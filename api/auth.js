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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;
  const sb = supabaseAdmin();

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
    });

    // Generar token de verificación
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24hs

    await sb.from('email_verification_tokens').insert({
      user_id: data.user.id,
      token,
      email,
      expires_at: expiresAt.toISOString(),
    });

    // Enviar email via Resend API directamente
    const verifyUrl = `${siteUrl}/api/verify?token=${token}`;
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
            <p style="color:#656D78;font-size:12px;margin-top:4px">O copiá este link: <a href="${verifyUrl}" style="color:#8FA8C8">${verifyUrl}</a></p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const emailError = await emailRes.json();
      console.error('Resend error:', emailError);
      // No fallamos el registro si el email falla — el admin puede confirmar manualmente
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
      .select('role, company, visible, nombre').eq('id', data.user.id).single();

    return res.status(200).json({
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: profile?.role,
        company: profile?.company,
        visible: profile?.visible,
        nombre: profile?.nombre,
      }
    });
  }

  // ── CREATE PROFILE (llamado desde frontend tras signUp) ───
  if (action === 'create_profile') {
    const { userId, email, role, company } = req.body;
    if (!userId || !email || !role) return res.status(400).json({ error: 'Datos faltantes' });
    await sb.from('profiles').upsert({ id: userId, email, role, company: company || null, visible: false });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Acción inválida' });
}
