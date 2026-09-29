// Script compartido — maneja el estado de auth en el nav
(function() {
  const INACTIVITY_LIMIT = 30 * 60 * 1000; // 30 minutos
  const ACTIVITY_KEY = 'corvus_last_activity';

  function getUser() {
    try {
      const raw = localStorage.getItem('corvus_user') || sessionStorage.getItem('corvus_user');
      const token = localStorage.getItem('corvus_token') || sessionStorage.getItem('corvus_token');
      if (!raw || !token) return null;
      return { user: JSON.parse(raw), token };
    } catch(e) { return null; }
  }

  function logout() {
    localStorage.removeItem('corvus_token');
    localStorage.removeItem('corvus_user');
    sessionStorage.removeItem('corvus_token');
    sessionStorage.removeItem('corvus_user');
    localStorage.removeItem(ACTIVITY_KEY);
    window.location.href = '/';
  }

  // Check inactivity
  function checkInactivity() {
    const last = parseInt(localStorage.getItem(ACTIVITY_KEY) || '0');
    if (last && Date.now() - last > INACTIVITY_LIMIT) {
      logout();
    }
  }

  // Update activity timestamp
  function updateActivity() {
    localStorage.setItem(ACTIVITY_KEY, Date.now().toString());
  }

  const session = getUser();
  const authArea = document.getElementById('nav-auth-area');
  if (!authArea) return;

  if (session) {
    // Check inactivity on page load
    checkInactivity();
    updateActivity();

    // Track activity
    ['click','keydown','mousemove','touchstart'].forEach(evt => {
      document.addEventListener(evt, updateActivity, { passive: true });
    });

    // Check every minute
    setInterval(checkInactivity, 60 * 1000);

    const { user } = session;
    const initial = user.nombre ? user.nombre[0].toUpperCase() : user.email?.[0]?.toUpperCase() || '?';
    const dashUrl = user.role === 'recruiter' ? '/dashboard/recruiter' : '/dashboard/candidato';
    const displayName = user.nombre || user.email?.split('@')[0] || 'Mi cuenta';

    authArea.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <a href="${dashUrl}" style="display:flex;align-items:center;gap:8px;text-decoration:none">
          <div style="width:30px;height:30px;border-radius:50%;background:rgba(143,168,200,0.2);border:1px solid rgba(143,168,200,0.4);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#8FA8C8;flex-shrink:0">${initial}</div>
          <span style="font-size:13px;color:#8FA8C8;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${displayName}</span>
        </a>
        <button onclick="(${logout.toString()})()" style="background:none;border:1px solid rgba(143,168,200,0.2);border-radius:6px;padding:5px 10px;color:rgba(255,255,255,0.4);font-size:11px;cursor:pointer;font-family:inherit">Salir</button>
      </div>
    `;
  } else {
    authArea.innerHTML = `<a href="/auth" style="background:#FFFFFF;color:#0A1628;padding:7px 18px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none">Ingresar</a>`;
  }
})();
