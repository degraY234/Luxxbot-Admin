const $ = (sel) => document.querySelector(sel);

const loginScreen = $('#login-screen');
const appScreen = $('#app-screen');
const toastEl = $('#toast');
const loginError = $('#login-error');

function showToast(msg, ms = 3000) {
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
    token: (localStorage.getItem('luxx_api_token') || '').trim()
  };
}

function defaultLocalBase() {
  return 'http://localhost:3920';
}

function friendlyError(err, base) {
  const msg = String(err?.message || err || 'Gagal connect');
  if (msg === 'Failed to fetch' || msg.includes('NetworkError')) {
    const tunnelHint = base.includes('trycloudflare.com')
      ? '\n• URL trycloudflare MATI kalau tunnel ditutup — jalankan ulang: scripts\\radio-tunnel.ps1\n• Salin URL BARU ke API Base URL (bukan URL lama).'
      : '';
    return `Tidak bisa hubungi bot di ${base}.\n• Bot jalan? (pm2 status)\n• Tunnel hidup? (jendela cloudflared harus terbuka)${tunnelHint}\n• API Base URL = alamat bot/tunnel, BUKAN link GitHub Pages.`;
  }
  if (msg.includes('Unauthorized')) {
    return 'Token salah. Harus sama persis dengan ADMIN_API_TOKEN di .env bot.';
  }
  if (msg.includes('Admin API disabled')) {
    return 'ADMIN_API_TOKEN belum diset di .env bot. Restart: pm2 restart luxx --update-env';
  }
  return msg;
}

