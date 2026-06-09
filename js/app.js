const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const loginScreen = $('#login-screen');
const appScreen = $('#app-screen');
const toastEl = $('#toast');
const loginError = $('#login-error');

function safeEl(sel, fn) {
  const el = $(sel);
  if (!el) return;
  fn(el);
}

const PANEL_TITLES = {
  dashboard: 'Dashboard',
  bot: 'Bot Health',
  radio: 'Radio Control',
  watch: 'Luxx Watch',
  system: 'System & Cache',
  tools: 'Tools'
};

let lastTrackId = null;
let lastThumbTrackId = null;
let lastStreamEpoch = null;
let lastAdminRadio = null;
let lastSystem = null;
let lyricsPollTimer = null;

let lyricsState = {
  trackKey: null,
  contentKey: null,
  data: null,
  playback: { positionSec: 0, durationSec: 0, progress: 0, preparedAt: 0 },
  fetchedAt: 0
};

function showToast(msg, ms = 3000) {
  if (!toastEl) return;
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
    base: resolveApiBase(),
    token: (localStorage.getItem('luxx_api_token') || '').trim()
  };
}

function isGitHubPages() {
  return location.hostname.includes('github.io');
}

function isSelfHostedAdmin() {
  return !isGitHubPages();
}

function defaultApiBase() {
  if (isSelfHostedAdmin()) return location.origin.replace(/\/$/, '');
  return 'http://localhost:3920';
}

function resolveApiBase() {
  if (isSelfHostedAdmin()) return location.origin.replace(/\/$/, '');
  return (localStorage.getItem('luxx_api_base') || '').replace(/\/$/, '') || defaultApiBase();
}

function setupLoginForm() {
  const baseInput = $('#api-base');
  const baseField = baseInput?.closest('.field');
  const localBtn = $('#btn-local');
  const hint = document.querySelector('.field-hint');

  if (isSelfHostedAdmin()) {
    const origin = location.origin.replace(/\/$/, '');
    if (baseInput) { baseInput.value = origin; baseInput.readOnly = true; }
    if (baseField) baseField.style.display = 'none';
    if (localBtn) localBtn.style.display = 'none';
    if (hint) hint.textContent = 'Admin jalan di server yang sama — cukup isi Admin Token.';
  } else {
    if (baseInput) baseInput.readOnly = false;
    if (baseField) baseField.style.display = '';
    if (localBtn) localBtn.style.display = '';
    if (hint) hint.textContent = 'Isi URL bot/tunnel (tanpa /admin). Bukan link GitHub Pages.';
  }
}

function friendlyError(err, base) {
  const msg = String(err?.message || err || 'Gagal connect');
  if (msg === 'Failed to fetch' || msg.includes('NetworkError')) {
    const tunnelHint = base.includes('trycloudflare.com')
      ? '\n• URL trycloudflare MATI kalau tunnel ditutup — jalankan ulang scripts\\radio-tunnel.ps1'
      : '';
    return `Tidak bisa hubungi bot di ${base}.\n• Bot jalan? (pm2 status)\n• Tunnel hidup?${tunnelHint}\n• API Base URL = alamat bot, BUKAN GitHub Pages.`;
  }
  if (msg.includes('Unauthorized')) return 'Token salah. Harus sama dengan ADMIN_API_TOKEN di .env bot.';
  if (msg.includes('Admin API disabled')) return 'ADMIN_API_TOKEN belum diset. Restart: pm2 restart luxx --update-env';
  return msg;
}

async function api(path, method = 'GET', body = null) {
  const { base, token } = cfg();
  if (!base || !token) throw new Error('Isi API Base URL dan Admin Token.');

  let res;
  try {
    res = await fetch(`${base}/admin/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: body != null ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
  } catch (e) {
    throw new Error(friendlyError(e, base));
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError({ message: data.error || `HTTP ${res.status}` }, base));
  return data;
}

function switchPanel(id) {
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.panel === id));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${id}`));
  safeEl('#panel-title', (el) => { el.textContent = PANEL_TITLES[id] || 'Dashboard'; });
  if (id === 'radio') requestAnimationFrame(() => $('#beat-canvas')?._resize?.());
}

