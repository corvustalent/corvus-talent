// /auth-check.js — Verifica que el usuario esté logged in
function checkAuth() {
    const token = localStorage.getItem('corvus_token');
    
    if (!token || token.trim() === '') {
        console.log('[AUTH-CHECK] No token found, redirecting to /auth');
        window.location.href = '/auth';
        return false;
    }
    
    console.log('[AUTH-CHECK] Token found:', token.split('@')[0]);
    return true;
}

// Ejecutar al cargar la página
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAuth);
} else {
    checkAuth();
}
