import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export default async function handler(req, res) {
    console.log('[API VERIFY] Method:', req.method);

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { token, email } = req.body;

        if (!token || !email) {
            return res.status(400).json({ error: 'Token y email requeridos' });
        }

        console.log('[VERIFY] Validando token para:', email);

        // BUSCAR TOKEN EN LA BD
        const { data: tokenRecord, error: tokenError } = await supabase
            .from('email_verification_tokens')
            .select('*')
            .eq('token', token)
            .eq('email', email.toLowerCase())
            .single();

        if (tokenError || !tokenRecord) {
            console.log('[VERIFY] Token no encontrado o inválido');
            return res.status(400).json({ error: 'Token inválido o expirado' });
        }

        // VERIFICAR QUE NO ESTÉ EXPIRADO
        const now = new Date();
        const expiresAt = new Date(tokenRecord.expires_at);

        if (now > expiresAt) {
            console.log('[VERIFY] Token expirado');
            return res.status(400).json({ error: 'Token expirado. Solicita uno nuevo.' });
        }

        // VERIFICAR QUE NO HAYA SIDO USADO YA
        if (tokenRecord.used_at) {
            console.log('[VERIFY] Token ya fue usado');
            return res.status(400).json({ error: 'Este token ya fue usado' });
        }

        // MARCAR EMAIL COMO VERIFICADO EN PROFILES
        const { error: updateError } = await supabase
            .from('profiles')
            .update({ email_verified: true })
            .eq('email', email.toLowerCase());

        if (updateError) {
            console.error('[VERIFY] Error updating profile:', updateError);
            return res.status(500).json({ error: 'Error al verificar email' });
        }

        // MARCAR TOKEN COMO USADO
        const { error: tokenUpdateError } = await supabase
            .from('email_verification_tokens')
            .update({ used_at: now.toISOString() })
            .eq('id', tokenRecord.id);

        if (tokenUpdateError) {
            console.error('[VERIFY] Error marking token as used:', tokenUpdateError);
        }

        console.log('[VERIFY] ✅ Email verificado para:', email);
        return res.status(200).json({ 
            success: true,
            message: 'Email verificado correctamente. Ya puedes ingresar.' 
        });

    } catch (error) {
        console.error('[API VERIFY] Error:', error.message);
        res.status(500).json({ error: 'Error en la verificación: ' + error.message });
    }
}
