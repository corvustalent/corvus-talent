// api/verify-corporate-email.js - Verificación de email corporativo
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Generar token aleatorio
function generateToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

  // GET: obtener estado actual de verificación del usuario
  if (req.method === 'GET') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('corporate_email, corporate_email_verified, solicitudes_aceptadas, tasa_aceptacion, es_recruiter_confianza')
      .eq('id', userId)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.status(200).json({
      corporate_email: profile.corporate_email,
      corporate_email_verified: profile.corporate_email_verified,
      solicitudes_aceptadas: profile.solicitudes_aceptadas || 0,
      tasa_aceptacion: Math.round(profile.tasa_aceptacion || 0),
      es_recruiter_confianza: profile.es_recruiter_confianza
    });
  }

  // POST: enviar email de verificación
  if (req.method === 'POST') {
    const { action, email } = req.body;

    if (action === 'send-verification') {
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Invalid email' });
      }

      // Verificar que es recruiter
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      if (profile?.role !== 'recruiter') {
        return res.status(403).json({ error: 'Only recruiters can verify corporate email' });
      }

      // Generar token
      const verificationToken = generateToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

      // Guardar token en DB
      const { error: insertError } = await supabase
        .from('corporate_email_verifications')
        .insert({
          user_id: userId,
          email: email,
          token: verificationToken,
          expires_at: expiresAt
        });

      if (insertError) {
        return res.status(500).json({ error: 'Error saving verification token' });
      }

      // Enviar email via Resend
      const verificationUrl = `https://corvustalent.com.ar/verify-corporate-email?token=${verificationToken}`;

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Corvus Talent <verify@corvustalent.com.ar>',
            to: email,
            subject: 'Verifica tu email corporativo en Corvus Talent',
            html: `
              <div style="font-family: Arial, sans-serif; background: #0A1628; color: #BABDC2; padding: 2rem;">
                <div style="max-width: 600px; margin: 0 auto; background: #19273B; padding: 2rem; border-radius: 8px; border: 1px solid #152132;">
                  <h2 style="color: #FFFFFF; margin-bottom: 1rem;">Verifica tu email corporativo</h2>
                  <p>Hola,</p>
                  <p>Haz click en el botón de abajo para verificar que trabajas en esta empresa. Una vez verificado, los candidatos verán un badge de confianza 🔵 en tu perfil.</p>
                  <p style="margin: 2rem 0;">
                    <a href="${verificationUrl}" style="background: #8FA8C8; color: #0A1628; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
                      Verificar email
                    </a>
                  </p>
                  <p style="color: #656D78; font-size: 0.9rem;">Este link vence en 24 horas.</p>
                  <p style="color: #656D78; font-size: 0.85rem;">Si no solicitaste esto, ignora este email.</p>
                  <hr style="border: none; border-top: 1px solid #152132; margin: 2rem 0;">
                  <p style="color: #656D78; font-size: 0.85rem;">— Corvus Talent<br>Talento certero</p>
                </div>
              </div>
            `
          })
        });
      } catch (emailError) {
        console.error('Error sending email:', emailError);
        return res.status(500).json({ error: 'Error sending verification email' });
      }

      return res.status(200).json({ message: 'Verification email sent', email: email });
    }

    // POST: verificar token (cuando usuario hace click en email)
    if (action === 'verify-token') {
      const { token: verificationToken } = req.body;

      if (!verificationToken) {
        return res.status(400).json({ error: 'Missing token' });
      }

      // Buscar token
      const { data: verification, error: verifyError } = await supabase
        .from('corporate_email_verifications')
        .select('*')
        .eq('token', verificationToken)
        .eq('verified', false)
        .single();

      if (verifyError || !verification) {
        return res.status(404).json({ error: 'Invalid or expired token' });
      }

      // Verificar que no expiró
      if (new Date(verification.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Token expired' });
      }

      // Marcar como verificado
      await supabase
        .from('corporate_email_verifications')
        .update({ verified: true, verified_at: new Date().toISOString() })
        .eq('id', verification.id);

      // Actualizar profile
      await supabase
        .from('profiles')
        .update({
          corporate_email: verification.email,
          corporate_email_verified: true
        })
        .eq('id', verification.user_id);

      return res.status(200).json({ message: 'Email verified successfully' });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
