import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verificar token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const token = authHeader.split(' ')[1];

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Verificar usuario con el token
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Sesión inválida' });
  }

  if (req.method === 'GET') {
    // Obtener perfil + análisis
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    const { data: analyses } = await supabase
      .from('fit_analyses')
      .select('id, score, job_title, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    return res.status(200).json({ profile, analyses: analyses || [] });
  }

  if (req.method === 'POST') {
    const { action, ...data } = req.body;

    if (action === 'update_visibility') {
      await supabase.from('profiles').update({ visible: data.visible }).eq('id', user.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'update_profile') {
      const allowed = ['nombre','apellido','rubro','seniority','ubicacion',
        'email_contacto','telefono','linkedin','genero',
        'mostrar_email','mostrar_telefono','mostrar_linkedin','mostrar_genero'];
      const update = {};
      allowed.forEach(k => { if (data[k] !== undefined) update[k] = data[k]; });
      const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (action === 'update_deseos') {
      const allowed = ['tipo_puesto','modalidad','seniority_deseado','disponibilidad',
        'rubros_interes','salario_ars','salario_usd','notas'];
      const update = {};
      allowed.forEach(k => { if (data[k] !== undefined) update[k] = data[k]; });
      const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Acción inválida' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
