// api/chat.js - Chat entre recruiter y candidato CON NOMBRES
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization' });
  }

  const token = authHeader.split(' ')[1];
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const userId = userData.user.id;

  if (req.method === 'GET') {
    const { conversation_id } = req.query;
    if (!conversation_id) {
      return res.status(400).json({ error: 'Missing conversation_id' });
    }

    // Verificar que el usuario pertenece a esta conversación
    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('recruiter_id, candidate_id')
      .eq('id', conversation_id)
      .single();

    if (convError || !convData) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (convData.recruiter_id !== userId && convData.candidate_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // CAMBIO: JOIN con profiles para obtener nombre + apellido del sender
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select(`
        id,
        conversation_id,
        sender_id,
        content,
        read_by_recipient,
        created_at,
        sender:profiles(nombre, apellido)
      `)
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true });

    if (msgError) {
      return res.status(500).json({ error: msgError.message });
    }

    // Mapear sender info al mensaje
    const enrichedMessages = messages.map(msg => ({
      ...msg,
      sender_name: msg.sender ? `${msg.sender.nombre || ''} ${msg.sender.apellido || ''}`.trim() : 'Usuario'
    }));

    return res.status(200).json(enrichedMessages);
  }

  if (req.method === 'POST') {
    const { conversation_id, content } = req.body;
    if (!conversation_id || !content) {
      return res.status(400).json({ error: 'Missing conversation_id or content' });
    }

    // Verificar pertenencia
    const { data: convData, error: convError } = await supabase
      .from('conversations')
      .select('recruiter_id, candidate_id')
      .eq('id', conversation_id)
      .single();

    if (convError || !convData) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (convData.recruiter_id !== userId && convData.candidate_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Insertar mensaje
    const { data: newMsg, error: insertError } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        sender_id: userId,
        content,
        read_by_recipient: false
      })
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    // Actualizar updated_at de la conversación
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation_id);

    // Marcar mensaje como no leído para el otro usuario
    const otherUserId = convData.recruiter_id === userId ? convData.candidate_id : convData.recruiter_id;
    await supabase.rpc('increment_unread_messages', {
      p_conversation_id: conversation_id,
      p_user_id: otherUserId
    }).catch(() => {
      // Si la función RPC no existe, hacerlo manual
      supabase
        .from('conversations')
        .update({ 
          unread_count_recruiter: convData.recruiter_id === otherUserId ? supabase.raw('unread_count_recruiter + 1') : undefined,
          unread_count_candidate: convData.candidate_id === otherUserId ? supabase.raw('unread_count_candidate + 1') : undefined
        })
        .eq('id', conversation_id);
    });

    return res.status(201).json(newMsg);
  }

  res.status(405).json({ error: 'Method not allowed' });
}
