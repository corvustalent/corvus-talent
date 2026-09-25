// Prompt hardcodeado en el servidor
const SYSTEM_PROMPT = `Sos un recruiter IT senior con 10 años de experiencia y experto en CVs ATS-friendly. 
Analizás CVs de forma objetiva, directa y útil. Siempre respondés SOLO con JSON válido, sin texto adicional.`;

const CV_ANALYSIS_PROMPT = `Analizá el CV adjunto y devolvé un JSON con exactamente esta estructura:

{
  "score": <número del 0 al 100>,
  "score_color": <"green" si >=70, "yellow" si >=40, "red" si <40>,
  "resumen": "<2-3 oraciones de diagnóstico general>",
  "fortalezas": ["<fortaleza 1>", "<fortaleza 2>", "<fortaleza 3>"],
  "problemas_ats": ["<problema ATS 1>", "<problema ATS 2>"],
  "mejoras": ["<mejora concreta 1>", "<mejora concreta 2>", "<mejora concreta 3>"],
  "keywords_faltantes": ["<keyword 1>", "<keyword 2>", "<keyword 3>"],
  "conclusion": "<1 oración con el consejo más importante>"
}

Respondé SOLO con el JSON, sin texto adicional.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { cvBase64 } = req.body;

  if (!cvBase64 || typeof cvBase64 !== 'string') {
    return res.status(400).json({ error: 'CV requerido' });
  }

  // Validación básica de tamaño (max ~5MB en base64)
  if (cvBase64.length > 7000000) {
    return res.status(400).json({ error: 'El archivo es demasiado grande' });
  }

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
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: cvBase64 }
            },
            { type: 'text', text: CV_ANALYSIS_PROMPT }
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