function initGridCanvas() {
  const canvas = $('#grid-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let t = 0;
  const nodes = [];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    nodes.length = 0;
    const count = Math.floor((w * h) / 28000);
    for (let i = 0; i < count; i++) {
      nodes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35
      });
    }
  }

  function draw() {
    t += 0.008;
    ctx.clearRect(0, 0, w, h);

    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < 0 || n.y > h) n.vy *= -1;
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 120) {
          const alpha = (1 - dist / 120) * 0.35;
          ctx.strokeStyle = `rgba(0, 212, 255, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    for (const n of nodes) {
      ctx.fillStyle = `rgba(0, 255, 163, ${0.35 + Math.sin(t + n.x) * 0.15})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener('resize', resize);
  draw();
}

const BEAT = {
  audioCtx: null,
  analyser: null,
  connected: false,
  animId: null,
  bars: 72,
  bassLevel: 0,
  phase: 0
};

function initBeatVisualizer() {
  const canvas = $('#beat-canvas');
  const audio = $('#radio-audio');
  if (!canvas) return;

  const parent = canvas.parentElement;
  const resize = () => {
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    canvas._ctx = ctx;
    canvas._w = rect.width;
    canvas._h = rect.height;
  };
  resize();
  window.addEventListener('resize', resize);
  canvas._resize = resize;

  if (audio) {
    audio.crossOrigin = audio.crossOrigin || 'anonymous';
    audio.addEventListener('play', connectBeatGraph);
    audio.addEventListener('timeupdate', () => {
      updatePlayerProgress(lastAdminRadio?.playback || {}, audio);
    });
  }

  document.addEventListener('click', resumeBeatCtx, { passive: true });
  if (!BEAT.animId) beatLoop();
}

function resumeBeatCtx() {
  if (BEAT.audioCtx?.state === 'suspended') BEAT.audioCtx.resume().catch(() => {});
}

function connectBeatGraph() {
  const audio = $('#radio-audio');
  if (!audio || BEAT.connected) return;
  try {
    BEAT.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    BEAT.analyser = BEAT.audioCtx.createAnalyser();
    BEAT.analyser.fftSize = 512;
    BEAT.analyser.smoothingTimeConstant = 0.75;
    const src = BEAT.audioCtx.createMediaElementSource(audio);
    src.connect(BEAT.analyser);
    BEAT.analyser.connect(BEAT.audioCtx.destination);
    BEAT.connected = true;
    resumeBeatCtx();
  } catch (e) {
    console.warn('Beat graph:', e.message);
  }
}

function isAudioLive() {
  const a = $('#radio-audio');
  return Boolean(a?.src && !a.paused && !a.ended && a.currentTime > 0.05);
}

function beatRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, width, height, radius);
  else ctx.rect(x, y, width, height);
}

