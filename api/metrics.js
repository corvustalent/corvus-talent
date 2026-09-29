import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_EMAIL = 'corvus.talent@gmail.com';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: { user }, error } = await sb.auth.getUser(authHeader.split(' ')[1]);
  if (error || !user || user.email !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  try {
    const [
      { count: total_candidatos },
      { count: total_recruiters },
      { count: candidatos_visibles },
      { count: total_analisis },
      { count: analisis_ultima_semana },
      { data: score_data },
      { count: registros_ultima_semana },
      { count: total_solicitudes_contacto },
      { data: rubros },
      { data: registros },
    ] = await Promise.all([
      sb.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'candidato'),
      sb.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'recruiter'),
      sb.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'candidato').eq('visible', true),
      sb.from('fit_analyses').select('*', { count: 'exact', head: true }),
      sb.from('fit_analyses').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      sb.from('fit_analyses').select('score'),
      sb.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      sb.from('contact_requests').select('*', { count: 'exact', head: true }),
      sb.rpc('get_top_rubros').limit ? sb.from('profiles').select('rubro').eq('role', 'candidato').not('rubro', 'is', null) : sb.from('profiles').select('rubro').eq('role', 'candidato').not('rubro', 'is', null),
      sb.from('profiles').select('created_at').gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).order('created_at', { ascending: false }),
    ]);

    // Calcular score promedio
    const scores = score_data?.map(a => a.score).filter(s => s !== null) || [];
    const score_promedio = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    // Calcular top rubros manualmente
    const rubroCount = {};
    (rubros || []).forEach(p => {
      if (p.rubro) rubroCount[p.rubro] = (rubroCount[p.rubro] || 0) + 1;
    });
    const topRubros = Object.entries(rubroCount)
      .map(([rubro, total]) => ({ rubro, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // Calcular registros por día
    const regByDay = {};
    (registros || []).forEach(p => {
      const day = p.created_at?.split('T')[0];
      if (day) regByDay[day] = (regByDay[day] || 0) + 1;
    });
    const registrosPorDia = Object.entries(regByDay)
      .map(([fecha, registros]) => ({ fecha, registros }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    return res.status(200).json({
      metrics: {
        total_candidatos, total_recruiters, candidatos_visibles,
        total_analisis, analisis_ultima_semana, score_promedio,
        registros_ultima_semana, total_solicitudes_contacto,
      },
      rubros: topRubros,
      registros: registrosPorDia,
    });

  } catch(e) {
    console.error('Metrics error:', e.message);
    return res.status(500).json({ error: 'Error interno' });
  }
}
