const $ = (s) => document.querySelector(s);

function apiRoot() {
  return `${window.location.origin}/watch/api`;
}

let sessionId = localStorage.getItem('luxx_watch_sid') || '';
let username = localStorage.getItem('luxx_watch_user') || '';
let pollTimer = null;
let playbackReportTimer = null;
let voiceSince = 0;
let localStream = null;
let joining = false;
let lastFilmKey = '';
let lastPlaybackUpdatedAt = 0;
let embedFallbackList = [];
let embedFallbackIdx = 0;
let embedLoadTimer = null;
let suppressPlaybackReport = false;
let lastChatLen = 0;
let activeGenre = '';
let activeGenreName = '';
let genresLoaded = false;
let catalogPage = 1;
let catalogTotalPages = 1;
let catalogSort = 'newest';
let catalogMode = 'latest';
let catalogQuery = '';
let hlsInstance = null;
let playerMountGen = 0;
let currentFilmForPlayer = null;
let progressBound = false;
let finishReported = false;
const peers = new Map();
const voicePeers = new Set();

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setServerBanner(msg, type = 'warn') {
  const el = $('#server-banner');
  if (!el) return;
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.className = `server-banner ${type}`;
  el.classList.remove('hidden');
}

function setServerStatus(msg, ok) {
  const el = $('#server-status');
  if (!el) return;
  el.textContent = msg;
  el.className = ok ? 'server-status ok' : 'server-status err';
}

async function checkServerHealth() {
  const url = `${apiRoot()}/health`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error('Server tidak siap');
    setServerBanner('');
    setServerStatus('Server online — silakan masuk dengan username', true);
    return true;
  } catch (_) {
    setServerBanner(
      'Server tidak terjangkau. Minta owner kirim !watch lagi (link baru), lalu refresh.',
      'error'
    );
    setServerStatus('Server offline — minta link !watch terbaru dari bot', false);
    return false;
  }
}

async function api(path, method = 'GET', body, retries = 2) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' };
  if (body) opts.body = JSON.stringify(body);
  const url = `${apiRoot()}${path}`;

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setServerBanner('');
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    }
  }
  setServerBanner(
    'Koneksi ke server putus. Cek tunnel/bot owner lalu refresh.',
    'error'
  );
  throw new Error(lastErr?.message || 'Gagal hubungi server. Pastikan bot & tunnel masih hidup.');
}