async function api(path, method = 'GET') {
  const { base, token } = cfg();
  if (!base || !token) throw new Error('Isi API Base URL dan Admin Token.');

  let res;
  try {
    res = await fetch(`${base}/admin/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (e) {
    throw new Error(friendlyError(e, base));
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError({ message: data.error || `HTTP ${res.status}` }, base));
  return data;
}

let lastTrackId = null;
let lastThumbTrackId = null;
let lastStreamEpoch = null;

function stopAudio(audio) {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

function resetPlayerState() {
  lastTrackId = null;
  lastThumbTrackId = null;
  stopAudio($('#radio-audio'));
}

function updatePlayerThumbnail(cur, thumb, fallback) {
  if (!cur?.thumbnail) {
    lastThumbTrackId = cur?.id ?? null;
    thumb.classList.remove('visible');
    thumb.removeAttribute('src');
    fallback.style.display = 'flex';
    return;
  }

  if (lastThumbTrackId === cur.id && thumb.classList.contains('visible')) return;

  lastThumbTrackId = cur.id;
  thumb.classList.remove('visible');
  fallback.style.display = 'flex';
  thumb.onload = () => {
    thumb.classList.add('visible');
    fallback.style.display = 'none';
  };
  thumb.onerror = () => {
    thumb.classList.remove('visible');
    thumb.removeAttribute('src');
    fallback.style.display = 'flex';
  };
  thumb.src = `${cur.thumbnail}?v=${cur.id}`;
}

function renderPlayer(r = {}, base = '') {
  const cur = r.current;
  const badge = $('#player-badge');
  const audio = $('#radio-audio');
  const thumb = $('#player-thumb');
  const fallback = $('#player-thumb-fallback');
  const epoch = r.streamEpoch ?? null;

  if (epoch !== null && epoch !== lastStreamEpoch) {
    lastStreamEpoch = epoch;
    lastTrackId = null;
    lastThumbTrackId = null;
    stopAudio(audio);
  }

  if (r.isPreparing && !cur) {
    badge.textContent = 'LOADING';
    badge.className = 'player-badge load';
    $('#player-title').textContent = 'Memuat lagu...';
    $('#player-artist').textContent = radioPreparingLabel(r);
    $('#player-requester').textContent = '🙋 —';
    lastThumbTrackId = null;
    thumb.classList.remove('visible');
    thumb.removeAttribute('src');
    fallback.style.display = 'flex';
    stopAudio(audio);
    return;
  }

  if (!cur) {
    badge.textContent = 'IDLE';
    badge.className = 'player-badge idle';
    const err = r.lastPrepareError?.message;
    $('#player-title').textContent = err ? 'Gagal memuat lagu' : 'Belum ada lagu';
    $('#player-artist').textContent = err
      ? `${r.lastPrepareError.title || ''}: ${err.slice(0, 120)}`
      : '—';
    $('#player-requester').textContent = '🙋 —';
    thumb.classList.remove('visible');
    thumb.removeAttribute('src');
    fallback.style.display = 'flex';
    stopAudio(audio);
    lastTrackId = null;
    lastThumbTrackId = null;
    return;
  }

  badge.textContent = 'LIVE';
  badge.className = 'player-badge live';
  $('#player-title').textContent = cur.title || 'Unknown';
  $('#player-artist').textContent = cur.author || 'Unknown';
  $('#player-requester').textContent = `🙋 ${cur.requestedBy || '-'}`;
  updatePlayerThumbnail(cur, thumb, fallback);

  const stream = `${base}${r.streamPath || '/radio/live.mp3'}`;
  const reloadKey = `${epoch ?? 0}:${cur.id}`;
  if (lastTrackId !== reloadKey) {
    lastTrackId = reloadKey;
    stopAudio(audio);
    audio.src = `${stream}?epoch=${epoch ?? 0}&id=${cur.id}&t=${Date.now()}`;
    audio.play().catch(() => {});
  }
}

function radioPreparingLabel(r) {
  const next = r.queue?.[0];
  return next ? `Berikutnya: ${next.title}` : 'Tunggu sebentar';
}

function renderStatus(d) {
  $('#conn-badge').textContent = 'online';
  $('#conn-badge').className = 'badge online';

  $('#hero-bot-name').textContent = d.bot || 'LuxxBot';
  $('#hero-uptime').textContent = `Uptime ${d.uptime} · RAM ${d.ramMb} MB`;

  const cur = d.radio?.current;
  const pill = $('#hero-pill');
  if (cur) pill.textContent = `▶ ${cur.title.slice(0, 32)}${cur.title.length > 32 ? '…' : ''}`;
  else if (d.radio?.isPreparing) pill.textContent = '⏳ Memuat...';
  else if (d.sleeping) pill.textContent = '🛌 Tidur';
  else pill.textContent = '⚡ Online';

  $('#status-grid').innerHTML = [
    ['Bot', d.bot], ['Uptime', d.uptime], ['RAM', `${d.ramMb} MB`], ['Host', d.host],
    ['Mode', d.sleeping ? 'Tidur' : 'Online'], ['Self', d.selfMode ? 'On' : 'Off'],
    ['Anti-Link', d.antiLink ? 'ON' : 'OFF']
  ].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');

  const disc = d.discord || {};
  $('#discord-box').innerHTML = `
    Server: <strong>${disc.guildCount || 0}</strong><br>
    Voice: ${disc.inVoice ? disc.voiceChannel : 'Belum connect'}<br>
    Slash: ${disc.slashReady ? '✅' : '⏳'}
    ${disc.inviteUrl ? `<br><a href="${disc.inviteUrl}" target="_blank" rel="noopener" style="color:var(--pink3)">Invite →</a>` : ''}`;

  const w = d.watch || {};
  const watchBase = cfg().base || '';
  const watchUrl = w.watchUrl || `${watchBase}/watch`;
  $('#watch-open-link').href = watchUrl;
  const pb = w.playback || {};
  const elapsed = typeof pb.now === 'number'
    ? pb.now
    : (pb.position || 0) + (pb.playing ? (Date.now() - (pb.updatedAt || Date.now())) / 1000 : 0);
  const mins = Math.floor(elapsed / 60);
  const secs = Math.floor(elapsed % 60).toString().padStart(2, '0');
  $('#watch-box').innerHTML = `
    Penonton: <strong>${w.viewerCount || 0}</strong><br>
    Film: ${w.film ? `<strong>${w.film.title}</strong>` : '—'}<br>
    Playback: ${w.film ? `${pb.playing ? '▶' : '⏸'} ${mins}:${secs}${pb.by ? ` · ${pb.by}` : ''}` : '—'}<br>
    Antrian: ${(w.queue || []).length} film<br>
    <span class="muted">User pakai !watch → login username saja</span>`;

  const r = d.radio || {};
  renderPlayer(r, cfg().base);

  const q = r.queue || [];
  $('#queue-list').innerHTML = q.length
    ? q.map((t, i) => {
        const thumb = t.thumbnail
          ? `<img src="${t.thumbnail}" alt="" class="queue-thumb" onerror="this.style.display='none'"/>`
          : '';
        return `<li>${thumb}<div><strong>${i + 1}.</strong> ${t.title}<br><span class="muted">🙋 ${t.requestedBy}</span></div></li>`;
      }).join('')
    : '<li class="muted">Antrian kosong</li>';
}

async function refresh() {
  try {
    renderStatus(await api('/status'));
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

  if (base.includes('github.io')) {
    showLoginError('API Base URL salah — itu link Pages. Isi http://localhost:3920 atau URL tunnel bot.');
    return;
  }

  localStorage.setItem('luxx_api_base', base);
  localStorage.setItem('luxx_api_token', token);

  const btn = $('#btn-login');
  btn.disabled = true;
  btn.textContent = 'Menghubungkan...';

  try {
    await api('/status');
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    refresh();
    if (!window._poll) window._poll = setInterval(refresh, 5000);
  } catch (e) {
    showLoginError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Masuk Dashboard';
  }
}

$('#btn-login').addEventListener('click', doLogin);
$('#btn-local').addEventListener('click', () => {
  $('#api-base').value = defaultLocalBase();
  showToast('Diisi: http://localhost:3920');
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
  resetPlayerState();
  try {
    const r = await api('/skip', 'POST');
    if (r.streamEpoch != null) lastStreamEpoch = r.streamEpoch;
    showToast(r.message || 'OK');
    await refresh();
  } catch (e) { showToast(e.message); }
});
$('#btn-clear').addEventListener('click', async () => {
  if (!confirm('Kosongkan antrian?')) return;
  resetPlayerState();
  try {
    const r = await api('/clear', 'POST');
    if (r.streamEpoch != null) lastStreamEpoch = r.streamEpoch;
    showToast('Antrian dikosongkan');
    await refresh();
  } catch (e) { showToast(e.message); }
});
$('#btn-restart').addEventListener('click', async () => {
  if (!confirm('Restart bot?')) return;
  try { await api('/restart', 'POST'); showToast('Restart diminta'); }
  catch (e) { showToast(e.message); }
});
$('#btn-watch-skip').addEventListener('click', async () => {
  try {
    const r = await api('/watch/skip', 'POST');
    showToast(r.ok ? 'Skip watch OK' : (r.error || 'Gagal'));
    await refresh();
  } catch (e) { showToast(e.message); }
});
$('#btn-watch-stop').addEventListener('click', async () => {
  if (!confirm('Hentikan film yang sedang diputar?')) return;
  try {
    await api('/watch/stop', 'POST');
    showToast('Pemutaran dihentikan');
    await refresh();
  } catch (e) { showToast(e.message); }
});
$('#btn-watch-clear-q').addEventListener('click', async () => {
  if (!confirm('Kosongkan antrian watch?')) return;
  try {
    await api('/watch/clear-queue', 'POST');
    showToast('Antrian watch dikosongkan');
    await refresh();
  } catch (e) { showToast(e.message); }
});

const savedBase = localStorage.getItem('luxx_api_base');
const savedToken = localStorage.getItem('luxx_api_token');
$('#api-base').value = savedBase || defaultLocalBase();
if (savedToken) $('#api-token').value = savedToken;