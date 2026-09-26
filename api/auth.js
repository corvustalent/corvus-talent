import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { action, email, password, role, company } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  // Validaciones
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    if (action === 'register') {
      if (!role || !['candidato', 'recruiter'].includes(role)) {
        return res.status(400).json({ error: 'Rol inválido' });
      }
      if (role === 'recruiter' && (!company || company.trim().length < 2)) {
        return res.status(400).json({ error: 'Nombre de empresa requerido' });
      }

      // Crear usuario en Supabase Auth
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false, // requiere verificación
        user_metadata: {
          role,
          company: role === 'recruiter' ? company.trim() : null,
        }
      });

      if (error) {
        if (error.message.includes('already registered')) {
          return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
        }
        return res.status(400).json({ error: error.message });
      }

      // Insertar perfil en tabla profiles
      await supabase.from('profiles').insert({
        id: data.user.id,
        email,
        role,
        company: role === 'recruiter' ? company.trim() : null,
        visible: false, // candidatos no visibles por defecto
      });

      return res.status(200).json({ message: 'Cuenta creada. Revisá tu email para confirmar.' });

    } else if (action === 'login') {
      const { createClient: createClientAnon } = await import('@supabase/supabase-js');
      const supabaseAnon = createClientAnon(supabaseUrl, process.env.SUPABASE_ANON_KEY);

      const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });

      if (error) {
        return res.status(401).json({ error: 'Email o contraseña incorrectos' });
      }

      // Obtener perfil
      const { data: profile } = await supabase
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
          confirmed: data.user.email_confirmed_at !== null,
        }
      });

    } else {
      return res.status(400).json({ error: 'Acción inválida' });
    }

  } catch (error) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
