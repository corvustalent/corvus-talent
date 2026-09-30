import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });

  const sb = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: { user }, error: authError } = await sb.auth.getUser(authHeader.split(' ')[1]);
  if (authError || !user) return res.status(401).json({ error: 'Sesión inválida' });

  const { data: profile } = await sb.from('profiles').select('role, nombre, apellido, company').eq('id', user.id).single();

  // ── POST: enviar mensaje o iniciar chat ───────────────────
  if (req.method === 'POST') {
    const { action, contact_request_id, conversation_id, message } = req.body;

    // Iniciar conversación cuando candidato acepta solicitud
    if (action === 'start') {
      if (!contact_request_id) return res.status(400).json({ error: 'contact_request_id requerido' });

      const { data: request } = await sb
        .from('contact_requests')
        .select('*')
        .eq('id', contact_request_id)
        .eq('status', 'accepted')
        .single();

      if (!request) return res.status(404).json({ error: 'Solicitud no encontrada o no aceptada' });

      // Verificar que el usuario es parte de la solicitud
      if (request.recruiter_id !== user.id && request.candidate_id !== user.id) {
        return res.status(403).json({ error: 'No autorizado' });
      }

      // Verificar si ya existe una conversación
      const { data: existing } = await sb
        .from('conversations')
        .select('id')
        .eq('contact_request_id', contact_request_id)
        .single();

      if (existing) return res.status(200).json({ conversation_id: existing.id });

      // Crear conversación nueva
      const { data: conv, error } = await sb.from('conversations').insert({
        contact_request_id,
        recruiter_id: request.recruiter_id,
        candidate_id: request.candidate_id,
        recruiter_company: request.company,
      }).select().single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ conversation_id: conv.id });
    }

    // Enviar mensaje
    if (conversation_id && message) {
      if (!message.trim() || message.length > 2000) {
        return res.status(400).json({ error: 'Mensaje inválido' });
      }

      // Verificar que el usuario es parte de la conversación
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

      // Actualizar last_message_at en la conversación
      await sb.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation_id);

      return res.status(200).json({ message: msg });
    }

    return res.status(400).json({ error: 'Parámetros inválidos' });
  }

  // ── GET: listar conversaciones o mensajes ─────────────────
  if (req.method === 'GET') {
    const { conversation_id } = req.query;

    // Obtener mensajes de una conversación
    if (conversation_id) {
      const { data: conv } = await sb
        .from('conversations')
        .select('*, recruiter:profiles!conversations_recruiter_id_fkey(nombre, apellido, company), candidate:profiles!conversations_candidate_id_fkey(nombre, apellido)')
        .eq('id', conversation_id)
        .single();

      if (!conv || (conv.recruiter_id !== user.id && conv.candidate_id !== user.id)) {
        return res.status(403).json({ error: 'No autorizado' });
      }

      const { data: messages } = await sb
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation_id)
        .order('created_at', { ascending: true });

      // Marcar mensajes como leídos
      await sb.from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', conversation_id)
        .neq('sender_id', user.id)
        .is('read_at', null);

      return res.status(200).json({ conversation: conv, messages: messages || [] });
    }

    // Listar todas las conversaciones del usuario
    const field = profile?.role === 'recruiter' ? 'recruiter_id' : 'candidate_id';
    const { data: conversations } = await sb
      .from('conversations')
      .select('*, recruiter:profiles!conversations_recruiter_id_fkey(nombre, apellido, company), candidate:profiles!conversations_candidate_id_fkey(nombre, apellido)')
      .eq(field, user.id)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    // Contar mensajes no leídos por conversación
    const convsWithUnread = await Promise.all((conversations || []).map(async conv => {
      const { count } = await sb.from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .neq('sender_id', user.id)
        .is('read_at', null);
      return { ...conv, unread: count || 0 };
    }));

    return res.status(200).json({ conversations: convsWithUnread });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
