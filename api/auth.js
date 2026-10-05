// /api/auth.js — Login + Register + Email Verification (CONSOLIDADO)
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
    if (password.length < 8) throw new Error('Contraseña debe tener mínimo 8 caracteres');
    if (!/[A-Z]/.test(password)) throw new Error('Contraseña debe tener al menos 1 mayúscula');
    if (!/[0-9]/.test(password)) throw new Error('Contraseña debe tener al menos 1 número');
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
        throw new Error('Email o contraseña incorrectos');
    }
    if (!profile.email_verified) {
        throw new Error('Por favor verifica tu email antes de ingresar.');
    }
    if (profile.password_hash !== password) {
        throw new Error('Email o contraseña incorrectos');
    }
    console.log('[AUTH] ✅ Login successful:', email);
    return { email: profile.email, nombre: profile.nombre, role: profile.role, company: profile.company };
}

async function handleRegister(email, password, nombre, role) {
    console.log('[AUTH] Register request:', email, role);
    validatePassword(password);

    const { data: existing } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', email.toLowerCase())
        .single();

    if (existing) throw new Error('Este email ya está registrado');

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

    if (insertError) throw new Error('Error al registrar usuario: ' + insertError.message);

    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + 3600000);

    const { error: tokenError } = await supabase
        .from('email_verification_tokens')
        .insert({
            user_id: newProfile[0].id,
            email: email.toLowerCase(),
            token: verificationToken,
            expires_at: expiresAt.toISOString()
        });

    if (tokenError) throw new Error('Error al generar token de verificación');

    const verificationUrl = `https://corvustalent.com.ar/verify?token=${verificationToken}&email=${encodeURIComponent(email)}`;

    try {
        await resend.emails.send({
            from: 'corvus.talent@gmail.com',
            to: email.toLowerCase(),
            subject: '🦅 Verifica tu email en Corvus Talent',
            html: `
                <h2>¡Bienvenido a Corvus Talent!</h2>
                <p>Hola ${nombre},</p>
                <p>Verifica tu email haciendo click aquí:</p>
                <p><a href="${verificationUrl}" style="background: #0a1628; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; display: inline-block;">✅ Verificar Email</a></p>
                <p><code>${verificationUrl}</code></p>
                <p><small>Expira en 1 hora.</small></p>
            `
        });
        console.log('[AUTH] Verification email sent to:', email);
    } catch (emailError) {
        console.error('[AUTH] Email error:', emailError);
    }

    console.log('[AUTH] ✅ Register successful:', email);
    return { email: newProfile[0].email, nombre: newProfile[0].nombre, role: newProfile[0].role, message: 'Revisa tu email para verificar.' };
}

async function handleVerify(token, email) {
    console.log('[AUTH] Verify token for:', email);

    const { data: tokenRecord, error: tokenError } = await supabase
        .from('email_verification_tokens')
        .select('*')
        .eq('token', token)
        .eq('email', email.toLowerCase())
        .single();

    if (tokenError || !tokenRecord) throw new Error('Token inválido o expirado');

    const now = new Date();
    const expiresAt = new Date(tokenRecord.expires_at);
    if (now > expiresAt) throw new Error('Token expirado. Solicita uno nuevo.');
    if (tokenRecord.used_at) throw new Error('Este token ya fue usado');

    const { error: updateError } = await supabase
        .from('profiles')
        .update({ email_verified: true })
        .eq('email', email.toLowerCase());

    if (updateError) throw new Error('Error al verificar email');

    await supabase
        .from('email_verification_tokens')
        .update({ used_at: now.toISOString() })
        .eq('id', tokenRecord.id);

    console.log('[AUTH] ✅ Email verified:', email);
    return { success: true, message: 'Email verificado correctamente. Ya puedes ingresar.' };
}

export default async function handler(req, res) {
    console.log('[API AUTH] Method:', req.method, 'Action:', req.body?.action);

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { action, email, password, nombre, role, token } = req.body;
        let result;

        if (action === 'login') {
            if (!email || !password) throw new Error('Email y contraseña requeridos');
            result = await handleLogin(email, password);
        } else if (action === 'register') {
            if (!email || !password || !nombre || !role) throw new Error('Todos los campos requeridos');
            result = await handleRegister(email, password, nombre, role);
        } else if (action === 'verify') {
            if (!token || !email) throw new Error('Token y email requeridos');
            result = await handleVerify(token, email);
        } else {
            throw new Error('Action desconocida');
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('[API AUTH] Error:', error.message);
        res.status(400).json({ error: error.message });
    }
}
