/* TeleMed call page - low-bandwidth WebRTC */

const token = localStorage.getItem('token');
const user  = JSON.parse(localStorage.getItem('user') || 'null');
if (!token || !user) location.href = 'index.html';

const params = new URLSearchParams(location.search);
const apptId = params.get('appointmentId');
if (!apptId) location.href = 'dashboard.html';

let pc, localStream, socket, dataChannel;
let currentAppt;
let audioOnlyMode   = false;
let lowBwSamples    = 0;
let goodBwSamples   = 0;
let statsTimer;
let currentTargetBitrate = 500000;
let _remotePeerId = null;

const $ = id => document.getElementById(id);

init();

async function init() {
  try {
    currentAppt = await api('/api/appointments/' + apptId);
    const other = user.role === 'doctor' ? currentAppt.patient : currentAppt.doctor;
    $('callTitle').textContent = (other && other.name) || 'Consultation';
    $('callSub').textContent = currentAppt.reason ? '- ' + currentAppt.reason : '';

    if (user.role === 'doctor') {
      $('notesArea').value = currentAppt.notes || '';
      $('saveNotesBtn').hidden = false;
      $('notesHint').textContent = 'Editable - only you can see and save notes.';
    } else {
      $('notesArea').readOnly = true;
      $('notesHint').textContent = 'Read-only - the doctor may share notes during the call.';
    }

    await setupMedia();
    await setupSocket();
    await setupPeerConnection();
    bindUI();
  } catch (err) {
    alert('Failed to join call: ' + err.message);
    location.href = 'dashboard.html';
  }
}

async function setupMedia() {
  const videoConstraints = { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 15, max: 20 } };
  const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  // Try video+audio, then audio-only, then no media at all
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: audioConstraints });
  } catch (e1) {
    console.warn('video+audio failed, trying audio only:', e1.message);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      console.warn('Joined with audio only - no camera available');
    } catch (e2) {
      console.warn('audio also failed, joining with no local media:', e2.message);
      localStream = new MediaStream();  // empty stream - can still receive remote tracks
    }
  }

  if (localStream.getVideoTracks().length > 0) {
    $('localVideo').srcObject = localStream;
  } else {
    $('localVideo').style.display = 'none';  // hide the empty local preview
  }
}

function setupSocket() {
  socket = io({ auth: { token } });

  socket.on('connect', () => {
    socket.emit('join-room', { roomId: currentAppt.roomId });
  });

  socket.on('room-peers', peers => {
    if (peers.length === 1) createOffer(peers[0].socketId);
  });

  socket.on('peer-joined', () => {});

  socket.on('offer', async ({ from, sdp }) => {
    _remotePeerId = from;
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { to: from, sdp: answer });
  });

  socket.on('answer', async ({ sdp }) => {
    await pc.setRemoteDescription(sdp);
  });

  socket.on('ice-candidate', async ({ candidate }) => {
    try { await pc.addIceCandidate(candidate); } catch (e) { console.warn(e); }
  });

  socket.on('peer-left', () => {
    $('remoteVideo').srcObject = null;
    $('callTitle').textContent = 'Peer left the call';
  });

  socket.on('chat-message', msg => {
  if (msg.from === socket.id) return;  // already appended locally
  appendChat(msg, false);
  });
  socket.on('note-update', ({ note }) => {
    if (user.role !== 'doctor') $('notesArea').value = note;
  });
}

async function setupPeerConnection() {
  const cfg = await api('/api/config');
  pc = new RTCPeerConnection({ iceServers: cfg.iceServers });

  try {
    const caps = RTCRtpSender.getCapabilities('video');
    const preferred = [
      ...caps.codecs.filter(c => c.mimeType === 'video/VP9'),
      ...caps.codecs.filter(c => c.mimeType === 'video/VP8'),
      ...caps.codecs.filter(c => !/VP9|VP8/.test(c.mimeType))
    ];
    pc.getTransceivers().forEach(t => { try { t.setCodecPreferences(preferred); } catch (e) {} });
  } catch (e) { console.warn('setCodecPreferences unavailable'); }

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  dataChannel = pc.createDataChannel('chat');
  dataChannel.onmessage = e => {
    try { const msg = JSON.parse(e.data); appendChat(msg, false); } catch (e) {}
  };

  pc.ontrack = e => {
    if (!audioOnlyMode) $('remoteVideo').srcObject = e.streams[0];
  };

  pc.onicecandidate = e => {
    if (e.candidate && _remotePeerId) {
      socket.emit('ice-candidate', { to: _remotePeerId, candidate: e.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      setTimeout(attemptReconnect, 4000);
    }
  };

  statsTimer = setInterval(monitorStats, 3000);
}

async function createOffer(peerId) {
  _remotePeerId = peerId;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { to: peerId, sdp: offer });
}

async function monitorStats() {
  if (!pc || pc.connectionState !== 'connected') return;
  const stats = await pc.getStats();

  let rtt = 0, jitter = 0, packetsLost = 0, packetsReceived = 0, availOut = 0;

  stats.forEach(r => {
    if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) {
      rtt = (r.currentRoundTripTime || 0) * 1000;
    }
    if (r.type === 'inbound-rtp' && r.kind === 'video') {
      jitter = (r.jitter || 0) * 1000;
      packetsLost = r.packetsLost || 0;
      packetsReceived = r.packetsReceived || 0;
    }
    if (r.type === 'transport') {
      availOut = r.availableOutgoingBitrate || 0;
    }
  });

  const totalPackets = packetsLost + packetsReceived;
  const lossPct = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;

  updateNetworkIndicator({ rtt, lossPct, jitter, availOut });
  await adaptBitrate(availOut);
  await checkAudioOnlyFallback(availOut);
}

