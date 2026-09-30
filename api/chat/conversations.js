import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
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

  const { status, limit = '20', offset = '0' } = req.query;

  try {
    let query = supabase
      .from('conversations')
      .select(`
        id,
        recruiter_id,
        candidate_id,
        job_title,
        status,
        created_at,
        updated_at,
        recruiter:profiles!recruiter_id (id, email, nombre),
        candidate:profiles!candidate_id (id, email, nombre)
      `)
      .or(`recruiter_id.eq.${user.id},candidate_id.eq.${user.id}`)
      .order('updated_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: conversations, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch conversations', details: error });
    }

    const enriched = conversations.map(conv => {
      const isRecruiter = conv.recruiter_id === user.id;
      const otherUser = isRecruiter ? conv.candidate : conv.recruiter;
      const unreadCount = isRecruiter ? conv.unread_count_recruiter : conv.unread_count_candidate;

      return {
        id: conv.id,
        job_title: conv.job_title,
        status: conv.status,
        other_user: {
          id: otherUser.id,
          email: otherUser.email,
          nombre: otherUser.nombre
        },
        unread_count: unreadCount || 0,
        created_at: conv.created_at,
        updated_at: conv.updated_at
      };
    });

    return res.status(200).json({
      conversations: enriched,
      total: count
    });

  } catch (err) {
    console.error('Conversations error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
