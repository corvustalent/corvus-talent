import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { contact_request_id, job_title } = req.body;

  if (!contact_request_id) {
    return res.status(400).json({ error: 'contact_request_id required' });
  }

  try {
    const { data: contactReq, error: crError } = await supabase
      .from('contact_requests')
      .select('id, recruiter_id, candidate_id, status')
      .eq('id', contact_request_id)
      .single();

    if (crError || !contactReq) {
      return res.status(404).json({ error: 'Contact request not found' });
    }

    if (contactReq.status !== 'accepted') {
      return res.status(400).json({ error: 'Contact request not accepted' });
    }

    const recruiter_id = contactReq.recruiter_id;
    const candidate_id = contactReq.candidate_id;

    if (recruiter_id !== user.id) {
      return res.status(403).json({ error: 'Only recruiter can start chat' });
    }

    const { data: existingConv, error: convCheckError } = await supabase
      .from('conversations')
      .select('id')
      .eq('recruiter_id', recruiter_id)
      .eq('candidate_id', candidate_id)
      .eq('contact_request_id', contact_request_id)
      .single();

    if (existingConv) {
      return res.status(200).json({
        success: true,
        conversation_id: existingConv.id,
        created: false
      });
    }

    const { data: newConv, error: insertError } = await supabase
      .from('conversations')
      .insert({
        recruiter_id,
        candidate_id,
        contact_request_id,
        job_title: job_title || 'Oportunidad laboral',
        status: 'active'
      })
      .select('id')
      .single();

    if (insertError) {
      return res.status(500).json({ error: 'Failed to create conversation', details: insertError });
    }

    const welcomeMsg = `¡Hola! Bienvenidos a Corvus Chat. Este es un espacio profesional para discutir la oportunidad laboral. 

Recordamos el Código de Conducta:
✓ Sé respetuoso y profesional
✓ Comunica de forma clara
✓ Mantén confidencialidad
✗ Nada de spam, acoso o contenido inapropiado

¡Que comience la conversación!`;

    await supabase
      .from('messages')
      .insert({
        conversation_id: newConv.id,
        sender_id: '00000000-0000-0000-0000-000000000000',
        content: welcomeMsg,
        read_by_recipient: true
      });

    return res.status(201).json({
      success: true,
      conversation_id: newConv.id,
      created: true
    });

  } catch (err) {
    console.error('Chat start error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
