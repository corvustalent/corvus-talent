// /api/profile.js — Perfil + Contact Requests + Email Notifications (CONSOLIDADO + FIXED)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Campos permitidos para actualizar en profiles
const ALLOWED_UPDATE_FIELDS = [
  'nombre', 'apellido', 'telefono', 'linkedin',
  'pais', 'provincia', 'ciudad',
  'rubro', 'seniority', 'seniority_deseado',
  'modalidad', 'disponibilidad',
  'salario_ars', 'salario_usd',
  'visible', 'descripcion', 'company', 'notas'
];

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.substring(7).trim();
  if (req.body && req.body.token) return req.body.token;
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/corvus_token=([^;]+)/);
  return match ? match[1] : null;
}

function getEmailFromToken(token) {
  if (!token) return null;
  token = token.trim();
  if (token.includes('|')) return token.split('|')[0].trim();
  if (token.includes('@')) return token;
  return null;
}

async function sendEmail(email, subject, htmlContent) {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: 'corvus.talent@gmail.com', to: email, subject, html: htmlContent }),
    });
    if (!response.ok) {
      console.error('[sendEmail] Resend error:', response.statusText);
      return false;
    }
    console.log('[sendEmail] Sent to', email);
    return true;
  } catch (error) {
    console.error('[sendEmail] Error:', error);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return handleGET(req, res);
  else if (req.method === 'POST') return handlePOST(req, res);
  else if (req.method === 'PATCH') return handlePATCH(req, res);
  else res.status(405).json({ error: 'Method not allowed' });
}

