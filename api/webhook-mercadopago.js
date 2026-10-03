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
  // WEBHOOK: MercadoPago Notification
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { action, data } = req.body;

      // MercadoPago envía notificación cuando hay un evento de pago
      // action = "payment.created" | "payment.updated"
      // data.id = payment_id

      if (action === 'payment.updated' || action === 'payment.created') {
        const payment_id = data.id;

        if (!payment_id) {
          return res.status(400).json({ error: 'No payment_id' });
        }

        // Obtener detalles del pago desde MercadoPago
        const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
          headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
        });

        const payment = await mpRes.json();

        if (!mpRes.ok) {
          console.error('MercadoPago API error:', payment);
          return res.status(200).json({ received: true }); // ACK anyway (no reintentar)
        }

        // Buscar la transacción por external_reference
        const { data: transaction, error: transError } = await supabase
          .from('payment_transactions')
          .select('*')
          .eq('external_reference', payment.external_reference)
          .single();

        if (transError || !transaction) {
          console.error('Transaction not found:', payment.external_reference);
          return res.status(200).json({ received: true });
        }

        // Procesar según estado del pago
        let transaction_status = 'pending';

        if (payment.status === 'approved') {
          transaction_status = 'approved';

          // ✅ PAGO APROBADO: Actualizar plan del usuario
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
            console.error('Error updating transaction:', updateError);
            return res.status(200).json({ received: true });
          }

          // Llamar función para aplicar upgrade de plan
          const { error: funcError } = await supabase.rpc('apply_plan_upgrade', {
            p_user_id: transaction.user_id,
            p_plan_type: transaction.plan_type,
            p_duration_days: 30
          });

          if (funcError) {
            console.error('Error applying plan upgrade:', funcError);
            // No fallar, pero logear
          }

          console.log(`✓ Pago aprobado: usuario ${transaction.user_id} → plan ${transaction.plan_type}`);
        } else if (payment.status === 'rejected') {
          transaction_status = 'rejected';

          await supabase
            .from('payment_transactions')
            .update({
              status: 'rejected',
              updated_at: new Date().toISOString()
            })
            .eq('id', transaction.id);

          console.log(`✗ Pago rechazado: ${payment.external_reference}`);
        } else if (payment.status === 'pending') {
          transaction_status = 'pending';
          // No hacer nada, esperar confirmación
        } else if (payment.status === 'cancelled') {
          transaction_status = 'cancelled';

          await supabase
            .from('payment_transactions')
            .update({
              status: 'cancelled',
              updated_at: new Date().toISOString()
            })
            .eq('id', transaction.id);
        }

        // ACK: MercadoPago requiere respuesta 200 para no reintentar
        return res.status(200).json({ received: true, status: transaction_status });
      }

      // Para otros tipos de notificaciones, ACK
      return res.status(200).json({ received: true });
    } catch (e) {
      console.error('Webhook error:', e);
      // Siempre devolver 200 para que MercadoPago no reintente
      return res.status(200).json({ received: true, error: e.message });
    }
  }

  // GET para verificar que el webhook está activo
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