function beatLoop() {
  const canvas = $('#beat-canvas');
  const stage = $('#beat-stage');
  const glow = $('#beat-center-glow');
  const ctx = canvas?._ctx;
  const w = canvas?._w || 0;
  const h = canvas?._h || 0;

  if (ctx && w && h) {
    BEAT.phase += 0.02;
    const live = isAudioLive();
    stage?.classList.toggle('is-live', live);

    const freq = BEAT.analyser && live ? new Uint8Array(BEAT.analyser.frequencyBinCount) : null;
    const wave = BEAT.analyser && live ? new Uint8Array(BEAT.analyser.frequencyBinCount) : null;
    if (freq) BEAT.analyser.getByteFrequencyData(freq);
    if (wave) BEAT.analyser.getByteTimeDomainData(wave);

    let bass = 0;
    if (freq) {
      const n = Math.min(14, freq.length);
      for (let i = 0; i < n; i++) bass += freq[i];
      bass /= n * 255;
    } else {
      bass = 0.15 + Math.sin(BEAT.phase) * 0.08;
    }
    BEAT.bassLevel = BEAT.bassLevel * 0.82 + bass * 0.18;
    if (glow) {
      const scale = 0.75 + BEAT.bassLevel * 0.85;
      glow.style.transform = `translate(-50%, -50%) scale(${scale})`;
      glow.style.opacity = live ? String(0.35 + BEAT.bassLevel * 0.65) : '0';
    }

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(0, 212, 255, 0.045)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < w; gx += 22) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 0; gy < h; gy += 18) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    const bars = BEAT.bars;
    const half = bars / 2;
    const gap = 1.5;
    const barW = (w - gap * (bars - 1)) / bars;
    const midY = h / 2;

    for (let i = 0; i < bars; i++) {
      const mirror = i < half ? i : bars - 1 - i;
      const idx = freq ? Math.floor((mirror / half) * freq.length * 0.68) : 0;
      const v = live && freq
        ? freq[idx] / 255
        : 0.05 + Math.sin(BEAT.phase * 2 + mirror * 0.18) * 0.04 + Math.sin(BEAT.phase + i * 0.05) * 0.02;
      const barH = Math.max(3, v * h * 0.44);
      const x = i * (barW + gap);

      const gradTop = ctx.createLinearGradient(x, midY - barH, x, midY);
      gradTop.addColorStop(0, `rgba(0, 255, 163, ${0.92 * v + 0.08})`);
      gradTop.addColorStop(0.45, `rgba(0, 212, 255, ${0.88 * v + 0.12})`);
      gradTop.addColorStop(1, 'rgba(123, 97, 255, 0.55)');
      ctx.fillStyle = gradTop;
      ctx.shadowBlur = live ? 6 + v * 14 : 0;
      ctx.shadowColor = 'rgba(0, 212, 255, 0.65)';
      beatRoundRect(ctx, x, midY - barH, barW, barH, 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      const gradBot = ctx.createLinearGradient(x, midY, x, midY + barH);
      gradBot.addColorStop(0, 'rgba(123, 97, 255, 0.55)');
      gradBot.addColorStop(0.55, `rgba(0, 212, 255, ${0.88 * v + 0.12})`);
      gradBot.addColorStop(1, `rgba(0, 255, 163, ${0.72 * v + 0.1})`);
      ctx.fillStyle = gradBot;
      beatRoundRect(ctx, x, midY, barW, barH, 2);
      ctx.fill();

      if (live && v > 0.62) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(v - 0.62) * 1.4})`;
        ctx.beginPath();
        ctx.arc(x + barW / 2, midY - barH - 2, 1 + v * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + barW / 2, midY + barH + 2, 1 + v * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.strokeStyle = live ? 'rgba(0, 255, 163, 0.4)' : 'rgba(0, 212, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (wave && live) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.9)';
      ctx.lineWidth = 1.6;
      ctx.shadowBlur = 12;
      ctx.shadowColor = 'rgba(0, 212, 255, 0.85)';
      const slice = w / wave.length;
      for (let i = 0; i < wave.length; i++) {
        const vy = ((wave[i] - 128) / 128) * (h * 0.24);
        const px = i * slice;
        const py = midY + vy;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.28)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= w; x += 2) {
        const py = midY + Math.sin(x * 0.03 + BEAT.phase * 3) * (h * 0.09) * Math.sin(x * 0.008 + BEAT.phase);
        if (x === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }

    const vig = ctx.createLinearGradient(0, 0, w, 0);
    vig.addColorStop(0, 'rgba(3, 5, 8, 0.88)');
    vig.addColorStop(0.07, 'transparent');
    vig.addColorStop(0.93, 'transparent');
    vig.addColorStop(1, 'rgba(3, 5, 8, 0.88)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  BEAT.animId = requestAnimationFrame(beatLoop);
}

function formatPlayerTime(sec) {
  if (!sec || !Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updatePlayerProgress(playback = {}, audioEl = null) {
  const fill = $('#player-progress-fill');
  const glowEl = $('#player-progress-glow');
  const elapsedEl = $('#player-time-elapsed');
  const durationEl = $('#player-time-duration');
  if (!fill) return;

  let position = playback.positionSec ?? 0;
  let duration = playback.durationSec ?? 0;

  if (audioEl?.duration && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
    duration = audioEl.duration;
    position = audioEl.currentTime || 0;
  } else if (playback.preparedAt && playback.durationSec > 0) {
    position = (playback.positionSec ?? 0) + (Date.now() - playback.preparedAt) / 1000;
    if (position > playback.durationSec) position = playback.durationSec;
  }

  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : (playback.progress ?? 0);
  fill.style.width = `${pct}%`;
  if (glowEl) {
    glowEl.style.left = `${pct}%`;
    glowEl.classList.toggle('active', pct > 0 && pct < 100);
  }
  if (elapsedEl) elapsedEl.textContent = formatPlayerTime(position);
  if (durationEl) durationEl.textContent = formatPlayerTime(duration);
}

let searchBusy = false;

function renderSearchHit(hit, index) {
  const title = escapeHtml(hit.title);
  const author = escapeHtml(hit.author || 'Unknown');
  const dur = escapeHtml(hit.duration || '—');
  const thumb = hit.thumbnail
    ? `<img src="${escapeHtml(hit.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'"/>`
    : '<div class="search-hit-ph">🎵</div>';
  return `<li class="search-hit" data-idx="${index}">
    ${thumb}
    <div class="search-hit-meta">
      <p class="search-hit-title">${title}</p>
      <p class="search-hit-sub">${author} · ${dur}</p>
    </div>
    <div class="search-hit-actions">
      <button type="button" class="btn primary btn-search-queue" data-idx="${index}">+ Antrian</button>
      <button type="button" class="btn btn-search-play" data-idx="${index}">▶ Putar</button>
    </div>
  </li>`;
}

let lastSearchResults = [];

async function runSongSearch() {
  const input = $('#song-search-input');
  const status = $('#search-status');
  const list = $('#search-results');
  const q = (input?.value || '').trim();
  if (!q) {
    if (status) status.textContent = 'Ketik judul atau paste link YouTube.';
    return;
  }
  if (searchBusy) return;

  searchBusy = true;
  if (status) status.textContent = 'Mencari...';
  if (list) list.innerHTML = '';
  lastSearchResults = [];

  try {
    const data = await api(`/search?q=${encodeURIComponent(q)}`);
    lastSearchResults = data.results || [];
    if (status) {
      status.textContent = lastSearchResults.length
        ? `${lastSearchResults.length} hasil untuk "${q}"`
        : 'Tidak ada hasil.';
    }
    if (list) {
      list.innerHTML = lastSearchResults.length
        ? lastSearchResults.map((hit, i) => renderSearchHit(hit, i)).join('')
        : '';
    }
  } catch (e) {
    if (status) status.textContent = e.message;
  } finally {
    searchBusy = false;
  }
}

async function addSongFromSearch(index, playNow = false) {
  const hit = lastSearchResults[index];
  if (!hit?.url) return;

  const status = $('#search-status');
  const label = playNow ? 'Memutar' : 'Menambah';
  if (status) status.textContent = `${label} "${hit.title}"...`;

  try {
    const r = await api('/queue/add', 'POST', {
      url: hit.url,
      title: hit.title,
      videoId: hit.videoId,
      thumbnail: hit.thumbnail,
      author: hit.author,
      seconds: hit.seconds,
      duration: hit.duration,
      playNow
    });
    if (r.streamEpoch != null) lastStreamEpoch = r.streamEpoch;
    resetPlayerState();
    showToast(r.message || 'Lagu ditambahkan');
    if (status) status.textContent = r.message || 'Berhasil.';
    await refresh();
  } catch (e) {
    if (status) status.textContent = e.message;
    showToast(e.message);
  }
}

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
  thumb.onload = () => { thumb.classList.add('visible'); fallback.style.display = 'none'; };
  thumb.onerror = () => { thumb.classList.remove('visible'); thumb.removeAttribute('src'); fallback.style.display = 'flex'; };
  thumb.src = `${cur.thumbnail}?v=${cur.id}`;
}

function radioPreparingLabel(r) {
  const next = r.queue?.[0];
  return next ? `Berikutnya: ${next.title}` : 'Tunggu sebentar';
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
    updatePlayerProgress({}, audio);
    return;
  }

  if (!cur) {
    badge.textContent = 'IDLE';
    badge.className = 'player-badge idle';
    const err = r.lastPrepareError?.message;
    $('#player-title').textContent = err ? 'Gagal memuat lagu' : 'Belum ada lagu';
    $('#player-artist').textContent = err ? `${r.lastPrepareError.title || ''}: ${err.slice(0, 120)}` : '—';
    $('#player-requester').textContent = '🙋 —';
    thumb.classList.remove('visible');
    thumb.removeAttribute('src');
    fallback.style.display = 'flex';
    stopAudio(audio);
    lastTrackId = null;
    lastThumbTrackId = null;
    updatePlayerProgress({}, audio);
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
  updatePlayerProgress(r.playback, audio);
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function lyricTrackKey(cur) {
  return cur ? `${cur.id ?? ''}:${cur.title}` : null;
}

function lyricContentKey(lyrics) {
  if (!lyrics?.lyrics) return null;
  return `${lyrics.trackId ?? ''}:${lyrics.lyrics.length}`;
}

function renderLyrics(r = {}) {
  const cur = r.current;
  const lyrics = r.lyrics;
  const body = $('#lyrics-body');
  const empty = $('#lyrics-empty');
  const meta = $('#lyrics-meta');
  const badge = $('#lyrics-source');
  const progress = $('#lyrics-progress-fill');
  const trackKey = lyricTrackKey(cur);

  if (!cur) {
    lyricsState = { trackKey: null, contentKey: null, data: null, playback: { positionSec: 0, durationSec: 0, progress: 0, preparedAt: 0 }, fetchedAt: 0 };
    meta.textContent = 'Belum ada lagu';
    badge.textContent = '—';
    empty.hidden = false;
    body.classList.add('hidden');
    body.innerHTML = '';
    if (progress) progress.style.width = '0%';
    return;
  }

  meta.textContent = `${cur.title} — ${cur.author || 'Unknown'} · 🙋 ${cur.requestedBy || '-'}`;
  lyricsState.playback = {
    positionSec: r.playback?.positionSec ?? 0,
    durationSec: r.playback?.durationSec ?? 0,
    progress: r.playback?.progress ?? 0,
    preparedAt: r.playback?.preparedAt ?? 0
  };

  const lyricsStale = lyrics?.trackId != null && cur.id != null && lyrics.trackId !== cur.id;
  const loading = lyrics?.loading || lyricsStale;

  if (loading) {
    badge.textContent = 'Memuat...';
    empty.textContent = 'Mencari lirik lagu...';
    empty.hidden = false;
    body.classList.add('hidden');
    body.innerHTML = '';
    if (progress) progress.style.width = `${r.playback?.progress ?? 0}%`;
    return;
  }

  if (!lyrics?.found || !lyrics?.lyrics) {
    badge.textContent = 'Tidak ditemukan';
    empty.textContent = lyrics?.retryInSec ? `Retry dalam ${lyrics.retryInSec}s...` : 'Mencari lirik — retry otomatis...';
    empty.hidden = false;
    body.classList.add('hidden');
    body.innerHTML = '';
    if (progress) progress.style.width = `${r.playback?.progress ?? 0}%`;
    return;
  }

  badge.textContent = lyrics.source || 'LRCLIB';
  empty.hidden = true;
  body.classList.remove('hidden');

  const contentKey = lyricContentKey(lyrics);
  const rebuild = trackKey !== lyricsState.trackKey || contentKey !== lyricsState.contentKey;
  lyricsState.trackKey = trackKey;
  lyricsState.contentKey = contentKey;
  lyricsState.data = lyrics;

  if (rebuild) {
    body.innerHTML = `<pre class="lyric-plain">${escapeHtml(lyrics.lyrics)}</pre>`;
    body.scrollTop = 0;
  }
  if (progress) progress.style.width = `${r.playback?.progress ?? 0}%`;
}

function renderMeters(d, sys) {
  const ramMb = sys?.memory?.rssMb ?? d.ramMb ?? 0;
  const heapMb = sys?.memory?.heapUsedMb ?? 0;
  const heapTotal = sys?.memory?.heapTotalMb ?? 256;
  const ramPct = Math.min(100, Math.round((ramMb / 512) * 100));
  const heapPct = Math.min(100, Math.round((heapMb / heapTotal) * 100));
  $('#meter-ram').style.width = `${ramPct}%`;
  $('#meter-heap').style.width = `${heapPct}%`;
  $('#meter-ram-label').textContent = `${ramMb} MB`;
  $('#meter-heap-label').textContent = `${heapMb} MB`;
}

function renderQuickLinks(base, sys) {
  const links = sys?.links || {};
  const items = [
    ['📻', 'Radio', `${base}/radio`],
    ['📺', 'Luxx Watch', `${base}/watch`],
    ['🌐', 'Portfolio', `${base}/portfolio`],
    ['📱', 'Pair WA', `${base}/pair`]
  ];
  $('#quick-links').innerHTML = items.map(([icon, label, href]) =>
    `<a class="link-tile" href="${href}" target="_blank" rel="noopener">${icon} ${label}</a>`
  ).join('');
}

function renderServicePills(d) {
  const sess = d.session || {};
  const yt = d.youtubeCookies || {};
  const disc = d.discord || {};
  const pills = [
    ['WA', sess.paired ? 'ok' : 'bad', sess.paired ? 'Paired' : 'Belum pair'],
    ['YT Cookies', yt.ready ? 'ok' : 'warn', yt.ready ? 'Ready' : 'Missing'],
    ['Discord', disc.slashReady ? 'ok' : 'warn', disc.slashReady ? 'Slash OK' : 'Slash ⏳'],
    ['Radio', d.radio?.current || d.radio?.isPreparing ? 'ok' : 'warn', d.radio?.current ? 'Playing' : 'Idle'],
    ['Mode', d.sleeping ? 'warn' : 'ok', d.sleeping ? 'Tidur' : 'Online']
  ];
  $('#service-pills').innerHTML = pills.map(([, cls, label]) =>
    `<span class="status-pill ${cls}">${label}</span>`
  ).join('');
}

function renderSystem(sys) {
  if (!sys) return;
  lastSystem = sys;

  const c = sys.cache || {};
  $('#cache-grid').innerHTML = [
    ['Image Cache', `${c.image?.entries ?? 0} / ${c.image?.max ?? 50}`, `~${c.image?.approxMb ?? 0} MB`],
    ['Cooldowns', c.cooldowns?.entries ?? 0, 'entries'],
    ['AI Context', c.aiContext?.users ?? 0, 'users'],
    ['AI Queue', c.aiQueue?.pending ?? 0, 'pending'],
    ['Sastra Cache', c.sastra?.size ?? 0, `max ${c.sastra?.max ?? 0}`],
    ['Lyrics Cache', c.lyrics?.trackCache ?? 0, `query ${c.lyrics?.queryCache ?? 0}`]
  ].map(([l, v, sub]) =>
    `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div><div class="label">${sub}</div></div>`
  ).join('');

  const temp = sys.temp || {};
  const dirs = (temp.dirs || []).map((d) =>
    `${d.exists ? '✓' : '✗'} <code>${d.path.split(/[/\\]/).pop()}</code>: ${d.files} file`
  ).join('<br>');
  $('#temp-box').innerHTML = `${dirs || '—'}<br><strong>${temp.totalFiles ?? 0}</strong> files · <strong>${temp.totalMb ?? 0} MB</strong>`;

  const s = sys.sessions || {};
  $('#session-box').innerHTML = `
    Play picker: <strong>${s.playSessions ?? 0}</strong><br>
    SP session: <strong>${s.spSessions ?? 0}</strong><br>
    Sastra: <strong>${s.sastraSessions ?? 0}</strong><br>
    Notes: <strong>${s.notes ?? 0}</strong> · Reminders: <strong>${s.reminders ?? 0}</strong>`;

  $('#runtime-box').innerHTML = `
    Node <strong>${sys.node || '—'}</strong> · PID <strong>${sys.pid ?? '—'}</strong><br>
    Platform: <strong>${sys.platform || '—'}</strong> · CPUs: <strong>${sys.cpus ?? '—'}</strong><br>
    Load: <strong>${(sys.loadAvg || []).join(', ') || '—'}</strong><br>
    Railway: <strong>${sys.runtime?.railway ? 'Yes' : 'No'}</strong><br>
    Radio URL: <span class="muted">${sys.runtime?.radioUrl || '—'}</span>`;
}

function renderStatus(d) {
  $('#conn-badge').textContent = 'online';
  $('#conn-badge').className = 'badge online';

  $('#hero-bot-name').textContent = d.bot || 'LuxxBot';
  $('#hero-uptime').textContent = `Uptime ${d.uptime} · RAM ${d.ramMb} MB · ${d.host || ''}`;

  const cur = d.radio?.current;
  const pill = $('#hero-pill');
  if (cur) pill.textContent = `▶ ${cur.title.slice(0, 36)}${cur.title.length > 36 ? '…' : ''}`;
  else if (d.radio?.isPreparing) pill.textContent = '⏳ Memuat...';
  else if (d.sleeping) pill.textContent = '🛌 Tidur';
  else pill.textContent = '⚡ Online';

  renderMeters(d, lastSystem);

  $('#status-grid').innerHTML = [
    ['Bot', d.bot], ['Uptime', d.uptime], ['RAM', `${d.ramMb} MB`], ['Host', d.host],
    ['Mode', d.sleeping ? 'Tidur' : 'Online'], ['Self Mode', d.selfMode ? 'On' : 'Off'],
    ['Anti-Link', d.antiLink ? 'ON' : 'OFF'], ['Queue', `${d.radio?.queueLength ?? 0} lagu`]
  ].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');

  const sess = d.session || {};
  const yt = d.youtubeCookies || {};
  $('#bot-health-box').innerHTML = `
    WhatsApp: <strong>${sess.paired ? '✅ Paired' : '❌ Belum pair'}</strong><br>
    Session size: <strong>${sess.credsBytes || 0}</strong> bytes<br>
    Persist path: <strong>${sess.onPersistPath ? '✅' : '⚠️'}</strong><br>
    YouTube cookies: <strong>${yt.ready ? '✅ Aktif' : '❌ Belum'}</strong> (${yt.bytes || 0} bytes)`;

  const disc = d.discord || {};
  $('#discord-box').innerHTML = `
    Server: <strong>${disc.guildCount || 0}</strong><br>
    Voice: ${disc.inVoice ? disc.voiceChannel : 'Belum connect'}<br>
    Slash: ${disc.slashReady ? '✅' : '⏳'}
    ${disc.inviteUrl ? `<br><a href="${disc.inviteUrl}" target="_blank" rel="noopener" style="color:var(--cyan)">Invite →</a>` : ''}`;

  $('#mode-box').innerHTML = `
    Sleeping: <strong>${d.sleeping ? 'Yes' : 'No'}</strong><br>
    Self mode: <strong>${d.selfMode ? 'On' : 'Off'}</strong><br>
    Anti-link: <strong>${d.antiLink ? 'ON' : 'OFF'}</strong><br>
    <span class="muted">Toggle via !turu / !bangun / !antilink di WA</span>`;

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
    Antrian: ${(w.queue || []).length} film`;

  $('#cookies-box').innerHTML = yt.ready
    ? `✅ Cookies aktif · <strong>${yt.bytes || 0}</strong> bytes<br><span class="muted">${yt.path || ''}</span>`
    : `❌ Cookies belum ada — !play gagal di Railway<br><span class="muted">${yt.hint || ''}</span>`;

  const r = d.radio || {};
  lastAdminRadio = r;
  renderPlayer(r, cfg().base);
  renderLyrics(r);

  const q = r.queue || [];
  $('#queue-list').innerHTML = q.length
    ? q.map((t, i) => {
        const thumb = t.thumbnail ? `<img src="${t.thumbnail}" alt="" class="queue-thumb" onerror="this.style.display='none'"/>` : '';
        return `<li>${thumb}<div><strong>${i + 1}.</strong> ${t.title}<br><span class="muted">🙋 ${t.requestedBy}</span></div></li>`;
      }).join('')
    : '<li class="muted">Antrian kosong</li>';

  renderServicePills(d);
  renderQuickLinks(cfg().base, lastSystem);
}