function toast(msg, ms = 3200) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function showLoginError(msg) {
  const el = $('#login-error');
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showApp() {
  $('#login-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
}

function showLogin() {
  $('#app-screen').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
}

function effectivePlayback(pb) {
  if (!pb) return 0;
  if (typeof pb.now === 'number') return pb.now;
  if (!pb.playing) return pb.position || 0;
  return (pb.position || 0) + (Date.now() - (pb.updatedAt || Date.now())) / 1000;
}

function formatElapsed(sec) {
  const total = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function formatProgressLabel(sec, duration) {
  const pos = formatElapsed(sec);
  if (!duration || !Number.isFinite(duration) || duration <= 0) return pos;
  const pct = Math.min(100, Math.max(0, (sec / duration) * 100));
  return `${pos} / ${formatElapsed(duration)} · ${Math.round(pct)}%`;
}

function formatChatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function filmIdentity(film) {
  return film?.key || film?.pageUrl || film?.embedUrl || film?.videoUrl || film?.title || '';
}

function destroyHls() {
  if (hlsInstance) {
    try { hlsInstance.destroy(); } catch (_) {}
    hlsInstance = null;
  }
}

function showProgressUi(show) {
  $('#player-progress-ui')?.classList.toggle('hidden', !show);
}

function updateProgressBar() {
  const video = $('#player-video');
  const fill = $('#progress-fill');
  const thumb = $('#progress-thumb');
  const elapsed = $('#progress-elapsed');
  const duration = $('#progress-duration');
  if (!video || video.classList.contains('hidden') || !fill) return;

  const cur = video.currentTime || 0;
  const dur = video.duration;
  const validDur = Number.isFinite(dur) && dur > 0 ? dur : 0;
  const pct = validDur ? Math.min(100, (cur / validDur) * 100) : 0;

  fill.style.width = `${pct}%`;
  if (thumb) thumb.style.left = `${pct}%`;
  if (elapsed) elapsed.textContent = formatElapsed(cur);
  if (duration) duration.textContent = validDur ? formatElapsed(validDur) : '--:--';
}

function showProgressTooltip(clientX) {
  const video = $('#player-video');
  const track = $('#progress-track');
  const tip = $('#progress-tooltip');
  if (!video || !track || !tip || video.classList.contains('hidden')) return;

  const rect = track.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const hoverSec = dur ? ratio * dur : 0;

  tip.textContent = dur
    ? formatProgressLabel(hoverSec, dur)
    : formatElapsed(hoverSec);
  tip.style.left = `${ratio * 100}%`;
  tip.classList.remove('hidden');
}

function hideProgressTooltip() {
  $('#progress-tooltip')?.classList.add('hidden');
}

function seekFromProgress(clientX) {
  const video = $('#player-video');
  const track = $('#progress-track');
  if (!video || !track || video.classList.contains('hidden')) return;
  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  if (!dur) return;

  const rect = track.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const target = ratio * dur;
  suppressPlaybackReport = true;
  try { video.currentTime = target; } catch (_) {}
  updateProgressBar();
  reportPlayback();
  setTimeout(() => { suppressPlaybackReport = false; }, 350);
}

function bindProgressEvents() {
  if (progressBound) return;
  const track = $('#progress-track');
  if (!track) return;
  progressBound = true;

  track.addEventListener('mousemove', (e) => showProgressTooltip(e.clientX));
  track.addEventListener('mouseleave', hideProgressTooltip);
  track.addEventListener('click', (e) => seekFromProgress(e.clientX));
  track.addEventListener('touchstart', (e) => {
    const t = e.touches?.[0];
    if (t) {
      showProgressTooltip(t.clientX);
      seekFromProgress(t.clientX);
    }
  }, { passive: true });
  track.addEventListener('keydown', (e) => {
    const video = $('#player-video');
    if (!video || video.classList.contains('hidden')) return;
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (!dur) return;
    const step = e.shiftKey ? 60 : 10;
    let next = video.currentTime || 0;
    if (e.key === 'ArrowRight') next = Math.min(dur, next + step);
    else if (e.key === 'ArrowLeft') next = Math.max(0, next - step);
    else return;
    e.preventDefault();
    suppressPlaybackReport = true;
    try { video.currentTime = next; } catch (_) {}
    updateProgressBar();
    reportPlayback();
    setTimeout(() => { suppressPlaybackReport = false; }, 350);
  });
}

function showPlayerEmpty() {
  playerMountGen += 1;
  clearEmbedLoadTimer();
  destroyHls();
  currentFilmForPlayer = null;
  showProgressUi(false);
  const iframe = $('#player');
  const video = $('#player-video');
  const sw = $('#server-switcher');
  if (iframe) {
    iframe.src = 'about:blank';
    iframe.classList.add('hidden');
  }
  if (video) {
    video.pause?.();
    video.classList.add('hidden');
    video.removeAttribute('src');
    video.load?.();
  }
  if (sw) sw.classList.add('hidden');
  $('#player-loading')?.classList.add('hidden');
  $('#player-empty')?.classList.remove('hidden');
  renderFilmDetails(null);
  lastFilmKey = '';
  lastPlaybackUpdatedAt = 0;
}

function showPlayerLoading() {
  $('#player-empty')?.classList.add('hidden');
  $('#player-loading')?.classList.remove('hidden');
  $('#player')?.classList.add('hidden');
  $('#player-video')?.classList.add('hidden');
  const sw = $('#server-switcher');
  if (sw) sw.classList.add('hidden');
}

function isVidplayerUrl(url = '') {
  return /vidplayer\.live/i.test(url);
}

function buildEmbedSources(film) {
  if (!film) return [];
  const list = [];
  const push = (u) => {
    const resolved = resolvePlayerUrl(u);
    if (resolved && !list.includes(resolved)) list.push(resolved);
  };

  push(film.playEmbedUrl);
  for (const u of film.playEmbedFallbacks || []) push(u);
  return list;
}

function playerEmbedSrc(film) {
  return buildEmbedSources(film)[0] || '';
}

function resolvePlayerUrl(raw) {
  if (!raw) return '';
  if (raw.startsWith('http')) return raw;
  return `${location.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function clearEmbedLoadTimer() {
  if (embedLoadTimer) {
    clearTimeout(embedLoadTimer);
    embedLoadTimer = null;
  }
}

function tryNextEmbed(film, gen = playerMountGen) {
  embedFallbackIdx += 1;
  if (embedFallbackIdx >= embedFallbackList.length) {
    toast('Semua server gagal. Coba film lain atau refresh.');
    $('#player-loading')?.classList.add('hidden');
    return;
  }
  const iframe = $('#player');
  const next = resolvePlayerUrl(embedFallbackList[embedFallbackIdx]);
  toast(`Mencoba server ${embedFallbackIdx + 1}...`);
  $('#player-loading')?.classList.remove('hidden');
  iframe.onload = () => markPlayerReady(gen);
  iframe.onerror = () => { if (gen === playerMountGen) tryNextEmbed(film, gen); };
  iframe.src = 'about:blank';
  requestAnimationFrame(() => {
    if (gen !== playerMountGen) return;
    iframe.src = next;
    scheduleEmbedWatch(film, gen);
  });
}

function embedLoadTimeoutMs() {
  return 12000; // faster auto-advance
}

function scheduleEmbedWatch(film, gen = playerMountGen) {
  clearEmbedLoadTimer();
  embedLoadTimer = setTimeout(() => {
    if (gen !== playerMountGen) return;
    if (embedFallbackIdx < embedFallbackList.length - 1) {
      tryNextEmbed(film, gen);
    } else {
      toast('Player lambat dimuat — coba film lain atau refresh.');
    }
  }, embedLoadTimeoutMs());
}

function fallbackToEmbed(film, reason) {
  const sources = buildEmbedSources(film);
  if (!sources.length) {
    toast(reason || 'Stream gagal. Coba film lain.');
    return false;
  }
  toast('Stream HLS gagal — mencoba player embed...');
  return mountEmbedPlayer(film);
}

function markPlayerReady(gen) {
  if (gen !== playerMountGen) return;
  $('#player-loading')?.classList.add('hidden');
  $('#player-empty')?.classList.add('hidden');
}

function mountHlsPlayer(film, gen = playerMountGen) {
  const video = $('#player-video');
  const iframe = $('#player');
  const src = resolvePlayerUrl(film.playVideoUrl || '');
  if (!video || !src) return fallbackToEmbed(film, 'URL stream kosong.');

  destroyHls();
  iframe.src = 'about:blank';
  iframe.classList.add('hidden');
  showProgressUi(false);
  $('#player-empty')?.classList.add('hidden');
  $('#player-loading')?.classList.remove('hidden');

  video.classList.remove('hidden');
  video.removeAttribute('src');
  video.load?.();
  currentFilmForPlayer = film;
  const sw = $('#server-switcher'); if (sw) sw.classList.add('hidden');

  const onReady = () => {
    markPlayerReady(gen);
    showProgressUi(true);
    bindProgressEvents();
    updateProgressBar();
  };

  if (window.Hls?.isSupported()) {
    hlsInstance = new window.Hls({ enableWorker: true, lowLatencyMode: false });
    hlsInstance.loadSource(src);
    hlsInstance.attachMedia(video);
    hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, onReady);
    hlsInstance.on(window.Hls.Events.ERROR, (_, data) => {
      if (gen !== playerMountGen) return;
      if (!data?.fatal) return;
      destroyHls();
      fallbackToEmbed(film, 'Stream HLS putus.');
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', () => {
      if (gen !== playerMountGen) return;
      fallbackToEmbed(film, 'Stream gagal dimuat.');
    }, { once: true });
    video.load();
  } else {
    return fallbackToEmbed(film, 'Browser tidak mendukung streaming ini.');
  }
  return true;
}

function mountEmbedPlayer(film, gen = playerMountGen) {
  const iframe = $('#player');
  const video = $('#player-video');
  embedFallbackList = buildEmbedSources(film);
  embedFallbackIdx = 0;
  const src = resolvePlayerUrl(embedFallbackList[0]);
  if (!src) {
    toast('Player tidak ditemukan. Coba film lain.');
    return false;
  }

  destroyHls();
  showProgressUi(false);
  $('#player-empty')?.classList.add('hidden');
  $('#player-loading')?.classList.remove('hidden');

  video.pause?.();
  video.classList.add('hidden');
  video.removeAttribute('src');
  video.load?.();

  currentFilmForPlayer = film;

  const playOverlay = $('#player-play-overlay');
  const serverSwitcher = $('#server-switcher');

  // Setup server switcher (show even for 2+ servers)
  if (serverSwitcher) {
    const total = Math.min(embedFallbackList.length, 3);
    serverSwitcher.classList.toggle('hidden', total <= 1);
    serverSwitcher.querySelectorAll('.server-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === 0 && i < total);
      btn.style.display = i < total ? '' : 'none';
      btn.onclick = () => {
        if (i >= embedFallbackList.length) return;
        embedFallbackIdx = i;
        const nextSrc = resolvePlayerUrl(embedFallbackList[i]);
        serverSwitcher.querySelectorAll('.server-btn').forEach((b, j) => b.classList.toggle('active', j === i));
        loadEmbedSrc(iframe, nextSrc, gen);
        if (playOverlay) playOverlay.classList.add('hidden');
      };
    });
  }

  iframe.onload = () => {
    markPlayerReady(gen);
    if (playOverlay) playOverlay.classList.add('hidden');
  };
  iframe.onerror = () => {
    if (gen !== playerMountGen) return;
    tryNextEmbed(film, gen);
  };

  // Show overlay for first load (user gesture for autoplay)
  if (playOverlay) {
    playOverlay.classList.remove('hidden');
    playOverlay.onclick = () => {
      playOverlay.classList.add('hidden');
      loadEmbedSrc(iframe, src, gen);
    };
  }

  iframe.src = 'about:blank';
  iframe.classList.remove('hidden');

  // Start a timeout watcher for auto-advance
  scheduleEmbedWatch(film, gen);
  return true;
}

function loadEmbedSrc(iframe, src, gen) {
  if (!src || !iframe) return;
  $('#player-loading')?.classList.remove('hidden');
  iframe.onload = () => markPlayerReady(gen);
  iframe.src = 'about:blank';
  requestAnimationFrame(() => {
    if (gen !== playerMountGen) return;
    iframe.src = src;
  });
}

function playerVideoSrc(film) {
  return film?.playVideoUrl || '';
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function avatarLetter(name) {
  const n = String(name || '?').trim();
  return (n[0] || '?').toUpperCase();
}

function isSystemUser(name) {
  return /^(🌸|📺|📋|⏭️)/.test(name) || name === 'LuxxBot';
}

function renderFilmDetails(film) {
  const panel = $('#film-details');
  if (!panel) return;

  const d = film?.details;
  const hasInfo = d && Object.values(d).some((v) => String(v || '').trim());
  if (!film || !hasInfo) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  const chips = [];
  if (d.year) chips.push(d.year);
  if (d.country) chips.push(d.country);
  if (d.duration) chips.push(d.duration);
  if (d.quality) chips.push(d.quality);
  if (d.genres) {
    for (const g of d.genres.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4)) {
      if (!chips.includes(g)) chips.push(g);
    }
  }

  panel.innerHTML = `
    ${chips.length ? `<div class="film-chips">${chips.map((c) => `<span class="film-chip">${esc(c)}</span>`).join('')}</div>` : ''}
    ${d.synopsis ? `<p class="film-synopsis">${esc(d.synopsis)}</p>` : ''}
    ${d.directors ? `<p class="film-credit"><span>Sutradara</span>${esc(d.directors)}</p>` : ''}
    ${d.cast ? `<p class="film-credit"><span>Pemeran</span>${esc(d.cast)}</p>` : ''}
  `.trim();
  panel.classList.remove('hidden');
}

function applyPlaybackSync(room) {
  const film = room?.film;
  const pb = room?.playback;
  if (!film || !pb) return;

  const key = filmIdentity(film);
  if (key !== lastFilmKey) {
    lastFilmKey = key;
    lastPlaybackUpdatedAt = 0;
  }

  const video = $('#player-video');
  if (film.videoUrl && video && !video.classList.contains('hidden')) {
    if ((pb.updatedAt || 0) > lastPlaybackUpdatedAt) {
      lastPlaybackUpdatedAt = pb.updatedAt || 0;
      const target = effectivePlayback(pb);
      suppressPlaybackReport = true;
      if (Math.abs((video.currentTime || 0) - target) > 1.2) {
        try { video.currentTime = target; } catch (_) {}
      }
      if (pb.playing && video.paused) video.play().catch(() => {});
      else if (!pb.playing && !video.paused) video.pause();
      setTimeout(() => { suppressPlaybackReport = false; }, 350);
    }
  }

  const meta = $('#now-meta');
  const base = film.hls || film.playUseHls ? 'Stream'
    : film.embedUrl ? (film.source === 'rebahin' ? 'Rebahin' : 'Player')
    : 'Player';
  if (pb.playing) {
    meta.textContent = `${base} · ⏱ ${formatElapsed(effectivePlayback(pb))} bareng`;
    if (pb.by) meta.textContent += ` · ${pb.by}`;
  } else {
    meta.textContent = `${base} · klik ▶ play di layar untuk mulai nonton bareng`;
    if (pb.by) meta.textContent += ` · dipilih ${pb.by}`;
  }
}

function renderChat(chat) {
  const el = $('#chat-list');
  const countEl = $('#chat-count');
  const list = chat || [];
  const userCount = list.filter((c) => !isSystemUser(c.username)).length;
  countEl.textContent = `${userCount} pesan`;

  if (!list.length) {
    el.innerHTML = `
      <div class="chat-empty">
        <span class="chat-empty-icon">💬</span>
        <p>Belum ada pesan</p>
        <small class="muted">Sapa penonton lain di bawah!</small>
      </div>`;
    lastChatLen = 0;
    return;
  }

  el.innerHTML = list.map((c) => {
    const mine = c.username === username;
    const system = isSystemUser(c.username);
    if (system) {
      return `
        <div class="chat-msg system">
          <div class="chat-system-pill">
            <span class="chat-system-icon">📢</span>
            <span class="chat-system-text">${esc(c.text)}</span>
            <time>${formatChatTime(c.at)}</time>
          </div>
        </div>`;
    }
    return `
      <div class="chat-msg ${mine ? 'mine' : 'other'}">
        ${mine ? '' : `<div class="chat-avatar" aria-hidden="true">${esc(avatarLetter(c.username))}</div>`}
        <div class="chat-bubble">
          <div class="chat-meta">
            <strong>${esc(c.username)}</strong>
            <time>${formatChatTime(c.at)}</time>
          </div>
          <p class="chat-text">${esc(c.text)}</p>
        </div>
        ${mine ? `<div class="chat-avatar mine-avatar" aria-hidden="true">${esc(avatarLetter(c.username))}</div>` : ''}
      </div>`;
  }).join('');

  if (list.length !== lastChatLen) {
    el.scrollTop = el.scrollHeight;
    lastChatLen = list.length;
  }
}

function renderRoom(room) {
  if (!room) return;
  $('#viewer-badge').textContent = `👥 ${room.viewerCount || 0}`;

  const discordBtn = $('#btn-discord');
  if (room.discordInvite) {
    discordBtn.href = room.discordInvite;
    discordBtn.textContent = room.discordServerName ? `Discord` : 'Discord';
    discordBtn.title = room.discordServerName ? `Gabung ${room.discordServerName}` : 'Gabung server Discord';
  }

  const film = room.film;
  const iframe = $('#player');
  const video = $('#player-video');
  const empty = $('#player-empty');
  const embedSrc = film ? playerEmbedSrc(film) : '';
  const videoSrc = film ? playerVideoSrc(film) : '';
  const hasHls = !!(film?.hls || film?.playUseHls) && !!videoSrc;
  const hasEmbed = !!embedSrc && !hasHls;
  const hasVideo = !!film?.videoUrl && !!videoSrc && !hasHls;

  if (hasHls || hasEmbed || hasVideo) {
    $('#now-title').textContent = film.title || 'Film';
    renderFilmDetails(film);
    const poster = $('#now-poster');
    if (film.poster) {
      poster.src = film.poster;
      poster.classList.remove('hidden');
    } else {
      poster.classList.add('hidden');
    }

    const key = filmIdentity(film);
    if (key !== lastFilmKey) {
      playerMountGen += 1;
      const gen = playerMountGen;
      finishReported = false;
      showPlayerLoading();
      lastFilmKey = key;
      lastPlaybackUpdatedAt = 0;
      if (hasHls) {
        mountHlsPlayer(film, gen);
      } else if (hasEmbed) {
        mountEmbedPlayer(film, gen);
      } else if (hasVideo) {
        clearEmbedLoadTimer();
        destroyHls();
        iframe.src = 'about:blank';
        iframe.classList.add('hidden');
        empty.classList.add('hidden');
        currentFilmForPlayer = film;
        const fullVideo = videoSrc.startsWith('http') ? videoSrc : `${location.origin}${videoSrc}`;
        video.removeAttribute('src');
        video.src = fullVideo;
        video.load();
        video.classList.remove('hidden');
        const sw = $('#server-switcher'); if (sw) sw.classList.add('hidden');
        video.addEventListener('loadedmetadata', () => {
          markPlayerReady(gen);
          showProgressUi(true);
          bindProgressEvents();
          updateProgressBar();
        }, { once: true });
      }
    }
  } else {
    showPlayerEmpty();
    $('#now-title').textContent = 'Belum ada film';
    $('#now-meta').textContent = 'Pilih film di katalog lalu klik ▶ Putar';
    $('#now-poster').classList.add('hidden');
    renderFilmDetails(null);
  }

  applyPlaybackSync(room);
  renderChat(room.chat);

  $('#queue-list').innerHTML = (room.queue || []).length
    ? room.queue.map((q, i) => `<li><span class="q-num">${i + 1}</span><span>${esc(q.title)}</span><small class="muted">${esc(q.by)}</small></li>`).join('')
    : '<li class="muted">Belum ada antrian</li>';

  $('#viewers-list').innerHTML = (room.viewers || []).length
    ? room.viewers.map((v) => `<li><span class="dot-online"></span>${esc(v.username)}${v.username === username ? ' <small>(kamu)</small>' : ''}</li>`).join('')
    : '<li class="muted">Kamu yang pertama!</li>';
}

async function reportPlayback() {
  if (suppressPlaybackReport || !sessionId) return;
  const video = $('#player-video');
  if (!video || video.classList.contains('hidden')) return;
  try {
    await api('/ping', 'POST', {
      sessionId,
      reportPlayback: true,
      position: video.currentTime || 0,
      playing: !video.paused
    });
  } catch (_) {}
}

async function poll() {
  if (!sessionId) return;
  try {
    const d = await api('/ping', 'POST', { sessionId });
    renderRoom(d.room);
    $('#conn-badge').textContent = 'live';
    $('#conn-badge').className = 'badge online';
  } catch (e) {
    $('#conn-badge').textContent = 'reconnect';
    $('#conn-badge').className = 'badge offline';
  }
}

async function joinRoom() {
  if (joining) return;
  const name = ($('#username')?.value || '').trim();
  showLoginError('');
  if (name.length < 2) {
    showLoginError('Username minimal 2 karakter.');
    return;
  }

  const btn = $('#btn-join');
  joining = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Menyambung...'; }

  try {
    const d = await api('/join', 'POST', { username: name, sessionId: sessionId || undefined });
    sessionId = d.sessionId;
    username = d.username;
    localStorage.setItem('luxx_watch_sid', sessionId);
    localStorage.setItem('luxx_watch_user', username);
    $('#user-pill').textContent = username;
    showApp();
    renderRoom(d.room);
    if (!pollTimer) pollTimer = setInterval(poll, 2500);
    if (!playbackReportTimer) playbackReportTimer = setInterval(reportPlayback, 2000);
    loadGenres();
    loadLatest();
    toast(`Selamat datang, ${username}!`);
  } catch (e) {
    const msg = e.message || 'Gagal masuk ruang TV.';
    if (/sesi|401|hubungi server|HTTP 5/i.test(msg)) {
      localStorage.removeItem('luxx_watch_sid');
      sessionId = '';
    }
    showLoginError(msg + ' — coba refresh atau minta owner kirim !watch lagi.');
    showLogin();
  } finally {
    joining = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Masuk Ruang TV'; }
  }
}

function readCardData(el) {
  const card = el?.closest?.('.film-card');
  if (!card) return { url: '', title: '', source: '' };
  let url = card.dataset.url || '';
  let title = card.dataset.title || '';
  let source = card.dataset.source || '';
  if (card.dataset.film) {
    try {
      const parsed = JSON.parse(card.dataset.film);
      url = parsed.url || url;
      title = parsed.title || title;
      source = parsed.source || source;
    } catch (_) {}
  }
  return { url, title, source };
}

function bindCatalogCards() {
  const catalog = $('#catalog');
  if (!catalog || catalog._luxxDelegated) return;
  catalog._luxxDelegated = true;
  catalog.addEventListener('click', (e) => {
    const playBtn = e.target.closest('.btn-play');
    const queueBtn = e.target.closest('.btn-queue');
    if (!playBtn && !queueBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const { url, title } = readCardData(playBtn || queueBtn);
    if (!url) return toast('URL film tidak valid — refresh halaman.');
    if (playBtn) playFilm(url, title);
    else queueFilm(url, title);
  });
}

function renderCatalog(results, emptyMsg) {
  if (!results?.length) {
    $('#catalog').innerHTML = `<p class="muted catalog-empty">${esc(emptyMsg)}</p>`;
    return;
  }
  $('#catalog').innerHTML = results.map((f) => {
    const filmData = esc(JSON.stringify({ url: f.url || '', title: f.title || '', source: f.source || '' }));
    return `
    <div class="film-card" data-film="${filmData}" data-url="${esc(f.url || '')}" data-title="${esc(f.title || '')}" data-source="${esc(f.source || '')}">
      <img src="${esc(f.poster)}" alt="" loading="lazy" onerror="this.classList.add('img-fallback')" />
      <p class="film-title">${esc(f.title)}${f.year ? ` <span class="muted">(${esc(f.year)})</span>` : ''}</p>
      <div class="film-actions">
        <button type="button" class="btn primary btn-play">▶ Putar</button>
        <button type="button" class="btn btn-queue">📋</button>
      </div>
    </div>`;
  }).join('');
}

function setActiveGenre(slug) {
  activeGenre = slug || '';
  document.querySelectorAll('.genre-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.genre === activeGenre);
  });
}

function setCatalogLabel(text) {
  const el = $('#catalog-label');
  if (el) el.textContent = text;
}

function updatePageControls(page, totalPages) {
  catalogPage = page;
  catalogTotalPages = totalPages || 1;
  const indicator = $('#page-indicator');
  const prev = $('#btn-prev-page');
  const next = $('#btn-next-page');
  if (indicator) {
    indicator.textContent = `Hal ${page} / ${catalogTotalPages}`;
  }
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= catalogTotalPages;
}

function updateSortButtons() {
  $('#btn-sort-newest')?.classList.toggle('active', catalogSort === 'newest');
  $('#btn-sort-oldest')?.classList.toggle('active', catalogSort === 'oldest');
}

function applyCatalogResponse(data, label) {
  renderCatalog(data.results, 'Tidak ada film di halaman ini.');
  updatePageControls(data.page || catalogPage, data.totalPages || catalogTotalPages);
  if (label) setCatalogLabel(label);
}

async function loadGenres() {
  if (genresLoaded) return;
  const wrap = $('#genre-chips');
  if (!wrap) return;
  try {
    const d = await api('/genres');
    const chips = (d.genres || []).map((g) =>
      `<button type="button" class="genre-chip" data-genre="${esc(g.slug)}" data-name="${esc(g.name)}">${esc(g.name)}</button>`
    ).join('');
    wrap.innerHTML = `<button type="button" class="genre-chip active" data-genre="">🔥 Terbaru</button>${chips}`;
    wrap.querySelectorAll('.genre-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = btn.dataset.genre || '';
        $('#search-input').value = '';
        if (!slug) loadCatalog({ resetPage: true });
        else { catalogPage = 1; loadGenre(slug, btn.dataset.name || slug); }
      });
    });
    genresLoaded = true;
  } catch (_) {
    wrap.innerHTML = `
      <button type="button" class="genre-chip active" data-genre="">🔥 Terbaru</button>
      <button type="button" class="genre-chip" data-genre="action" data-name="Action">Action</button>
      <button type="button" class="genre-chip" data-genre="horror" data-name="Horror">Horror</button>
      <button type="button" class="genre-chip" data-genre="comedy" data-name="Comedy">Comedy</button>
      <button type="button" class="genre-chip" data-genre="drama" data-name="Drama">Drama</button>
      <button type="button" class="genre-chip" data-genre="romance" data-name="Romance">Romance</button>
      <button type="button" class="genre-chip" data-genre="thriller" data-name="Thriller">Thriller</button>`;
    wrap.querySelectorAll('.genre-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = btn.dataset.genre || '';
        $('#search-input').value = '';
        if (!slug) loadCatalog({ resetPage: true });
        else { catalogPage = 1; loadGenre(slug, btn.dataset.name || slug); }
      });
    });
  }
}

async function loadCatalog({ resetPage = false, page } = {}) {
  if (resetPage) catalogPage = 1;
  if (page) catalogPage = page;
  catalogMode = 'latest';
  catalogQuery = '';
  setActiveGenre('');
  updateSortButtons();
  setCatalogLabel(catalogSort === 'oldest' ? 'Film terlama' : 'Film terbaru');
  $('#catalog').innerHTML = '<p class="muted catalog-empty">Memuat katalog...</p>';
  try {
    const d = await api(`/browse?page=${catalogPage}&sort=${catalogSort}`);
    applyCatalogResponse(d, catalogSort === 'oldest'
      ? `Film terlama · hal ${d.page}/${d.totalPages}`
      : `Film terbaru · hal ${d.page}/${d.totalPages}`);
  } catch (e) {
    $('#catalog').innerHTML = `<p class="muted catalog-empty">${esc(e.message)}</p>`;
  }
}

async function loadLatest() {
  return loadCatalog({ resetPage: true });
}

async function loadGenre(slug, name) {
  catalogMode = 'genre';
  catalogQuery = '';
  activeGenreName = name || slug;
  if (catalogPage < 1) catalogPage = 1;
  setActiveGenre(slug);
  updateSortButtons();
  setCatalogLabel(`Genre: ${name || slug}`);
  $('#catalog').innerHTML = '<p class="muted catalog-empty">Memuat genre...</p>';
  try {
    const d = await api(`/browse?page=${catalogPage}&sort=${catalogSort}&genre=${encodeURIComponent(slug)}`);
    applyCatalogResponse(d, `Genre ${name || slug} · hal ${d.page}/${d.totalPages}`);
  } catch (e) {
    $('#catalog').innerHTML = `<p class="muted catalog-empty">${esc(e.message)}</p>`;
  }
}

async function searchFilms({ resetPage = true, page } = {}) {
  const q = ($('#search-input')?.value || '').trim();
  if (!q) return loadCatalog({ resetPage: true });
  if (resetPage) catalogPage = 1;
  if (page) catalogPage = page;
  catalogMode = 'search';
  catalogQuery = q;
  setActiveGenre('');
  updateSortButtons();
  setCatalogLabel(`Hasil: "${q}"`);
  $('#catalog').innerHTML = '<p class="muted catalog-empty">Mencari...</p>';
  try {
    const d = await api(`/search?q=${encodeURIComponent(q)}&page=${catalogPage}`);
    renderCatalog(d.results, 'Tidak ada hasil. Coba judul lain atau pilih genre.');
    updatePageControls(d.page || catalogPage, Math.max(d.page || 1, catalogPage + (d.results?.length ? 1 : 0)));
    setCatalogLabel(`Pencarian "${q}" · hal ${catalogPage}`);
  } catch (e) {
    $('#catalog').innerHTML = `<p class="muted catalog-empty">${esc(e.message)}</p>`;
  }
}

async function reloadCatalogPage(page) {
  if (catalogMode === 'search') return searchFilms({ resetPage: false, page });
  if (catalogMode === 'genre' && activeGenre) return loadGenre(activeGenre, activeGenreName || activeGenre);
  return loadCatalog({ page });
}

function setCatalogSort(sort) {
  catalogSort = sort === 'oldest' ? 'oldest' : 'newest';
  updateSortButtons();
  reloadCatalogPage(1);
}

async function playFilm(url, title) {
  if (!sessionId) return toast('Sesi habis — login ulang.');
  const playUrl = String(url || '').trim();
  if (!playUrl || !/^https?:\/\/.+\/.+/.test(playUrl)) {
    return toast('URL film tidak valid — pilih lagi dari katalog.');
  }
  const cards = $('#catalog')?.querySelectorAll('.film-card') || [];
  let source = '';
  cards.forEach((c) => {
    const data = readCardData(c);
    if (data.url === playUrl) source = data.source || '';
    c.classList.toggle('playing', data.url === playUrl);
  });
  showPlayerLoading();
  $('#now-title').textContent = title || 'Memuat...';
  $('#now-meta').textContent = 'Menyiapkan player...';
  try {
    const d = await api('/play', 'POST', { sessionId, url: playUrl, title, source }, 3);
    renderRoom(d.room);
    const film = d.room?.film;
    if (film?.hls || film?.playUseHls || film?.videoUrl) toast(`▶ ${film.title || title} — klik ▶ di player`);
    else if (film?.embedUrl || film?.playEmbedUrl) toast(`▶ ${film.title || title} — klik play di layar`);
    else toast(`Memutar: ${title}`);
  } catch (e) {
    $('#player-loading')?.classList.add('hidden');
    cards.forEach((c) => c.classList.remove('playing'));
    try { await poll(); } catch (_) {}
    toast(e.message || 'Gagal memutar film — coba judul lain.');
  }
}

async function queueFilm(url, title) {
  if (!sessionId) return toast('Sesi habis — login ulang.');
  try {
    const d = await api('/queue', 'POST', { sessionId, url, title });
    renderRoom(d.room);
    toast(`Ditambah ke antrian: ${title}`);
  } catch (e) {
    toast(e.message);
  }
}

async function skipFilm() {
  if (!sessionId) return toast('Sesi habis — login ulang.');
  showPlayerLoading();
  try {
    const d = await api('/skip', 'POST', { sessionId });
    renderRoom(d.room);
    const nextTitle = d.room?.film?.title;
    toast(nextTitle ? `Skip → ${nextTitle}` : 'Skip ke film berikutnya');
  } catch (e) {
    $('#player-loading')?.classList.add('hidden');
    toast(e.message || 'Gagal skip — tambahkan film ke antrian dulu.');
  }
}

async function sendChat() {
  const text = $('#chat-input').value.trim();
  if (!text || !sessionId) return;
  try {
    await api('/chat', 'POST', { sessionId, text });
    $('#chat-input').value = '';
    await poll();
  } catch (e) {
    toast(e.message);
  }
}

function updateVoiceUsers() {
  const el = $('#voice-users');
  const names = [...voicePeers];
  if (localStream) names.unshift(`${username} (kamu)`);
  el.innerHTML = names.length
    ? names.map((n) => `<li><span class="dot-voice"></span>${esc(n)}</li>`).join('')
    : '<li class="muted">Belum ada yang pakai voice</li>';
}

async function sendVoiceSignal(to, data) {
  try {
    await api('/voice/signal', 'POST', { sessionId, to, data });
  } catch (_) {}
}

async function pollVoiceSignals() {
  if (!sessionId) return;
  try {
    const d = await api(`/voice/signals?sessionId=${sessionId}&since=${voiceSince}`);
    for (const sig of d.signals || []) {
      voiceSince = Math.max(voiceSince, sig.at);
      if (sig.from === sessionId) continue;
      if (sig.data?.type === 'hello' && sig.data?.name) {
        voicePeers.add(sig.data.name);
        updateVoiceUsers();
      }
      await handleVoiceSignal(sig);
    }
  } catch (_) {}
}

function getPeer(remoteId, { send = true } = {}) {
  if (peers.has(remoteId)) return peers.get(remoteId);
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  if (localStream && send) {
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  } else {
    pc.addTransceiver('audio', { direction: send ? 'sendrecv' : 'recvonly' });
  }
  pc.ontrack = (e) => {
    let audio = document.getElementById(`audio-${remoteId}`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `audio-${remoteId}`;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.setAttribute('playsinline', '');
      document.body.appendChild(audio);
    }
    audio.srcObject = e.streams[0];
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) sendVoiceSignal(remoteId, { candidate: e.candidate });
  };
  peers.set(remoteId, pc);
  return pc;
}

async function handleVoiceSignal(sig) {
  if (sig.data?.type === 'hello' && sig.from !== sessionId) {
    const pc = getPeer(sig.from, { send: !!localStream });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendVoiceSignal(sig.from, { type: 'offer', sdp: offer.sdp });
    return;
  }
  if (sig.data?.type === 'offer' && sig.data.sdp) {
    const pc = getPeer(sig.from, { send: !!localStream });
    await pc.setRemoteDescription(sig.data);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendVoiceSignal(sig.from, { type: 'answer', sdp: answer.sdp });
  } else if (sig.data?.type === 'answer' && sig.data.sdp) {
    const pc = peers.get(sig.from);
    if (pc) await pc.setRemoteDescription(sig.data);
  } else if (sig.data?.candidate) {
    const pc = peers.get(sig.from);
    if (pc) try { await pc.addIceCandidate(sig.data.candidate); } catch (_) {}
  }
}

async function startVoice() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Browser tidak mendukung mikrofon.');
    }
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    $('#voice-status').textContent = 'Mic aktif — terhubung ke ruang voice';
    $('#btn-mic-on').classList.add('hidden');
    $('#btn-mic-off').classList.remove('hidden');
    await sendVoiceSignal('*', { type: 'hello', name: username });
    if (!window._voicePoll) window._voicePoll = setInterval(pollVoiceSignals, 1500);
    updateVoiceUsers();
  } catch (e) {
    $('#voice-status').textContent = `Gagal: ${e.message}`;
    toast('Izinkan akses mikrofon di browser.');
  }
}

function stopVoice() {
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  peers.forEach((pc) => pc.close());
  peers.clear();
  document.querySelectorAll('audio[id^="audio-"]').forEach((a) => a.remove());
  $('#voice-status').textContent = 'Voice dimatikan';
  $('#btn-mic-on').classList.remove('hidden');
  $('#btn-mic-off').classList.add('hidden');
  updateVoiceUsers();
}

function toggleFullscreen() {
  const shell = $('#player-shell');
  if (!shell) return;
  if (!document.fullscreenElement) {
    shell.requestFullscreen?.().catch(() => toast('Fullscreen tidak didukung.'));
  } else {
    document.exitFullscreen?.();
  }
}

function leaveRoom() {
  localStorage.removeItem('luxx_watch_sid');
  localStorage.removeItem('luxx_watch_user');
  sessionId = '';
  username = '';
  clearInterval(pollTimer);
  pollTimer = null;
  clearInterval(playbackReportTimer);
  playbackReportTimer = null;
  clearInterval(window._voicePoll);
  window._voicePoll = null;
  stopVoice();
  voicePeers.clear();
  showLogin();
  $('#username').value = '';
  toast('Kamu keluar dari ruang TV.');
}

async function notifyFilmFinished() {
  if (!sessionId) return;
  try {
    const prevKey = lastFilmKey;
    const d = await api('/ping', 'POST', { sessionId, finished: true });
    const hadNext = !!d.room?.film && filmIdentity(d.room.film) !== prevKey;
    renderRoom(d.room);
    if (hadNext) toast('Film selesai — lanjut ke antrian');
  } catch (_) {}
}

function bindPlaybackEvents() {
  const video = $('#player-video');
  if (!video || video._luxxBound) return;
  video._luxxBound = true;

  const onUserAction = () => {
    if (suppressPlaybackReport) return;
    reportPlayback();
  };
  video.addEventListener('play', onUserAction);
  video.addEventListener('pause', onUserAction);
  video.addEventListener('seeked', onUserAction);
  video.addEventListener('timeupdate', updateProgressBar);
  video.addEventListener('loadedmetadata', updateProgressBar);
  video.addEventListener('ended', () => {
    if (finishReported) return;
    finishReported = true;
    notifyFilmFinished();
  });
  video.addEventListener('error', () => {
    if (currentFilmForPlayer) fallbackToEmbed(currentFilmForPlayer, 'Stream gagal.');
    else toast('Stream gagal. Coba film lain.');
  });
}

function bindEvents() {
  bindCatalogCards();
  bindPlaybackEvents();
  $('#btn-join')?.addEventListener('click', joinRoom);
  $('#username')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('#btn-search')?.addEventListener('click', searchFilms);
  $('#btn-latest')?.addEventListener('click', () => {
    $('#search-input').value = '';
    loadCatalog({ resetPage: true });
  });
  $('#btn-sort-newest')?.addEventListener('click', () => setCatalogSort('newest'));
  $('#btn-sort-oldest')?.addEventListener('click', () => setCatalogSort('oldest'));
  $('#btn-prev-page')?.addEventListener('click', () => {
    if (catalogPage > 1) reloadCatalogPage(catalogPage - 1);
  });
  $('#btn-next-page')?.addEventListener('click', () => {
    if (catalogPage < catalogTotalPages) reloadCatalogPage(catalogPage + 1);
  });
  $('#search-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchFilms(); });
  $('#btn-chat')?.addEventListener('click', sendChat);
  $('#chat-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
  $('#btn-leave')?.addEventListener('click', leaveRoom);
  $('#btn-voice')?.addEventListener('click', () => {
    $('#voice-panel').classList.remove('hidden');
    if (!window._voicePoll) window._voicePoll = setInterval(pollVoiceSignals, 1500);
  });
  $('#btn-voice-close')?.addEventListener('click', () => $('#voice-panel').classList.add('hidden'));
  $('#btn-mic-on')?.addEventListener('click', startVoice);
  $('#btn-mic-off')?.addEventListener('click', stopVoice);
  $('#btn-skip')?.addEventListener('click', skipFilm);
  $('#btn-fullscreen')?.addEventListener('click', toggleFullscreen);
}

async function init() {
  bindEvents();
  if (username) $('#username').value = username;
  const ok = await checkServerHealth();
  if (ok && sessionId && username) {
    joinRoom();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init().catch(() => {}); });
} else {
  init().catch(() => {});
}