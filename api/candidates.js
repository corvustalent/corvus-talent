import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.split(' ')[1]);
  if (authError || !user) return res.status(401).json({ error: 'Sesión inválida' });

  // Verificar que es recruiter
  const { data: recruiterProfile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  if (recruiterProfile?.role !== 'recruiter') return res.status(403).json({ error: 'Acceso denegado' });

  const { rubro, seniority, modalidad, disponibilidad, min_score } = req.query;

  // Obtener candidatos visibles con su mejor score
  let query = supabase
    .from('profiles')
    .select(`
      id, nombre, apellido, rubro, seniority, ubicacion,
      email_contacto, telefono, linkedin, genero,
      mostrar_email, mostrar_telefono, mostrar_linkedin, mostrar_genero,
      tipo_puesto, modalidad, seniority_deseado, disponibilidad,
      rubros_interes, notas
    `)
    .eq('visible', true)
    .eq('role', 'candidato');

  if (rubro) query = query.eq('rubro', rubro);
  if (seniority) query = query.eq('seniority', seniority);
  if (modalidad) query = query.eq('modalidad', modalidad);
  if (disponibilidad) query = query.eq('disponibilidad', disponibilidad);

  const { data: candidates, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Para cada candidato obtener su mejor score de Corvus Fit
  const candidatesWithScores = await Promise.all(
    (candidates || []).map(async c => {
      const { data: analyses } = await supabase
        .from('fit_analyses')
        .select('score')
        .eq('user_id', c.id)
        .order('score', { ascending: false })
        .limit(1);

      const bestScore = analyses?.[0]?.score || null;
      return { ...c, best_score: bestScore };
    })
  );

  // Filtrar por score mínimo si se especificó
  const filtered = min_score
    ? candidatesWithScores.filter(c => (c.best_score || 0) >= parseInt(min_score))
    : candidatesWithScores;

  // Ordenar por score descendente
  filtered.sort((a, b) => (b.best_score || 0) - (a.best_score || 0));

  return res.status(200).json({ candidates: filtered });
}
