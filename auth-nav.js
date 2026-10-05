// /auth-nav.js — Verificación de auth + nav rendering + inactividad (Sesión 19 MEJORADO)
(function() {
  const INACTIVITY_LIMIT = 30 * 60 * 1000; // 30 minutos
  const ACTIVITY_KEY = 'corvus_last_activity';

  function getUser() {
    try {
      const token = localStorage.getItem('corvus_token') || sessionStorage.getItem('corvus_token');
      const raw = localStorage.getItem('corvus_user') || sessionStorage.getItem('corvus_user');
      if (!token) return null;
      if (!raw) return { token }; // Token pero sin datos de user
      return { user: JSON.parse(raw), token };
    } catch(e) { return null; }
  }

  function logout() {
    localStorage.removeItem('corvus_token');
    localStorage.removeItem('corvus_user');
    sessionStorage.removeItem('corvus_token');
    sessionStorage.removeItem('corvus_user');
    localStorage.removeItem(ACTIVITY_KEY);
    window.location.href = '/auth';
  }

  // Verificación de inactividad
  function checkInactivity() {
    const last = parseInt(localStorage.getItem(ACTIVITY_KEY) || '0');
    if (last && Date.now() - last > INACTIVITY_LIMIT) {
      console.log('[AUTH-NAV] Inactivity timeout, logging out');
      logout();
    }
  }

  // Actualizar timestamp de actividad
  function updateActivity() {
    localStorage.setItem(ACTIVITY_KEY, Date.now().toString());
  }

  // Verificación principal: si hay token, permite acceso
  const session = getUser();
  
  if (!session || !session.token) {
    console.log('[AUTH-NAV] No token found, redirecting to /auth');
    window.location.href = '/auth';
    return;
  }

  console.log('[AUTH-NAV] Token verified, user logged in:', session.token.split('@')[0]);

  // Usuario logueado: configurar nav + inactividad
  const authArea = document.getElementById('nav-auth-area');
  
  // Limpiar sesión temporal al cerrar navegador
  if (localStorage.getItem('corvus_session_temp') === '1') {
    window.addEventListener('beforeunload', () => {
      localStorage.removeItem('corvus_token');
      localStorage.removeItem('corvus_user');
      localStorage.removeItem('corvus_session_temp');
      localStorage.removeItem(ACTIVITY_KEY);
    });
  }

  // Verificar inactividad
  checkInactivity();
  updateActivity();

  // Rastrear actividad del usuario
  ['click', 'keydown', 'mousemove', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, updateActivity, { passive: true });
  });

  // Verificar inactividad cada minuto
  setInterval(checkInactivity, 60 * 1000);

  // Renderizar nav si existe el elemento
  if (authArea) {
    const { user } = session;
    const initial = user?.nombre ? user.nombre[0].toUpperCase() : session.token.split('@')[0][0].toUpperCase() || '?';
    const dashUrl = user?.role === 'recruiter' ? '/dashboard/recruiter' : '/dashboard/candidato';
    const displayName = user?.nombre || session.token.split('@')[0] || 'Mi cuenta';

    authArea.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <a href="${dashUrl}" style="display:flex;align-items:center;gap:8px;text-decoration:none;background:rgba(143,168,200,0.1);border:1px solid rgba(143,168,200,0.25);border-radius:20px;padding:5px 12px 5px 6px">
          <div style="width:24px;height:24px;border-radius:50%;background:rgba(143,168,200,0.25);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#8FA8C8;flex-shrink:0">${initial}</div>
          <span style="font-size:12px;color:#8FA8C8;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Mi perfil</span>
        </a>
        <button onclick="(${logout.toString()})()" style="background:none;border:1px solid rgba(143,168,200,0.2);border-radius:6px;padding:5px 10px;color:rgba(255,255,255,0.4);font-size:11px;cursor:pointer;font-family:inherit">Salir</button>
      </div>
    `;
  }
})();
