# Corvus Talent — Estado del Proyecto

> README para sesiones futuras de Claude. Última actualización: 30/09/2026.

---

## Quién es Alejandro

Senior IT Recruiter en Accenture Argentina. Fundador de Corvus Talent desde 2019. Vive en Granadero Baigorria, Santa Fe. Cursa Licenciatura en Filosofía en UNR como diferenciador a largo plazo.

---

## Qué es Corvus Talent

Consultoría de RRHH B2C. Foco: CV, LinkedIn, entrevistas, cover letter. B2B pausado hasta salir de Accenture.

- **Slogan:** "Talento certero."
- **Handle IG:** @corvustalent
- **Paleta:** Navy #0A1628 · Slate #8FA8C8 · Blanco
- **Packs B2C:** Esencial ATS $35.000 ARS · Pro Estratégico $55.000 · Premium Pitch $85.000

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Hosting | Vercel (plan Hobby — límite 12 funciones serverless) |
| Base de datos + Auth | Supabase (proyecto corvus-talent, región São Paulo) |
| Email transaccional | Resend (dominio corvustalent.com.ar verificado via Cloudflare) |
| DNS | Cloudflare (nameservers desde NIC Argentina) |
| IA | Anthropic API (claude-sonnet-4-6) via funciones serverless |
| Frontend | Vanilla JS + HTML/CSS (sin frameworks) |
| Código | GitHub repo: corvustalent/corvus-talent |

### Variables de entorno en Vercel
- `ANTHROPIC_API_KEY`
- `SUPABASE_URL` → https://fciquzvndvbbqecboumg.supabase.co
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `RESEND_API_KEY`

---

## Estructura del repo

```
corvus-talent/
├── index.html                  ← Landing principal
├── auth-check.js               ← Bloquea herramientas sin sesión
├── auth-nav.js                 ← Muestra "Mi perfil" o "Ingresar" en nav
├── package.json                ← type: module, dep: @supabase/supabase-js
├── CNAME / sitemap.xml
├── auth/index.html             ← Login/registro
├── forgot-password/index.html  ← Recupero de contraseña
├── reset-password/index.html   ← Nueva contraseña
├── corvit/index.html           ← App preguntas
├── corvus-fit/index.html       ← Análisis CV vs JD
├── corvus-craft/index.html     ← Generador de JD
├── chat/index.html             ← Hub de mensajes
├── dashboard/
│   ├── candidato/index.html
│   └── recruiter/index.html
├── metrics/index.html          ← Solo corvus.talent@gmail.com
└── api/
    ├── auth.js                 ← Registro, login, create_profile
    ├── verify.js               ← Confirma email via token
    ├── reset-password.js       ← Recupero de contraseña via Resend
    ├── profile.js              ← GET/POST perfil candidato
    ├── candidates.js           ← Lista candidatos visibles (recruiter)
    ├── contact.js              ← Solicitudes de contacto
    ├── chat.js                 ← Chat entre recruiter y candidato
    ├── feedback.js             ← Feedback IA por respuesta (Corvit)
    ├── analyze-cv.js           ← Análisis CV (deprecated, usar /corvus-fit)
    ├── fit.js                  ← Análisis compatibilidad CV+JD
    ├── generate.js             ← Generación JD (Corvus Craft) — requiere token
    └── metrics.js              ← Métricas del ecosistema
```

> **IMPORTANTE:** Vercel Hobby permite exactamente 12 funciones serverless. El repo tiene exactamente 12. No agregar más sin consolidar primero.

---

## Ecosistema Corvus

Todo vive en `corvustalent.com.ar`. Todas las herramientas requieren login.

### 🏆 Corvit (`/corvit`)
- Juego de preguntas múltiple choice con feedback IA
- 14 rubros, candidatos y entrevistadores
- Límite: 5 preguntas/día (localStorage)
- Backend: `/api/feedback.js` — prompts hardcodeados

### 🧩 Corvus Fit (`/corvus-fit`)
- Análisis CV (PDF) vs Job Description en 3 pasos
- Score 0-100, matches, gaps, mejoras, puntos para entrevista
- Guarda resultados en Supabase tabla `fit_analyses`
- Límite: 2 análisis/día (localStorage)
- Backend: `/api/fit.js`

### ✦ Corvus Craft (`/corvus-craft`)
- Generador de JD con 8 parámetros, español/inglés, 5 tonos
- Límite: 3 generaciones/día (localStorage)
- Backend: `/api/generate.js` — requiere token JWT válido

### 💬 Chat (`/chat`)
- Mensajería entre recruiter y candidato
- Se crea automáticamente cuando candidato acepta solicitud de contacto
- Polling cada 3 segundos para mensajes nuevos
- Backend: `/api/chat.js`

---

## Sistema de Auth

