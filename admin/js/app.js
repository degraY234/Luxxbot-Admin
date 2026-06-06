const $ = (sel) => document.querySelector(sel);

const loginScreen = $('#login-screen');
const appScreen = $('#app-screen');
const toastEl = $('#toast');
const loginError = $('#login-error');

function showToast(msg, ms = 2800) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

function showLoginError(msg) {
  if (!msg) {
    loginError.classList.add('hidden');
    loginError.textContent = '';
    return;
  }
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}

function cfg() {
  return {
    base: (localStorage.getItem('luxx_api_base') || '').replace(/\/$/, ''),
    token: localStorage.getItem('luxx_api_token') || ''
  };
}

function defaultLocalBase() {
  const { protocol, hostname, port } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const p = port || '3920';
    return `${protocol}//${hostname}:${p}`;
  }
  return '';
}

async function api(path, method = 'GET') {
  const { base, token } = cfg();
  if (!base || !token) throw new Error('Belum login');

  const res = await fetch(`${base}/admin/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderStatus(d) {
  const badge = $('#conn-badge');
  badge.textContent = 'online';
  badge.className = 'badge online';

  $('#hero-bot-name').textContent = d.bot || 'LuxxBot';
  $('#hero-uptime').textContent = `Uptime ${d.uptime} · RAM ${d.ramMb} MB`;

  const cur = d.radio?.current;
  const pill = $('#hero-pill');
  if (cur) {
    pill.textContent = `▶ ${cur.title.slice(0, 36)}${cur.title.length > 36 ? '…' : ''}`;
  } else if (d.radio?.isPreparing) {
    pill.textContent = '⏳ Memuat lagu...';
  } else if (d.sleeping) {
    pill.textContent = '🛌 Mode tidur';
  } else {
    pill.textContent = '⚡ Online';
  }

  $('#status-grid').innerHTML = [
    ['Bot', d.bot],
    ['Uptime', d.uptime],
    ['RAM', `${d.ramMb} MB`],
    ['Host', d.host],
    ['Mode', d.sleeping ? '🛌 Tidur' : '⚡ Online'],
    ['Self', d.selfMode ? '🔒' : '🔓'],
    ['Anti-Link', d.antiLink ? 'ON' : 'OFF']
  ].map(([label, value]) => `
    <div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>
  `).join('');

  const disc = d.discord || {};
  $('#discord-box').innerHTML = `
    <div>🖥️ Server: <strong>${disc.guildCount || 0}</strong></div>
    <div style="margin-top:0.4rem">${disc.inVoice ? `🔊 ${disc.voiceChannel}` : '🔇 Belum di voice'}</div>
    <div style="margin-top:0.4rem">Slash: ${disc.slashReady ? '✅ Siap' : '⏳ ...'}</div>
    ${disc.inviteUrl ? `<div style="margin-top:0.6rem"><a href="${disc.inviteUrl}" target="_blank" rel="noopener" style="color:var(--pink3)">Invite bot →</a></div>` : ''}
  `;

  const r = d.radio || {};
  $('#now-box').innerHTML = cur
    ? `<strong>${cur.title}</strong><br><span class="muted">${cur.author || '-'}</span><br>🙋 ${cur.requestedBy || '-'}<br><br><a href="${r.listenUrl}/radio" target="_blank" rel="noopener">Buka player ↗</a>`
    : (r.isPreparing ? '⏳ Memuat lagu...' : '<span class="muted">⏸ Tidak ada lagu aktif</span>');

  const q = r.queue || [];
  $('#queue-list').innerHTML = q.length
    ? q.map((t, i) => `<li><strong>${i + 1}.</strong> ${t.title}<br><span class="muted">🙋 ${t.requestedBy}</span></li>`).join('')
    : '<li class="muted">Antrian kosong</li>';
}

async function refresh() {
  try {
    const data = await api('/status');
    renderStatus(data);
  } catch (e) {
    $('#conn-badge').textContent = 'error';
    $('#conn-badge').className = 'badge offline';
    showToast(e.message);
  }
}

async function doLogin() {
  const base = $('#api-base').value.trim().replace(/\/$/, '');
  const token = $('#api-token').value.trim();
  showLoginError('');

  if (!base || !token) {
    showLoginError('Isi API Base URL dan Admin Token.');
    return;
  }

  localStorage.setItem('luxx_api_base', base);
  localStorage.setItem('luxx_api_token', token);

  const btn = $('#btn-login');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Menghubungkan...';

  try {
    await api('/status');
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    refresh();
    if (!window._poll) window._poll = setInterval(refresh, 12000);
  } catch (e) {
    showLoginError(e.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Masuk Dashboard';
  }
}

$('#btn-login').addEventListener('click', doLogin);

$('#btn-local').addEventListener('click', () => {
  const local = defaultLocalBase();
  if (local) $('#api-base').value = local;
  showToast('URL localhost diisi otomatis');
});

$('#btn-toggle-token').addEventListener('click', () => {
  const inp = $('#api-token');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('#btn-logout').addEventListener('click', () => {
  localStorage.removeItem('luxx_api_base');
  localStorage.removeItem('luxx_api_token');
  appScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  clearInterval(window._poll);
  window._poll = null;
});

$('#btn-refresh').addEventListener('click', refresh);

$('#btn-skip').addEventListener('click', async () => {
  try {
    const r = await api('/skip', 'POST');
    showToast(r.message || 'Skipped');
    refresh();
  } catch (e) { showToast(e.message); }
});

$('#btn-clear').addEventListener('click', async () => {
  if (!confirm('Kosongkan antrian radio?')) return;
  try {
    await api('/clear', 'POST');
    showToast('Antrian dikosongkan');
    refresh();
  } catch (e) { showToast(e.message); }
});

$('#btn-restart').addEventListener('click', async () => {
  if (!confirm('Restart bot via PM2?')) return;
  try {
    await api('/restart', 'POST');
    showToast('Restart diminta...');
  } catch (e) { showToast(e.message); }
});

// Init login form
const localBase = defaultLocalBase();
const savedBase = localStorage.getItem('luxx_api_base');
const savedToken = localStorage.getItem('luxx_api_token');

$('#api-base').value = savedBase || localBase || '';
if (savedToken) $('#api-token').value = savedToken;

if (savedBase && savedToken) {
  api('/status').then(() => {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    refresh();
    window._poll = setInterval(refresh, 12000);
  }).catch(() => {});
}