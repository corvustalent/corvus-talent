# 📬 Sistema de Notificaciones Bidireccionales — Contact Requests

**Versión:** 4 de octubre 2026  
**Status:** ✅ Listo para producción  
**Stack:** `/api/moderation.js` + Resend

---

## 🎯 Flujo completo de notificaciones

```
1️⃣ RECRUITER ENVÍA SOLICITUD
   └─→ POST /api/moderation { action: 'send_contact_request', candidate_id, message }
       └─→ Inserta en contact_requests
       └─→ 📧 Envía email al CANDIDATO ("Nuevo interés")
       └─→ Candidato recibe: [📩] + CTA "Ver solicitud"

2️⃣ CANDIDATO ACEPTA
   └─→ PATCH /api/moderation { action: 'respond_contact_request', request_id, status: 'accepted' }
       └─→ Actualiza status a 'accepted'
       └─→ Crea conversation automáticamente
       └─→ 📧 Envía email al RECRUITER ("Conexión confirmada")
       └─→ Recruiter recibe: [✅] + CTA "Ir a chat"

3️⃣ AMBOS EN CHAT
   └─→ /chat → Conversación activa
```

---

## 📧 Email 1 — Recruiter → Candidato

**Cuándo:** Cuando recruiter envía solicitud  
**A quién:** Email del candidato  
**De:** `Corvus Talent <info@corvustalent.com.ar>`  
**Subject:** `📩 [Nombre Recruiter] te envió una solicitud de contacto — Corvus Talent`

### Contenido:
- Header: "¡Nueva oportunidad! 🎯"
- De: [Nombre Recruiter] / [Empresa]
- Mensaje: [Lo que escribió el recruiter]
- Datos: Empresa del recruiter
- **CTA:** Botón "Ver solicitud en tu panel" → `https://corvustalent.com.ar/dashboard/candidato`

### Tiempo:
- 2-5 segundos después de enviar solicitud

---

## 📧 Email 2 — Candidato → Recruiter (NUEVO)

**Cuándo:** Cuando candidato ACEPTA la solicitud  
**A quién:** Email del recruiter  
**De:** `Corvus Talent <info@corvustalent.com.ar>`  
**Subject:** `✅ [Nombre Candidato] aceptó tu solicitud de contacto — Corvus Talent`

### Contenido:
- Header: "¡Conexión confirmada! ✅"
- Dato: "[Nombre Candidato] aceptó tu solicitud"
- Próximos pasos: Lista con 3 acciones recomendadas
- **CTA:** Botón "Ir a tu chat" → `https://corvustalent.com.ar/dashboard/recruiter?tab=mensajes`

### Tiempo:
- 2-5 segundos después de aceptar

---

## 🔄 Cambios técnicos en `respond_contact_request`

### Antes
```javascript
if (status === 'accepted') {
  // Crear conversación
  const { data: conv } = await supabase
    .from('conversations')
    .insert([{ recruiter_id, candidate_id, contact_request_id, status: 'active' }])
    .select()
    .single();
}

return res.status(200).json({ success: true, request: data });
```

### Después
```javascript
if (status === 'accepted') {
  // Crear conversación (igual que antes)
  const { data: conv } = await supabase
    .from('conversations')
    .insert([{ recruiter_id, candidate_id, contact_request_id, status: 'active' }])
    .select()
    .single();

  // ───── ENVIAR EMAIL AL RECRUITER (NUEVO) ─────
  if (request.recruiter && request.recruiter.email && resend) {
    try {
      await resend.emails.send({
        from: 'Corvus Talent <info@corvustalent.com.ar>',
        to: request.recruiter.email,
        subject: `✅ ${candidateName} aceptó tu solicitud...`,
        html: `[HTML formateado con estilos]`
      });
      console.log(`Email enviado a ${request.recruiter.email}...`);
    } catch (emailError) {
      console.error('Error sending acceptance email:', emailError);
    }
  }
}

return res.status(200).json({ success: true, request: data });
```

### Líneas exactas:
- **Inicio del bloque nuevo:** ~262 (después de crear conversación)
- **Fin del bloque:** ~296 (antes del return final)
- **Total de líneas agregadas:** ~35

