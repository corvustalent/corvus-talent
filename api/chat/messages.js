import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // GET
  if (req.method === 'GET') {
    const { conversation_id, limit = '50', offset = '0' } = req.query;

    if (!conversation_id) {
      return res.status(400).json({ error: 'conversation_id required' });
    }

    try {
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversation_id)
        .or(`recruiter_id.eq.${user.id},candidate_id.eq.${user.id}`)
        .single();

      if (convError || !conv) {
        return res.status(403).json({ error: 'Not authorized to view this conversation' });
      }

      const { data: messages, error: msgError } = await supabase
        .from('messages')
        .select(`
          id,
          content,
          sender_id,
          sender:profiles!sender_id (id, nombre, email),
          read_by_recipient,
          created_at
        `)
        .eq('conversation_id', conversation_id)
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      if (msgError) {
        return res.status(500).json({ error: 'Failed to fetch messages', details: msgError });
      }

      await supabase
        .from('messages')
        .update({ read_by_recipient: true })
        .eq('conversation_id', conversation_id)
        .neq('sender_id', user.id)
        .eq('read_by_recipient', false);

      return res.status(200).json({
        messages: messages.reverse()
      });

    } catch (err) {
      console.error('Get messages error:', err);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  }

  // POST
  if (req.method === 'POST') {
    const { conversation_id, content } = req.body;

    if (!conversation_id || !content || content.trim().length === 0) {
      return res.status(400).json({ error: 'conversation_id and content required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
    }

    try {
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .select('id, status')
        .eq('id', conversation_id)
        .or(`recruiter_id.eq.${user.id},candidate_id.eq.${user.id}`)
        .single();

      if (convError || !conv) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      if (conv.status !== 'active') {
        return res.status(400).json({ error: 'Conversation is not active' });
      }

      const { data: message, error: insertError } = await supabase
        .from('messages')
        .insert({
          conversation_id,
          sender_id: user.id,
          content: content.trim(),
          read_by_recipient: false
        })
        .select('id, content, sender_id, created_at')
        .single();

      if (insertError) {
        return res.status(500).json({ error: 'Failed to send message', details: insertError });
      }

      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversation_id);

      return res.status(201).json({
        success: true,
        message_id: message.id,
        created_at: message.created_at
      });

    } catch (err) {
      console.error('Send message error:', err);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  }

  // PATCH (mark as read)
  if (req.method === 'PATCH') {
    const { conversation_id } = req.body;

    if (!conversation_id) {
      return res.status(400).json({ error: 'conversation_id required' });
    }

    try {
      const { data: conv, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversation_id)
        .or(`recruiter_id.eq.${user.id},candidate_id.eq.${user.id}`)
        .single();

      if (convError || !conv) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      const { error: updateError } = await supabase
        .from('messages')
        .update({ read_by_recipient: true })
        .eq('conversation_id', conversation_id)
        .neq('sender_id', user.id);

      if (updateError) {
        return res.status(500).json({ error: 'Failed to mark as read', details: updateError });
      }

      return res.status(200).json({ success: true });

    } catch (err) {
      console.error('Mark read error:', err);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
