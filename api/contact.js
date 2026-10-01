// api/contact.js - Solicitudes de contacto CON NOTIFICACIÓN POR EMAIL
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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

  // GET: solicitudes de contacto recibidas (candidato) o enviadas (recruiter)
  if (req.method === 'GET') {
    const { type } = req.query; // "received" o "sent"

    if (type === 'received') {
      // Solicitudes enviadas al candidato
      const { data, error } = await supabase
        .from('contact_requests')
        .select(`
          id,
          recruiter_id,
          candidate_id,
          message,
          company,
          status,
          created_at,
          recruiter:profiles!recruiter_id(nombre, apellido, email, linkedin, company)
        `)
        .eq('candidate_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json(data);
    } else if (type === 'sent') {
      // Solicitudes enviadas por el recruiter
      const { data, error } = await supabase
        .from('contact_requests')
        .select(`
          id,
          recruiter_id,
          candidate_id,
          message,
          company,
          status,
          created_at,
          candidate:profiles!candidate_id(nombre, apellido, email, linkedin, rubro)
        `)
        .eq('recruiter_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Missing or invalid type parameter' });
  }

  // POST: crear nueva solicitud de contacto
  if (req.method === 'POST') {
    const { candidate_id, message, company } = req.body;
    if (!candidate_id || !message) {
      return res.status(400).json({ error: 'Missing candidate_id or message' });
    }

    // Verificar que el usuario es recruiter (optional, pero recomendado)
    const { data: recruiterProfile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    if (profileError || recruiterProfile.role !== 'recruiter') {
      return res.status(403).json({ error: 'Only recruiters can send contact requests' });
    }

    // Verificar que no existe solicitud previa
    const { data: existing } = await supabase
      .from('contact_requests')
      .select('id')
      .eq('recruiter_id', userId)
      .eq('candidate_id', candidate_id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Contact request already exists' });
    }

    // Crear solicitud
    const { data: newRequest, error: insertError } = await supabase
      .from('contact_requests')
      .insert({
        recruiter_id: userId,
        candidate_id,
        message,
        company: company || null,
        status: 'pending'
      })
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(201).json(newRequest);
  }

  // PATCH: actualizar estado de solicitud (aceptar/rechazar)
 // api/contact.js v2 - CON TRACKING DE REPUTACIÓN
// Reemplazar la sección PATCH del api-contact.js anterior

// PATCH: actualizar estado de solicitud (aceptar/rechazar) + TRACKING DE REPUTACIÓN
if (req.method === 'PATCH') {
  const { request_id, status } = req.body;
  if (!request_id || !['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid request_id or status' });
  }

  // Verificar que el usuario es el candidato receptor
  const { data: request, error: requestError } = await supabase
    .from('contact_requests')
    .select('candidate_id, recruiter_id')
    .eq('id', request_id)
    .single();

  if (requestError || !request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  if (request.candidate_id !== userId) {
    return res.status(403).json({ error: 'Only the candidate can respond to this request' });
  }

  // Actualizar estado
  const { data: updated, error: updateError } = await supabase
    .from('contact_requests')
    .update({ status })
    .eq('id', request_id)
    .select()
    .single();

  if (updateError) {
    return res.status(500).json({ error: updateError.message });
  }

  // ==========================================
  // TRACKING DE REPUTACIÓN DEL RECRUITER
  // ==========================================

  if (status === 'accepted') {
    // Incrementar solicitudes_aceptadas + recalcular tasa
    const { data: recruiterProfile } = await supabase
      .from('profiles')
      .select('solicitudes_enviadas, solicitudes_aceptadas')
      .eq('id', request.recruiter_id)
      .single();

    if (recruiterProfile) {
      const newAceptadas = (recruiterProfile.solicitudes_aceptadas || 0) + 1;
      const newTasa = recruiterProfile.solicitudes_enviadas > 0 
        ? (newAceptadas / recruiterProfile.solicitudes_enviadas) * 100 
        : 0;

      // Actualizar counters (el trigger calculará automáticamente es_recruiter_confianza)
      await supabase
        .from('profiles')
        .update({
          solicitudes_aceptadas: newAceptadas,
          tasa_aceptacion: newTasa
        })
        .eq('id', request.recruiter_id);
    }

    // Enviar email al recruiter con datos actualizados
    try {
      const { data: candidateProfile } = await supabase
        .from('profiles')
        .select('nombre, apellido, email')
        .eq('id', userId)
        .single();

      const { data: recruiterProfileEmail } = await supabase
        .from('profiles')
        .select('email, nombre')
        .eq('id', request.recruiter_id)
        .single();

      if (recruiterProfileEmail?.email) {
        // Obtener datos actualizados de reputación
        const { data: updatedRecruiterMetrics } = await supabase
          .from('profiles')
          .select('solicitudes_aceptadas, tasa_aceptacion, es_recruiter_confianza, corporate_email_verified')
          .eq('id', request.recruiter_id)
          .single();

        const reputationInfo = updatedRecruiterMetrics?.es_recruiter_confianza 
          ? `⭐ ¡Felicidades! Ya sos un "Recruiter de confianza" en Corvus Talent.`
          : updatedRecruiterMetrics?.corporate_email_verified
          ? `Tu perfil está verificado 🔵. Aceptaciones: ${updatedRecruiterMetrics?.solicitudes_aceptadas || 0}`
          : `Verifica tu email corporativo para aparecer como recruiter verificado.`;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Corvus Talent <notifications@corvustalent.com.ar>',
            to: recruiterProfileEmail.email,
            subject: `✓ ${candidateProfile?.nombre || 'Un candidato'} aceptó tu solicitud de contacto`,
            html: `
              <div style="font-family: Arial, sans-serif; background: #0A1628; color: #BABDC2; padding: 2rem;">
                <div style="max-width: 600px; margin: 0 auto; background: #19273B; padding: 2rem; border-radius: 8px; border: 1px solid #152132;">
                  <h2 style="color: #FFFFFF; margin-bottom: 1rem;">¡Buena noticia!</h2>
                  <p><strong>${candidateProfile?.nombre || 'El candidato'} aceptó tu solicitud de contacto.</strong></p>
                  <p style="color: #8FA8C8; margin: 1rem 0;">Email: ${candidateProfile?.email || 'No disponible'}</p>
                  <p style="background: #0A1628; padding: 1rem; border-radius: 6px; border-left: 3px solid #8FA8C8; color: #BABDC2;">
                    ${reputationInfo}
                  </p>
                  <p style="margin-top: 1.5rem;">
                    <a href="https://corvustalent.com.ar/dashboard/recruiter/" style="background: #8FA8C8; color: #0A1628; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
                      Ir al Dashboard
                    </a>
                  </p>
                  <hr style="border: none; border-top: 1px solid #152132; margin: 2rem 0;">
                  <p style="color: #656D78; font-size: 0.85rem;">— Corvus Talent<br>Talento certero</p>
                </div>
              </div>
            `
          })
        });
      }
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // No fallar si el email falla
    }

    // Crear conversación automáticamente
    try {
      const { data: existingConv } = await supabase
        .from('conversations')
        .select('id')
        .eq('recruiter_id', request.recruiter_id)
        .eq('candidate_id', userId)
        .maybeSingle();

      if (!existingConv) {
        await supabase
          .from('conversations')
          .insert({
            recruiter_id: request.recruiter_id,
            candidate_id: userId,
            contact_request_id: request_id,
            status: 'active'
          });
      }
    } catch (convError) {
      console.error('Error creating conversation:', convError);
    }
  }

  // Si es rechazada, también contar como solicitud enviada si no estaba contada
  if (status === 'rejected') {
    const { data: recruiterProfile } = await supabase
      .from('profiles')
      .select('solicitudes_enviadas')
      .eq('id', request.recruiter_id)
      .single();

    if (recruiterProfile && recruiterProfile.solicitudes_enviadas === 0) {
      // Contar como 1 solicitud enviada
      await supabase
        .from('profiles')
        .update({ solicitudes_enviadas: 1 })
        .eq('id', request.recruiter_id);
    }
  }

  return res.status(200).json(updated);
}

  res.status(405).json({ error: 'Method not allowed' });
}