async function pollAdminLyrics() {
  try {
    const d = await api('/radio-lyrics');
    if (!lastAdminRadio?.current && !d?.currentId) return;
    renderLyrics({
      ...lastAdminRadio,
      playback: d.playback || lastAdminRadio?.playback,
      lyrics: d.lyrics
    });
  } catch (_) { /* ignore */ }
}

async function refresh() {
  try {
    const [status, system] = await Promise.all([
      api('/status'),
      api('/system').catch(() => null)
    ]);
    if (system) {
      lastSystem = system;
      renderSystem(system);
    }
    renderStatus(status);
  } catch (e) {
    $('#conn-badge').textContent = 'error';
    $('#conn-badge').className = 'badge offline';
    showToast(e.message);
  }
}

async function doLogin() {
  const base = resolveApiBase();
  const token = $('#api-token').value.trim();
  showLoginError('');

  if (!token) {
    showLoginError('Isi Admin Token (sama dengan ADMIN_API_TOKEN).');
    return;
  }

  if (!isSelfHostedAdmin() && !$('#api-base').value.trim()) {
    showLoginError('Isi API Base URL dan Admin Token.');
    return;
  }

  const typedBase = ($('#api-base').value || '').trim().replace(/\/$/, '');
  if (!isSelfHostedAdmin() && typedBase.includes('github.io')) {
    showLoginError('API Base URL salah — itu link Pages. Isi URL Railway atau localhost:3920.');
    return;
  }

  localStorage.setItem('luxx_api_base', isSelfHostedAdmin() ? base : typedBase);
  localStorage.setItem('luxx_api_token', token);

  const btn = $('#btn-login');
  btn.disabled = true;
  btn.textContent = 'Menghubungkan...';

  try {
    await api('/status');
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    requestAnimationFrame(() => $('#beat-canvas')?._resize?.());
    refresh();
    if (!window._poll) window._poll = setInterval(refresh, 4000);
    if (!lyricsPollTimer) lyricsPollTimer = setInterval(pollAdminLyrics, 2000);
  } catch (e) {
    showLoginError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Masuk Dashboard';
  }
}

