export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY } = process.env;
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[Webhook] Missing env');
    return res.status(200).json({ error: 'Missing env' });
  }

  // ─────────────────────────────────────────────────────────────
  // IMPORTS
  // ─────────────────────────────────────────────────────────────
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // ─────────────────────────────────────────────────────────────
  // WEBHOOK: MercadoPago Notification
  // Acepta múltiples formatos:
  // 1. IPN viejo: { "topic": "payment", "id": "123" }
  // 2. Order.processed: { "action": "order.processed", "data": { "transactions": { "payments": [...] } } }
  // 3. payment.updated: { "action": "payment.updated", "data": {...} }
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    console.log('[Webhook] POST recibido');
    
    // ACK INMEDIATO (no bloquear la respuesta)
    res.status(200).json({ received: true });

    // Procesar de forma asincrónica
    processWebhookAsync(req.body, supabase, RESEND_API_KEY).catch(err => {
      console.error('[Webhook] Error async:', err);
    });

    return;
  }

  // GET para verificar que el webhook está activo
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ─────────────────────────────────────────────────────────────
// Procesar webhook de forma asincrónica
// ─────────────────────────────────────────────────────────────
async function processWebhookAsync(body, supabase, resendKey) {
  try {
    if (!body) {
      console.log('[Webhook] Body vacío');
      return;
    }

    // 🔥 DEBUG: Registrar TODO lo que recibe
    console.log('═════════════════════════════════════════════');
    console.log('[Webhook] NOTIFICACIÓN RECIBIDA');
    console.log('═════════════════════════════════════════════');
    console.log('[Webhook] Body completo:', JSON.stringify(body, null, 2));
    console.log('═════════════════════════════════════════════');

    let payment_id = null;
    let action = null;

    // ───────────────────────────────────────────────────────────
    // Formato 1: Order.processed (nuevo)
    // ───────────────────────────────────────────────────────────
    if (body.action === 'order.processed' && body.data) {
      action = 'order.processed';
      
      // Extraer payment_id del primer pago en transactions
      if (body.data.transactions && 
          body.data.transactions.payments && 
          body.data.transactions.payments.length > 0) {
        payment_id = body.data.transactions.payments[0].id;
        
        console.log('[Webhook] Formato: order.processed');
        console.log('[Webhook] payment_id:', payment_id);
      }
    }

    // ───────────────────────────────────────────────────────────
    // Formato 2: payment.updated
    // ───────────────────────────────────────────────────────────
    else if (body.action === 'payment.updated' && body.data?.id) {
      action = 'payment.updated';
      payment_id = body.data.id;
      
      console.log('[Webhook] Formato: payment.updated');
      console.log('[Webhook] payment_id:', payment_id);
    }

    // ───────────────────────────────────────────────────────────
    // Formato 3: IPN viejo
    // ───────────────────────────────────────────────────────────
    else if (body.topic === 'payment' && body.id) {
      action = 'payment';
      payment_id = body.id;
      
      console.log('[Webhook] Formato: IPN payment');
      console.log('[Webhook] payment_id:', payment_id);
    }

    // Si no tenemos payment_id, no procesamos
    if (!payment_id) {
      console.log('[Webhook] ⚠️ No se encontró payment_id en el body');
      console.log('[Webhook] Body keys:', Object.keys(body));
      return;
    }

    // ───────────────────────────────────────────────────────────
    // Obtener detalles del pago desde MercadoPago
    // ───────────────────────────────────────────────────────────
    console.log('[Webhook] Obteniendo detalles de MercadoPago para payment_id:', payment_id);

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
      headers: { 'Authorization': `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` }
    });

    if (!mpRes.ok) {
      console.error(`[Webhook] MercadoPago API error: ${mpRes.status}`);
      return;
    }

    const payment = await mpRes.json();
    
    console.log('═════════════════════════════════════════════');
    console.log('[Webhook] Detalles del pago desde MP:');
    console.log('  - Status:', payment.status);
    console.log('  - external_reference:', payment.external_reference);
    console.log('  - id:', payment.id);
    console.log('═════════════════════════════════════════════');

    // Si no tiene external_reference, no podemos emparejar con nuestra transacción
    if (!payment.external_reference) {
      console.log('[Webhook] ⚠️ Pago sin external_reference');
      return;
    }

    // ───────────────────────────────────────────────────────────
    // Buscar la transacción por external_reference
    // ───────────────────────────────────────────────────────────
    console.log('[Webhook] Buscando transacción con external_reference:', payment.external_reference);
    
    const { data: transaction, error: transError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('external_reference', payment.external_reference)
      .single();

    if (transError || !transaction) {
      console.error(`[Webhook] ❌ Transacción no encontrada para: ${payment.external_reference}`);
      console.error('[Webhook] Error:', transError);
      return;
    }

    console.log(`[Webhook] ✅ Transacción encontrada`);
    console.log(`  - id: ${transaction.id}`);
    console.log(`  - user_id: ${transaction.user_id}`);
    console.log(`  - plan: ${transaction.plan_type}`);

    // ───────────────────────────────────────────────────────────
    // Procesar según estado del pago
    // ───────────────────────────────────────────────────────────
    if (payment.status === 'approved') {
      console.log(`[Webhook] ✅ Pago APROBADO para usuario ${transaction.user_id}`);

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

      console.log('[Webhook] Transacción actualizada a "approved"');

      // Aplicar upgrade de plan
      console.log('[Webhook] Llamando apply_plan_upgrade con:');
      console.log(`  - p_user_id: ${transaction.user_id}`);
      console.log(`  - p_plan_type: ${transaction.plan_type}`);
      console.log(`  - p_duration_days: 30`);

      const { error: funcError } = await supabase.rpc('apply_plan_upgrade', {
        p_user_id: transaction.user_id,
        p_plan_type: transaction.plan_type,
        p_duration_days: 30
      });

      if (funcError) {
        console.error(`[Webhook] ❌ Error aplicando plan upgrade:`, funcError);
        return;
      }

      console.log(`[Webhook] ✅ Plan upgrade completado`);

      // ───────────────────────────────────────────────────────────
      // ENVIAR EMAIL DE CONFIRMACIÓN
      // ───────────────────────────────────────────────────────────
      if (resendKey) {
        console.log('[Webhook] Preparando email de confirmación...');

        // Obtener datos del usuario
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, nombre, apellido')
          .eq('id', transaction.user_id)
          .single();

        if (!profile) {
          console.error('[Webhook] ❌ No se encontró perfil del usuario');
          return;
        }

        // Mapear nombre del plan
        const planNames = {
          pro: 'Plan Pro Estratégico',
          premium: 'Plan Premium Pitch'
        };
        const planName = planNames[transaction.plan_type] || transaction.plan_type;

        // Enviar email con Resend
        console.log(`[Webhook] Enviando email a: ${profile.email}`);

        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Corvus Talent <info@corvustalent.com.ar>',
            to: profile.email,
            subject: `✅ Pago confirmado — ${planName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #0A1628;">¡Hola ${profile.nombre}! 🎉</h2>
                <p>Confirmamos que tu pago fue aprobado correctamente.</p>
                
                <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <h3 style="color: #8FA8C8; margin-top: 0;">Resumen del pago</h3>
                  <p><strong>Plan:</strong> ${planName}</p>
                  <p><strong>Monto:</strong> $${transaction.amount.toLocaleString('es-AR')} ARS</p>
                  <p><strong>Fecha:</strong> ${new Date(transaction.paid_at).toLocaleDateString('es-AR')}</p>
                  <p><strong>Referencia:</strong> ${transaction.external_reference}</p>
                </div>

                <p>Ya podés acceder a todas las funcionalidades de tu nuevo plan en:</p>
                <a href="https://corvustalent.com.ar/dashboard/candidato" style="display: inline-block; background: #8FA8C8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">
                  Ir al Dashboard
                </a>

                <p style="color: #656D78; font-size: 14px; margin-top: 30px;">
                  Si tenés dudas, escribinos a <strong>corvus.talent@gmail.com</strong>
                </p>

                <p style="color: #656D78; font-size: 12px; border-top: 1px solid #ddd; padding-top: 20px;">
                  Corvus Talent — Talento certero
                </p>
              </div>
            `
          })
        });

        if (!emailRes.ok) {
          const emailError = await emailRes.json();
          console.error('[Webhook] ❌ Error enviando email:', emailError);
        } else {
          const emailData = await emailRes.json();
          console.log(`[Webhook] ✅ Email enviado - ID: ${emailData.id}`);
        }
      } else {
        console.warn('[Webhook] ⚠️ RESEND_API_KEY no configurada, no se envía email');
      }

      console.log(`[Webhook] ✅ ÉXITO TOTAL: Usuario ${transaction.user_id} → Plan ${transaction.plan_type} + Email enviado`);
    } else if (payment.status === 'rejected') {
      console.log(`[Webhook] ❌ Pago RECHAZADO para transacción ${transaction.id}`);

      await supabase
        .from('payment_transactions')
        .update({
          status: 'rejected',
          updated_at: new Date().toISOString()
        })
        .eq('id', transaction.id);
    } else if (payment.status === 'pending') {
      console.log(`[Webhook] ⏳ Pago PENDIENTE para transacción ${transaction.id}`);
    } else if (payment.status === 'cancelled') {
      console.log(`[Webhook] ⛔ Pago CANCELADO para transacción ${transaction.id}`);

      await supabase
        .from('payment_transactions')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString()
        })
        .eq('id', transaction.id);
    }
  } catch (e) {
    console.error('[Webhook] ❌ Excepción:', e.message);
    console.error('[Webhook] Stack:', e.stack);
  }
}
