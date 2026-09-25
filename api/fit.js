const SYSTEM_PROMPT = `Sos un recruiter IT senior con 10 años de experiencia. 
Tu especialidad es evaluar la compatibilidad entre perfiles profesionales y descripciones de puesto.
Analizás CVs y JDs con criterio técnico y de negocio. Siempre respondés SOLO con JSON válido.`;

const ANALYSIS_PROMPT = `Analizá la compatibilidad entre el CV adjunto y la siguiente descripción de puesto.

DESCRIPCIÓN DEL PUESTO:
{JD}

Devolvé SOLO un JSON con exactamente esta estructura:
{
  "score": <número del 0 al 100 que representa el % de compatibilidad>,
  "matches": ["<cosa que tiene el candidato que el puesto busca 1>", "<match 2>", "<match 3>", "<match 4>"],
  "gaps": ["<gap importante 1>", "<gap 2>", "<gap 3>"],
  "mejoras": ["<cómo mejorar el CV para este puesto específico 1>", "<mejora 2>", "<mejora 3>"],
  "entrevista": ["<punto fuerte a destacar en la entrevista 1>", "<punto 2>", "<punto 3>"]
}

Sé específico y directo. Respondé SOLO con el JSON.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { cvBase64, jd } = req.body;

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
    return res.status(200).json({ text });

  } catch (error) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
