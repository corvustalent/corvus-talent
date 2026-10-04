// /api/moderation.js — Contact requests CRUD
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Extrae el email del token (que es simplemente el email)
function getEmailFromToken(token) {
  if (!token) return null;
  
  // El token es solo el email, puede estar en formato:
  // - "email@example.com" (simple)
  // - "email@example.com|algo" (legacy, sacamos la parte antes del |)
  
  token = token.trim();
  
  if (token.includes('|')) {
    return token.split('|')[0];
  }
  
  // Validar que sea un email válido
  if (token.includes('@')) {
    return token;
  }
  
  return null;
}

// Extrae el token de Authorization header, body, o cookies
function extractToken(req) {
  // 1. Authorization header: "Bearer email@example.com"
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    console.log('[extractToken] From Authorization header:', token);
    return token;
  }
  
  // 2. Body (para POST/PATCH)
  if (req.body && req.body.token) {
    console.log('[extractToken] From body.token:', req.body.token);
    return req.body.token;
  }
  
  // 3. Cookies
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/corvus_token=([^;]+)/);
  if (match) {
    console.log('[extractToken] From cookies:', match[1]);
    return match[1];
  }
  
  console.log('[extractToken] Token not found');
  return null;
}

async function sendEmailNotification(email, subject, htmlContent) {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'corvus.talent@gmail.com',
        to: email,
        subject: subject,
        html: htmlContent,
      }),
    });
    
    if (!response.ok) {
      console.error('[sendEmailNotification] Resend error:', response.statusText);
      return false;
    }
    
    console.log('[sendEmailNotification] Email sent to', email);
    return true;
  } catch (error) {
    console.error('[sendEmailNotification] Error:', error);
    return false;
  }
}

export default async function handler(req, res) {
  // Validar método
  if (req.method === 'GET') {
    return handleGET(req, res);
  } else if (req.method === 'POST') {
    return handlePOST(req, res);
  } else if (req.method === 'PATCH') {
    return handlePATCH(req, res);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

// GET /api/moderation?type=received|sent
async function handleGET(req, res) {
  try {
    // Extraer token
    const token = extractToken(req);
    const email = getEmailFromToken(token);
    
    if (!email) {
      console.log('[GET] Invalid token:', token);
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    console.log('[GET] Fetching contact requests for:', email);
    
    // Determinar si quiere recibidas o enviadas
    const type = req.query.type || 'received'; // 'received' o 'sent'
    
    if (type === 'received') {
      // Solicitudes RECIBIDAS (el usuario es el candidato)
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('candidate_email', email)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('[GET] Supabase error:', error);
        return res.status(500).json({ error: error.message });
      }
      
      console.log('[GET] Found', data.length, 'received requests');
      return res.status(200).json(data);
    } else {
      // Solicitudes ENVIADAS (el usuario es el recruiter)
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('recruiter_email', email)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('[GET] Supabase error:', error);
        return res.status(500).json({ error: error.message });
      }
      
      console.log('[GET] Found', data.length, 'sent requests');
      return res.status(200).json(data);
    }
  } catch (error) {
    console.error('[GET] Unexpected error:', error);
    res.status(500).json({ error: error.message });
  }
}

// POST /api/moderation — Enviar solicitud de contacto
async function handlePOST(req, res) {
  try {
    const token = extractToken(req);
    const recruiter_email = getEmailFromToken(token);
    
    if (!recruiter_email) {
      console.log('[POST] Invalid token:', token);
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { candidate_email, message, company } = req.body;
    
    if (!candidate_email) {
      return res.status(400).json({ error: 'Missing candidate_email' });
    }
    
    console.log('[POST] Recruiter', recruiter_email, 'sending request to', candidate_email);
    
    // Insertar en contact_requests
    const { data, error } = await supabase
      .from('contact_requests')
      .insert({
        recruiter_email,
        candidate_email,
        message: message || '',
        company: company || '',
        status: 'pending',
      })
      .select();
    
    if (error) {
      console.error('[POST] Insert error:', error);
      return res.status(500).json({ error: error.message });
    }
    
    const request = data[0];
    
    // Obtener datos del recruiter
    const { data: recruiterData } = await supabase
      .from('profiles')
      .select('nombre, company')
      .eq('email', recruiter_email)
      .single();
    
    // Enviar email al candidato
    const recruiterName = recruiterData?.nombre || 'Un recruiter';
    const recruiterCompany = recruiterData?.company || company || 'Una empresa';
    
    const emailHTML = `
      <h2>¡Tienes una nueva solicitud de contacto!</h2>
      <p>Hola,</p>
      <p><strong>${recruiterName}</strong> de <strong>${recruiterCompany}</strong> quiere contactarte.</p>
      <p><strong>Mensaje:</strong></p>
      <blockquote>${message || '(Sin mensaje)'}</blockquote>
      <p><a href="https://corvustalent.com.ar/dashboard/candidato">Responder en tu dashboard</a></p>
      <p>— Corvus Talent</p>
    `;
    
    await sendEmailNotification(candidate_email, 'Nueva solicitud de contacto', emailHTML);
    
    console.log('[POST] Request created:', request.id);
    return res.status(201).json(request);
  } catch (error) {
    console.error('[POST] Unexpected error:', error);
    res.status(500).json({ error: error.message });
  }
}

// PATCH /api/moderation — Responder solicitud
async function handlePATCH(req, res) {
  try {
    const token = extractToken(req);
    const candidate_email = getEmailFromToken(token);
    
    if (!candidate_email) {
      console.log('[PATCH] Invalid token:', token);
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { action, request_id, status } = req.body;
    
    if (action !== 'respond_contact_request' || !request_id || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    console.log('[PATCH] Candidate', candidate_email, 'responding to request', request_id, 'with', status);
    
    // Actualizar status
    const { data, error } = await supabase
      .from('contact_requests')
      .update({ status })
      .eq('id', request_id)
      .eq('candidate_email', candidate_email) // Validar que le pertenece
      .select();
    
    if (error) {
      console.error('[PATCH] Update error:', error);
      return res.status(500).json({ error: error.message });
    }
    
    if (!data || data.length === 0) {
      console.log('[PATCH] Request not found or not owned by', candidate_email);
      return res.status(404).json({ error: 'Request not found' });
    }
    
    const request = data[0];
    
    // Si fue aceptada, enviar email al recruiter
    if (status === 'accepted') {
      const recruiterEmail = request.recruiter_email;
      
      // Obtener datos del candidato
      const { data: candidateData } = await supabase
        .from('profiles')
        .select('nombre')
        .eq('email', candidate_email)
        .single();
      
      const candidateName = candidateData?.nombre || 'Un candidato';
      
      const emailHTML = `
        <h2>¡Solicitud aceptada!</h2>
        <p>Hola,</p>
        <p><strong>${candidateName}</strong> aceptó tu solicitud de contacto.</p>
        <p>Puedes enviarle un mensaje directo en tu dashboard: <a href="https://corvustalent.com.ar/dashboard/recruiter">Ir al dashboard</a></p>
        <p>— Corvus Talent</p>
      `;
      
      await sendEmailNotification(recruiterEmail, 'Solicitud aceptada', emailHTML);
    }
    
    console.log('[PATCH] Request updated:', request.id);
    return res.status(200).json(request);
  } catch (error) {
    console.error('[PATCH] Unexpected error:', error);
    res.status(500).json({ error: error.message });
  }
}
