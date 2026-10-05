// /api/payments.js — MercadoPago Integration (CONSOLIDADO upgrade-plan + webhook)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.substring(7).trim();
  if (req.body && req.body.token) return req.body.token;
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/corvus_token=([^;]+)/);
  return match ? match[1] : null;
}

function getEmailFromToken(token) {
  if (!token) return null;
  token = token.trim();
  if (token.includes('|')) return token.split('|')[0].trim();
  if (token.includes('@')) return token;
  return null;
}

async function createPayment(email, plan, amountARS) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .single();

  if (!profile) throw new Error('Profile not found');

  const items = [
    {
      id: plan,
      title: `Plan ${plan} - Corvus Talent`,
      currency_id: 'ARS',
      quantity: 1,
      unit_price: parseFloat(amountARS),
    }
  ];

  const preference = {
    items,
    payer: { email },
    back_urls: {
      success: `${process.env.VERCEL_URL || 'https://corvustalent.com.ar'}/dashboard/candidato?payment=success`,
      failure: `${process.env.VERCEL_URL || 'https://corvustalent.com.ar'}/dashboard/candidato?payment=failure`,
      pending: `${process.env.VERCEL_URL || 'https://corvustalent.com.ar'}/dashboard/candidato?payment=pending`,
    },
    notification_url: `${process.env.VERCEL_URL || 'https://corvustalent.com.ar'}/api/payments?webhook=true`,
    auto_return: 'all',
  };

  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(preference),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[MP] Preference creation error:', err);
    throw new Error('Error creating payment preference');
  }

  const data = await response.json();
  console.log('[MP] Preference created:', data.id);

  // Record in DB
  await supabase.from('payment_transactions').insert({
    user_id: profile.id,
    plan,
    amount_ars: amountARS,
    mercado_id: data.id,
    status: 'pending',
    created_at: new Date().toISOString(),
  });

  return { init_point: data.init_point, preference_id: data.id };
}

async function handleWebhook(req) {
  const paymentId = req.query.data?.id;
  if (!paymentId) {
    console.log('[MP WEBHOOK] No payment ID in query');
    return null;
  }

  console.log('[MP WEBHOOK] Processing payment:', paymentId);

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}` },
  });

  if (!response.ok) throw new Error('Error fetching payment');

  const payment = await response.json();
  console.log('[MP WEBHOOK] Payment status:', payment.status);

  if (payment.status === 'approved') {
    const preferenceId = payment.preference_id;
    
    // Find transaction by mercado_id
    const { data: tx } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('mercado_id', preferenceId)
      .single();

    if (tx) {
      await supabase
        .from('payment_transactions')
        .update({ status: 'approved' })
        .eq('id', tx.id);

      // Update user profile with plan
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', tx.user_id)
        .single();

      if (profile) {
        await supabase
          .from('profiles')
          .update({ plan: tx.plan, plan_expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })
          .eq('id', tx.user_id);

        console.log('[MP WEBHOOK] ✅ Plan updated for:', profile.email, '→', tx.plan);
      }
    }
  }

  return { status: payment.status };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ════════════════════════════════════════════════════
    // WEBHOOK (MercadoPago notification)
    // ════════════════════════════════════════════════════
    if (req.query.webhook === 'true' || req.query.type === 'payment') {
      const result = await handleWebhook(req);
      return res.status(200).json(result || { status: 'processed' });
    }

    // ════════════════════════════════════════════════════
    // CREATE PAYMENT (POST, requires auth)
    // ════════════════════════════════════════════════════
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const token = extractToken(req);
    const email = getEmailFromToken(token);
    if (!email) return res.status(401).json({ error: 'Invalid token' });

    const { plan } = req.body;
    if (!plan) return res.status(400).json({ error: 'Plan requerido' });

    const planPrices = {
      'Esencial ATS': 35000,
      'Pro Estratégico': 55000,
      'Premium Pitch': 85000,
    };

    const amount = planPrices[plan];
    if (!amount) return res.status(400).json({ error: 'Plan inválido' });

    console.log('[PAYMENTS] Creating payment for:', email, '| Plan:', plan);

    const paymentLink = await createPayment(email.toLowerCase(), plan, amount.toString());
    return res.status(200).json(paymentLink);

  } catch (error) {
    console.error('[PAYMENTS] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
