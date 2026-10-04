import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const resend = new Resend(resendApiKey);

// Parse query string manually (Vercel Hobby limitation)
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

export default async function handler(req, res) {
  try {
    const query = parseQuery(req.url);
    const body = parseBody(req.body);
    
    const method = req.method?.toUpperCase();
    const action = body.action || query.action;
    const type = query.type;
    
    // GET endpoints
    if (method === 'GET') {
      if (type === 'received') {
        // Solicitudes recibidas por este usuario (candidato)
        const token = req.headers.cookie?.split('corvus_token=')[1]?.split(';')[0];
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
        // Solicitudes enviadas por este recruiter
        const token = req.headers.cookie?.split('corvus_token=')[1]?.split(';')[0];
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
        const { candidate_id, message } = body;
        
        if (!candidate_id || !message) {
          return res.status(400).json({ error: 'Missing candidate_id or message' });
        }
        
        // Get recruiter info
        const token = req.headers.cookie?.split('corvus_token=')[1]?.split(';')[0];
        if (!token) return res.status(401).json({ error: 'No token' });
        
        const recruiterEmail = decodeURIComponent(token.split('|')[0]);
        
        const { data: recruiter } = await supabase
          .from('profiles')
          .select('id, nombre, apellido, company')
          .eq('email', recruiterEmail)
          .single();
        
        if (!recruiter) return res.status(404).json({ error: 'Recruiter not found' });
        
        // Get candidate info
        const { data: candidate } = await supabase
          .from('profiles')
          .select('id, email, nombre, apellido')
          .eq('id', candidate_id)
          .single();
        
        if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
        
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
          return res.status(400).json({ error: insertError.message });
        }
        
        // Send email to candidate in background
        (async () => {
          try {
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
          } catch (emailError) {
            console.error('❌ Error sending email to candidate:', emailError);
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
        
        // Update request
        const { data: updatedRequest, error: updateError } = await supabase
          .from('contact_requests')
          .update({ status })
          .eq('id', request_id)
          .select()
          .single();
        
        if (updateError) {
          return res.status(400).json({ error: updateError.message });
        }
        
        // If accepted, create conversation
        if (status === 'accepted') {
          const { data: conversation } = await supabase
            .from('conversations')
            .insert([
              {
                recruiter_id: updatedRequest.recruiter_id,
                candidate_id: updatedRequest.candidate_id,
                contact_request_id: request_id,
                status: 'active',
              },
            ])
            .select()
            .single();
          
          // Get recruiter email and info
          const { data: recruiter } = await supabase
            .from('profiles')
            .select('email, nombre, apellido')
            .eq('id', updatedRequest.recruiter_id)
            .single();
          
          // Get candidate info
          const { data: candidate } = await supabase
            .from('profiles')
            .select('nombre, apellido')
            .eq('id', updatedRequest.candidate_id)
            .single();
          
          // Send email to recruiter in background
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
                        Ya podés comenzar a chatear. Esto abre nuevas oportunidades de diálogo directo.
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
    console.error('Moderation handler error:', error);
    res.status(500).json({ error: error.message });
  }
}
