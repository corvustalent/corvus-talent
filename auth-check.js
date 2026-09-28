// Script compartido — verifica sesión activa antes de cargar la herramienta
(function() {
  const token = localStorage.getItem('corvus_token');
  const userRaw = localStorage.getItem('corvus_user');
  
  if (!token || !userRaw) {
    // Guardamos la URL actual para redirigir de vuelta después del login
    localStorage.setItem('corvus_redirect', window.location.pathname);
    window.location.href = '/auth';
    return;
  }

  // Verificar que el token no sea muy viejo (7 días)
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      localStorage.removeItem('corvus_token');
      localStorage.removeItem('corvus_user');
      localStorage.setItem('corvus_redirect', window.location.pathname);
      window.location.href = '/auth';
    }
  } catch(e) {
    // Token malformado
    localStorage.removeItem('corvus_token');
    localStorage.removeItem('corvus_user');
    window.location.href = '/auth';
  }
})();
