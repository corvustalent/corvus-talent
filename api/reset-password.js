import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const siteUrl = 'https://corvustalent.com.ar';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { email, token, newPassword } = req.body;

  // ── CAMBIAR CONTRASEÑA (token + newPassword) ──────────────
  if (token && newPassword) {
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'Contraseña no cumple los requisitos' });
    }

    const { data: tokenData, error } = await sb
      .from('email_verification_tokens')
      .select('*').eq('token', token).single();

    if (error || !tokenData) return res.status(400).json({ error: 'Token inválido' });
    if (tokenData.used_at) return res.status(400).json({ error: 'Este link ya fue usado' });
    if (new Date(tokenData.expires_at) < new Date()) return res.status(400).json({ error: 'El link venció' });

    await sb.auth.admin.updateUserById(tokenData.user_id, { password: newPassword });
    await sb.from('email_verification_tokens').update({ used_at: new Date().toISOString() }).eq('token', token);

    return res.status(200).json({ ok: true });
  }

  // ── SOLICITAR RESET (email) ───────────────────────────────
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(200).json({ ok: true }); // No revelar
    }

    const { data: { users } } = await sb.auth.admin.listUsers();
    const user = users?.find(u => u.email === email);
    if (!user) return res.status(200).json({ ok: true });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await sb.from('email_verification_tokens').insert({
      user_id: user.id, token: resetToken, email,
      expires_at: expiresAt.toISOString(),
    });

    const resetUrl = `${siteUrl}/reset-password?token=${resetToken}`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
      body: JSON.stringify({
        from: 'Corvus Talent <noreply@corvustalent.com.ar>',
        to: email,
        subject: 'Restablecer contraseña — Corvus Talent',
        html: `
          <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;background:#0A1628;color:#FFFFFF;padding:40px;border-radius:12px">
            <h1 style="font-size:22px;margin-bottom:8px">Restablecer <span style="color:#8FA8C8">contraseña</span></h1>
            <p style="color:#9CA3AF;margin-bottom:32px">Hacé clic en el botón para crear una nueva contraseña. El link vence en 1 hora.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#FFFFFF;color:#0A1628;padding:14px 28px;border-radius:8px;font-weight:600;text-decoration:none">Restablecer contraseña</a>
            <p style="color:#656D78;margin-top:32px;font-size:12px">Si no solicitaste esto, ignorá este email.</p>
          </div>
        `,
      }),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Datos inválidos' });
}