async function handleGET(req, res) {
  try {
    const token = extractToken(req);
    const email = getEmailFromToken(token);
    if (!email) return res.status(401).json({ error: 'Invalid token' });

    // GET solicitudes ENVIADAS
    if (req.query.type === 'contact_requests') {
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('recruiter_email', email)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('[GET contact_requests] Error:', error.message);
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json(data || []);
    }

    // GET solicitudes RECIBIDAS
    if (req.query.type === 'received_requests') {
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('candidate_email', email)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('[GET received_requests] Error:', error.message);
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json(data || []);
    }

    // GET perfil del usuario
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .single();

    if (error) {
      console.error('[GET profile] Error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: 'Profile not found' });
    return res.status(200).json(data);
  } catch (error) {
    console.error('[GET] Unhandled error:', error);
    res.status(500).json({ error: error.message });
  }
}

async function handlePOST(req, res) {
  try {
    const token = extractToken(req);
    const email = getEmailFromToken(token);
    if (!email) return res.status(401).json({ error: 'Invalid token' });

    const { action } = req.body;

    // POST: crear solicitud de contacto
    if (action === 'contact_create') {
      const { candidate_email, message, company } = req.body;
      if (!candidate_email) return res.status(400).json({ error: 'candidate_email requerido' });

      // Verificar que no exista solicitud previa
      const { data: existing } = await supabase
        .from('contact_requests')
        .select('id')
        .eq('recruiter_email', email)
        .eq('candidate_email', candidate_email)
        .maybeSingle();

      if (existing) return res.status(400).json({ error: 'Ya enviaste una solicitud a este candidato' });

      // Crear solicitud
      const { data, error } = await supabase
        .from('contact_requests')
        .insert({
          recruiter_email: email,
          candidate_email: candidate_email,
          message: message || null,
          company: company || 'Sin especificar',
          status: 'pending',
          created_at: new Date().toISOString()
        })
        .select();

      if (error) {
        console.error('[contact_create] Insert error:', error.message);
        return res.status(500).json({ error: error.message });
      }

      // Obtener datos del candidato para el email
      const { data: candidateProfile } = await supabase
        .from('profiles')
        .select('nombre')
        .eq('email', candidate_email)
        .single();

      // Obtener datos del recruiter
      const { data: recruiterData } = await supabase
        .from('profiles')
        .select('nombre, company')
        .eq('email', email)
        .single();

      const recruiterName = recruiterData?.nombre || 'Un recruiter';
      const recruiterCompany = recruiterData?.company || company || 'Una empresa';

      // Enviar email al candidato
      const emailHTML = `
        <h2>¡Tienes una nueva solicitud de contacto!</h2>
        <p>Hola ${candidateProfile?.nombre},</p>
        <p><strong>${recruiterName}</strong> de <strong>${recruiterCompany}</strong> quiere contactarte.</p>
        <p><strong>Mensaje:</strong></p>
        <blockquote style="background: #f5f5f5; padding: 1rem; border-left: 3px solid #8FA8C8;">${message || '(Sin mensaje)'}</blockquote>
        <p><a href="https://corvustalent.com.ar/dashboard/candidato" style="background: #0A1628; color: white; padding: 0.5rem 1rem; border-radius: 4px; text-decoration: none; display: inline-block;">Responder en tu dashboard</a></p>
        <hr>
        <p><small>— Corvus Talent</small></p>
      `;

      await sendEmail(candidate_email, `Nueva solicitud de contacto de ${recruiterCompany}`, emailHTML);

      return res.status(201).json(data[0]);
    }

    // POST: actualizar perfil del usuario (CON VALIDACIÓN)
    const updates = {};
    
    // Filtrar solo campos permitidos y excluir nulls/vacíos innecesarios
    for (const [key, value] of Object.entries(req.body)) {
      if (key === 'email' || key === 'action') continue; // Nunca actualizar email
      if (!ALLOWED_UPDATE_FIELDS.includes(key)) {
        console.warn(`[POST] Campo ignorado (no permitido): ${key}`);
        continue;
      }
      // Permitir false/0 pero no undefined
      if (value !== undefined && value !== '') {
        updates[key] = value;
      }
    }

    console.log('[POST] Actualizando perfil de', email, 'con:', Object.keys(updates).join(', '));

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('email', email)
      .select()
      .single();

    if (error) {
      console.error('[POST] Update error:', error.message, 'Code:', error.code);
      return res.status(500).json({ error: error.message, code: error.code });
    }
    if (!data) return res.status(404).json({ error: 'Profile not found after update' });
    return res.status(200).json(data);
  } catch (error) {
    console.error('[POST] Unhandled error:', error);
    res.status(500).json({ error: error.message });
  }
}

async function handlePATCH(req, res) {
  try {
    const token = extractToken(req);
    const email = getEmailFromToken(token);
    if (!email) return res.status(401).json({ error: 'Invalid token' });

    const { request_id, status } = req.body;
    if (!request_id || !['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'request_id and valid status required' });
    }

    console.log('[PATCH] Updating request', request_id, 'to status:', status);

    // Actualizar solicitud
    const { data, error } = await supabase
      .from('contact_requests')
      .update({ status })
      .eq('id', request_id)
      .eq('candidate_email', email)
      .select();

    if (error) {
      console.error('[PATCH] Update error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data || data.length === 0) return res.status(404).json({ error: 'Request not found or not authorized' });

    const request = data[0];

    // Si fue aceptada, enviar email al recruiter
    if (status === 'accepted') {
      const { data: candidateData } = await supabase
        .from('profiles')
        .select('nombre')
        .eq('email', email)
        .single();

      const candidateName = candidateData?.nombre || 'Un candidato';
      const emailHTML = `
        <h2>¡Solicitud aceptada! 🎉</h2>
        <p>Hola,</p>
        <p><strong>${candidateName}</strong> aceptó tu solicitud de contacto.</p>
        <p><a href="https://corvustalent.com.ar/dashboard/recruiter">Ir al dashboard</a></p>
        <hr>
        <p><small>— Corvus Talent</small></p>
      `;
      await sendEmail(request.recruiter_email, `${candidateName} aceptó tu solicitud`, emailHTML);
    }

    return res.status(200).json(request);
  } catch (error) {
    console.error('[PATCH] Unhandled error:', error);
    res.status(500).json({ error: error.message });
  }
}
