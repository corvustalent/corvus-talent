// /api/profile.js — GET/POST perfil + solicitudes de contacto
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function extractToken(req) {
  // 1. Authorization header: "Bearer email@example.com"
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    console.log('[extractToken] From Authorization header:', token);
    return token;
  }
  
  // 2. Body (para POST)
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

function getEmailFromToken(token) {
  if (!token) return null;
  token = token.trim();
  if (token.includes('|')) {
    return token.split('|')[0].trim();
  }
  if (token.includes('@')) {
    return token;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return handleGET(req, res);
  } else if (req.method === 'POST') {
    return handlePOST(req, res);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGET(req, res) {
  try {
    const token = extractToken(req);
    const email = getEmailFromToken(token);
    
    if (!email) {
      console.log('[GET] Invalid token:', token);
      return res.status(401).json({ error: 'Invalid token' });
    }

    // GET solicitudes de contacto enviadas por recruiter
    if (req.query.type === 'contact_requests') {
      console.log('[GET] Fetching contact_requests for:', email);
      const { data, error } = await supabase
        .from('contact_requests')
        .select('*')
        .eq('recruiter_email', email)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('[GET] Supabase error:', error);
        return res.status(500).json({ error: error.message });
      }
      console.log('[GET] Found', data?.length || 0, 'contact requests');
      return res.status(200).json(data || []);
    }

    // GET: obtener perfil del usuario (default)
    console.log('[GET] Fetching profile for:', email);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error) {
      console.error('[GET] Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }
    
    if (!data) {
      console.log('[GET] Profile not found for:', email);
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    console.log('[GET] Profile found:', data.email);
    return res.status(200).json(data);
  } catch (error) {
    console.error('[GET] Unexpected error:', error);
    res.status(500).json({ error: error.message });
  }
}

async function handlePOST(req, res) {
  try {
    const token = extractToken(req);
    const email = getEmailFromToken(token);
    
    if (!email) {
      console.log('[POST] Invalid token:', token);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { action } = req.body;

    // POST: crear solicitud de contacto
    if (action === 'contact_create') {
      const { candidate_email, message, company } = req.body;
      
      if (!candidate_email) {
        return res.status(400).json({ error: 'candidate_email requerido' });
      }

      console.log('[POST] Creating contact_request from', email, 'to', candidate_email);

      // Verificar que no exista solicitud previa
      const { data: existing } = await supabase
        .from('contact_requests')
        .select('id')
        .eq('recruiter_email', email)
        .eq('candidate_email', candidate_email)
        .maybeSingle();
      
      if (existing) {
        console.log('[POST] Contact request already exists');
        return res.status(400).json({ error: 'Ya enviaste una solicitud a este candidato' });
      }

      // Crear solicitud
      const { data, error } = await supabase
        .from('contact_requests')
        .insert({
          recruiter_email: email,
          candidate_email: candidate_email,
          message: message || null,
          company: company || 'Sin especificar',
          status: 'pending',
          created_at: new Date().toISOString()
        })
        .select();
      
      if (error) {
        console.error('[POST] Supabase error:', error);
        return res.status(500).json({ error: error.message });
      }
      
      console.log('[POST] Contact request created:', data[0].id);
      return res.status(201).json(data[0]);
    }

    // POST: actualizar perfil del usuario (default)
    console.log('[POST] Updating profile for:', email);
    
    const updates = req.body;
    delete updates.email; // No permitir cambiar email
    delete updates.action; // Remover action si vino en body
    
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('email', email)
      .select()
      .single();
    
    if (error) {
      console.error('[POST] Supabase error:', error);
      return res.status(500).json({ error: error.message });
    }
    
    if (!data) {
      console.log('[POST] Profile not found for:', email);
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    console.log('[POST] Profile updated:', data.email);
    return res.status(200).json(data);
  } catch (error) {
    console.error('[POST] Unexpected error:', error);
    res.status(500).json({ error: error.message });
  }
}
