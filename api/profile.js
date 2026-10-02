import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

function generateToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verificar token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const token = authHeader.split(' ')[1];

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Verificar usuario con el token
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Sesión inválida' });
  }

  if (req.method === 'GET') {
    // Obtener perfil + análisis + estado de verificación
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    const { data: analyses } = await supabase
      .from('fit_analyses')
      .select('id, score, job_title, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    // CALCULAR BADGES SEGÚN ROLE
    const badges = [];
    
    if (profile) {
      if (profile.role === 'recruiter') {
        // BADGES PARA RECRUITER
        if (profile.corporate_email_verified === true) {
          badges.push({
            id: 'verified',
            icon: '🔵',
            name: 'Verificado',
            color: '#3B82F6'
          });
        }

        if (profile.corporate_email_verified === true && 
            profile.solicitudes_enviadas >= 5 &&
            profile.tasa_aceptacion >= 80) {
          badges.push({
            id: 'trusted',
            icon: '⭐',
            name: 'De confianza',
            color: '#FBBF24'
          });
        }
      } else {
        // BADGES PARA CANDIDATO
        const requiredFields = ['nombre', 'apellido', 'rubro', 'seniority', 'ubicacion'];
        const filledCount = requiredFields.filter(f => profile[f]).length;
        if (filledCount >= 5) {
          badges.push({
            id: 'profile_complete',
            icon: '✅',
            name: 'Perfil completo',
            color: '#4ADE80'
          });
        }

        if (analyses && analyses.length > 0) {
          badges.push({
            id: 'analyzed',
            icon: '📊',
            name: 'Analizado',
            color: '#3B82F6'
          });
        }

        if (profile.visible === true) {
          badges.push({
            id: 'active',
            icon: '🎯',
            name: 'Activo',
            color: '#8FA8C8'
          });
        }

        if (analyses && analyses.length > 0) {
          const maxScore = Math.max(...analyses.map(a => a.score || 0));
          if (maxScore >= 75) {
            badges.push({
              id: 'high_score',
              icon: '🔥',
              name: 'Score alto',
              color: '#F59E0B'
            });
          }
        }
      }
    }

    return res.status(200).json({ 
      profile, 
      analyses: analyses || [],
      badges: badges
    });
  }

  if (req.method === 'POST') {
    const { action, ...data } = req.body;

    // ── UPDATE PROFILE ────────────────────────────────────────
    if (action === 'update_visibility') {
      await supabase.from('profiles').update({ visible: data.visible }).eq('id', user.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'update_profile') {
      const allowed = ['nombre','apellido','rubro','seniority','ubicacion',
        'email_contacto','telefono','linkedin','genero',
        'mostrar_email','mostrar_telefono','mostrar_linkedin','mostrar_genero'];
      const update = {};
      allowed.forEach(k => { if (data[k] !== undefined) update[k] = data[k]; });
      const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (action === 'update_deseos') {
      const allowed = ['tipo_puesto','modalidad','seniority_deseado','disponibilidad',
        'rubros_interes','salario_ars','salario_usd','notas'];
      const update = {};
      allowed.forEach(k => { if (data[k] !== undefined) update[k] = data[k]; });
      const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // ── CORPORATE EMAIL VERIFICATION ──────────────────────────
    if (action === 'send-verification') {
      const { email } = data;
      
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Email inválido' });
      }

      // Verificar que es recruiter
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profile?.role !== 'recruiter') {
        return res.status(403).json({ error: 'Solo recruiters pueden verificar email corporativo' });
      }

      // Generar token
      const verificationToken = generateToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Guardar token
      const { error: insertError } = await supabase
        .from('corporate_email_verifications')
        .insert({
          user_id: user.id,
          email: email,
          token: verificationToken,
          expires_at: expiresAt
        });

      if (insertError) {
        return res.status(500).json({ error: 'Error al guardar token' });
      }

      // Enviar email
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
        return res.status(500).json({ error: 'Error al enviar email' });
      }

      return res.status(200).json({ message: 'Email de verificación enviado', email: email });
    }

    if (action === 'verify-token') {
      const { token: verificationToken } = data;

      if (!verificationToken) {
        return res.status(400).json({ error: 'Token requerido' });
      }

      // Buscar token
      const { data: verification, error: verifyError } = await supabase
        .from('corporate_email_verifications')
        .select('*')
        .eq('token', verificationToken)
        .eq('verified', false)
        .single();

      if (verifyError || !verification) {
        return res.status(404).json({ error: 'Token inválido o expirado' });
      }

      // Verificar que no expiró
      if (new Date(verification.expires_at) < new Date()) {
        return res.status(400).json({ error: 'El token venció' });
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

      return res.status(200).json({ message: 'Email verificado correctamente' });
    }

    return res.status(400).json({ error: 'Acción inválida' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
