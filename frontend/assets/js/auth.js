// Auth functions
async function login() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.token) {
        // normalize user object: backend may return `id` instead of `_id`
        const user = data.user || {};
        if (user.id && !user._id) user._id = user.id;
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(user));
        window.location.href = `dashboard_${user.role}.html`;
    } else {
        alert(data.message || 'Login failed');
    }
}

async function register() {
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;
    const designation = document.getElementById('designation').value.trim();
    const department = document.getElementById('department').value.trim();
    const managerEmail = document.getElementById('managerEmail').value.trim();
    const github = document.getElementById('github') ? document.getElementById('github').value.trim() : '';
    const linkedin = document.getElementById('linkedin') ? document.getElementById('linkedin').value.trim() : '';
    const photoFile = document.getElementById('photo').files[0];
    const msgEl = document.getElementById('registerMsg');
    const submitBtn = document.getElementById('registerBtn');
    if (msgEl) msgEl.innerHTML = '';

    // simple client-side validation
    if (!name || !email || !password) {
        if (msgEl) msgEl.innerHTML = '<div class="error">Name, email and password are required.</div>';
        return;
    }
    if (password.length < 6) {
        if (msgEl) msgEl.innerHTML = '<div class="error">Password must be at least 6 characters.</div>';
        return;
    }

    let photo = null;
    if (photoFile) {
        photo = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(photoFile);
        });
    }
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';
    }
    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, role, designation, department, managerEmail, photo, github, linkedin })
        });
        const data = await res.json();
        if (res.ok) {
            if (msgEl) msgEl.innerHTML = '<div class="success">Registration successful. Redirecting to login...</div>';
            setTimeout(() => window.location.href = 'index.html', 1200);
        } else {
            if (msgEl) msgEl.innerHTML = `<div class="error">${data.message || 'Registration failed'}</div>`;
        }
    } catch (err) {
        if (msgEl) msgEl.innerHTML = `<div class="error">Network error: ${err.message}</div>`;
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create account';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (loginForm) loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        login();
    });
    if (registerForm) registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        register();
    });
    // photo preview for registration
    const photoInput = document.getElementById('photo');
    const preview = document.getElementById('photoPreview');
    if (photoInput && preview) {
        photoInput.addEventListener('change', () => {
            const f = photoInput.files[0];
            if (!f) return preview.src = 'assets/images/avatar-placeholder.png';
            const reader = new FileReader();
            reader.onload = () => preview.src = reader.result;
            reader.readAsDataURL(f);
        });
    }
});

// Check auth
function getToken() {
    return localStorage.getItem('token');
}

function getUser() {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    if (u && !u._id && u.id) u._id = u.id;
    return u;
}

function logout() {
    localStorage.clear();
    window.location.href = 'index.html';
}

// API helper
async function apiCall(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${endpoint}`, opts);
    let data = null;
    try {
        data = await res.json();
    } catch (err) {
        console.error('apiCall: failed to parse JSON for', endpoint, 'status', res.status, err);
        throw new Error('API returned non-JSON response');
    }
    if (!res.ok) {
        console.error('apiCall error:', endpoint, res.status, data);
        throw new Error(data.message || data.error || `API error ${res.status}`);
    }
    return data;
}