// /api/moderation.js — Contact requests CRUD + email notifications (actualizado sesión 18)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RESEND_API_KEY) {
    throw new Error('Missing environment variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7).trim();
        console.log('[extractToken] From Authorization header');
        return token;
    }
    
    if (req.body && req.body.token) {
        console.log('[extractToken] From body.token');
        return req.body.token.trim();
    }
    
    const cookies = req.headers.cookie || '';
    const match = cookies.match(/corvus_token=([^;]+)/);
    if (match) {
        console.log('[extractToken] From cookies');
        return match[1].trim();
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
            console.error('[sendEmail] Resend error:', response.statusText);
            return false;
        }
        
        console.log('[sendEmail] Sent to', email);
        return true;
    } catch (error) {
        console.error('[sendEmail] Error:', error);
        return false;
    }
}

export default async function handler(req, res) {
    console.log('[MODERATION] Method:', req.method);

    if (req.method === 'GET') {
        return handleGET(req, res);
    } else if (req.method === 'POST') {
        return handlePOST(req, res);
    } else if (req.method === 'PATCH') {
        return handlePATCH(req, res);
    } else {
        return res.status(405).json({ error: 'Method not allowed' });
    }
}

async function handleGET(req, res) {
    try {
        const token = extractToken(req);
        if (!token) {
            console.log('[GET] No token');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Token es el email
        const email = token;
        const type = req.query.type || 'received';
        
        console.log('[GET]', type, 'requests for:', email);
        
        let query = supabase
            .from('contact_requests')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (type === 'received') {
            query = query.eq('candidate_email', email);
        } else if (type === 'sent') {
            query = query.eq('recruiter_email', email);
        }
        
        const { data, error } = await query;
        
        if (error) {
            console.error('[GET] Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }
        
        console.log('[GET] Found:', data?.length || 0, type);
        return res.status(200).json(data || []);

    } catch (error) {
        console.error('[GET] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

async function handlePOST(req, res) {
    try {
        const token = extractToken(req);
        if (!token) {
            console.log('[POST] No token');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const recruiter_email = token;
        const { candidate_email, message, company } = req.body;
        
        if (!candidate_email) {
            return res.status(400).json({ error: 'candidate_email required' });
        }
        
        console.log('[POST] Recruiter', recruiter_email, '→ Candidate', candidate_email);
        
        // Verificar que el candidato existe y está verificado
        const { data: candidateProfile, error: candidateError } = await supabase
            .from('profiles')
            .select('email, nombre, email_verified')
            .eq('email', candidate_email)
            .single();

        if (candidateError || !candidateProfile) {
            console.log('[POST] Candidate not found:', candidate_email);
            return res.status(404).json({ error: 'Candidate not found' });
        }

        if (!candidateProfile.email_verified) {
            console.log('[POST] Candidate email not verified:', candidate_email);
            return res.status(400).json({ error: 'Candidate email not verified' });
        }

        // Crear solicitud
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
        
        const recruiterName = recruiterData?.nombre || 'Un recruiter';
        const recruiterCompany = recruiterData?.company || company || 'Una empresa';
        
        // Enviar email al candidato
        const emailHTML = `
            <h2>¡Tienes una nueva solicitud de contacto!</h2>
            <p>Hola ${candidateProfile.nombre},</p>
            <p><strong>${recruiterName}</strong> de <strong>${recruiterCompany}</strong> quiere contactarte.</p>
            <p><strong>Mensaje:</strong></p>
            <blockquote style="background: #f5f5f5; padding: 1rem; border-left: 3px solid #8FA8C8;">${message || '(Sin mensaje)'}</blockquote>
            <p><a href="https://corvustalent.com.ar/dashboard/candidato" style="background: #0A1628; color: white; padding: 0.5rem 1rem; border-radius: 4px; text-decoration: none; display: inline-block;">Responder en tu dashboard</a></p>
            <hr>
            <p><small>— Corvus Talent</small></p>
        `;
        
        await sendEmailNotification(
            candidate_email,
            `Nueva solicitud de contacto de ${recruiterCompany}`,
            emailHTML
        );
        
        console.log('[POST] ✅ Request created:', request.id);
        return res.status(201).json(request);

    } catch (error) {
        console.error('[POST] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}

async function handlePATCH(req, res) {
    try {
        const token = extractToken(req);
        if (!token) {
            console.log('[PATCH] No token');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const candidate_email = token;
        const { request_id, status } = req.body;
        
        if (!request_id || !['accepted', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'request_id and valid status required' });
        }
        
        console.log('[PATCH] Candidate', candidate_email, '→ Request', request_id, 'Status:', status);
        
        // Actualizar solicitud
        const { data, error } = await supabase
            .from('contact_requests')
            .update({ status })
            .eq('id', request_id)
            .eq('candidate_email', candidate_email)
            .select();
        
        if (error) {
            console.error('[PATCH] Update error:', error);
            return res.status(500).json({ error: error.message });
        }
        
        if (!data || data.length === 0) {
            console.log('[PATCH] Request not found or unauthorized');
            return res.status(404).json({ error: 'Request not found' });
        }
        
        const request = data[0];
        const recruiterEmail = request.recruiter_email;
        
        // Si fue aceptada, enviar email al recruiter
        if (status === 'accepted') {
            const { data: candidateData } = await supabase
                .from('profiles')
                .select('nombre')
                .eq('email', candidate_email)
                .single();
            
            const candidateName = candidateData?.nombre || 'Un candidato';
            
            const emailHTML = `
                <h2>¡Solicitud aceptada! 🎉</h2>
                <p>Hola,</p>
                <p><strong>${candidateName}</strong> aceptó tu solicitud de contacto.</p>
                <p>Puedes enviarle un mensaje directo: <a href="https://corvustalent.com.ar/dashboard/recruiter">Ir al dashboard</a></p>
                <hr>
                <p><small>— Corvus Talent</small></p>
            `;
            
            await sendEmailNotification(
                recruiterEmail,
                `${candidateName} aceptó tu solicitud`,
                emailHTML
            );
        }
        
        console.log('[PATCH] ✅ Request updated:', request.id);
        return res.status(200).json(request);

    } catch (error) {
        console.error('[PATCH] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
