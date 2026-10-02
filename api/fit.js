import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

const SYSTEM_PROMPT = `Sos un recruiter IT senior con 10 años de experiencia. 
Tu especialidad es evaluar la compatibilidad entre perfiles profesionales y descripciones de puesto.
Analizás CVs y JDs con criterio técnico y de negocio. Siempre respondés SOLO con JSON válido.`;

const ANALYSIS_PROMPT = `Analizá la compatibilidad entre el CV adjunto y la siguiente descripción de puesto.

DESCRIPCIÓN DEL PUESTO:
{JD}

Devolvé SOLO un JSON con exactamente esta estructura:
{
  "score": <número del 0 al 100>,
  "job_title": "<título del puesto detectado de la JD>",
  "matches": ["<match 1>", "<match 2>", "<match 3>", "<match 4>"],
  "gaps": ["<gap 1>", "<gap 2>", "<gap 3>"],
  "mejoras": ["<mejora 1>", "<mejora 2>", "<mejora 3>"],
  "entrevista": ["<punto 1>", "<punto 2>", "<punto 3>"]
}

Respondé SOLO con el JSON.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { cvBase64, jd, save, token } = req.body;

  if (!cvBase64 || typeof cvBase64 !== 'string') {
    return res.status(400).json({ error: 'CV requerido' });
  }
  if (!jd || typeof jd !== 'string' || jd.length < 50) {
    return res.status(400).json({ error: 'Descripción del puesto requerida' });
  }
  if (jd.length > 10000) {
    return res.status(400).json({ error: 'La descripción es demasiado larga' });
  }
  if (cvBase64.length > 7000000) {
    return res.status(400).json({ error: 'El archivo es demasiado grande' });
  }

  const prompt = ANALYSIS_PROMPT.replace('{JD}', jd);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: cvBase64 } },
            { type: 'text', text: prompt }
          ]
        }],
      }),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Error en la API de IA' });
    }

    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '';

    // Guardar en Supabase si hay token y save=true
    if (save && token) {
      try {
        const sb = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { autoRefreshToken: false, persistSession: false }
        });

        const { data: { user }, error: authError } = await sb.auth.getUser(token);
        if (user && !authError) {
          // Obtener plan del usuario
          const { data: profile } = await sb
            .from('profiles')
            .select('plan, fit_analyses_week_count, fit_analyses_week_reset_at')
            .eq('id', user.id)
            .single();

          if (!profile) {
            return res.status(500).json({ error: 'Perfil no encontrado' });
          }

          // VERIFICAR LÍMITES POR PLAN
          const now = new Date();
          let weekCount = profile.fit_analyses_week_count || 0;
          let resetAt = profile.fit_analyses_week_reset_at ? new Date(profile.fit_analyses_week_reset_at) : now;

          // Si pasó la fecha de reset, reiniciar contador
          if (now > resetAt) {
            weekCount = 0;
            // Siguiente lunes a las 00:00
            const nextMonday = new Date(now);
            nextMonday.setDate(nextMonday.getDate() + (1 + 7 - nextMonday.getDay()) % 7);
            nextMonday.setHours(0, 0, 0, 0);
            resetAt = nextMonday;
          }

          // Límites por plan
          const limits = {
            'free': 2,
            'pro': 15,
            'premium': 999 // Ilimitado
          };
          const limit = limits[profile.plan] || 2;

          // Verificar si llegó al límite
          if (weekCount >= limit) {
            return res.status(429).json({ 
              error: `Límite de ${limit} análisis por semana alcanzado para plan ${profile.plan}`,
              plan: profile.plan,
              used: weekCount,
              limit: limit,
              reset_at: resetAt
            });
          }

          // Guardar análisis
          const result = JSON.parse(text.replace(/```json|```/g, '').trim());
          await sb.from('fit_analyses').insert({
            user_id: user.id,
            score: result.score,
            job_title: result.job_title || null,
            matches: result.matches || [],
            gaps: result.gaps || [],
            mejoras: result.mejoras || [],
            entrevista: result.entrevista || [],
          });

          // Incrementar contador
          await sb.from('profiles').update({
            fit_analyses_week_count: weekCount + 1,
            fit_analyses_week_reset_at: resetAt
          }).eq('id', user.id);
        }
      } catch(e) {
        console.error('Error saving analysis:', e.message);
        // No falla el request principal
      }
    }

    return res.status(200).json({ text });

  } catch (error) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