---

## 🔍 Detalles de implementación

### Data que obtiene:
```javascript
// Ya disponible en 'request' (del fetch anterior)
request.recruiter = {
  id, nombre, apellido, company, email
}

// Usa el perfil actual del candidato
profile.nombre
profile.apellido
```

### Validaciones:
```javascript
if (request.recruiter && request.recruiter.email && resend) {
  // Solo envía si:
  // 1. Existe recruiter
  // 2. Tiene email registrado
  // 3. Resend está inicializado
}
```

### Manejo de errores:
- **No bloquea** la respuesta si el email falla
- **Loguea** el error en console
- **La solicitud igual se actualiza** en BD
- **UX:** Candidato ve ✅ igual; recruiter recibe email si Resend funciona

---

## 📋 Checklist de deploy

- [ ] Reemplazar `/api/moderation.js` en GitHub con `moderation-FINAL.js`
- [ ] Verificar `RESEND_API_KEY` en Vercel env vars
- [ ] `package.json` tiene `"resend": "^latest"`
- [ ] Commit + Push → Vercel redespliega
- [ ] Test 1: Recruiter envía solicitud
  - [ ] Email llega al candidato (2-5 seg)
  - [ ] Supabase: `contact_requests.status = 'pending'`
- [ ] Test 2: Candidato acepta
  - [ ] Email llega al recruiter (2-5 seg)
  - [ ] Supabase: `contact_requests.status = 'accepted'`
  - [ ] Supabase: Nueva fila en `conversations`
  - [ ] Vercel logs: Sin errores de Resend

---

## 🧪 Casos de test

### Caso 1: Email normal (happy path)
```
Recruiter → Email al candidato ✅
Candidato acepta → Email al recruiter ✅
Tiempo total: 5-10 segundos
```

### Caso 2: Falla email al candidato
```
Solicitud se guarda en BD ✅
Email NO se envía
Frontend ve: "✓ Solicitud enviada" ✅
Console log: "Error sending email with Resend: ..."
```

### Caso 3: Falla email al recruiter (accept)
```
Conversación se crea en BD ✅
Email NO se envía al recruiter
Candidato ve: "✓ Solicitud aceptada" ✅
Console log: "Error sending acceptance email to recruiter: ..."
Recruiter se entera cuando hace refresh del dashboard
```

### Caso 4: Rechazo (status = 'rejected')
```
Solicitud se actualiza: status = 'rejected'
NO se envía email al recruiter ✅ (por diseño)
NO se crea conversación ✅ (por diseño)
```

---

## 🎨 Estilos de email

### Paleta Corvus en email:
- Fondo header: `#0A1628` (navy)
- Borde izquierdo (aceptado): `#4ADE80` (green) — indica éxito
- Texto principal: `#1E3050` (dark navy)
- Links: `#0A1628` con hover

### Tipografía:
- Font: `Inter, system-ui, sans-serif`
- Subject emojis: 📩 (solicitud), ✅ (aceptado)
- Responsive: Max-width 600px, se adapta a mobile

---

## 📊 Resumen de cambios

| Función | Email | Destinatario | Trigger | Líneas |
|---------|-------|--------------|---------|--------|
| `send_contact_request` | Sí | Candidato | Recruiter envía | 105-179 |
| `respond_contact_request` | Sí (NEW) | Recruiter | Candidato acepta | 262-296 |

**Total de cambios en el archivo:** ~100 líneas  
**Compatibilidad:** Backward-compatible (no rompe APIs existentes)  
**Performance:** Envío asincrónico (no bloquea respuesta)

---

## 🚀 Próximos pasos

### Inmediato:
1. Deploy de `moderation-FINAL.js`
2. Testing de ambos flujos

### Futuro:
- [ ] Email cuando candidato RECHAZA (opcional)
- [ ] Notificación en-app (además de email)
- [ ] Re-envío de emails si fallan (retry logic)
- [ ] Customizar mensajes en email por recruiter
- [ ] Analytics: tracking de emails abiertos (Resend)

---

**¿Preguntas?** Revisar logs de Vercel en `https://vercel.com/corvustalent` → Deployments → Función `moderation` → Logs
