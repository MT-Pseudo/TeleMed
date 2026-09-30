const form   = document.getElementById('authForm');
const tabs   = document.querySelectorAll('.auth-tabs button');
const errEl  = document.getElementById('error');
let mode = 'login';

tabs.forEach(btn => btn.onclick = () => {
  mode = btn.dataset.mode;
  tabs.forEach(b => b.classList.toggle('active', b === btn));
  document.getElementById('nameField').hidden = mode === 'login';
  document.getElementById('roleField').hidden = mode === 'login';
  document.getElementById('specField').hidden = mode === 'login';
  document.getElementById('submitBtn').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  document.querySelector('input[name="password"]').autocomplete =
    mode === 'login' ? 'current-password' : 'new-password';
});

document.querySelector('select[name="role"]').addEventListener('change', e => {
  document.getElementById('specField').hidden = e.target.value !== 'doctor';
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  errEl.hidden = true;
  const data = Object.fromEntries(new FormData(form));
  const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Request failed');

    if (mode === 'login') {
      localStorage.setItem('token', json.token);
      localStorage.setItem('user', JSON.stringify(json.user));
      location.href = 'dashboard.html';
    } else {
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, password: data.password })
      });
      const loginJson = await loginRes.json();
      if (!loginRes.ok) throw new Error(loginJson.message);
      localStorage.setItem('token', loginJson.token);
      localStorage.setItem('user', JSON.stringify(loginJson.user));
      location.href = 'dashboard.html';
    }
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

if (localStorage.getItem('token')) location.href = 'dashboard.html';