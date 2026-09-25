// Prompt hardcodeado en el servidor — el cliente solo manda parámetros de datos
const SYSTEM_PROMPT = `Sos un recruiter IT senior con 10 años de experiencia en selección de talento. 
Tu rol es dar feedback breve, directo y constructivo sobre respuestas de entrevista. 
Máximo 2-3 oraciones. Sin bullets ni headers. Tono humano y profesional.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { question, chosen, correct, correctAnswer, context, module } = req.body;

  if (!question || typeof question !== 'string' || question.length > 500) {
    return res.status(400).json({ error: 'Parámetro inválido: question' });
  }
  if (!chosen || typeof chosen !== 'string' || chosen.length > 300) {
    return res.status(400).json({ error: 'Parámetro inválido: chosen' });
  }
  if (typeof correct !== 'boolean') {
    return res.status(400).json({ error: 'Parámetro inválido: correct' });
  }

  const mod = module === 'candidato'
    ? 'candidato preparando una entrevista'
    : 'entrevistador aprendiendo a evaluar candidatos';

  const userMessage = [
    `Contexto: Un ${mod} respondió una pregunta de preparación.`,
    `Pregunta: ${question}`,
    `Respuesta elegida: ${chosen}`,
    `Resultado: ${correct ? 'CORRECTA' : 'INCORRECTA'}`,
    correctAnswer ? `Respuesta correcta: ${correctAnswer}` : '',
    context ? `Contexto adicional: ${context}` : '',
    correct
      ? 'Reforzá brevemente por qué esta respuesta es correcta y por qué importa en una entrevista real.'
      : 'Explicá brevemente por qué esta respuesta es incorrecta y qué debería haber respondido, de forma constructiva.',
  ].filter(Boolean).join('\n');

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
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
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
