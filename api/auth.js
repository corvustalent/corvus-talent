# Consolidación 12 → 8 Funciones Serverless — Instrucciones de Deploy

**Estado:** ✅ Completado  
**Fecha:** 05/10/2026  
**Funciones eliminadas:** `verify.js`, `moderation.js`, `fit.js`, `upgrade-plan.js`, `mercado/index.js`

---

## 📋 Resumen de cambios

### Consolidaciones ejecutadas:

| Consolidación | Archivos origen | Archivo final | Líneas | Cambios principales |
|---|---|---|---|---|
| Auth | `auth.js` + `verify.js` | `api/auth.js` | 174 | action: 'login' / 'register' / 'verify' |
| Perfil | `profile.js` + `moderation.js` | `api/profile.js` | 242 | Contact CRUD + email notifications + PATCH aceptar/rechazar |
| Corvus | `corvus.js` + `fit.js` | `api/corvus.js` | 164 | action: 'analyze_fit' / 'generate_jd' |
| Payments | `upgrade-plan.js` + `mercado/index.js` | `api/payments.js` | 190 | query.webhook=true para notificación / POST para crear pago |

**Resultado:** 12 funciones → 8 funciones + 4 slots libres ✅

---

## 🚀 Instrucciones de Deploy

### PASO 1: Hacer backup (seguridad)
```bash
git stash
# O: git checkout -b consolidacion-backup
```

### PASO 2: Reemplazar archivos en `/api/`

#### A. Reemplazar archivos consolidados:
1. **`/api/auth.js`** — Copiar contenido de `auth.js` generado
   - Elimina `verify.js` (ya no lo necesitás)
   
2. **`/api/profile.js`** — Copiar contenido de `profile.js` generado
   - Elimina `moderation.js` (ya no lo necesitás)
   
3. **`/api/corvus.js`** — Copiar contenido de `corvus.js` generado
   - Elimina `fit.js` (ya no lo necesitás)
   
4. **`/api/payments.js`** — Copiar contenido de `payments.js` generado
   - Elimina `upgrade-plan.js` (ya no lo necesitás)
   - Elimina la carpeta `mercado/` completa

#### B. Mantener sin cambios:
- `/api/candidates.js` ✅
- `/api/chat.js` ✅
- `/api/feedback.js` ✅
- `/api/metrics.js` ✅

### PASO 3: Actualizar package.json (si es necesario)
Verificar que tenga estas dependencias:
```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.x",
    "@anthropic-ai/sdk": "^0.x",
    "resend": "^0.x"
  }
}
```

---

## 🔧 Cambios en Endpoints

### Login / Register / Verify
**Cambio:** Todo en `/api/auth` con `action` parameter

```javascript
// Antes: POST /api/auth, POST /api/verify
// Ahora: POST /api/auth + action
POST /api/auth {
  "action": "login",
  "email": "...",
  "password": "..."
}

POST /api/auth {
  "action": "register",
  "email": "...",
  "password": "...",
  "nombre": "...",
  "role": "..."
}

POST /api/auth {
  "action": "verify",
  "token": "...",
  "email": "..."
}
```

### Perfil / Contacto / Email
**Cambio:** `/api/profile` consolida todo

```javascript
// GET — Perfil
GET /api/profile (auth requerida)

// GET — Solicitudes ENVIADAS (recruiter)
GET /api/profile?type=contact_requests

// GET — Solicitudes RECIBIDAS (candidato)
GET /api/profile?type=received_requests

// POST — Crear solicitud de contacto
POST /api/profile {
  "action": "contact_create",
  "candidate_email": "...",
  "message": "...",
  "company": "..."
}

// POST — Actualizar perfil
POST /api/profile {
  "nombre": "...",
  "rubro": "...",
  "visible": true,
  ...
}

// PATCH — Aceptar/rechazar solicitud
PATCH /api/profile {
  "request_id": "...",
  "status": "accepted" | "rejected"
}
```

### Análisis CV + JD
**Cambio:** `/api/corvus` con `action` parameter

