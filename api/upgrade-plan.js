export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, MERCADOPAGO_ACCESS_TOKEN } = process.env;
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !MERCADOPAGO_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  // ─────────────────────────────────────────────────────────────
  // IMPORTS
  // ─────────────────────────────────────────────────────────────
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

  // ─────────────────────────────────────────────────────────────
  // PLANES (precios en centavos para MercadoPago)
  // ─────────────────────────────────────────────────────────────
  const PLANS = {
    pro: {
      name: 'Plan Pro Estratégico',
      price: 399900, // $3,999 ARS en centavos
      currency: 'ARS',
      description: '5 análisis CV/mes + reportes detallados',
      analyses_per_month: 5
    },
    premium: {
      name: 'Plan Premium Pitch',
      price: 799900, // $7,999 ARS en centavos
      currency: 'ARS',
      description: 'Análisis ilimitados + prioridad + soporte',
      analyses_per_month: 999
    }
  };

  // ─────────────────────────────────────────────────────────────
  // POST: CREATE PREFERENCE (iniciar pago)
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.body.action === 'create_preference') {
    try {
      const { plan } = req.body;

      if (!PLANS[plan]) {
        return res.status(400).json({ error: 'Plan inválido' });
      }

      const planData = PLANS[plan];

      // Construir preferencia MercadoPago
      const preference = {
        items: [
          {
            id: plan,
            title: planData.name,
            description: planData.description,
            quantity: 1,
            unit_price: planData.price / 100 // Convertir centavos a ARS
          }
        ],
        payer: {
          email: profile.email,
          name: profile.nombre || 'Usuario'
        },
        back_urls: {
          success: `${process.env.VERCEL_URL || 'https://corvustalent.com.ar'}/dashboard/candidato?payment=success&plan=${plan}`,
          failure: `${process.env.VERCEL_URL || 'https://corvustalent.com.ar'}/dashboard/candidato?payment=failed`,
          pending: `${process.env.VERCEL_URL || 'https://corvustalent.com.ar'}/dashboard/candidato?payment=pending`
        },
        notification_url: `${process.env.VERCEL_URL || 'https://corvustalent.com.ar'}/api/webhook-mercadopago`,
        external_reference: `${profile.id}-${plan}-${Date.now()}`,
        auto_return: 'approved',
        metadata: {
          user_id: profile.id,
          user_email: profile.email,
          plan_type: plan
        }
      };

      // Llamar a API de MercadoPago
      const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(preference)
      });

      const mpData = await mpRes.json();

      if (!mpRes.ok) {
        console.error('MercadoPago error:', mpData);
        return res.status(400).json({ error: 'Error creating preference', details: mpData });
      }

      // Guardar intención de pago en Supabase
      const { data: transaction, error: transError } = await supabase
        .from('payment_transactions')
        .insert([{
          user_id: profile.id,
          plan_type: plan,
          amount: planData.price / 100,
          currency: planData.currency,
          mercadopago_preference_id: mpData.id,
          external_reference: preference.external_reference,
          status: 'pending',
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (transError) {
        console.error('Error saving transaction:', transError);
      }

      return res.status(200).json({
        success: true,
        preference_id: mpData.id,
        init_point: mpData.init_point, // URL para redirigir al usuario
        sandbox_init_point: mpData.sandbox_init_point // URL sandbox para testing
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GET: CHECK PAYMENT STATUS (verificar si pagó)
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'check_payment') {
    try {
      const { payment_id } = req.query;

      if (!payment_id) {
        return res.status(400).json({ error: 'payment_id requerido' });
      }

      // Obtener detalles del pago desde MercadoPago
      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
        headers: { 'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}` }
      });

      const payment = await mpRes.json();

      if (!mpRes.ok) {
        return res.status(400).json({ error: 'Payment not found' });
      }

      return res.status(200).json({
        status: payment.status, // approved, rejected, pending, etc.
        amount: payment.transaction_amount,
        external_reference: payment.external_reference
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // GET: LIST PLANS
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'list_plans') {
    try {
      const plans = {
        free: {
          name: 'Plan Esencial ATS',
          price: 0,
          currency: 'ARS',
          description: '1 análisis CV/mes',
          analyses_per_month: 1,
          features: ['CV ATS-friendly', 'Optimización básica']
        },
        pro: {
          name: 'Plan Pro Estratégico',
          price: 3999,
          currency: 'ARS',
          description: '5 análisis CV/mes + reportes detallados',
          analyses_per_month: 5,
          features: ['5 análisis/mes', 'Reportes PDF', 'Puntos entrevista']
        },
        premium: {
          name: 'Plan Premium Pitch',
          price: 7999,
          currency: 'ARS',
          description: 'Análisis ilimitados + prioridad + soporte',
          analyses_per_month: 999,
          features: ['Análisis ilimitados', 'Soporte prioritario', 'Mentoring personal']
        }
      };

      return res.status(200).json({ plans, current_plan: profile.plan || 'free' });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 404
  // ─────────────────────────────────────────────────────────────
  return res.status(400).json({ error: 'Invalid request' });
}