- **Registro:** nuestro propio sistema. Supabase crea el usuario con `email_confirm: false`. Nuestro backend genera token y llama a Resend directamente.
- **Verificación de email:** desactivada en Supabase. La maneja `/api/verify.js`.
- **Login:** con "Recordarme" (localStorage) o sin (sessionStorage). Auto-logout a los 30 min de inactividad.
- **Recupero de contraseña:** link via Resend, vence en 1 hora. Manejado por `/api/reset-password.js`.
- **Contraseña:** mínimo 8 chars, 1 mayúscula, 1 número.
- **Tokens de verificación:** tabla `email_verification_tokens` en Supabase.

> **ADVERTENCIA:** El SMTP nativo de Supabase nunca funcionó. Siempre usar Resend directamente via API.

---

## Supabase — Tablas

### `profiles`
id, email, role (candidato/recruiter), company, visible, nombre, apellido, rubro, seniority, ubicacion, email_contacto, telefono, linkedin, genero, mostrar_email, mostrar_telefono, mostrar_linkedin, mostrar_genero, tipo_puesto, modalidad, seniority_deseado, disponibilidad, rubros_interes (JSONB), salario_ars, salario_usd, notas

### `fit_analyses`
id, user_id, score, job_title, matches, gaps, mejoras, entrevista, created_at

### `contact_requests`
id, recruiter_id, candidate_id, message, company, status (pending/accepted/rejected), created_at

### `email_verification_tokens`
id, user_id, token, email, expires_at, used_at, created_at

### `conversations`
id, recruiter_id, candidate_id, contact_request_id, status, unread_count_recruiter, unread_count_candidate, created_at, updated_at

### `messages`
id, conversation_id, sender_id, content, read_by_recipient, created_at

### Vistas
- `ecosystem_metrics` — métricas globales
- `top_rubros` — rubros más populares
- `registros_por_dia` — registros últimos 30 días

### RLS
- Habilitado en todas las tablas
- `conversations` requiere política: `"Allow insert conversations" ON conversations FOR INSERT WITH CHECK (true)`

---

## Dashboards

### Candidato (`/dashboard/candidato`)
- Bienvenida con nombre
- Accesos rápidos a Corvit y Corvus Fit
- Toggle visibilidad para recruiters
- Pestañas: Mi perfil / Qué busco / Mis análisis / Solicitudes / Mensajes
- Selector de ubicación en cascada: País → Provincia → Ciudad (Argentina 24 provincias, Brasil 15 estados)
- Onboarding banner con 3 pasos: completar perfil, primer análisis, activar visibilidad

### Recruiter (`/dashboard/recruiter`)
- Stats: candidatos disponibles, score +70, disponibilidad inmediata
- Filtros: rubro, seniority, modalidad, disponibilidad, score mínimo
- Lista candidatos con scores de Corvus Fit
- Botón "Enviar solicitud" (modal con mensaje)
- Muestra "✓ Solicitud enviada" si ya contactó al candidato
- Botón 💬 Mensajes en nav con badge de no leídos

### Métricas (`/metrics`)
- Solo accesible con `corvus.talent@gmail.com`
- Total candidatos, recruiters, candidatos visibles
- Análisis Corvus Fit totales y última semana
- Score promedio, registros por semana
- Top rubros, solicitudes de contacto

---

## Cuentas de prueba en Supabase
- `alejandro.leitner@gmail.com` — candidato
- `corvus.talent@gmail.com` — recruiter, empresa "Corvus Talent"

---

## Contenido IG planificado

| Fecha | Post | Estado |
|---|---|---|
| Mar 30/09 | Lanzamiento Corvus Fit | ✅ Publicado |
| Jue 02/10 | Cover Letter | ✅ Generado |
| Sáb | Simone de Beauvoir | ✅ Generado |
| Mar siguiente | Lanzamiento Corvit | ✅ Generado |

**Reglas IG:** máximo 5 hashtags, publicar mar/jue 12-13hs o 19-21hs (Argentina)

---

## Pendientes

- [ ] Nombre del recruiter/candidato en el chat muestra "Usuario" — falta enriquecer con datos de perfiles
- [ ] Favicon 404 — agregar favicon.ico a la raíz del repo
- [ ] Email de notificación cuando llega solicitud de contacto al candidato
- [ ] Sistema de sugerencias en Corvit
- [ ] Historial de JDs en Corvus Craft (localStorage)
- [ ] Rol admin en Supabase cuando haya equipo (reemplazar email hardcodeado en metrics)
- [ ] Registrar marcas Corvus Talent, Corvit, Corvus Craft en INPI (Clase 35 y 42) — octubre
- [ ] Monotributo cuando llegue el primer cliente pago
- [ ] Cargar créditos Anthropic cuando el volumen lo justifique

---

## Forma de trabajo con Claude

- Alejandro prefiere copy-paste directo de archivos en la conversación
- Siempre subir cambios a GitHub para que Vercel redespliege automáticamente
- Antes de agregar funciones serverless: verificar que no superen 12 en total
- Los prompts de IA siempre van hardcodeados en el backend, nunca en el frontend
- Supabase service key bypasea RLS — usar cliente separado del cliente de auth del usuario