```javascript
// Análisis CV vs JD (antiguo /api/fit)
POST /api/corvus {
  "action": "analyze_fit",
  "cv": "...",
  "job_title": "...",
  "job_description": "..."
}

// Generar JD (antiguo /api/corvus)
POST /api/corvus {
  "action": "generate_jd",
  "title": "...",
  "industry": "...",
  "seniority": "...",
  ...
}
```

### Pagos
**Cambio:** `/api/payments` consolida todo

```javascript
// Crear pago (antiguo /api/upgrade-plan)
POST /api/payments {
  "plan": "Esencial ATS" | "Pro Estratégico" | "Premium Pitch"
}
// Retorna: { init_point, preference_id }

// Webhook MercadoPago (antiguo /api/mercado)
GET /api/payments?webhook=true&data={"id": "123"}
// MercadoPago enviará notificación automáticamente
```

---

## ✅ Checklist de Deploy

- [ ] Copiar `auth.js` a `/api/auth.js`
- [ ] Eliminar `/api/verify.js`
- [ ] Copiar `profile.js` a `/api/profile.js`
- [ ] Eliminar `/api/moderation.js`
- [ ] Copiar `corvus.js` a `/api/corvus.js`
- [ ] Eliminar `/api/fit.js`
- [ ] Copiar `payments.js` a `/api/payments.js`
- [ ] Eliminar `/api/upgrade-plan.js`
- [ ] Eliminar carpeta `/api/mercado/`
- [ ] Verificar `package.json` dependencias
- [ ] `git add . && git commit -m "Consolidar 12→8 funciones"` 
- [ ] `git push` → Vercel redespliega automáticamente
- [ ] Verificar en Vercel que quedan 8 funciones (sin las eliminadas)
- [ ] Testear auth, perfil, contacto, análisis, pagos

---

## 🧪 Testing

### 1. Login
```javascript
fetch('/api/auth', {
  method: 'POST',
  body: JSON.stringify({
    action: 'login',
    email: 'alejandro.leitner@gmail.com',
    password: 'password123'
  })
})
```

### 2. Perfil
```javascript
fetch('/api/profile', {
  headers: { 'Authorization': 'Bearer alejandro.leitner@gmail.com' }
})
```

### 3. Crear solicitud de contacto
```javascript
fetch('/api/profile', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer recruiter@example.com' },
  body: JSON.stringify({
    action: 'contact_create',
    candidate_email: 'alejandro.leitner@gmail.com',
    message: 'Tenemos un rol para ti',
    company: 'Tech Co'
  })
})
```

### 4. Análisis CV
```javascript
fetch('/api/corvus', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer alejandro.leitner@gmail.com' },
  body: JSON.stringify({
    action: 'analyze_fit',
    cv: 'Experiencia: 6 años en IT...',
    job_title: 'Senior Backend Dev',
    job_description: 'Buscamos...'
  })
})
```

### 5. Pago
```javascript
fetch('/api/payments', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer alejandro.leitner@gmail.com' },
  body: JSON.stringify({
    plan: 'Premium Pitch'
  })
})
```

---

## 🚨 Rollback (en caso de error)

```bash
git revert HEAD
# O:
git checkout main
git reset --hard origin/main
```

---

## 📊 Resultado Final

**Antes:** 
```
1. auth.js
2. verify.js
3. candidates.js
4. chat.js
5. corvus.js
6. feedback.js
7. fit.js
8. mercado/index.js
9. metrics.js
10. moderation.js
11. profile.js
12. upgrade-plan.js
```

**Después (8/12):**
```
1. auth.js (login + register + verify)
2. candidates.js
3. chat.js
4. corvus.js (analyze_fit + generate_jd)
5. feedback.js
6. metrics.js
7. payments.js (create payment + webhook)
8. profile.js (get + post + patch + contact CRUD + emails)

🟢 4 SLOTS LIBRES para nuevas funciones
```

---

**¡Listo para deploy! 🚀**
