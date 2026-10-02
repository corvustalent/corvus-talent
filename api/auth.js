import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const siteUrl = 'https://corvustalent.com.ar';

const supabaseAdmin = () => createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sb = supabaseAdmin();

  // ── GET: VERIFICAR EMAIL (desde link) ──────────────────────
  if (req.method === 'GET') {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send(errorPage('Token inválido', 'El link de verificación no es válido.'));
    }

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

  // POST REQUESTS BELOW
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  // ── REGISTER ──────────────────────────────────────────────
  if (action === 'register') {
    const { email, password, role, company } = req.body;

    if (!email || !password || !role) return res.status(400).json({ error: 'Datos requeridos faltantes' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email inválido' });
    if (password.length < 8) return res.status(400).json({ error: 'Contraseña demasiado corta' });
    if (!/[A-Z]/.test(password)) return res.status(400).json({ error: 'La contraseña debe tener al menos una mayúscula' });
    if (!/[0-9]/.test(password)) return res.status(400).json({ error: 'La contraseña debe tener al menos un número' });
    if (!['candidato', 'recruiter'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
    if (role === 'recruiter' && !company?.trim()) return res.status(400).json({ error: 'Nombre de empresa requerido' });

    // Crear usuario sin confirmación automática
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
    });

    if (error) {
      if (error.message.includes('already registered') || error.message.includes('already been registered')) {
        return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
      }
      return res.status(400).json({ error: error.message });
    }

    // Crear perfil
    await sb.from('profiles').insert({
      id: data.user.id,
      email,
      role,
      company: role === 'recruiter' ? company.trim() : null,
      visible: false,
      plan: 'free',
    });

    // Generar token de verificación
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24hs

    await sb.from('email_verification_tokens').insert({
      user_id: data.user.id,
      token: verifyToken,
      email,
      expires_at: expiresAt.toISOString(),
    });

    // Enviar email via Resend
    const verifyUrl = `${siteUrl}/api/auth?token=${verifyToken}`;
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: 'Corvus Talent <noreply@corvustalent.com.ar>',
        to: email,
        subject: 'Confirmá tu cuenta en Corvus Talent',
        html: `
          <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;background:#0A1628;color:#FFFFFF;padding:40px;border-radius:12px">
            <h1 style="font-size:24px;margin-bottom:8px">Bienvenido a <span style="color:#8FA8C8">Corvus Talent</span></h1>
            <p style="color:#9CA3AF;margin-bottom:32px">Hacé clic en el botón para confirmar tu cuenta y empezar a usar el ecosistema.</p>
            <a href="${verifyUrl}" style="display:inline-block;background:#FFFFFF;color:#0A1628;padding:14px 28px;border-radius:8px;font-weight:600;text-decoration:none;font-size:15px">Confirmar mi cuenta</a>
            <p style="color:#656D78;margin-top:32px;font-size:12px">Este link vence en 24 horas. Si no creaste esta cuenta, ignorá este email.</p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      console.error('Resend error:', await emailRes.json());
    }

    return res.status(200).json({ message: 'Cuenta creada. Revisá tu email para confirmar.' });
  }

  // ── LOGIN ─────────────────────────────────────────────────
  if (action === 'login') {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const sbAnon = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await sbAnon.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

    if (!data.user.email_confirmed_at) {
      return res.status(403).json({ error: 'Confirmá tu email antes de ingresar. Revisá tu casilla.' });
    }

    const { data: profile } = await sb.from('profiles')
      .select('role, company, visible, nombre, plan').eq('id', data.user.id).single();

    return res.status(200).json({
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: profile?.role,
        company: profile?.company,
        visible: profile?.visible,
        nombre: profile?.nombre,
        plan: profile?.plan || 'free',
      }
    });
  }

  // ── CREATE PROFILE ────────────────────────────────────────
  if (action === 'create_profile') {
    const { userId, email, role, company } = req.body;
    if (!userId || !email || !role) return res.status(400).json({ error: 'Datos faltantes' });
    await sb.from('profiles').upsert({ 
      id: userId, 
      email, 
      role, 
      company: company || null, 
      visible: false,
      plan: 'free'
    });
    return res.status(200).json({ ok: true });
  }

  // ── REQUEST PASSWORD RESET (email) ────────────────────────
  if (action === 'request_reset') {
    const { email } = req.body;
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(200).json({ ok: true }); // No revelar
    }

    const { data: { users } } = await sb.auth.admin.listUsers();
    const user = users?.find(u => u.email === email);
    if (!user) return res.status(200).json({ ok: true });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await sb.from('email_verification_tokens').insert({
      user_id: user.id,
      token: resetToken,
      email,
      expires_at: expiresAt.toISOString(),
    });

    const resetUrl = `${siteUrl}/reset-password?token=${resetToken}`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${resendApiKey}` 
      },
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

  // ── CHANGE PASSWORD (token + newPassword) ──────────────────
  if (action === 'reset_password') {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token y contraseña requeridos' });
    }

    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'Contraseña no cumple los requisitos' });
    }

    const { data: tokenData, error } = await sb
      .from('email_verification_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (error || !tokenData) return res.status(400).json({ error: 'Token inválido' });
    if (tokenData.used_at) return res.status(400).json({ error: 'Este link ya fue usado' });
    if (new Date(tokenData.expires_at) < new Date()) return res.status(400).json({ error: 'El link venció' });

    await sb.auth.admin.updateUserById(tokenData.user_id, { password: newPassword });
    await sb.from('email_verification_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Acción inválida' });
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