function updateNetworkIndicator({ rtt, lossPct, jitter, availOut }) {
  let score = 100;
  if (rtt > 300) score -= 40; else if (rtt > 150) score -= 20;
  if (lossPct > 3) score -= 40; else if (lossPct > 1) score -= 20;
  if (jitter > 50) score -= 30; else if (jitter > 30) score -= 15;
  if (availOut > 0 && availOut < 200000) score -= 40;
  else if (availOut > 0 && availOut < 500000) score -= 20;

  const bars = score > 80 ? 5 : score > 60 ? 4 : score > 40 ? 3 : score > 20 ? 2 : 1;
  const cls = bars >= 4 ? 'active' : bars >= 2 ? 'warn' : 'bad';

  document.querySelectorAll('#netIndicator .bar').forEach((b, i) => {
    b.className = 'bar' + (i < bars ? ' ' + cls : '');
  });

  $('netLabel').textContent = bars >= 4 ? 'Good' : bars >= 2 ? 'Fair' : 'Poor';
}

async function adaptBitrate(availOut) {
  if (!availOut) return;
  const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
  if (!sender) return;

  const target = Math.max(100000, Math.min(1500000, Math.round(availOut * 0.7)));
  if (Math.abs(target - currentTargetBitrate) < 50000) return;

  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) return;
    params.encodings[0].maxBitrate = target;
    if ('degradationPreference' in params) params.degradationPreference = 'maintain-framerate';
    await sender.setParameters(params);
    currentTargetBitrate = target;
    console.log('[adaptive] target bitrate ->', (target / 1000).toFixed(0), 'kbps');
  } catch (e) {
    console.warn('[adaptive] setParameters failed', e);
  }
}

async function checkAudioOnlyFallback(availOut) {
  if (!availOut) return;
  if (availOut < 120000) {
    lowBwSamples++; goodBwSamples = 0;
    if (lowBwSamples >= 3 && !audioOnlyMode) enterAudioOnly();
  } else if (availOut > 250000) {
    goodBwSamples++; lowBwSamples = 0;
    if (goodBwSamples >= 3 && audioOnlyMode) exitAudioOnly();
  }
}

function enterAudioOnly() {
  audioOnlyMode = true;
  $('audioOnlyBanner').hidden = false;
  $('remoteVideo').srcObject = null;
  const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
  if (sender) sender.replaceTrack(null).catch(() => {});
  console.log('[fallback] entered audio-only mode');
}

function exitAudioOnly() {
  audioOnlyMode = false;
  $('audioOnlyBanner').hidden = true;
  const sender = pc.getSenders().find(s => !s.track || s.track.kind === 'video');
  const vt = localStream.getVideoTracks()[0];
  if (sender && vt) sender.replaceTrack(vt).catch(() => {});
  console.log('[fallback] exited audio-only mode');
}

async function attemptReconnect() {
  console.log('[reconnect] attempting ICE restart');
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    if (_remotePeerId) socket.emit('offer', { to: _remotePeerId, sdp: offer });
  } catch (e) {
    console.warn('[reconnect] failed', e);
  }
}

function bindUI() {
  document.querySelectorAll('.side-tabs button').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.side-tabs button').forEach(b => b.classList.toggle('active', b === btn));
      $('tabChat').style.display  = btn.dataset.tab === 'chat'  ? 'flex' : 'none';
      $('tabNotes').style.display = btn.dataset.tab === 'notes' ? 'block' : 'none';
    };
  });

  $('micBtn').onclick = () => {
    const track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    $('micBtn').classList.toggle('active', !track.enabled);
  };

  $('camBtn').onclick = () => {
    const track = localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    $('camBtn').classList.toggle('active', !track.enabled);
  };

  $('endBtn').onclick = () => {
    if (confirm('End the consultation?')) {
      socket.emit('leave-room');
      pc.close();
      localStream.getTracks().forEach(t => t.stop());
      clearInterval(statsTimer);
      location.href = 'dashboard.html';
    }
  };

  $('chatForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    const msg = { name: user.name, role: user.role, text, ts: Date.now() };
    appendChat(msg, true);
    socket.emit('chat-message', { roomId: currentAppt.roomId, text });
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(msg));
    }
    input.value = '';
  });

  if (user.role === 'doctor') {
    let noteTimer;
    $('notesArea').addEventListener('input', () => {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        socket.emit('note-update', { roomId: currentAppt.roomId, note: $('notesArea').value });
      }, 500);
    });
    $('saveNotesBtn').onclick = async () => {
      await api('/api/appointments/' + apptId + '/notes', {
        method: 'PATCH',
        body: JSON.stringify({ notes: $('notesArea').value, status: 'completed' })
      });
      $('saveNotesBtn').textContent = 'Saved';
      setTimeout(() => $('saveNotesBtn').textContent = 'Save notes', 2000);
    };
  }
}

function appendChat(msg, isSelf) {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (isSelf ? 'self' : 'other');
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = '<span class="meta">' + escapeHtml(msg.name) + ' - ' + time + '</span>' + escapeHtml(msg.text);
  $('chatMessages').appendChild(div);
  $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
}

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