import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function getEmailFromToken(authHeader) {
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
    return parts[1];
}

export default async function handler(req, res) {
    console.log('[API CANDIDATES] Method:', req.method);

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const email = getEmailFromToken(req.headers.authorization);
        if (!email) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        console.log('[CANDIDATES] Recruiter:', email);

        // OBTENER TODOS LOS CANDIDATOS VISIBLES
        const { data: candidates, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('role', 'candidato')
            .eq('visible', true)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[CANDIDATES] Error:', error);
            return res.status(500).json({ error: error.message });
        }

        console.log('[CANDIDATES] Found:', candidates?.length || 0);

        // FILTRAR CAMPOS SENSIBLES
        const safe = candidates.map(c => ({
            id: c.id,
            nombre: c.nombre,
            rubro: c.rubro,
            seniority: c.seniority,
            pais: c.pais,
            provincia: c.provincia,
            modalidad: c.modalidad,
            disponibilidad: c.disponibilidad,
            cv_fit_score: c.cv_fit_score || 0,
            linkedin: c.linkedin || null
        }));

        res.status(200).json(safe);

    } catch (error) {
        console.error('[API CANDIDATES] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
}
