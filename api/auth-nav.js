// Script compartido — maneja el estado de auth en el nav de todas las herramientas
(function() {
  const authArea = document.getElementById('nav-auth-area');
  if (!authArea) return;

  const userRaw = localStorage.getItem('corvus_user');
  const token = localStorage.getItem('corvus_token');

  if (userRaw && token) {
    try {
      const user = JSON.parse(userRaw);
      const initial = user.email ? user.email[0].toUpperCase() : '?';
      const dashUrl = user.role === 'recruiter' ? '/dashboard/recruiter' : '/dashboard/candidato';
      authArea.innerHTML = `
        <a href="${dashUrl}" style="display:flex;align-items:center;gap:8px;text-decoration:none">
          <div style="width:30px;height:30px;border-radius:50%;background:rgba(143,168,200,0.2);border:1px solid rgba(143,168,200,0.4);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#8FA8C8">${initial}</div>
          <span style="font-size:13px;color:#8FA8C8;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${user.email}</span>
        </a>
      `;
    } catch(e) {
      showLoginBtn();
    }
  } else {
    showLoginBtn();
  }

  function showLoginBtn() {
    authArea.innerHTML = `<a href="/auth" style="background:#FFFFFF;color:#0A1628;padding:6px 16px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none">Ingresar</a>`;
  }
})();
