import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });

  // Cliente para verificar auth (con token del usuario)
  const sbAuth = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: { user }, error: authError } = await sbAuth.auth.getUser(authHeader.split(' ')[1]);
  if (authError || !user) return res.status(401).json({ error: 'Sesión inválida' });

  // Cliente admin para operaciones DB (bypasea RLS)
  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } }
  });

  const { data: profile } = await sb.from('profiles').select('role, nombre, apellido, company').eq('id', user.id).single();

  // ── POST ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, contact_request_id, conversation_id, message } = req.body;

    // Iniciar conversación
    if (action === 'start') {
      if (!contact_request_id) return res.status(400).json({ error: 'contact_request_id requerido' });

      const { data: request } = await sb
        .from('contact_requests')
        .select('*')
        .eq('id', contact_request_id)
        .eq('status', 'accepted')
        .single();

      if (!request) return res.status(404).json({ error: 'Solicitud no encontrada o no aceptada' });

      if (request.recruiter_id !== user.id && request.candidate_id !== user.id) {
        return res.status(403).json({ error: 'No autorizado' });
      }

      // Verificar si ya existe
      const { data: existing } = await sb
        .from('conversations')
        .select('id')
        .eq('contact_request_id', contact_request_id)
        .single();

      if (existing) return res.status(200).json({ conversation_id: existing.id });

      // Crear conversación con columnas correctas
      console.log('Attempting insert with:', { contact_request_id, recruiter_id: request.recruiter_id, candidate_id: request.candidate_id });
      const { data: conv, error } = await sb.from('conversations').insert({
        contact_request_id,
        recruiter_id: request.recruiter_id,
        candidate_id: request.candidate_id,
        status: 'active',
      }).select().single();

      if (error) {
        console.error('Insert error:', JSON.stringify(error));
        return res.status(500).json({ error: error.message, details: error });
      }
      console.log('Conversation created:', conv?.id);
      return res.status(200).json({ conversation_id: conv.id });
    }

    // Enviar mensaje
    if (conversation_id && message) {
      if (!message.trim() || message.length > 2000) {
        return res.status(400).json({ error: 'Mensaje inválido' });
      }

      const { data: conv } = await sb
        .from('conversations')
        .select('recruiter_id, candidate_id')
        .eq('id', conversation_id)
        .single();

      if (!conv || (conv.recruiter_id !== user.id && conv.candidate_id !== user.id)) {
        return res.status(403).json({ error: 'No autorizado' });
      }

      const { data: msg, error } = await sb.from('messages').insert({
        conversation_id,
        sender_id: user.id,
        content: message.trim(),
      }).select().single();

      if (error) return res.status(500).json({ error: error.message });

      // Actualizar updated_at
      await sb.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversation_id);

      return res.status(200).json({ message: msg });
    }

    return res.status(400).json({ error: 'Parámetros inválidos' });
  }

  // ── GET ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { conversation_id } = req.query;

    if (conversation_id) {
      const { data: conv } = await sb
        .from('conversations')
        .select('*')
        .eq('id', conversation_id)
        .single();

      console.log('Conv check:', { conv_recruiter: conv?.recruiter_id, conv_candidate: conv?.candidate_id, user_id: user.id });

      if (!conv || (conv.recruiter_id !== user.id && conv.candidate_id !== user.id)) {
        return res.status(403).json({ error: 'No autorizado', user_id: user.id, conv_ids: { recruiter: conv?.recruiter_id, candidate: conv?.candidate_id } });
      }

      const { data: messages } = await sb
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation_id)
        .order('created_at', { ascending: true });

      // Marcar como leídos
      const unreadField = profile?.role === 'recruiter' ? 'unread_count_recruiter' : 'unread_count_candidate';
      await sb.from('conversations').update({ [unreadField]: 0 }).eq('id', conversation_id);
      await sb.from('messages')
        .update({ read_by_recipient: true })
        .eq('conversation_id', conversation_id)
        .neq('sender_id', user.id)
        .eq('read_by_recipient', false);

      return res.status(200).json({ conversation: conv, messages: messages || [] });
    }

    // Listar conversaciones
    const field = profile?.role === 'recruiter' ? 'recruiter_id' : 'candidate_id';
    const unreadField = profile?.role === 'recruiter' ? 'unread_count_recruiter' : 'unread_count_candidate';

    const { data: conversations, error: convError } = await sb
      .from('conversations')
      .select('*')
      .eq(field, user.id)
      .order('created_at', { ascending: false });

    if (convError) {
      console.error('Conversations error:', convError.message);
      return res.status(500).json({ error: convError.message });
    }

    // Enriquecer con datos de perfiles
    const enriched = await Promise.all((conversations || []).map(async c => {
      const { data: recruiter } = await sb.from('profiles').select('nombre, apellido, company').eq('id', c.recruiter_id).single();
      const { data: candidate } = await sb.from('profiles').select('nombre, apellido').eq('id', c.candidate_id).single();
      return { ...c, recruiter, candidate };
    }));

    const convsWithUnread = enriched.map(c => ({
      ...c,
      unread: c[unreadField] || 0
    }));

    return res.status(200).json({ conversations: convsWithUnread });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
