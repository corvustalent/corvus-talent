export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, RESEND_API_KEY } = process.env;
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing env' });
  }

  // ─────────────────────────────────────────────────────────────
  // IMPORT SUPABASE & RESEND
  // ─────────────────────────────────────────────────────────────
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Resend client
  let resend = null;
  if (RESEND_API_KEY) {
    const ResendModule = await import('resend');
    resend = new ResendModule.Resend(RESEND_API_KEY);
  }

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
  // POST: CREATE CONTACT REQUEST + EMAIL AL CANDIDATO
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

      // Insertar solicitud
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

      // ───── ENVIAR EMAIL AL CANDIDATO ─────
      // Obtener datos del candidato
      const { data: candidate, error: candidateError } = await supabase
        .from('profiles')
        .select('id, email, nombre, apellido')
        .eq('id', candidate_id)
        .single();

      if (candidateError) {
        console.error('Error fetching candidate:', candidateError);
      } else if (candidate && candidate.email && resend) {
        // Obtener datos del recruiter
        const { data: recruiter, error: recruiterError } = await supabase
          .from('profiles')
          .select('id, email, nombre, apellido, company')
          .eq('id', profile.id)
          .single();

        if (!recruiterError && recruiter) {
          const candidateName = candidate.nombre ? `${candidate.nombre} ${candidate.apellido || ''}`.trim() : 'Candidato';
          const recruiterName = recruiter.nombre ? `${recruiter.nombre} ${recruiter.apellido || ''}`.trim() : 'Recruiter';
          const recruiterCompany = recruiter.company || 'Una empresa';

          // Enviar email con Resend
          try {
            await resend.emails.send({
              from: 'Corvus Talent <info@corvustalent.com.ar>',
              to: candidate.email,
              subject: `📩 ${recruiterName} te envió una solicitud de contacto — Corvus Talent`,
              html: `
                <div style="font-family: Inter, system-ui, sans-serif; max-width: 600px; margin: 0 auto; color: #0A1628;">
                  <div style="background: linear-gradient(135deg, #0A1628 0%, #142038 100%); color: #FFFFFF; padding: 32px; border-radius: 16px 16px 0 0; text-align: center;">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700;">¡Nueva oportunidad! 🎯</h1>
                    <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 14px;">Un recruiter está interesado en tu perfil</p>
                  </div>

                  <div style="background: #FFFFFF; padding: 32px; border-radius: 0 0 16px 16px; border: 1px solid rgba(143, 168, 200, 0.2);">
                    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6;">Hola ${candidateName},</p>

                    <div style="background: #F5F7FA; border-left: 4px solid #8FA8C8; padding: 20px; border-radius: 8px; margin-bottom: 24px;">
                      <p style="margin: 0 0 12px 0; font-size: 13px; color: #656D78; text-transform: uppercase; letter-spacing: 1px;">📍 De:</p>
                      <p style="margin: 0 0 4px 0; font-size: 16px; font-weight: 600;">${recruiterName}</p>
                      <p style="margin: 0; font-size: 14px; color: #9CA3AF;">${recruiterCompany}</p>
                    </div>

                    <div style="background: #F5F7FA; border: 1px solid rgba(143, 168, 200, 0.2); padding: 20px; border-radius: 8px; margin-bottom: 24px;">
                      <p style="margin: 0 0 12px 0; font-size: 13px; color: #656D78; text-transform: uppercase; letter-spacing: 1px;">💬 Mensaje:</p>
                      <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #1E3050;">${message.split('\n').join('<br>')}</p>
                    </div>

                    <div style="text-align: center; margin-bottom: 32px;">
                      <a href="https://corvustalent.com.ar/dashboard/candidato" style="display: inline-block; background: #0A1628; color: #FFFFFF; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; transition: background 0.2s;">
                        Ver solicitud en tu panel
                      </a>
                    </div>

                    <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #9CA3AF;">Desde Corvus Talent facilitamos conexiones auténticas entre talento y oportunidades. Respond con confianza — esta solicitud proviene de un recruiter verificado en nuestra plataforma.</p>

                    <p style="margin: 0; font-size: 12px; color: #9CA3AF;">¿Preguntas? Escríbenos a <strong>corvus.talent@gmail.com</strong></p>
                  </div>

                  <div style="text-align: center; padding: 24px; color: #9CA3AF; font-size: 11px;">
                    <p style="margin: 0;">© 2026 Corvus Talent — Talento certero.</p>
                  </div>
                </div>
              `
            });

            console.log(`Email enviado a ${candidate.email} sobre solicitud de ${recruiterName}`);
          } catch (emailError) {
            console.error('Error sending email with Resend:', emailError);
          }
        }
      }

      return res.status(200).json({ success: true, request: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PATCH: RESPOND TO CONTACT REQUEST (accept/reject) + EMAIL AL RECRUITER SI ACEPTA
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

      // Si es aceptado, crear conversación automáticamente + ENVIAR EMAIL AL RECRUITER
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

        // ───── ENVIAR EMAIL AL RECRUITER ─────
        if (request.recruiter && request.recruiter.email && resend) {
          try {
            const recruiterName = request.recruiter.nombre ? `${request.recruiter.nombre} ${request.recruiter.apellido || ''}`.trim() : 'Recruiter';
            const candidateName = profile.nombre ? `${profile.nombre} ${profile.apellido || ''}`.trim() : 'Candidato';

            await resend.emails.send({
              from: 'Corvus Talent <info@corvustalent.com.ar>',
              to: request.recruiter.email,
              subject: `✅ ${candidateName} aceptó tu solicitud de contacto — Corvus Talent`,
              html: `
                <div style="font-family: Inter, system-ui, sans-serif; max-width: 600px; margin: 0 auto; color: #0A1628;">
                  <div style="background: linear-gradient(135deg, #0A1628 0%, #142038 100%); color: #FFFFFF; padding: 32px; border-radius: 16px 16px 0 0; text-align: center;">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700;">¡Conexión confirmada! ✅</h1>
                    <p style="margin: 8px 0 0 0; opacity: 0.9; font-size: 14px;">El candidato respondió tu solicitud</p>
                  </div>

                  <div style="background: #FFFFFF; padding: 32px; border-radius: 0 0 16px 16px; border: 1px solid rgba(143, 168, 200, 0.2);">
                    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6;">Hola ${recruiterName},</p>

                    <div style="background: #F5F7FA; border-left: 4px solid #4ADE80; padding: 20px; border-radius: 8px; margin-bottom: 24px;">
                      <p style="margin: 0 0 12px 0; font-size: 13px; color: #656D78; text-transform: uppercase; letter-spacing: 1px;">✨ Actualización:</p>
                      <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">✅ ${candidateName} aceptó tu solicitud</p>
                      <p style="margin: 0; font-size: 14px; color: #9CA3AF;">Ahora puedes comenzar una conversación directa</p>
                    </div>

                    <div style="text-align: center; margin-bottom: 32px;">
                      <a href="https://corvustalent.com.ar/dashboard/recruiter?tab=mensajes" style="display: inline-block; background: #0A1628; color: #FFFFFF; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; transition: background 0.2s;">
                        Ir a tu chat
                      </a>
                    </div>

                    <div style="background: #F5F7FA; border: 1px solid rgba(143, 168, 200, 0.2); padding: 16px; border-radius: 8px; margin-bottom: 24px;">
                      <p style="margin: 0 0 8px 0; font-size: 12px; color: #656D78; text-transform: uppercase; letter-spacing: 1px;">📋 Próximos pasos:</p>
                      <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6; color: #1E3050;">
                        <li>Envía un mensaje presentándote</li>
                        <li>Agenda una llamada si lo considera pertinente</li>
                        <li>Mantén profesionalismo y respeto</li>
                      </ul>
                    </div>

                    <p style="margin: 0; font-size: 12px; color: #9CA3AF;">¿Preguntas? Escríbenos a <strong>corvus.talent@gmail.com</strong></p>
                  </div>

                  <div style="text-align: center; padding: 24px; color: #9CA3AF; font-size: 11px;">
                    <p style="margin: 0;">© 2026 Corvus Talent — Talento certero.</p>
                  </div>
                </div>
              `
            });

            console.log(`Email enviado a ${request.recruiter.email} — ${candidateName} aceptó solicitud`);
          } catch (emailError) {
            console.error('Error sending acceptance email to recruiter:', emailError);
          }
        }
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
        }
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
