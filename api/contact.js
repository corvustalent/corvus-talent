import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: { user }, error: authError } = await sb.auth.getUser(authHeader.split(' ')[1]);
  if (authError || !user) return res.status(401).json({ error: 'Sesión inválida' });

  const { data: userProfile } = await sb.from('profiles').select('role, company').eq('id', user.id).single();

  // ── GET: listar solicitudes del candidato ─────────────────
  if (req.method === 'GET') {
    const { action } = req.query;
    if (action !== 'list') return res.status(400).json({ error: 'Acción inválida' });

    if (userProfile?.role !== 'candidato') return res.status(403).json({ error: 'Solo candidatos' });

    const { data: solicitudes } = await sb
      .from('contact_requests')
      .select('id, company, message, status, created_at')
      .eq('candidate_id', user.id)
      .order('created_at', { ascending: false });

    return res.status(200).json({ solicitudes: solicitudes || [] });
  }

  // ── POST ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body;

    // Recruiter envía solicitud
    if (!action || action === 'send') {
      if (userProfile?.role !== 'recruiter') return res.status(403).json({ error: 'Solo recruiters' });

      const { candidate_id, message } = req.body;
      if (!candidate_id || !message || message.trim().length < 20) {
        return res.status(400).json({ error: 'Datos inválidos' });
      }

      const { data: candidate } = await sb
        .from('profiles').select('id, visible, role').eq('id', candidate_id).single();
      if (!candidate || !candidate.visible || candidate.role !== 'candidato') {
        return res.status(404).json({ error: 'Candidato no disponible' });
      }

      await sb.from('contact_requests').insert({
        recruiter_id: user.id,
        candidate_id,
        message: message.trim(),
        company: userProfile.company,
        status: 'pending'
      });

      return res.status(200).json({ ok: true });
    }

    // Candidato responde solicitud
    if (action === 'respond') {
      if (userProfile?.role !== 'candidato') return res.status(403).json({ error: 'Solo candidatos' });

      const { solicitud_id, status } = req.body;
      if (!solicitud_id || !['accepted', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Datos inválidos' });
      }

      // Verificar que la solicitud le pertenece
      const { data: solicitud } = await sb
        .from('contact_requests').select('id, candidate_id').eq('id', solicitud_id).single();
      if (!solicitud || solicitud.candidate_id !== user.id) {
        return res.status(403).json({ error: 'No autorizado' });
      }

      await sb.from('contact_requests').update({ status }).eq('id', solicitud_id);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Acción inválida' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
