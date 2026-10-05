// /api/profile.js — GET/POST perfil del usuario
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
  
  // Si tiene formato "email|algo", sacar la parte antes del |
  if (token.includes('|')) {
    return token.split('|')[0].trim();
  }
  
  // Si contiene @, es un email directo
  if (token.includes('@')) {
    return token;
  }
  
  return null;
}

export default async function handler(req, res) {
  // GET: obtener perfil del usuario
  if (req.method === 'GET') {
    return handleGET(req, res);
  }
  // POST: actualizar perfil del usuario
  else if (req.method === 'POST') {
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
    
    console.log('[POST] Updating profile for:', email);
    
    const updates = req.body;
    delete updates.email; // No permitir cambiar email
    
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
