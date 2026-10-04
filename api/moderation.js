import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const resend = new Resend(resendApiKey);

// Parse query string manually
function parseQuery(url) {
  const query = {};
  if (!url || !url.includes('?')) return query;
  const queryString = url.split('?')[1];
  if (!queryString) return query;
  queryString.split('&').forEach(param => {
    const [key, value] = param.split('=');
    if (key) {
      query[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  });
  return query;
}

// Parse body safely
function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

// Extract token from multiple sources
function extractToken(req, body) {
  // 1. Check body
  if (body?.token) {
    console.log('✅ Token found in body:', body.token.substring(0, 50) + '...');
    return body.token;
  }
  
  // 2. Check Authorization header
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    console.log('✅ Token found in Authorization header:', token.substring(0, 50) + '...');
    return token;
  }
  
  // 3. Check cookies
  if (req.headers?.cookie) {
    const match = req.headers.cookie.match(/corvus_token=([^;]+)/);
    if (match && match[1]) {
      console.log('✅ Token found in cookie:', match[1].substring(0, 50) + '...');
      return match[1];
    }
  }
  
  console.log('❌ No token found in any source');
  return null;
}

// Get recruiter profile from token
async function getRecruiterFromToken(token) {
  if (!token) {
    console.log('❌ Token is null or empty');
    return null;
  }
  
  try {
    // Token format: "email|something" or just email
    let recruiterEmail;
    
    if (token.includes('|')) {
      recruiterEmail = decodeURIComponent(token.split('|')[0]);
      console.log('📧 Email extracted from pipe format:', recruiterEmail);
    } else {
      // Token might be just the email
      recruiterEmail = decodeURIComponent(token);
      console.log('📧 Token treated as email directly:', recruiterEmail);
    }
    
    console.log('🔍 Searching for recruiter with email:', recruiterEmail);
    
    const { data: recruiter, error } = await supabase
      .from('profiles')
      .select('id, nombre, apellido, company')
      .eq('email', recruiterEmail)
      .single();
    
    if (error) {
      console.log('❌ Database error:', error.message);
      return null;
    }
    
    if (!recruiter) {
      console.log('❌ Recruiter not found in database for email:', recruiterEmail);
      return null;
    }
    
    console.log('✅ Recruiter found:', recruiter.nombre, recruiter.apellido);
    return recruiter;
  } catch (err) {
    console.error('❌ Error in getRecruiterFromToken:', err);
    return null;
  }
}

export default async function handler(req, res) {
  try {
    const query = parseQuery(req.url);
    const body = parseBody(req.body);
    
    const method = req.method?.toUpperCase();
    const action = body.action || query.action;
    const type = query.type;
    
    console.log('📝 Request:', method, req.url);
    
    // GET endpoints
    if (method === 'GET') {
      if (type === 'received') {
        const token = extractToken(req, body);
        if (!token) return res.status(401).json({ error: 'No token' });
        
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', decodeURIComponent(token.split('|')[0]))
          .single();
        
        if (!profile) return res.status(404).json({ error: 'Profile not found' });
        
        const { data, error } = await supabase
          .from('contact_requests')
          .select('*')
          .eq('candidate_id', profile.id)
          .order('created_at', { ascending: false });
        
        return res.status(error ? 400 : 200).json(error || data);
      }
      
      if (type === 'sent') {
        const token = extractToken(req, body);
        if (!token) return res.status(401).json({ error: 'No token' });
        
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', decodeURIComponent(token.split('|')[0]))
          .single();
        
        if (!profile) return res.status(404).json({ error: 'Profile not found' });
        
        const { data, error } = await supabase
          .from('contact_requests')
          .select('*')
          .eq('recruiter_id', profile.id)
          .order('created_at', { ascending: false });
        
        return res.status(error ? 400 : 200).json(error || data);
      }
      
      return res.status(400).json({ error: 'Bad request' });
    }
    
    // POST endpoints
    if (method === 'POST') {
      if (action === 'send_contact_request') {
        console.log('📤 send_contact_request action');
        
        const { candidate_id, message } = body;
        
        if (!candidate_id || !message) {
          return res.status(400).json({ error: 'Missing candidate_id or message' });
        }
        
        // Get recruiter info from token
        const token = extractToken(req, body);
        if (!token) {
          console.log('❌ No token provided');
          return res.status(401).json({ error: 'No token' });
        }
        
        const recruiter = await getRecruiterFromToken(token);
        if (!recruiter) {
          console.log('❌ Recruiter not found');
          return res.status(404).json({ error: 'Recruiter not found' });
        }
        
        console.log('✅ Recruiter authenticated:', recruiter.id);
        
        // Get candidate info
        const { data: candidate } = await supabase
          .from('profiles')
          .select('id, email, nombre, apellido')
          .eq('id', candidate_id)
          .single();
        
        if (!candidate) {
          console.log('❌ Candidate not found');
          return res.status(404).json({ error: 'Candidate not found' });
        }
        
        console.log('✅ Candidate found:', candidate.nombre);
        
        // Insert contact request
        const { data: request, error: insertError } = await supabase
          .from('contact_requests')
          .insert([
            {
              recruiter_id: recruiter.id,
              candidate_id: candidate.id,
              message,
              status: 'pending',
            },
          ])
          .select()
          .single();
        
        if (insertError) {
          console.log('❌ Insert error:', insertError.message);
          return res.status(400).json({ error: insertError.message });
        }
        
        console.log('✅ Contact request created:', request.id);
        
        // Send email to candidate in background (non-blocking)
        (async () => {
          try {
            console.log('📧 Sending email to candidate:', candidate.email);
            await resend.emails.send({
              from: 'Corvus Talent <info@corvustalent.com.ar>',
              to: candidate.email,
              subject: `📩 ${recruiter.nombre || 'Un recruiter'} te envió una solicitud de contacto — Corvus Talent`,
              html: `
                <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: #0A1628; padding: 32px; text-align: center; border-radius: 8px 8px 0 0;">
                    <h1 style="color: #FFFFFF; margin: 0; font-size: 24px;">Corvus Talent</h1>
                  </div>
                  <div style="background: #FFFFFF; padding: 32px; border-radius: 0 0 8px 8px;">
                    <p style="color: #0A1628; font-size: 16px; margin-top: 0;">Hola ${candidate.nombre},</p>
                    <p style="color: #0A1628; font-size: 16px; line-height: 1.6;">
                      <strong>${recruiter.nombre || 'Un recruiter'}</strong> de <strong>${recruiter.company || 'una empresa'}</strong> te envió una solicitud de contacto.
                    </p>
                    <div style="background: #F3F4F6; padding: 16px; border-radius: 8px; margin: 24px 0; border-left: 4px solid #8FA8C8;">
                      <p style="color: #0A1628; margin: 0; font-size: 14px;">${message}</p>
                    </div>
                    <div style="margin: 24px 0;">
                      <a href="https://corvustalent.com.ar/dashboard/candidato" style="background: #0A1628; color: #FFFFFF; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Ver solicitud en tu panel</a>
                    </div>
                    <p style="color: #656D78; font-size: 12px; margin-top: 32px;">Corvus Talent © 2026</p>
                  </div>
                </div>
              `,
            });
            console.log('✅ Email sent successfully');
          } catch (emailError) {
            console.error('❌ Error sending email:', emailError);
          }
        })();
        
        return res.status(201).json({ success: true, request });
      }
      
      return res.status(400).json({ error: 'Unknown action' });
    }
    
    // PATCH endpoints
    if (method === 'PATCH') {
      if (action === 'respond_contact_request') {
        const { request_id, status } = body;
        
        if (!request_id || !status) {
          return res.status(400).json({ error: 'Missing request_id or status' });
        }
        
        const { data: updatedRequest, error: updateError } = await supabase
          .from('contact_requests')
          .update({ status })
          .eq('id', request_id)
          .select()
          .single();
        
        if (updateError) {
          return res.status(400).json({ error: updateError.message });
        }
        
        if (status === 'accepted') {
          await supabase
            .from('conversations')
            .insert([
              {
                recruiter_id: updatedRequest.recruiter_id,
                candidate_id: updatedRequest.candidate_id,
                contact_request_id: request_id,
                status: 'active',
              },
            ]);
          
          const { data: recruiter } = await supabase
            .from('profiles')
            .select('email, nombre, apellido')
            .eq('id', updatedRequest.recruiter_id)
            .single();
          
          const { data: candidate } = await supabase
            .from('profiles')
            .select('nombre, apellido')
            .eq('id', updatedRequest.candidate_id)
            .single();
          
          (async () => {
            try {
              await resend.emails.send({
                from: 'Corvus Talent <info@corvustalent.com.ar>',
                to: recruiter.email,
                subject: `✅ ${candidate.nombre || 'Un candidato'} aceptó tu solicitud de contacto — Corvus Talent`,
                html: `
                  <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: #0A1628; padding: 32px; text-align: center; border-radius: 8px 8px 0 0;">
                      <h1 style="color: #FFFFFF; margin: 0; font-size: 24px;">Corvus Talent</h1>
                    </div>
                    <div style="background: #FFFFFF; padding: 32px; border-radius: 0 0 8px 8px;">
                      <p style="color: #0A1628; font-size: 16px; margin-top: 0;">Hola ${recruiter.nombre},</p>
                      <div style="background: #F0FDF4; padding: 16px; border-radius: 8px; margin: 24px 0; border-left: 4px solid #4ADE80;">
                        <p style="color: #0A1628; margin: 0; font-size: 14px;">✅ <strong>${candidate.nombre || 'El candidato'} aceptó tu solicitud</strong></p>
                      </div>
                      <p style="color: #0A1628; font-size: 16px; line-height: 1.6;">
                        Ya podés comenzar a chatear.
                      </p>
                      <div style="margin: 24px 0;">
                        <a href="https://corvustalent.com.ar/chat" style="background: #0A1628; color: #FFFFFF; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Ir a tu chat</a>
                      </div>
                      <p style="color: #656D78; font-size: 12px; margin-top: 32px;">Corvus Talent © 2026</p>
                    </div>
                  </div>
                `,
              });
            } catch (emailError) {
              console.error('❌ Error sending email to recruiter:', emailError);
            }
          })();
        }
        
        return res.status(200).json({ success: true, request: updatedRequest });
      }
      
      return res.status(400).json({ error: 'Unknown action' });
    }
    
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('❌ Handler error:', error);
    res.status(500).json({ error: error.message });
  }
}
