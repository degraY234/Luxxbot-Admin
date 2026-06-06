const $ = (s) => document.querySelector(s);

function apiRoot() {
  return '/watch/api';
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
const peers = new Map();
const voicePeers = new Set();

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

async function api(path, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const url = `${apiRoot()}${path}`;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new Error('Gagal hubungi server. Pastikan bot & tunnel masih hidup.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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

function formatChatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function filmIdentity(film) {
  return film?.key || film?.playEmbedUrl || film?.playVideoUrl || film?.embedUrl || film?.videoUrl || film?.pageUrl || film?.title || '';
}

function playerEmbedSrc(film) {
  return film?.playEmbedUrl || '';
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
  const base = film.embedUrl ? (film.source === 'lk21' ? 'LK21 Player' : 'Streaming') : 'Direct stream';
  meta.textContent = `${base} · ⏱ ${formatElapsed(effectivePlayback(pb))} bareng`;
  if (pb.by) meta.textContent += ` · ${pb.by}`;
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
  const hasEmbed = !!film?.embedUrl;
  const hasVideo = !!film?.videoUrl;

  if (hasEmbed || hasVideo) {
    if (hasEmbed && embedSrc) {
      const fullEmbed = embedSrc.startsWith('http') ? embedSrc : `${location.origin}${embedSrc}`;
      if (iframe.src !== fullEmbed) iframe.src = fullEmbed;
      iframe.classList.remove('hidden');
      video.pause?.();
      video.classList.add('hidden');
      video.removeAttribute('src');
      video.load?.();
    } else if (hasVideo && videoSrc) {
      iframe.src = '';
      iframe.classList.add('hidden');
      const fullVideo = videoSrc.startsWith('http') ? videoSrc : `${location.origin}${videoSrc}`;
      if (video.getAttribute('src') !== fullVideo) {
        video.src = fullVideo;
        video.load();
      }
      video.classList.remove('hidden');
      video.play().catch(() => {});
    }
    empty.classList.add('hidden');
    $('#now-title').textContent = film.title || 'Film';
    const poster = $('#now-poster');
    if (film.poster) {
      poster.src = film.poster;
      poster.classList.remove('hidden');
    } else {
      poster.classList.add('hidden');
    }
  } else {
    iframe.src = '';
    iframe.classList.add('hidden');
    video.classList.add('hidden');
    video.removeAttribute('src');
    video.load?.();
    empty.classList.remove('hidden');
    $('#now-title').textContent = 'Belum ada film';
    $('#now-meta').textContent = 'Pilih film terbaru atau cari di bawah';
    $('#now-poster').classList.add('hidden');
    lastFilmKey = '';
    lastPlaybackUpdatedAt = 0;
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
    showLoginError(e.message || 'Gagal masuk ruang TV.');
    showLogin();
  } finally {
    joining = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Masuk Ruang TV'; }
  }
}

function bindCatalogCards() {
  $('#catalog').querySelectorAll('.film-card').forEach((el) => {
    el.querySelector('.btn-play')?.addEventListener('click', (e) => {
      e.stopPropagation();
      playFilm(el.dataset.url, el.dataset.title);
    });
    el.querySelector('.btn-queue')?.addEventListener('click', (e) => {
      e.stopPropagation();
      queueFilm(el.dataset.url, el.dataset.title);
    });
  });
}

function renderCatalog(results, emptyMsg) {
  if (!results?.length) {
    $('#catalog').innerHTML = `<p class="muted catalog-empty">${esc(emptyMsg)}</p>`;
    return;
  }
  $('#catalog').innerHTML = results.map((f) => `
    <div class="film-card" data-url="${esc(f.url)}" data-title="${esc(f.title)}">
      <img src="${esc(f.poster)}" alt="" loading="lazy" onerror="this.classList.add('img-fallback')" />
      <p class="film-title">${esc(f.title)}${f.year ? ` <span class="muted">(${esc(f.year)})</span>` : ''}</p>
      <div class="film-actions">
        <button type="button" class="btn primary btn-play">▶ Putar</button>
        <button type="button" class="btn btn-queue">📋</button>
      </div>
    </div>
  `).join('');
  bindCatalogCards();
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
  setCatalogLabel(catalogSort === 'oldest' ? 'Film terlama dari LK21' : 'Film terbaru dari LK21');
  $('#catalog').innerHTML = '<p class="muted catalog-empty">Memuat katalog...</p>';
  try {
    const d = await api(`/browse?page=${catalogPage}&sort=${catalogSort}`);
    applyCatalogResponse(d, catalogSort === 'oldest'
      ? `Arsip LK21 · hal ${d.page}/${d.totalPages} (terlama dulu)`
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
    const d = await api(`/genre?g=${encodeURIComponent(slug)}&page=${catalogPage}&sort=${catalogSort}`);
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
  const cards = $('#catalog')?.querySelectorAll('.film-card') || [];
  cards.forEach((c) => c.classList.toggle('playing', c.dataset.url === url));
  try {
    toast('Memuat player LK21...');
    const d = await api('/play', 'POST', { sessionId, url, title });
    renderRoom(d.room);
    const film = d.room?.film;
    if (film?.embedUrl) toast(`▶ ${film.title || title} — player aktif`);
    else if (film?.videoUrl) toast(`▶ ${film.title || title} — stream MP4`);
    else toast(`Memutar: ${title}`);
  } catch (e) {
    toast(e.message || 'Gagal memutar film.');
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
  if (!sessionId) return;
  try {
    const d = await api('/skip', 'POST', { sessionId });
    renderRoom(d.room);
    toast('Skip ke film berikutnya');
  } catch (e) {
    toast(e.message);
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

function bindPlaybackEvents() {
  const video = $('#player-video');
  if (!video) return;
  const onUserAction = () => {
    if (suppressPlaybackReport) return;
    reportPlayback();
  };
  video.addEventListener('play', onUserAction);
  video.addEventListener('pause', onUserAction);
  video.addEventListener('seeked', onUserAction);
  video.addEventListener('error', () => {
    toast('Stream MP4 gagal. Coba film terbaru dengan player embed.');
  });
}

function bindEvents() {
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

function init() {
  bindEvents();
  if (username) $('#username').value = username;
  if (sessionId && username) joinRoom();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}