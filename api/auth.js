import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

async function handleLogin(email, password) {
    console.log('[AUTH] Login request:', email);

    // Obtener el usuario de profiles
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

    if (profileError || !profile) {
        console.log('[AUTH] Email not found:', email);
        throw new Error('Email o contraseña incorrectos');
    }

    console.log('[AUTH] Profile found:', email);

    // Validar contraseña (comparación simple para demo)
    // En producción: usar bcrypt o Supabase Auth
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

    // Validar contraseña
    validatePassword(password);

    // Verificar que el email no exista
    const { data: existing, error: checkError } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', email.toLowerCase())
        .single();

    if (existing) {
        console.log('[AUTH] Email already exists:', email);
        throw new Error('Este email ya está registrado');
    }

    // Crear el usuario en profiles
    const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
            email: email.toLowerCase(),
            nombre: nombre,
            role: role,
            password_hash: password, // En producción: hashear con bcrypt
            company: null,
            rubro: null,
            seniority: null
        })
        .select();

    if (insertError) {
        console.error('[AUTH] Insert error:', insertError);
        throw new Error('Error al registrar usuario: ' + insertError.message);
    }

    console.log('[AUTH] ✅ Register successful:', email);
    return {
        email: newProfile[0].email,
        nombre: newProfile[0].nombre,
        role: newProfile[0].role
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
