// api/moderation.js - Solicitudes de contacto + Reportes de usuarios
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

const VALID_REPORT_TYPES = [
  'estafa',
  'inactividad_sospechosa',
  'acoso_hostigamiento',
  'perfil_falso',
  'cobranza_afuera',
  'otro'
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const token = authHeader.split(' ')[1];
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Sesión inválida' });
  }

  // ═══════════════════════════════════════════════════════════════
  // ── CONTACT REQUESTS (Solicitudes de contacto) ─────────────────
  // ═══════════════════════════════════════════════════════════════

  if (req.method === 'GET' && (req.query.type === 'received' || req.query.type === 'sent')) {
    const { type } = req.query;

    if (type === 'received') {
      const { data, error } = await supabase
        .from('contact_requests')
        .select(`
          id, recruiter_id, candidate_id, message, company, status, created_at,
          recruiter:profiles!recruiter_id(nombre, apellido, email, linkedin, company)
        `)
        .eq('candidate_id', user.id)
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    } else if (type === 'sent') {
      const { data, error } = await supabase
        .from('contact_requests')
        .select(`
          id, recruiter_id, candidate_id, message, company, status, created_at,
          candidate:profiles!candidate_id(nombre, apellido, email, linkedin, rubro)
        `)
        .eq('recruiter_id', user.id)
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    }
  }

  // ─── POST: Crear solicitud de contacto ──────────────────────
  if (req.method === 'POST' && req.body.action === 'send_contact_request') {
    const { candidate_id, message, company } = req.body;

    if (!candidate_id || !message) {
      return res.status(400).json({ error: 'candidate_id y message requeridos' });
    }

    // Verificar que es recruiter
    const { data: recruiterProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (recruiterProfile?.role !== 'recruiter') {
      return res.status(403).json({ error: 'Solo recruiters pueden enviar solicitudes' });
    }

    // Verificar que no existe solicitud previa
    const { data: existing } = await supabase
      .from('contact_requests')
      .select('id')
      .eq('recruiter_id', user.id)
      .eq('candidate_id', candidate_id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'La solicitud ya existe' });
    }

    const { data: newRequest, error: insertError } = await supabase
      .from('contact_requests')
      .insert({
        recruiter_id: user.id,
        candidate_id,
        message,
        company: company || null,
        status: 'pending'
      })
      .select()
      .single();

    if (insertError) return res.status(500).json({ error: insertError.message });
    return res.status(201).json(newRequest);
  }

  // ─── PATCH: Responder solicitud (aceptar/rechazar) ───────────
  if (req.method === 'PATCH' && req.body.action === 'respond_contact_request') {
    const { request_id, status } = req.body;

    if (!request_id || !['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'request_id y status requeridos' });
    }

    const { data: request } = await supabase
      .from('contact_requests')
      .select('candidate_id, recruiter_id')
      .eq('id', request_id)
      .single();

    if (!request) {
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }

    if (request.candidate_id !== user.id) {
      return res.status(403).json({ error: 'Solo el candidato puede responder' });
    }

    const { data: updated, error: updateError } = await supabase
      .from('contact_requests')
      .update({ status })
      .eq('id', request_id)
      .select()
      .single();

    if (updateError) return res.status(500).json({ error: updateError.message });

    // Tracking de reputación si es aceptado
    if (status === 'accepted') {
      const { data: recruiterProfile } = await supabase
        .from('profiles')
        .select('solicitudes_enviadas, solicitudes_aceptadas')
        .eq('id', request.recruiter_id)
        .single();

      if (recruiterProfile) {
        const newAceptadas = (recruiterProfile.solicitudes_aceptadas || 0) + 1;
        const newTasa = recruiterProfile.solicitudes_enviadas > 0
          ? (newAceptadas / recruiterProfile.solicitudes_enviadas) * 100
          : 0;

        await supabase
          .from('profiles')
          .update({
            solicitudes_aceptadas: newAceptadas,
            tasa_aceptacion: newTasa
          })
          .eq('id', request.recruiter_id);
      }

      // Crear conversación automáticamente
      try {
        const { data: existingConv } = await supabase
          .from('conversations')
          .select('id')
          .eq('recruiter_id', request.recruiter_id)
          .eq('candidate_id', user.id)
          .maybeSingle();

        if (!existingConv) {
          await supabase.from('conversations').insert({
            recruiter_id: request.recruiter_id,
            candidate_id: user.id,
            contact_request_id: request_id,
            status: 'active'
          });
        }
      } catch (e) {
        console.error('Error creating conversation:', e);
      }
    }

    return res.status(200).json(updated);
  }

  // ═══════════════════════════════════════════════════════════════
  // ── REPORTS (Reportes de usuarios) ────────────────────────────
  // ═══════════════════════════════════════════════════════════════

  // ─── GET: Ver reportes (solo admin) ────────────────────────
  if (req.method === 'GET' && req.query.action === 'list_reports') {
    if (user.email !== 'corvus.talent@gmail.com') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { status, limit = 50, offset = 0 } = req.query;

    try {
      let query = supabase
        .from('reports')
        .select(`
          id, reporter_id, reported_user_id, report_type, description,
          evidence_url, status, resolution, created_at, resolved_at
        `)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data: reports, error, count } = await query
        .range(offset, offset + limit - 1);

      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({
        reports: reports || [],
        total: count,
        limit,
        offset
      });
    } catch (e) {
      return res.status(500).json({ error: 'Error al obtener reportes' });
    }
  }

  // ─── POST: Crear reporte ─────────────────────────────────
  if (req.method === 'POST' && req.body.action === 'create_report') {
    const { reported_user_id, report_type, description, evidence_url, conversation_id } = req.body;

    // Validaciones
    if (!reported_user_id || typeof reported_user_id !== 'string') {
      return res.status(400).json({ error: 'Usuario a reportar requerido' });
    }
    if (!report_type || !VALID_REPORT_TYPES.includes(report_type)) {
      return res.status(400).json({ error: 'Tipo de reporte inválido' });
    }
    if (!description || description.length < 10 || description.length > 1000) {
      return res.status(400).json({ error: 'Descripción entre 10 y 1000 caracteres' });
    }

    if (user.id === reported_user_id) {
      return res.status(400).json({ error: 'No puedes reportarte a ti mismo' });
    }

    // Verificar que el usuario existe
    const { data: reportedUser } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', reported_user_id)
      .single();

    if (!reportedUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    try {
      const { data, error } = await supabase.from('reports').insert({
        reporter_id: user.id,
        reported_user_id,
        report_type,
        description,
        evidence_url: evidence_url || null,
        conversation_id: conversation_id || null,
        status: 'pending'
      }).select();

      if (error) return res.status(500).json({ error: error.message });

      return res.status(201).json({
        ok: true,
        report_id: data?.[0]?.id,
        message: 'Reporte enviado. Nuestro equipo lo revisará pronto.'
      });
    } catch (e) {
      return res.status(500).json({ error: 'Error al crear reporte' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
