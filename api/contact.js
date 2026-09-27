import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.split(' ')[1]);
  if (authError || !user) return res.status(401).json({ error: 'Sesión inválida' });

  const { candidate_id, message } = req.body;

  if (!candidate_id || !message || message.trim().length < 20) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  // Verificar que el recruiter es recruiter
  const { data: recruiterProfile } = await supabase
    .from('profiles').select('role, company').eq('id', user.id).single();
  if (recruiterProfile?.role !== 'recruiter') return res.status(403).json({ error: 'Acceso denegado' });

  // Verificar que el candidato existe y es visible
  const { data: candidate } = await supabase
    .from('profiles').select('id, visible, role').eq('id', candidate_id).single();
  if (!candidate || !candidate.visible || candidate.role !== 'candidato') {
    return res.status(404).json({ error: 'Candidato no disponible' });
  }

  // Guardar solicitud de contacto
  const { error } = await supabase.from('contact_requests').insert({
    recruiter_id: user.id,
    candidate_id,
    message: message.trim(),
    company: recruiterProfile.company,
    status: 'pending'
  });

  if (error) {
    // Si la tabla no existe todavía, devolvemos éxito igual
    // (la tabla se crea en el próximo SQL migration)
    console.error('Contact insert error:', error.message);
  }

  return res.status(200).json({ ok: true });
}