$$('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
});

$('#btn-login')?.addEventListener('click', doLogin);
$('#btn-local')?.addEventListener('click', () => {
  safeEl('#api-base', (el) => { el.value = defaultApiBase(); });
  showToast('Diisi: localhost:3920');
});
$('#btn-toggle-token')?.addEventListener('click', () => {
  const inp = $('#api-token');
  if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
});
$('#btn-logout')?.addEventListener('click', () => {
  localStorage.removeItem('luxx_api_base');
  localStorage.removeItem('luxx_api_token');
  appScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  clearInterval(window._poll);
  window._poll = null;
  clearInterval(lyricsPollTimer);
  lyricsPollTimer = null;
});
$('#btn-refresh')?.addEventListener('click', refresh);
$('#btn-skip')?.addEventListener('click', async () => {
  resetPlayerState();
  try {
    const r = await api('/skip', 'POST');
    if (r.streamEpoch != null) lastStreamEpoch = r.streamEpoch;
    showToast(r.message || 'OK');
    await refresh();
  } catch (e) { showToast(e.message); }
});
$('#btn-clear')?.addEventListener('click', async () => {
  if (!confirm('Kosongkan antrian?')) return;
  resetPlayerState();
  try {
    const r = await api('/clear', 'POST');
    if (r.streamEpoch != null) lastStreamEpoch = r.streamEpoch;
    showToast('Antrian dikosongkan');
    await refresh();
  } catch (e) { showToast(e.message); }
});
$('#btn-restart')?.addEventListener('click', async () => {
  if (!confirm('Restart bot?')) return;
  try { await api('/restart', 'POST'); showToast('Restart diminta'); }
  catch (e) { showToast(e.message); }
});
$('#btn-watch-skip')?.addEventListener('click', async () => {
  try {
    const r = await api('/watch/skip', 'POST');
    showToast(r.ok ? 'Skip watch OK' : (r.error || 'Gagal'));
    await refresh();
  } catch (e) { showToast(e.message); }
});
$('#btn-watch-stop')?.addEventListener('click', async () => {
  if (!confirm('Hentikan film?')) return;
  try { await api('/watch/stop', 'POST'); showToast('Dihentikan'); await refresh(); }
  catch (e) { showToast(e.message); }
});
$('#btn-watch-clear-q')?.addEventListener('click', async () => {
  if (!confirm('Kosongkan antrian watch?')) return;
  try { await api('/watch/clear-queue', 'POST'); showToast('Antrian watch dikosongkan'); await refresh(); }
  catch (e) { showToast(e.message); }
});
$('#btn-cookies-save')?.addEventListener('click', async () => {
  const content = ($('#cookies-paste').value || '').trim();
  if (!content) return showToast('Paste isi file cookies dulu.');
  try {
    const r = await api('/youtube-cookies', 'POST', { content });
    showToast(r.message || 'Cookies tersimpan');
    $('#cookies-paste').value = '';
    await refresh();
  } catch (e) { showToast(e.message); }
});
$('#btn-prune-cache')?.addEventListener('click', async () => {
  if (!confirm('Bersihkan cache runtime (image + cooldown)?')) return;
  try {
    const r = await api('/cache/prune', 'POST');
    showToast(r.message || 'Cache dibersihkan');
    if (r.system) { lastSystem = r.system; renderSystem(r.system); }
    await refresh();
  } catch (e) { showToast(e.message); }
});
$('#btn-song-search')?.addEventListener('click', runSongSearch);
$('#song-search-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runSongSearch(); }
});
$('#search-results')?.addEventListener('click', (e) => {
  const queueBtn = e.target.closest('.btn-search-queue');
  const playBtn = e.target.closest('.btn-search-play');
  if (queueBtn) addSongFromSearch(Number(queueBtn.dataset.idx), false);
  else if (playBtn) addSongFromSearch(Number(playBtn.dataset.idx), true);
});

setupLoginForm();
initGridCanvas();
initBeatVisualizer();
const savedToken = localStorage.getItem('luxx_api_token');
if (!isSelfHostedAdmin()) {
  $('#api-base').value = localStorage.getItem('luxx_api_base') || defaultApiBase();
}
if (savedToken) $('#api-token').value = savedToken;