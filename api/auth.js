import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { action, email, password, role, company } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    if (action === 'register') {
      if (!role || !['candidato', 'recruiter'].includes(role)) {
        return res.status(400).json({ error: 'Rol inválido' });
      }
      if (role === 'recruiter' && (!company || company.trim().length < 2)) {
        return res.status(400).json({ error: 'Nombre de empresa requerido' });
      }

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
        user_metadata: { role, company: role === 'recruiter' ? company.trim() : null }
      });

      if (error) {
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
        }
        return res.status(400).json({ error: error.message });
      }

      await supabaseAdmin.from('profiles').insert({
        id: data.user.id,
        email,
        role,
        company: role === 'recruiter' ? company.trim() : null,
        visible: false,
      });

      return res.status(200).json({ message: 'Cuenta creada. Revisá tu email para confirmar.' });

    } else if (action === 'login') {
      const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });

      if (error) {
        return res.status(401).json({ error: 'Email o contraseña incorrectos' });
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role, company, visible')
        .eq('id', data.user.id)
        .single();

      return res.status(200).json({
        token: data.session.access_token,
        user: {
          id: data.user.id,
          email: data.user.email,
          role: profile?.role,
          company: profile?.company,
          visible: profile?.visible,
          confirmed: !!data.user.email_confirmed_at,
        }
      });

    } else {
      return res.status(400).json({ error: 'Acción inválida' });
    }

  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
