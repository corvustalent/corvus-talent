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

    // SI STATUS ES "ACCEPTED" → ENVIAR EMAIL AL RECRUITER
    if (status === 'accepted') {
      try {
        // Obtener datos del candidato que aceptó
        const { data: candidateProfile } = await supabase
          .from('profiles')
          .select('nombre, apellido, email')
          .eq('id', userId)
          .single();

        // Obtener datos del recruiter
        const { data: recruiterProfile } = await supabase
          .from('profiles')
          .select('email, nombre')
          .eq('id', request.recruiter_id)
          .single();

        if (recruiterProfile?.email) {
          // Enviar email via Resend
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'Corvus Talent <notifications@corvustalent.com.ar>',
              to: recruiterProfile.email,
              subject: `✓ ${candidateProfile?.nombre || 'Un candidato'} aceptó tu solicitud de contacto`,
              html: `
                <h2>¡Buena noticia!</h2>
                <p>${candidateProfile?.nombre || 'El candidato'} aceptó tu solicitud de contacto.</p>
                <p><strong>Email:</strong> ${candidateProfile?.email || 'No disponible'}</p>
                <p>Podés ponerte en contacto o acceder al chat desde tu dashboard en <a href="https://corvustalent.com.ar/dashboard/recruiter">Corvus Talent</a>.</p>
                <p>—<br>Corvus Talent</p>
              `
            })
          });
        }
      } catch (emailError) {
        console.error('Error sending email:', emailError);
        // No fallar la solicitud si el email falla
      }

      // Crear conversación automáticamente si no existe
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

    return res.status(200).json(updated);
  }

  res.status(405).json({ error: 'Method not allowed' });
}
