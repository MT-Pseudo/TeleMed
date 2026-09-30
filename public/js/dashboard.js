const token = localStorage.getItem('token');
const user  = JSON.parse(localStorage.getItem('user') || 'null');
if (!token || !user) location.href = 'index.html';

document.getElementById('userName').textContent = user.name;
const badge = document.getElementById('userBadge');
badge.textContent = user.role;
badge.className = 'badge badge-' + user.role;

document.getElementById('logoutBtn').onclick = () => {
  localStorage.clear();
  location.href = 'index.html';
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(options.headers || {}) }
  });
  if (res.status === 401) { localStorage.clear(); location.href = 'index.html'; }
  if (!res.ok) throw new Error((await res.json()).message || 'Request failed');
  return res.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildQuickActions() {
  const grid = document.getElementById('quickActions');
  const cards = [];

  if (user.role === 'patient') {
    cards.push({ icon: 'Calendar', title: 'Book appointment', desc: 'Schedule a new consultation', action: openBook });
  }
  cards.push({ icon: 'Profile', title: 'My profile', desc: 'View your account details', action: () => alert('Profile page coming soon') });

  if (user.role === 'doctor') {
    cards.push({ icon: 'Notes', title: 'Session notes', desc: 'Review recent session notes', action: () => alert('Open a call to see notes') });
  }
  if (user.role === 'admin') {
    cards.push({ icon: 'Users', title: 'All users', desc: 'Manage system accounts', action: () => alert('Admin user management coming soon') });
  }

  grid.innerHTML = cards.map((c, i) => `
    <div class="dash-card" data-idx="${i}">
      <div class="icon">${c.icon}</div>
      <h3>${c.title}</h3>
      <p>${c.desc}</p>
    </div>`).join('');

  grid.querySelectorAll('.dash-card').forEach(el => {
    el.onclick = () => cards[+el.dataset.idx].action();
  });
}

async function loadAppointments() {
  const appts = await api('/api/appointments');
  const now = new Date();
  const upcoming = appts.filter(a => new Date(a.date) > now && a.status === 'scheduled');
  const past     = appts.filter(a => new Date(a.date) <= now || a.status !== 'scheduled');

  renderList('upcoming', upcoming, true);
  renderList('previous', past, false);
}

function renderList(targetId, list, allowJoin) {
  const el = document.getElementById(targetId);
  if (!list.length) { el.innerHTML = '<div class="empty">No appointments here.</div>'; return; }

  const now = new Date();

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Date</th><th>${user.role === 'patient' ? 'Doctor' : 'Patient'}</th>
        <th>Reason</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${list.map(a => {
          const other = user.role === 'patient' ? a.doctor : a.patient;
          const d = new Date(a.date);
          const dateStr = d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
          const canJoin = allowJoin && a.status === 'scheduled';

          // Display-only status override: past-scheduled & never-joined => "missed"
          let displayStatus = a.status;
          if (a.status === 'scheduled' && d < now) displayStatus = 'missed';

          const statusClass = 'status-' + displayStatus;

          return `<tr>
            <td>${dateStr}</td>
            <td>${other && other.name ? other.name : '-'}</td>
            <td>${a.reason || '-'}</td>
            <td><span class="status-badge ${statusClass}">${displayStatus}</span></td>
            <td>${canJoin ? '<button class="btn btn-primary btn-sm" onclick="joinCall(\'' + a._id + '\')">Join call</button>' : ''}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

window.joinCall = (appointmentId) => {
  location.href = 'call.html?appointmentId=' + appointmentId;
};

async function openBook() {
  const doctors = await api('/api/users/doctors');
  document.getElementById('doctorSelect').innerHTML =
    '<option value="">- select doctor -</option>' +
    doctors.map(d => '<option value="' + d._id + '">' + d.name + (d.specialization ? ' (' + d.specialization + ')' : '') + '</option>').join('');
  document.getElementById('bookModal').hidden = false;
}
window.openBook = openBook;
window.closeBook = () => document.getElementById('bookModal').hidden = true;

document.getElementById('bookForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/appointments', { method: 'POST', body: JSON.stringify(data) });
    closeBook();
    loadAppointments();
  } catch (err) { alert(err.message); }
});

buildQuickActions();
loadAppointments();

// ---------- Real-time call notifications ----------
const notifySocket = io({ auth: { token } });

notifySocket.on('call-started', (data) => {
  showCallToast(data);
});

function showCallToast({ appointmentId, from, fromRole }) {
  const existing = document.getElementById('callToast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'callToast';
  toast.className = 'call-toast';
  toast.innerHTML =
    '<div class="toast-body">' +
      '<strong>' + escapeHtml(from) + '</strong>' +
      ' <span class="toast-role">' + escapeHtml(fromRole) + '</span>' +
      ' has joined the call.' +
    '</div>' +
    '<div class="toast-actions">' +
      '<button class="btn btn-primary btn-sm" id="toastJoin">Join now</button>' +
      '<button class="btn btn-ghost btn-sm" id="toastDismiss">Dismiss</button>' +
    '</div>';

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) { /* audio optional */ }

  document.getElementById('toastJoin').onclick = () => {
    location.href = 'call.html?appointmentId=' + appointmentId;
  };
  document.getElementById('toastDismiss').onclick = () => toast.remove();

  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 30000);
}