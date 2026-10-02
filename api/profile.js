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

    // CALCULAR BADGES SEGÚN ROLE
    const badges = [];
    
    if (profile) {
      if (profile.role === 'recruiter') {
        // BADGES PARA RECRUITER
        
        // Badge 1: Verificado (email corporativo verificado)
        if (profile.corporate_email_verified === true) {
          badges.push({
            id: 'verified',
            icon: '🔵',
            name: 'Verificado',
            color: '#3B82F6'
          });
        }

        // Badge 2: De confianza (verificado + 80%+ aceptación + 5+ contactos)
        if (profile.corporate_email_verified === true && 
            profile.solicitudes_enviadas >= 5 &&
            profile.tasa_aceptacion >= 80) {
          badges.push({
            id: 'trusted',
            icon: '⭐',
            name: 'De confianza',
            color: '#FBBF24'
          });
        }
      } else {
        // BADGES PARA CANDIDATO
        
        // Badge 1: Perfil completo (5+ campos llenos)
        const requiredFields = ['nombre', 'apellido', 'rubro', 'seniority', 'ubicacion'];
        const filledCount = requiredFields.filter(f => profile[f]).length;
        if (filledCount >= 5) {
          badges.push({
            id: 'profile_complete',
            icon: '✅',
            name: 'Perfil completo',
            color: '#4ADE80'
          });
        }

        // Badge 2: Analizado (≥1 análisis)
        if (analyses && analyses.length > 0) {
          badges.push({
            id: 'analyzed',
            icon: '📊',
            name: 'Analizado',
            color: '#3B82F6'
          });
        }

        // Badge 3: Activo (visible = true)
        if (profile.visible === true) {
          badges.push({
            id: 'active',
            icon: '🎯',
            name: 'Activo',
            color: '#8FA8C8'
          });
        }

        // Badge 4: Score alto (max score ≥75)
        if (analyses && analyses.length > 0) {
          const maxScore = Math.max(...analyses.map(a => a.score || 0));
          if (maxScore >= 75) {
            badges.push({
              id: 'high_score',
              icon: '🔥',
              name: 'Score alto',
              color: '#F59E0B'
            });
          }
        }
      }
    }

    return res.status(200).json({ 
      profile, 
      analyses: analyses || [],
      badges: badges
    });
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
