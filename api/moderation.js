export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } = process.env;
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing env' });
  }

  // ─────────────────────────────────────────────────────────────
  // IMPORT SUPABASE
  // ─────────────────────────────────────────────────────────────
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ─────────────────────────────────────────────────────────────
  // AUTH
  // ─────────────────────────────────────────────────────────────
  const auth = req.headers.authorization?.split('Bearer ')[1];
  if (!auth) return res.status(401).json({ error: 'No token' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(auth);
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, role')
    .eq('email', user.email)
    .single();

  if (!profile) return res.status(401).json({ error: 'Profile not found' });

  // ─────────────────────────────────────────────────────────────
  // GET: CONTACT REQUESTS (candidato/recruiter)
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.query.type === 'received') {
    try {
      let query = supabase.from('contact_requests').select('*');
      
      if (profile.role === 'candidato') {
        query = query.eq('candidate_id', profile.id);
      } else {
        query = query.eq('recruiter_id', profile.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      return res.status(200).json({ requests: data || [] });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GET: CONTACT REQUESTS SENT (recruiter)
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.query.type === 'sent') {
    try {
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('recruiter_id', profile.id);

      if (error) throw error;
      return res.status(200).json({ requests: data || [] });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GET: LIST REPORTS (admin only)
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'list_reports') {
    try {
      // Verificar que es admin
      if (profile.email !== 'corvus.talent@gmail.com') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { data, error } = await supabase
        .from('reports')
        .select(`
          id, report_type, description, evidence_url, status, conversation_id,
          created_at, updated_at, admin_notes, admin_action, admin_reason,
          reported_user:reported_user_id(id, email, nombre, apellido, avatar)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ reports: data || [] });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // POST: CREATE CONTACT REQUEST
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.body.action === 'send_contact_request') {
    try {
      const { candidate_id, message, company } = req.body;

      if (profile.role !== 'recruiter') {
        return res.status(403).json({ error: 'Solo recruiters pueden enviar solicitudes' });
      }

      // Verificar que la solicitud no exista ya
      const { data: existing } = await supabase
        .from('contact_requests')
        .select('id')
        .eq('recruiter_id', profile.id)
        .eq('candidate_id', candidate_id)
        .single();

      if (existing) {
        return res.status(400).json({ error: 'Ya enviaste una solicitud a este candidato' });
      }

      const { data, error } = await supabase
        .from('contact_requests')
        .insert([{
          recruiter_id: profile.id,
          candidate_id,
          message,
          company: company || profile.company,
          status: 'pending'
        }])
        .select()
        .single();

      if (error) throw error;
      return res.status(200).json({ success: true, request: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PATCH: RESPOND TO CONTACT REQUEST (accept/reject)
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'PATCH' && req.body.action === 'respond_contact_request') {
    try {
      const { request_id, status } = req.body;

      if (!['accepted', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Status inválido' });
      }

      // Obtener la solicitud
      const { data: request, error: fetchError } = await supabase
        .from('contact_requests')
        .select('*, recruiter:recruiter_id(id, nombre, apellido, company, email)')
        .eq('id', request_id)
        .single();

      if (fetchError || !request) {
        return res.status(404).json({ error: 'Solicitud no encontrada' });
      }

      // Verificar que es el candidato que recibió la solicitud
      if (request.candidate_id !== profile.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Actualizar estado
      const { data, error } = await supabase
        .from('contact_requests')
        .update({ status })
        .eq('id', request_id)
        .select()
        .single();

      if (error) throw error;

      // Si es aceptado, crear conversación automáticamente
      if (status === 'accepted') {
        const { data: conv, error: convError } = await supabase
          .from('conversations')
          .insert([{
            recruiter_id: request.recruiter_id.id,
            candidate_id: profile.id,
            contact_request_id: request_id,
            status: 'active'
          }])
          .select()
          .single();

        if (convError) console.error('Error creando conversación:', convError);
      }

      return res.status(200).json({ success: true, request: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // POST: CREATE REPORT
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.body.action === 'create_report') {
    try {
      const { reported_user_id, report_type, description, evidence_url, conversation_id } = req.body;

      // Validaciones
      if (!reported_user_id || !report_type || !description) {
        return res.status(400).json({ error: 'Campos requeridos faltando' });
      }

      if (description.length < 10 || description.length > 1000) {
        return res.status(400).json({ error: 'Descripción debe tener 10-1000 caracteres' });
      }

      if (!['estafa', 'inactividad', 'acoso', 'perfil_falso', 'cobranza', 'otro'].includes(report_type)) {
        return res.status(400).json({ error: 'Tipo de reporte inválido' });
      }

      // No permitir auto-reportes
      if (reported_user_id === profile.id) {
        return res.status(400).json({ error: 'No puedes reportarte a ti mismo' });
      }

      // Crear reporte
      const { data, error } = await supabase
        .from('reports')
        .insert([{
          reporter_id: profile.id,
          reported_user_id,
          report_type,
          description,
          evidence_url: evidence_url || null,
          conversation_id: conversation_id || null,
          status: 'pending'
        }])
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({ success: true, report: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PATCH: UPDATE REPORT (mark reviewed, dismiss, or suspend user)
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'PATCH' && req.body.action === 'update_report') {
    try {
      // Solo admin
      if (profile.email !== 'corvus.talent@gmail.com') {
        return res.status(403).json({ error: 'Solo admin puede actualizar reportes' });
      }

      const { report_id, status, admin_action, admin_reason, admin_notes } = req.body;

      if (!['pending', 'reviewed', 'dismissed', 'action_taken'].includes(status)) {
        return res.status(400).json({ error: 'Status inválido' });
      }

      // Obtener el reporte
      const { data: report, error: fetchError } = await supabase
        .from('reports')
        .select('*')
        .eq('id', report_id)
        .single();

      if (fetchError || !report) {
        return res.status(404).json({ error: 'Reporte no encontrado' });
      }

      // Construir update
      const updateData = {
        status,
        updated_at: new Date().toISOString(),
        admin_notes: admin_notes || null,
        admin_action: admin_action || null,
        admin_reason: admin_reason || null
      };

      // Si es suspend_user, marcar usuario como suspendido
      if (admin_action === 'suspend_user') {
        const { error: suspendError } = await supabase
          .from('profiles')
          .update({ suspended: true, suspended_at: new Date().toISOString(), suspend_reason: admin_reason })
          .eq('id', report.reported_user_id);

        if (suspendError) {
          console.error('Error suspendiendo usuario:', suspendError);
          // No fallar si no puede suspender, pero logear el error
        }

        // Opcional: aquí irían notificaciones por email al usuario suspendido
      }

      // Actualizar reporte
      const { data, error } = await supabase
        .from('reports')
        .update(updateData)
        .eq('id', report_id)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({ success: true, report: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 404
  // ─────────────────────────────────────────────────────────────
  return res.status(400).json({ error: 'Invalid request' });
}
