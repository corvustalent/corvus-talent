export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing env' });
  }

  // ─────────────────────────────────────────────────────────────
  // IMPORTS
  // ─────────────────────────────────────────────────────────────
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ─────────────────────────────────────────────────────────────
  // WEBHOOK: MercadoPago Notification (IPN)
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      // MercadoPago envía notificación IPN con formato:
      // POST body: { "id": "12345678", "topic": "payment" }
      
      const { id: payment_id, topic } = req.body;

      console.log(`[Webhook] Recibido: topic=${topic}, payment_id=${payment_id}`);

      // ACK INMEDIATO (MercadoPago requiere respuesta 200 rápido)
      res.status(200).json({ received: true });

      // Procesar de forma asincrónica (sin bloquear la respuesta)
      if (topic === 'payment' && payment_id) {
        processPaymentAsync(payment_id, supabase).catch(err => {
          console.error('[Webhook] Error async:', err);
        });
      }

      return;
    } catch (e) {
      console.error('[Webhook] Parse error:', e);
      return res.status(200).json({ received: true });
    }
  }

  // GET para verificar que el webhook está activo
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ─────────────────────────────────────────────────────────────
// Procesar pago de forma asincrónica
// ─────────────────────────────────────────────────────────────
async function processPaymentAsync(payment_id, supabase) {
  try {
    console.log(`[Webhook] Procesando payment_id=${payment_id}`);

    // Obtener detalles del pago desde MercadoPago
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
      headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
    });

    if (!mpRes.ok) {
      console.error(`[Webhook] MercadoPago API error: ${mpRes.status}`);
      return;
    }

    const payment = await mpRes.json();
    console.log(`[Webhook] Estado del pago: ${payment.status}, external_reference: ${payment.external_reference}`);

    // Buscar la transacción por external_reference
    const { data: transaction, error: transError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('external_reference', payment.external_reference)
      .single();

    if (transError || !transaction) {
      console.error(`[Webhook] Transacción no encontrada: ${payment.external_reference}`);
      return;
    }

    console.log(`[Webhook] Transacción encontrada: id=${transaction.id}, user_id=${transaction.user_id}`);

    // Procesar según estado del pago
    if (payment.status === 'approved') {
      console.log(`[Webhook] Pago APROBADO para usuario ${transaction.user_id}`);

      // Actualizar transacción a "approved"
      const { error: updateError } = await supabase
        .from('payment_transactions')
        .update({
          status: 'approved',
          mercadopago_payment_id: payment.id,
          payment_method: payment.payment_method?.type,
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', transaction.id);

      if (updateError) {
        console.error(`[Webhook] Error actualizando transacción:`, updateError);
        return;
      }

      // Aplicar upgrade de plan
      const { error: funcError } = await supabase.rpc('apply_plan_upgrade', {
        p_user_id: transaction.user_id,
        p_plan_type: transaction.plan_type,
        p_duration_days: 30
      });

      if (funcError) {
        console.error(`[Webhook] Error aplicando plan upgrade:`, funcError);
        return;
      }

      console.log(`✅ ÉXITO: Usuario ${transaction.user_id} → Plan ${transaction.plan_type}`);
    } else if (payment.status === 'rejected') {
      console.log(`[Webhook] Pago RECHAZADO para transacción ${transaction.id}`);

      await supabase
        .from('payment_transactions')
        .update({
          status: 'rejected',
          updated_at: new Date().toISOString()
        })
        .eq('id', transaction.id);
    } else if (payment.status === 'pending') {
      console.log(`[Webhook] Pago PENDIENTE para transacción ${transaction.id}`);
      // No hacer nada, esperar confirmación
    } else if (payment.status === 'cancelled') {
      console.log(`[Webhook] Pago CANCELADO para transacción ${transaction.id}`);

      await supabase
        .from('payment_transactions')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('id', transaction.id);
    }
  } catch (e) {
    console.error('[Webhook] Excepción:', e.message);
  }
}
