import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(errorPage('Token inválido', 'El link de verificación no es válido.'));
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Buscar token
  const { data: tokenData, error } = await sb
    .from('email_verification_tokens')
    .select('*')
    .eq('token', token)
    .single();

  if (error || !tokenData) {
    return res.status(400).send(errorPage('Token inválido', 'Este link de verificación no existe o ya fue usado.'));
  }

  if (tokenData.used_at) {
    return res.status(400).send(errorPage('Ya confirmado', 'Esta cuenta ya fue confirmada anteriormente.'));
  }

  if (new Date(tokenData.expires_at) < new Date()) {
    return res.status(400).send(errorPage('Link vencido', 'Este link de verificación venció. Registrate de nuevo.'));
  }

  // Confirmar email en Supabase Auth
  await sb.auth.admin.updateUserById(tokenData.user_id, {
    email_confirm: true,
  });

  // Marcar token como usado
  await sb.from('email_verification_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token);

  // Redirigir a login con mensaje de éxito
  return res.redirect(302, '/auth?verified=1');
}

function errorPage(title, message) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${title} — Corvus Talent</title>
<style>body{font-family:Inter,sans-serif;background:#0A1628;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center}
.card{background:#142038;border:1px solid rgba(143,168,200,0.2);border-radius:14px;padding:40px;max-width:400px}
h1{margin-bottom:12px;color:#F87171}p{color:#9CA3AF;margin-bottom:24px}
a{background:#fff;color:#0A1628;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600}</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p><a href="/auth">Ir al inicio</a></div></body></html>`;
}
