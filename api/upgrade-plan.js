export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, MERCADOPAGO_ACCESS_TOKEN } = process.env;
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !MERCADOPAGO_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

  if (req.method === 'POST' && req.body.action === 'create_preference') {
    try {
      const { plan } = req.body;

      if (!PLANS[plan]) {
        return res.status(400).json({ error: 'Plan inválido' });
      }

      const planData = PLANS[plan];
      const externalRef = `${profile.id}-${plan}-${Date.now()}`;

      console.log('[upgrade-plan] Iniciando...');
      console.log('[upgrade-plan] Plan:', plan, 'Price:', planData.price);

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
      console.log('[upgrade-plan] MP Data:', JSON.stringify(mpData, null, 2));

      if (!mpRes.ok) {
        console.error('[upgrade-plan] MP Error:', mpData);
        return res.status(400).json({ error: 'MP error', details: mpData });
      }

      if (!mpData.id) {
        console.error('[upgrade-plan] No ID returned');
        return res.status(400).json({ error: 'No ID from MP' });
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

      console.log('[upgrade-plan] Success - Returning init_point:', mpData.init_point || mpData.sandbox_init_point);

      return res.status(200).json({
        success: true,
        preference_id: mpData.id,
        init_point: mpData.init_point,
        sandbox_init_point: mpData.sandbox_init_point
      });
    } catch (e) {
      console.error('[upgrade-plan] Exception:', e.message, e.stack);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'GET' && req.query.action === 'list_plans') {
    const plans = {
      free: { name: 'Plan Esencial ATS', price: 0, currency: 'ARS', description: '1 análisis CV/mes', analyses_per_month: 1 },
      pro: { name: 'Plan Pro Estratégico', price: 3999, currency: 'ARS', description: '5 análisis CV/mes + reportes', analyses_per_month: 5 },
      premium: { name: 'Plan Premium Pitch', price: 7999, currency: 'ARS', description: 'Análisis ilimitados', analyses_per_month: 999 }
    };
    return res.status(200).json({ plans, current_plan: profile.plan || 'free' });
  }

  return res.status(400).json({ error: 'Invalid request' });
}
