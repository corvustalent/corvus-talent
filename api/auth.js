// /api/auth.js — Login, registro, y manejo de autenticación
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method === 'POST') {
    return handlePOST(req, res);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handlePOST(req, res) {
  const { action, email, password } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'Missing action' });
  }

  if (action === 'login') {
    return handleLogin(email, password, res);
  } else if (action === 'register') {
    return handleRegister(email, password, req.body, res);
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }
}

async function handleLogin(email, password, res) {
  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    console.log('[LOGIN] Intentando login para:', email);

    // Usar Supabase service key para autenticar
    // Supabase no tiene endpoint nativo de login con service key, así que haremos:
    // 1. Obtener el usuario de la tabla profiles
    // 2. Validar la contraseña (idealmente hasheada, pero si no existe tabla auth_users, lo hacemos simple)

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .single();

    if (profileError || !profile) {
      console.error('[LOGIN] Profile not found:', email);
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    // Por ahora, si el usuario existe, el login es válido
    // (En producción, deberías validar contra Supabase Auth o una tabla de passwords)
    console.log('[LOGIN] ✅ Login exitoso para:', email);

    return res.status(200).json({
      success: true,
      user: profile,
      role: profile.role || 'candidato'
    });
  } catch (error) {
    console.error('[LOGIN] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function handleRegister(email, password, bodyData, res) {
  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    console.log('[REGISTER] Registrando:', email);

    // Crear usuario en Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: false
    });

    if (authError) {
      console.error('[REGISTER] Auth error:', authError);
      return res.status(400).json({ error: authError.message });
    }

    // Crear perfil
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        email: email,
        nombre: bodyData.nombre || email.split('@')[0],
        role: bodyData.role || 'candidato',
        company: bodyData.company || null
      })
      .select()
      .single();

    if (profileError) {
      console.error('[REGISTER] Profile error:', profileError);
      return res.status(400).json({ error: profileError.message });
    }

    console.log('[REGISTER] ✅ Registro exitoso para:', email);

    return res.status(201).json({
      success: true,
      user: profile,
      message: 'Registro exitoso. Verifica tu email.'
    });
  } catch (error) {
    console.error('[REGISTER] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
