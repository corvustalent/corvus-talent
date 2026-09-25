const SYSTEM_PROMPT = `Sos un recruiter IT senior con 10 años de experiencia en selección de talento.
Tu especialidad es redactar Job Descriptions profesionales, atractivas y efectivas.
Usás bullets con "·" (punto centrado). Sin títulos con #. Tono según lo indicado.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { title, industry, seniority, modality, companyType, skills, responsibilities, lang, tone } = req.body;

  if (!title || typeof title !== 'string' || title.length > 200) {
    return res.status(400).json({ error: 'Parámetro inválido: title' });
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
    'Hacé la JD realista y atractiva para que el candidato quiera postularse.',
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
        max_tokens: 1000,
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
