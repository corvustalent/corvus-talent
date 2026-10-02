// api/corvus.js - Análisis de compatibilidad + Generación de JD
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════

const FIT_SYSTEM_PROMPT = `Sos un recruiter IT senior con 10 años de experiencia. 
Tu especialidad es evaluar la compatibilidad entre perfiles profesionales y descripciones de puesto.
Analizás CVs y JDs con criterio técnico y de negocio. Siempre respondés SOLO con JSON válido.`;

const GENERATE_SYSTEM_PROMPT = `Sos un recruiter IT senior con 10 años de experiencia en selección de talento.
Tu especialidad es redactar Job Descriptions profesionales, atractivas y efectivas.
Usás bullets con "·" (punto centrado). Sin títulos con #. Tono según lo indicado.`;

// ═══════════════════════════════════════════════════════════════
// PROMPTS DE ANÁLISIS
// ═══════════════════════════════════════════════════════════════

const FIT_ANALYSIS_PROMPT = `Analizá la compatibilidad entre el CV adjunto y la siguiente descripción de puesto.

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ═══════════════════════════════════════════════════════════════
  // ── CORVUS FIT: Análisis CV vs JD ─────────────────────────────
  // ═══════════════════════════════════════════════════════════════

  if (req.body.action === 'analyze_fit') {
    const { cvBase64, jd, token } = req.body;

    // Validaciones
    if (!cvBase64 || typeof cvBase64 !== 'string') {
      return res.status(400).json({ error: 'CV requerido' });
    }
    if (!jd || typeof jd !== 'string' || jd.length < 50) {
      return res.status(400).json({ error: 'Descripción del puesto requerida (mín 50 caracteres)' });
    }
    if (jd.length > 10000) {
      return res.status(400).json({ error: 'Descripción demasiado larga (máx 10000 caracteres)' });
    }
    if (cvBase64.length > 7000000) {
      return res.status(400).json({ error: 'Archivo demasiado grande (máx 7MB)' });
    }

    const prompt = FIT_ANALYSIS_PROMPT.replace('{JD}', jd);

    try {
      const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: FIT_SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: [
              { 
                type: 'document', 
                source: { 
                  type: 'base64', 
                  media_type: 'application/pdf', 
                  data: cvBase64 
                } 
              },
              { type: 'text', text: prompt }
            ]
          }],
        }),
      });

      if (!aiResponse.ok) {
        return res.status(502).json({ error: 'Error en API de IA' });
      }

      const aiData = await aiResponse.json();
      const analysisText = aiData.content?.map(b => b.text || '').join('') || '';

      // Guardar en Supabase si hay token
      if (token) {
        try {
          const sb = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
          });

          const { data: { user } } = await sb.auth.getUser(token);
          if (user) {
            const result = JSON.parse(analysisText.replace(/```json|```/g, '').trim());
            await sb.from('fit_analyses').insert({
              user_id: user.id,
              score: result.score,
              job_title: result.job_title || null,
              matches: result.matches || [],
              gaps: result.gaps || [],
              mejoras: result.mejoras || [],
              entrevista: result.entrevista || [],
              job_description: jd
            });
          }
        } catch (saveError) {
          console.error('Error saving fit analysis:', saveError.message);
          // No falla el request principal
        }
      }

      return res.status(200).json({ text: analysisText });

    } catch (error) {
      console.error('Fit analysis error:', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ── CORVUS CRAFT: Generación de JD ────────────────────────────
  // ═══════════════════════════════════════════════════════════════

  if (req.body.action === 'generate_jd') {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: { user }, error: authError } = await sb.auth.getUser(authHeader.split(' ')[1]);
    if (authError || !user) {
      return res.status(401).json({ error: 'Sesión inválida' });
    }

    const { title, industry, seniority, modality, companyType, skills, responsibilities, lang, tone } = req.body;

    // Validaciones
    if (!title || typeof title !== 'string' || title.length > 200) {
      return res.status(400).json({ error: 'Título del puesto requerido (máx 200 caracteres)' });
    }

    const langInstruction = lang === 'en'
      ? 'Write the entire job description in English.'
      : 'Escribí toda la descripción en español (Argentina).';

    const toneMap = {
      'Profesional': 'profesional y claro',
      'Dinámico': 'dinámico y energético',
      'Cercano': 'cercano y humano, usando "vos"',
      'Técnico': 'técnico y preciso',
      'Corporativo': 'formal y corporativo',
    };
    const toneDesc = toneMap[tone] || 'profesional';

    const userMessage = [
      langInstruction,
      `Tono: ${toneDesc}.`,
      `Título del puesto: ${title}`,
      industry ? `Rubro: ${industry}` : '',
      seniority ? `Seniority: ${seniority}` : '',
      modality ? `Modalidad: ${modality}` : '',
      companyType ? `Tipo de empresa: ${companyType}` : '',
      skills ? `Skills técnicas: ${skills}` : '',
      responsibilities ? `Responsabilidades principales: ${responsibilities}` : '',
      'Incluí estas secciones: Sobre el rol (2-3 oraciones), Responsabilidades (5-7 bullets), Requisitos (4-6 bullets), Deseable (2-3 bullets), Lo que ofrecemos (3-4 bullets).',
    ].filter(Boolean).join('\n');

    try {
      const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: GENERATE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });

      if (!aiResponse.ok) {
        return res.status(502).json({ error: 'Error en API de IA' });
      }

      const aiData = await aiResponse.json();
      const jdText = aiData.content?.map(b => b.text || '').join('') || '';
      return res.status(200).json({ text: jdText });

    } catch (error) {
      console.error('Generate JD error:', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  }

  return res.status(400).json({ error: 'Action parameter required (analyze_fit o generate_jd)' });
}
