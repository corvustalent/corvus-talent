module.exports = async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, MERCADOPAGO_ACCESS_TOKEN } = process.env;
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !MERCADOPAGO_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ─────────────────────────────────────────────────────────────
  // PARSEAR BODY
  // ─────────────────────────────────────────────────────────────
  let body = {};
  if (req.method === 'POST') {
    try {
      // Si req.body es string, parsearlo
      if (typeof req.body === 'string') {
        body = JSON.parse(req.body);
      } else if (typeof req.body === 'object') {
        body = req.body;
      }
    } catch (e) {
      console.error('[upgrade-plan] Error parsing body:', e);
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PARSEAR QUERY STRING (para Vercel)
  // ─────────────────────────────────────────────────────────────
  let query = {};
  if (req.url && req.url.includes('?')) {
    const queryString = req.url.split('?')[1];
    queryString.split('&').forEach(param => {
      const [key, value] = param.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
  }

  // ─────────────────────────────────────────────────────────────
  // AUTH
  // ─────────────────────────────────────────────────────────────
  const auth = req.headers.authorization?.split('Bearer ')[1];
  if (!auth) return res.status(401).json({ error: 'No token' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(auth);
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, nombre, apellido, plan')
    .eq('email', user.email)
    .single();

  if (!profile) return res.status(401).json({ error: 'Profile not found' });

  const PLANS = {
    pro: {
      name: 'Plan Pro Estratégico',
      price: 3999,
      currency: 'ARS',
      description: '5 análisis CV/mes + reportes detallados',
      analyses_per_month: 5
    },
    premium: {
      name: 'Plan Premium Pitch',
      price: 7999,
      currency: 'ARS',
      description: 'Análisis ilimitados + prioridad + soporte',
      analyses_per_month: 999
    }
  };

  // ─────────────────────────────────────────────────────────────
  // POST: CREATE PREFERENCE
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && body.action === 'create_preference') {
    try {
      const { plan } = body;

      console.log('[upgrade-plan] Action: create_preference, Plan:', plan);

      if (!PLANS[plan]) {
        return res.status(400).json({ error: 'Plan inválido' });
      }

      const planData = PLANS[plan];
      const externalRef = `${profile.id}-${plan}-${Date.now()}`;

      const preference = {
        items: [
          {
            id: plan,
            title: planData.name,
            description: planData.description,
            quantity: 1,
            unit_price: planData.price
          }
        ],
        payer: {
          email: profile.email
        },
        back_urls: {
          success: 'https://corvustalent.com.ar/dashboard/candidato?payment=success',
          failure: 'https://corvustalent.com.ar/dashboard/candidato?payment=failed',
          pending: 'https://corvustalent.com.ar/dashboard/candidato?payment=pending'
        },
        notification_url: 'https://corvustalent.com.ar/api/mercado',
        external_reference: externalRef,
        auto_return: 'approved'
      };

      console.log('[upgrade-plan] Calling MercadoPago API...');

      const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(preference)
      });

      const mpData = await mpRes.json();

      console.log('[upgrade-plan] MP Status:', mpRes.status);
      console.log('[upgrade-plan] MP Response:', JSON.stringify(mpData).substring(0, 800));

      if (!mpRes.ok) {
        console.error('[upgrade-plan] MP Error:', mpData);
        return res.status(400).json({ error: 'MP error', details: mpData });
      }

      if (!mpData.id) {
        console.error('[upgrade-plan] No preference ID');
        return res.status(400).json({ error: 'No preference ID' });
      }

      const { data: transaction, error: transError } = await supabase
        .from('payment_transactions')
        .insert([{
          user_id: profile.id,
          plan_type: plan,
          amount: planData.price,
          currency: planData.currency,
          mercadopago_preference_id: mpData.id,
          external_reference: externalRef,
          status: 'pending',
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (transError) {
        console.error('[upgrade-plan] DB Error:', transError);
        return res.status(400).json({ error: 'DB error' });
      }

      console.log('[upgrade-plan] Success - init_point:', mpData.init_point || mpData.sandbox_init_point);

      return res.status(200).json({
        success: true,
        preference_id: mpData.id,
        init_point: mpData.init_point,
        sandbox_init_point: mpData.sandbox_init_point
      });
    } catch (e) {
      console.error('[upgrade-plan] Exception:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GET: LIST PLANS
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && query.action === 'list_plans') {
    const plans = {
      free: { name: 'Plan Esencial ATS', price: 0, currency: 'ARS', description: '1 análisis CV/mes', analyses_per_month: 1 },
      pro: { name: 'Plan Pro Estratégico', price: 3999, currency: 'ARS', description: '5 análisis CV/mes', analyses_per_month: 5 },
      premium: { name: 'Plan Premium Pitch', price: 7999, currency: 'ARS', description: 'Análisis ilimitados', analyses_per_month: 999 }
    };
    return res.status(200).json({ plans, current_plan: profile.plan || 'free' });
  }

  return res.status(400).json({ error: 'Invalid request' });
};
