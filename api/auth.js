import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseServiceKey || !resendApiKey) {
    throw new Error('Missing environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const resend = new Resend(resendApiKey);

function validatePassword(password) {
    if (password.length < 8) {
        throw new Error('Contraseña debe tener mínimo 8 caracteres');
    }
    if (!/[A-Z]/.test(password)) {
        throw new Error('Contraseña debe tener al menos 1 mayúscula');
    }
    if (!/[0-9]/.test(password)) {
        throw new Error('Contraseña debe tener al menos 1 número');
    }
}

function generateVerificationToken() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function handleLogin(email, password) {
    console.log('[AUTH] Login request:', email);

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

    if (profileError || !profile) {
        console.log('[AUTH] Email not found:', email);
        throw new Error('Email o contraseña incorrectos');
    }

    // VERIFICAR QUE EMAIL ESTÉ VERIFICADO
    if (!profile.email_verified) {
        console.log('[AUTH] Email not verified:', email);
        throw new Error('Por favor verifica tu email antes de ingresar. Revisa tu bandeja de entrada.');
    }

    if (profile.password_hash !== password) {
        console.log('[AUTH] Invalid password');
        throw new Error('Email o contraseña incorrectos');
    }

    console.log('[AUTH] ✅ Login successful:', email);
    return {
        email: profile.email,
        nombre: profile.nombre,
        role: profile.role,
        company: profile.company
    };
}

async function handleRegister(email, password, nombre, role) {
    console.log('[AUTH] Register request:', email, role);

    validatePassword(password);

    const { data: existing } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', email.toLowerCase())
        .single();

    if (existing) {
        console.log('[AUTH] Email already exists:', email);
        throw new Error('Este email ya está registrado');
    }

    // CREAR USUARIO CON email_verified: false
    const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
            email: email.toLowerCase(),
            nombre: nombre,
            role: role,
            password_hash: password,
            email_verified: false,
            company: null,
            rubro: null,
            seniority: null
        })
        .select();

    if (insertError) {
        console.error('[AUTH] Insert error:', insertError);
        throw new Error('Error al registrar usuario: ' + insertError.message);
    }

    // GENERAR TOKEN DE VERIFICACIÓN
    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 3600000); // 1 hora

    const { error: tokenError } = await supabase
        .from('email_verification_tokens')
        .insert({
            user_id: newProfile[0].id,
            email: email.toLowerCase(),
            token: verificationToken,
            expires_at: expiresAt.toISOString()
        });

    if (tokenError) {
        console.error('[AUTH] Token creation error:', tokenError);
        throw new Error('Error al generar token de verificación');
    }

    // ENVIAR EMAIL CON LINK DE VERIFICACIÓN
    const verificationUrl = `https://corvustalent.com.ar/verify?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    
    try {
        await resend.emails.send({
            from: 'corvus.talent@gmail.com',
            to: email.toLowerCase(),
            subject: '🦅 Verifica tu email en Corvus Talent',
            html: `
                <h2>¡Bienvenido a Corvus Talent!</h2>
                <p>Hola ${nombre},</p>
                <p>Para completar tu registro, necesitas verificar tu email. Haz click en el botón de abajo:</p>
                <p>
                    <a href="${verificationUrl}" style="background: #0a1628; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; display: inline-block;">
                        ✅ Verificar Email
                    </a>
                </p>
                <p>O copia este link en tu navegador:</p>
                <p><code>${verificationUrl}</code></p>
                <p><small>Este link expira en 1 hora.</small></p>
                <hr>
                <p><small>Si no creaste una cuenta, ignora este email.</small></p>
            `
        });
        console.log('[AUTH] Verification email sent to:', email);
    } catch (emailError) {
        console.error('[AUTH] Email sending error:', emailError);
        // Continuar de todas formas — el usuario puede solicitar reenvío
    }

    console.log('[AUTH] ✅ Register successful:', email);
    return {
        email: newProfile[0].email,
        nombre: newProfile[0].nombre,
        role: newProfile[0].role,
        message: 'Cuenta creada. Revisa tu email para verificar tu dirección.'
    };
}

export default async function handler(req, res) {
    console.log('[API AUTH] Method:', req.method, 'Action:', req.body?.action);

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { action, email, password, nombre, role } = req.body;

        let user;

        if (action === 'login') {
            if (!email || !password) {
                return res.status(400).json({ error: 'Email y contraseña requeridos' });
            }
            user = await handleLogin(email, password);
        } else if (action === 'register') {
            if (!email || !password || !nombre || !role) {
                return res.status(400).json({ error: 'Email, contraseña, nombre y rol requeridos' });
            }
            user = await handleRegister(email, password, nombre, role);
        } else {
            return res.status(400).json({ error: 'Action desconocida' });
        }

        res.status(200).json(user);
    } catch (error) {
        console.error('[API AUTH] Error:', error.message);
        res.status(400).json({ error: error.message });
    }
}
