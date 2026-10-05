// /api/corvus.js — Análisis CV vs JD + Generación JD (CONSOLIDADO fit + corvus)
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const client = new Anthropic();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

const GENERATE_SYSTEM_PROMPT = `Sos un recruiter IT senior con 10 años de experiencia.
Tu especialidad es redactar Job Descriptions profesionales y efectivas.
Usás bullets con "·". Sin títulos con #. Tono según lo indicado.`;

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.substring(7).trim();
  if (req.body && req.body.token) return req.body.token;
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/corvus_token=([^;]+)/);
  return match ? match[1] : null;
}

function getEmailFromToken(token) {
  if (!token) return null;
  token = token.trim();
  if (token.includes('|')) return token.split('|')[0].trim();
  if (token.includes('@')) return token;
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = extractToken(req);
  const email = getEmailFromToken(token);
  if (!email) return res.status(401).json({ error: 'Invalid token' });

  // ══════════════════════════════════════════════════════════════
  // ANÁLISIS CV VS JD (fit)
  // ══════════════════════════════════════════════════════════════
  if (req.body.action === 'analyze_fit') {
    const { cv, job_title, job_description } = req.body;
    
    if (!cv || !job_description) {
      return res.status(400).json({ error: 'CV y Job Description requeridos' });
    }

    console.log('[FIT] Analyzing for:', email, '| Job:', job_title);

    const prompt = `Eres un experto en recursos humanos y análisis de compatibilidad laboral. 
Tu tarea es analizar la compatibilidad entre un CV y una descripción de puesto.

**CV del Candidato:**
${cv}

**Puesto:** ${job_title}

**Descripción del Puesto:**
${job_description}

Proporciona un análisis estructurado en JSON con los siguientes campos:
1. **score** (número 0-100): compatibilidad general
2. **matches** (array de strings): habilidades/experiencias que coinciden
3. **gaps** (array of strings): lo que falta o no coincide
4. **mejoras** (array of strings): sugerencias para mejorar en una entrevista

Responde SOLO con JSON válido, sin explicaciones adicionales.`;

    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      });

      const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
      console.log('[FIT] Raw response:', responseText);

      let analysisData;
      try {
        analysisData = JSON.parse(responseText);
      } catch (e) {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysisData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No valid JSON found in response');
        }
      }

      console.log('[FIT] Parsed analysis:', analysisData);

      return res.status(200).json({
        score: analysisData.score || 75,
        matches: analysisData.matches || [],
        gaps: analysisData.gaps || [],
        mejoras: analysisData.mejoras || []
      });

    } catch (error) {
      console.error('[FIT] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // GENERACIÓN DE JD (corvus craft)
  // ══════════════════════════════════════════════════════════════
  if (req.body.action === 'generate_jd') {
    const { title, industry, seniority, modality, companyType, skills, responsibilities, lang, tone } = req.body;

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
      'Incluí: Sobre el rol, Responsabilidades (5-7), Requisitos (4-6), Deseable (2-3), Lo que ofrecemos (3-4).',
    ].filter(Boolean).join('\n');

    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: GENERATE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }]
      });

      const jdText = message.content[0].type === 'text' ? message.content[0].text : '';
      return res.status(200).json({ text: jdText });

    } catch (error) {
      console.error('[GENERATE JD] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(400).json({ error: 'Action parameter required (analyze_fit o generate_jd)' });
}
