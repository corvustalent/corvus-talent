// /api/fit.js — Análisis CV vs Job Description
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.body && req.body.token) {
    return req.body.token;
  }
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/corvus_token=([^;]+)/);
  return match ? match[1] : null;
}

function getEmailFromToken(token) {
  if (!token) return null;
  token = token.trim();
  if (token.includes('|')) {
    return token.split('|')[0].trim();
  }
  if (token.includes('@')) {
    return token;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = extractToken(req);
    const email = getEmailFromToken(token);
    
    if (!email) {
      console.log('[FIT] Invalid token:', token);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { cv, job_title, job_description } = req.body;
    
    if (!cv || !job_description) {
      return res.status(400).json({ error: 'CV y Job Description requeridos' });
    }

    console.log('[FIT] Analyzing for:', email, '| Job:', job_title);

    // Prompt para Claude
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

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    // Extraer el texto de la respuesta
    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    console.log('[FIT] Raw response:', responseText);

    // Parsear JSON
    let analysisData;
    try {
      // Intenta parsear directamente
      analysisData = JSON.parse(responseText);
    } catch (e) {
      // Si falla, intenta extraer JSON entre { }
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
    res.status(500).json({ error: error.message });
  }
}
