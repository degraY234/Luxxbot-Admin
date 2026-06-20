(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const API_NOW = '/radio/api/now';
  const API_PLAY = '/radio/api/play';
  const API_PAUSE = '/radio/api/pause';
  const API_RESUME = '/radio/api/resume';
  const API_LYRICS = '/radio/api/lyrics';
  const STREAM = '/radio/live.mp3';

  const player = $('#radio-player');
  const waveCanvas = $('#wave-canvas');
  const waveCtx = waveCanvas?.getContext('2d');
  const thumb = $('#radio-thumb');
  const thumbPh = $('#radio-thumb-ph');
  const trackTitle = $('#track-title');
  const trackArtist = $('#track-artist');
  const trackRequester = $('#track-requester');
  const progressFill = $('#progress-fill');
  const progressGlow = $('#progress-glow');
  const timeElapsed = $('#time-elapsed');
  const timeDuration = $('#time-duration');
  const queueList = $('#queue-list');
  const queueEmpty = $('#queue-empty');
  const queueCount = $('#queue-count');
  const statusEl = $('#radio-status');
  const btnPlay = $('#btn-play');
  const btnSkip = $('#btn-skip');
  const btnStop = $('#btn-stop');
  const lyricsBadge = $('#lyrics-badge');
  const lyricsEmpty = $('#lyrics-empty');
  const lyricsBody = $('#lyrics-body');
  const lyricsProgress = $('#lyrics-progress-fill');

  let activeTrackKey = null;
  let pendingTrackKey = null;
  let userPaused = false;
  let playbackArmed = false;
  let playBusy = false;
  let userInteracted = false;
  let audioCtx = null;
  let analyser = null;
  let graphConnected = false;
  let animWave = 0;
  let pollTimer = null;
  let lyricsPollTimer = null;
  let lyricsPollMs = 0;
  let tickTimer = null;
  let pollInFlight = false;
  let lyricsPollInFlight = false;
  let lastMetaKey = '';
  let lastQueueKey = '';
  let lastQueueLyricsPrefetchKey = '';

  let lastNowData = null;
  let loadAttempt = 0;
  let streamLoadGen = 0;
  let lastAudioProgressAt = 0;
  let lastStreamTrackKey = null;
  let lastPlaybackSeq = null;
  let lastKnownServerPaused = null;

  let lyricsState = {
    trackKey: null,
    contentKey: null,
    data: null,
    playback: { positionSec: 0, durationSec: 0, progress: 0, preparedAt: 0 }
  };

  function displayTrack(d) {
    if (!d) return null;
    if (d.playbackActive && d.current) return d.current;
    return d.upNext || null;
  }

  function trackKey(d) {
    if (!d?.playbackActive || !d?.current) return null;
    return String(d.current.id);
  }

  function streamIdentityKey(d) {
    const t = displayTrack(d);
    if (!t) return null;
    return String(t.id);
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? 'var(--robot-warn)' : 'var(--robot-accent)';
  }

  function isPlayerPlaying() {
    return Boolean(
      playbackArmed
      && player?.src
      && !player.paused
      && !player.ended
      && !player.error
    );
  }

  function isPlayerAudible() {
    return Boolean(isPlayerPlaying() && player.currentTime > 0);
  }

  function disarmLocalPlayback() {
    playbackArmed = false;
    userPaused = false;
    streamLoadGen += 1;
    activeTrackKey = null;
    pendingTrackKey = null;
    if (!player) return;
    player.pause();
    player.muted = true;
    try { player.currentTime = 0; } catch (_) { /* ignore */ }
    player.removeAttribute('src');
    player.load();
    updatePlayBtn();
    updateProgressDisplay();
  }

  function armLocalPlayback() {
    playbackArmed = true;
    userPaused = false;
    if (player) player.muted = false;
    connectAudioGraph();
  }

  function markUserInteraction() {
    userInteracted = true;
    connectAudioGraph();
    if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
  }

  function connectAudioGraph() {
    if (!player || graphConnected || !userInteracted) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      const source = audioCtx.createMediaElementSource(player);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      graphConnected = true;
      drawWave();
    } catch (e) {
      console.warn('Visualizer off:', e.message);
    }
  }

  function resizeWave() {
    if (!waveCanvas || !waveCtx) return;
    const rect = waveCanvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    waveCanvas.width = Math.floor(rect.width * dpr);
    waveCanvas.height = Math.floor(rect.height * dpr);
    waveCtx.setTransform(1, 0, 0, 1, 0, 0);
    waveCtx.scale(dpr, dpr);
  }

  function drawWave() {
    if (!waveCtx || !waveCanvas) return;
    const w = waveCanvas.parentElement.clientWidth;
    const h = waveCanvas.parentElement.clientHeight;
    const bars = 48;
    const gap = 2;
    const barW = (w - gap * (bars - 1)) / bars;
    const playing = isPlayerAudible();
    const buffer = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    if (buffer) analyser.getByteFrequencyData(buffer);

    waveCtx.clearRect(0, 0, w, h);
    for (let i = 0; i < bars; i++) {
      const idx = buffer ? Math.floor((i / bars) * buffer.length * 0.7) : 0;
      const v = playing && buffer
        ? buffer[idx] / 255
        : 0.06 + Math.sin(Date.now() / 500 + i * 0.25) * 0.03;
      const barH = Math.max(4, v * h * 0.88);
      const x = i * (barW + gap);
      const y = (h - barH) / 2;
      const grad = waveCtx.createLinearGradient(0, y, 0, y + barH);
      grad.addColorStop(0, '#1e90ff');
      grad.addColorStop(0.5, '#94a3b8');
      grad.addColorStop(1, '#3b82f6');
      waveCtx.fillStyle = grad;
      waveCtx.beginPath();
      waveCtx.roundRect(x, y, barW, barH, 3);
      waveCtx.fill();
    }

    animWave = requestAnimationFrame(drawWave);
  }

  async function startPlayerPlayback() {
    if (!playbackArmed || !player?.src) return false;
    userPaused = false;
    try {
      await player.play();
      if (audioCtx?.state === 'suspended') await audioCtx.resume();
      updatePlayBtn();
      return true;
    } catch (_) {
      setStatus('🔊 Klik tombol Putar untuk mulai audio', false);
      updatePlayBtn();
      return false;
    }
  }

  function pausePlayerPlayback() {
    if (!player?.src) return;
    userPaused = true;
    player.pause();
    updatePlayBtn();
  }

  async function resumePlayerPlayback() {
    if (!playbackArmed || !player?.src) return false;
    return startPlayerPlayback();
  }

  function seekToPosition(sec = 0) {
    try { player.currentTime = Math.max(0, sec); } catch (_) { /* ignore */ }
  }

  function prepareStream(d) {
    if (!playbackArmed) return;
    const key = trackKey(d);
    if (!key || !d.hasStream || !d.current) return;

    const gen = ++streamLoadGen;
    pendingTrackKey = key;
    loadAttempt += 1;
    lastAudioProgressAt = 0;
    updatePlayBtn();
    const seekSec = Math.max(0, d.playback?.positionSec || 0);
    const serverPaused = Boolean(d.paused ?? d.playback?.paused);

    const url = `${STREAM}?epoch=${d.streamEpoch}&id=${d.current.id}&n=${loadAttempt}`;
    player.pause();
    player.removeAttribute('src');
    player.load();

    const onCanPlay = async () => {
      if (gen !== streamLoadGen) return;
      player.removeEventListener('canplay', onCanPlay);
      player.removeEventListener('error', onErr);
      activeTrackKey = key;
      pendingTrackKey = null;
      if (seekSec > 0) {
        await waitForPlayerMetadata(seekSec > 600 ? 20000 : 12000);
        seekToPosition(seekSec);
      }
      userPaused = serverPaused;
      if (playbackArmed && !serverPaused) {
        startPlayerPlayback();
      } else {
        updateProgressUI(seekSec, d.playback?.durationSec || 0);
      }
      updatePlayBtn();
    };

    const onErr = () => {
      if (gen !== streamLoadGen) return;
      player.removeEventListener('canplay', onCanPlay);
      player.removeEventListener('error', onErr);
      if (pendingTrackKey === key) {
        activeTrackKey = null;
        pendingTrackKey = null;
      }
      setStatus('Gagal memuat audio — mencoba lagi...', true);
    };

    player.src = url;
    player.load();
    player.addEventListener('canplay', onCanPlay);
    player.addEventListener('error', onErr, { once: true });
  }

  function resetTrackState() {
    lastStreamTrackKey = null;
    loadAttempt = 0;
    disarmLocalPlayback();
    stopTick();
    lyricsState = {
      trackKey: null,
      contentKey: null,
      data: null,
      playback: { positionSec: 0, durationSec: 0, progress: 0, preparedAt: 0 }
    };
    lyricsBody.innerHTML = '';
    lyricsBody.hidden = true;
    lyricsEmpty.hidden = false;
    lyricsEmpty.textContent = 'Lirik muncul otomatis saat lagu diputar';
    lyricsProgress.style.width = '0%';
    updatePlayBtn();
  }

  function updateProgressUI(positionSec, durationSec) {
    const dur = durationSec || 0;
    const pos = dur > 0 ? Math.min(dur, Math.max(0, positionSec)) : Math.max(0, positionSec);
    const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    progressGlow.style.left = `${pct}%`;
    progressGlow.classList.toggle('active', pct > 0 && pct < 100);
    timeElapsed.textContent = formatTime(pos);
    timeDuration.textContent = dur > 0 ? formatTime(dur) : (lyricsState.playback.durationLabel || '0:00');
    if (lyricsProgress) lyricsProgress.style.width = '0%';
  }

  function updateProgressFromPlayer() {
    if (!player.duration || Number.isNaN(player.duration)) return;
    lastAudioProgressAt = Date.now();
    updateProgressUI(player.currentTime, player.duration);
  }

  function updateProgressDisplay() {
    const serverPaused = Boolean(lastNowData?.paused ?? lastNowData?.playback?.paused);
    if (isPlayerAudible() && !serverPaused) return;
    const pb = lastNowData?.playback || {};
    const dur = pb.durationSec || lyricsState.playback.durationSec || 0;
    const pos = pb.positionSec || 0;
    updateProgressUI(pos, dur);
  }

  function syncServerPlayback(d) {
    const pb = d.playback || {};
    const serverPaused = Boolean(d.paused ?? pb.paused);
    const serverPos = pb.positionSec || 0;
    const wasPaused = lastKnownServerPaused;
    lastKnownServerPaused = serverPaused;
    userPaused = serverPaused;

    if (pb.playbackSeq != null || d.playbackSeq != null) {
      lastPlaybackSeq = pb.playbackSeq ?? d.playbackSeq;
    }

    updatePlayBtn();

    if (!d.playbackActive) return;

    updateProgressUI(serverPos, pb.durationSec || 0);

    if (serverPaused) {
      if (player.src && !player.paused) player.pause();
      if (player.src) seekToPosition(serverPos);
      return;
    }

    if (!playbackArmed) return;

    if (!player.src) {
      prepareStream(d);
      return;
    }

    const resumedFromPause = wasPaused === true;
    const drift = Math.abs((player.currentTime || 0) - serverPos);
    if (resumedFromPause || player.paused || drift > 2) {
      seekToPosition(serverPos);
      startPlayerPlayback();
    }
  }

  function formatTime(sec) {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function parseDurationHint(track) {
    if (!track) return 0;
    if (track.durationSec > 0) return track.durationSec;
    const raw = String(track.duration || '').trim();
    if (!raw || raw === '—' || raw === '-') return 0;
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);
    const parts = raw.split(':').map((p) => parseInt(p, 10));
    if (parts.some((n) => Number.isNaN(n))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  function estimatePrepareWaitMs(d = {}) {
    const head = d.playbackActive ? null : (d.upNext || d.queue?.[0]);
    const dur = parseDurationHint(head) || 300;
    return Math.min(1_800_000, Math.max(180_000, dur * 2500 + 120_000));
  }

  async function waitForPlayerMetadata(maxMs = 12000) {
    if (!player) return false;
    if (Number.isFinite(player.duration) && player.duration > 0) return true;
    return new Promise((resolve) => {
      const started = Date.now();
      const done = (ok) => {
        player.removeEventListener('loadedmetadata', onMeta);
        player.removeEventListener('durationchange', onMeta);
        clearInterval(timer);
        resolve(ok);
      };
      const onMeta = () => {
        if (Number.isFinite(player.duration) && player.duration > 0) done(true);
      };
      player.addEventListener('loadedmetadata', onMeta);
      player.addEventListener('durationchange', onMeta);
      const timer = setInterval(() => {
        if (Number.isFinite(player.duration) && player.duration > 0) done(true);
        else if (Date.now() - started >= maxMs) done(false);
      }, 200);
    });
  }

  function lyricTrackKey(cur) {
    return cur ? `${cur.id ?? ''}:${cur.title}` : null;
  }

  function lyricContentKey(lyrics) {
    if (!lyrics?.lyrics) return lyrics?.loading ? `loading:${lyrics.trackId ?? ''}` : null;
    return `${lyrics.trackId ?? ''}:${lyrics.lyrics.length}:${lyrics.found}`;
  }

  function lyricsMatchesTrack(lyrics, cur) {
    if (!cur || !lyrics) return false;
    if (lyrics.trackId == null) return true;
    return Number(lyrics.trackId) === Number(cur.id);
  }

  function isAutoAdvancePending(d) {
    return Boolean(
      playbackArmed
      && !d.playbackActive
      && (d.isPreparing || d.waitingPlay || (d.queueLength || 0) > 0)
    );
  }

  async function followAutoAdvance(maxMs = null) {
    if (!playbackArmed) return;
    const waitMs = maxMs ?? Math.max(90000, estimatePrepareWaitMs(lastNowData));
    const started = Date.now();
    setStatus('⏭️ Lagu berikutnya — putar otomatis...', false);
    while (Date.now() - started < waitMs) {
      await new Promise((r) => setTimeout(r, 350));
      await pollNow();
      const d = lastNowData;
      if (!d) continue;
      const serverPaused = Boolean(d.paused ?? d.playback?.paused);
      if (d.playbackActive && d.hasStream && !serverPaused) {
        armLocalPlayback();
        lastKnownServerPaused = false;
        userPaused = false;
        prepareStream(d);
        return;
      }
      if (!d.isPreparing && !d.waitingPlay && !(d.queueLength || 0)) break;
    }
  }

  function onTrackIdentityChange(d) {
    const key = streamIdentityKey(d);
    if (!key || key === lastStreamTrackKey) return;
    lastStreamTrackKey = key;
    activeTrackKey = null;
    pendingTrackKey = null;
    streamLoadGen += 1;
    const serverPaused = Boolean(d.paused ?? d.playback?.paused);
    if (d.playbackActive && d.hasStream && !serverPaused) {
      if (!playbackArmed) armLocalPlayback();
      prepareStream(d);
    } else if (isAutoAdvancePending(d)) {
      setStatus('⏳ Lagu berikutnya dimuat — putar otomatis setelah siap', false);
    } else if (!d.playbackActive) {
      disarmLocalPlayback();
    }
    if (d.waitingPlay || d.upNext) {
      setStatus('⏳ Lagu sedang dimuat — audio menyala otomatis setelah siap', false);
    }
    burstLyricsPoll();
    prefetchQueueLyricsClient(d.queue);
  }

  function prefetchQueueLyricsClient(queue) {
    if (!queue?.length) return;
    queue.slice(0, 6).forEach((t, i) => {
      setTimeout(() => {
        fetch(`${API_LYRICS}?id=${t.id}`, { cache: 'no-store' }).catch(() => {});
      }, i * 120);
    });
  }

  function burstLyricsPoll() {
    pollLyrics();
    setTimeout(pollLyrics, 300);
    setTimeout(pollLyrics, 800);
    setTimeout(pollLyrics, 1600);
  }

  function ensureTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      updateProgressDisplay();
      checkAudioHealth();
    }, 300);
  }

  function stopTick() {
    if (!tickTimer) return;
    clearInterval(tickTimer);
    tickTimer = null;
  }

  function applyLyrics(lyrics, cur, playback) {
    if (playback) {
      lyricsState.playback = {
        positionSec: playback.positionSec ?? 0,
        durationSec: playback.durationSec ?? 0,
        progress: playback.progress ?? 0,
        preparedAt: playback.preparedAt ?? 0,
        durationLabel: playback.durationLabel
      };
    }

    if (!cur) {
      stopTick();
      lyricsState.trackKey = null;
      lyricsState.contentKey = null;
      lyricsState.data = null;
      lyricsBadge.textContent = '—';
      lyricsEmpty.textContent = 'Lirik muncul otomatis saat lagu diputar';
      lyricsEmpty.hidden = false;
      lyricsBody.hidden = true;
      lyricsBody.innerHTML = '';
      return;
    }

    if (!lyrics || !lyricsMatchesTrack(lyrics, cur)) return;

    const tk = lyricTrackKey(cur);

    if (lyrics.loading) {
      if (lyricsState.data?.found && lyricsMatchesTrack(lyricsState.data, cur)) return;
      lyricsBadge.textContent = 'Memuat...';
      lyricsEmpty.textContent = 'Mencari lirik lagu...';
      lyricsEmpty.hidden = false;
      lyricsBody.hidden = true;
      lyricsState.trackKey = tk;
      setLyricsPollInterval(true);
      ensureTick();
      return;
    }

    if (!lyrics.found || !lyrics.lyrics) {
      lyricsState.data = null;
      lyricsState.trackKey = tk;
      lyricsBadge.textContent = 'N/A';
      lyricsEmpty.textContent = lyrics.error
        ? `Lirik gagal dimuat — ${String(lyrics.error).slice(0, 60)}`
        : lyrics.retryInSec
          ? `Mencari lirik lagi dalam ${lyrics.retryInSec}s...`
          : 'Lirik tidak ditemukan — mencari ulang otomatis...';
      lyricsEmpty.hidden = false;
      lyricsBody.hidden = true;
      lyricsBody.innerHTML = '';
      setLyricsPollInterval(true);
      ensureTick();
      return;
    }

    lyricsBadge.textContent = lyrics.source || 'LRCLIB';
    lyricsEmpty.hidden = true;
    lyricsBody.hidden = false;

    const contentKey = lyricContentKey(lyrics);
    const rebuild = tk !== lyricsState.trackKey || contentKey !== lyricsState.contentKey;
    lyricsState.trackKey = tk;
    lyricsState.contentKey = contentKey;
    lyricsState.data = lyrics;

    if (rebuild) {
      lyricsBody.innerHTML = `<pre class="lyric-plain">${escapeHtml(lyrics.lyrics)}</pre>`;
      lyricsBody.scrollTop = 0;
    }

    setLyricsPollInterval(false);
    ensureTick();
  }

  function setLyricsPollInterval(fast) {
    const ms = fast ? 350 : 1400;
    if (lyricsPollMs === ms && lyricsPollTimer) return;
    lyricsPollMs = ms;
    if (lyricsPollTimer) clearInterval(lyricsPollTimer);
    lyricsPollTimer = setInterval(pollLyrics, ms);
  }

  function renderQueue(queue) {
    const key = (queue || []).map((t) => `${t.id}:${t.title}`).join('|');
    if (key === lastQueueKey) return;
    lastQueueKey = key;

    if (!queue?.length) {
      queueList.hidden = true;
      queueEmpty.hidden = false;
      queueCount.textContent = '0';
      return;
    }
    queueEmpty.hidden = true;
    queueList.hidden = false;
    queueCount.textContent = String(queue.length);
    queueList.innerHTML = queue
      .slice(0, 8)
      .map((t, i) => {
        const lyricTag = t.lyricsReady ? ' <small class="queue-lyrics-ready">📝</small>'
          : t.lyricsLoading ? ' <small class="queue-lyrics-loading">📝…</small>' : '';
        return `<li>${i + 1}. ${escapeHtml(t.title)}${lyricTag} <small>— ${escapeHtml(t.requestedBy || '?')}</small></li>`;
      })
      .join('');
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const robotEls = () => document.querySelectorAll('.luxx-robot');

  function updateRobotMood() {
    const playing = playbackArmed && isPlayerPlaying();
    robotEls().forEach((el) => el.classList.toggle('is-playing', playing));
  }

  function initRobotEyes() {
    const pupils = document.querySelectorAll('.luxx-robot-pupil');
    if (!pupils.length) return;

    let idleT = 0;
    let targetX = 0;
    let targetY = 0;
    let lastPointerAt = 0;

    const applyPupils = () => {
      pupils.forEach((p) => {
        p.style.transform = `translate(calc(-50% + ${targetX}px), calc(-50% + ${targetY}px))`;
      });
    };

    const onMove = (e) => {
      const x = e.clientX ?? window.innerWidth / 2;
      const y = e.clientY ?? window.innerHeight / 2;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      targetX = Math.max(-3, Math.min(3, (x - cx) / cx * 3));
      targetY = Math.max(-2, Math.min(2, (y - cy) / cy * 2));
      lastPointerAt = Date.now();
      applyPupils();
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (t) onMove(t);
    }, { passive: true });

    const tick = () => {
      if (Date.now() - lastPointerAt > 1800) {
        idleT += 0.025;
        targetX = Math.sin(idleT) * 2;
        targetY = Math.cos(idleT * 0.7) * 1.2;
        applyPupils();
      }
      requestAnimationFrame(tick);
    };
    tick();
  }

  function updatePlayBtn() {
    if (!btnPlay) return;
    if (playBusy || pendingTrackKey) {
      btnPlay.disabled = true;
      btnPlay.innerHTML = '<span aria-hidden="true">⏳</span> Memuat';
      updateRobotMood();
      return;
    }
    btnPlay.disabled = false;
    const serverPaused = Boolean(lastNowData?.paused ?? lastNowData?.playback?.paused);
    const hasLive = Boolean(lastNowData?.playbackActive && lastNowData?.hasStream);
    if (hasLive) {
      btnPlay.innerHTML = serverPaused
        ? '<span aria-hidden="true">▶</span> Lanjut'
        : '<span aria-hidden="true">⏸</span> Jeda';
    } else {
      btnPlay.innerHTML = '<span aria-hidden="true">▶</span> Putar';
    }
    updateRobotMood();
  }

  function renderDiscordStatus(d) {
    const disc = d.discord;
    if (isPlayerPlaying()) {
      if (disc?.inVoice) {
        setStatus(`🎧 Live — sinkron Discord (${disc.voiceChannel})`);
      } else {
        setStatus('🔊 Sedang diputar');
      }
      return;
    }
    if (playbackArmed && userPaused && lastNowData?.playbackActive) {
      setStatus('⏸️ Dijeda — klik Putar untuk lanjut');
      return;
    }
    if (d.isPreparing) {
      setStatus('⏳ Sedang mengunduh lagu...');
      return;
    }
    if (d.paused || d.playback?.paused) {
      const pos = d.playback?.elapsedLabel || '0:00';
      setStatus(`⏸️ Dijeda @ ${pos} — sinkron admin/Discord`);
      return;
    }
    if (d.playbackActive && d.hasStream && !playbackArmed) {
      const pos = d.playback?.elapsedLabel || '0:00';
      setStatus(`▶️ Live @ ${pos} — klik Putar untuk dengar di browser ini`);
      return;
    }
    if (d.waitingPlay && !playbackArmed) {
      setStatus('⏳ Menunggu lagu siap...');
      return;
    }
    if (!disc?.enabled) {
      setStatus('📻 Sinkron antrian !play WhatsApp');
      return;
    }
    if (disc.inVoice && disc.voiceChannel) {
      setStatus(`🎧 Discord + Web — ${disc.voiceChannel}`);
      return;
    }
    setStatus('🎧 Discord aktif — /join di voice channel');
  }

  function renderMeta(d) {
    const show = displayTrack(d);
    const key = `${d.streamEpoch}:${show?.id}:${d.isPreparing}:${d.playbackActive}:${d.queueLength}`;
    if (key === lastMetaKey) return;
    lastMetaKey = key;

    if (d.isPreparing) {
      trackTitle.textContent = show?.title || 'Memuat lagu...';
      trackArtist.textContent = 'Mengunduh — tunggu sebentar';
      trackRequester.textContent = show?.requestedBy ? `🙋 ${show.requestedBy}` : '';
      if (show?.thumbnail) {
        thumb.src = `${show.thumbnail}?v=${show.id}`;
        thumb.hidden = false;
        thumbPh.hidden = true;
      } else {
        thumb.hidden = true;
        thumbPh.hidden = false;
      }
      return;
    }

    if (show) {
      trackTitle.textContent = show.title || '—';
      trackArtist.textContent = show.author || '—';
      trackRequester.textContent = show.requestedBy ? `🙋 ${show.requestedBy}` : '';
      if (show.thumbnail) {
        thumb.src = `${show.thumbnail}?v=${show.id}`;
        thumb.hidden = false;
        thumbPh.hidden = true;
      } else {
        thumb.hidden = true;
        thumbPh.hidden = false;
      }
      return;
    }

    const err = d.lastPrepareError?.message;
    trackTitle.textContent = err ? 'Gagal memuat lagu' : 'Belum ada lagu';
    trackArtist.textContent = err
      ? `${d.lastPrepareError?.title || ''}: ${err.slice(0, 80)}`
      : 'Tambah via !play di WhatsApp';
    trackRequester.textContent = '';
    thumb.hidden = true;
    thumbPh.hidden = false;
  }

  function needsStreamReload(d) {
    if (!playbackArmed || !d.playbackActive) return false;
    const key = trackKey(d);
    if (!d.current || !d.hasStream || !key) return false;
    if (key !== activeTrackKey && key !== pendingTrackKey) return false;
    if (player.error) return true;
    return !player.src && !pendingTrackKey;
  }

  function checkAudioHealth() {
    if (!playbackArmed) return;
    if (lastNowData?.paused || lastNowData?.playback?.paused || userPaused) return;
    if (!lastNowData?.current || !lastNowData.hasStream) return;
    if (needsStreamReload(lastNowData)) {
      prepareStream(lastNowData);
    }
  }

  function syncPlaybackState(d) {
    lyricsState.playback = {
      positionSec: d.playback?.positionSec ?? 0,
      durationSec: d.playback?.durationSec ?? 0,
      progress: d.playback?.progress ?? 0,
      preparedAt: d.playback?.preparedAt ?? 0,
      durationLabel: d.playback?.durationLabel
    };
  }

  async function pollLyrics() {
    const cur = displayTrack(lastNowData);
    if (lyricsPollInFlight || !cur) return;
    const curId = cur.id;
    lyricsPollInFlight = true;
    try {
      const r = await fetch(`${API_LYRICS}?id=${curId}`, { cache: 'no-store' });
      const lyrics = await r.json();
      if (displayTrack(lastNowData)?.id !== curId) return;
      applyLyrics(lyrics, cur, lastNowData.playback);
    } catch (_) { /* retry next poll */ }
    finally {
      lyricsPollInFlight = false;
    }
  }

  async function pollNow() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
      const r = await fetch(API_NOW, { cache: 'no-store', signal: ctrl?.signal });
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      lastNowData = d;

      syncPlaybackState(d);
      syncServerPlayback(d);
      onTrackIdentityChange(d);
      renderDiscordStatus(d);
      renderQueue(d.queue || []);
      renderMeta(d);
      try {
        applyLyrics(d.lyrics, displayTrack(d), d.playback);
      } catch (lyricErr) {
        console.warn('lyrics render:', lyricErr);
      }
      const queuePrefetchKey = (d.queue || []).map((t) => t.id).join(',');
      if (queuePrefetchKey && queuePrefetchKey !== lastQueueLyricsPrefetchKey) {
        lastQueueLyricsPrefetchKey = queuePrefetchKey;
        prefetchQueueLyricsClient(d.queue);
      }

      const hasQueue = (d.queueLength || 0) > 0 || d.waitingPlay || d.upNext;
      if (d.playbackActive && d.hasStream && d.current) {
        if (!playbackArmed && userInteracted && !userPaused && !(d.paused ?? d.playback?.paused)) {
          armLocalPlayback();
          prepareStream(d);
        } else if (playbackArmed && needsStreamReload(d)) {
          prepareStream(d);
        } else {
          updateProgressDisplay();
        }
        btnSkip.disabled = false;
        btnStop.disabled = false;
        ensureTick();
      } else if (d.isPreparing && !d.playbackActive) {
        streamLoadGen += 1;
        activeTrackKey = null;
        pendingTrackKey = null;
        if (playbackArmed && player.src && !player.paused) player.pause();
        btnSkip.disabled = false;
        btnStop.disabled = false;
        ensureTick();
        updateProgressDisplay();
      } else if (hasQueue) {
        if (!playbackArmed && (activeTrackKey || pendingTrackKey)) disarmLocalPlayback();
        if (isAutoAdvancePending(d)) {
          setStatus('⏳ Menunggu lagu berikutnya — putar otomatis...', false);
        }
        btnSkip.disabled = false;
        btnStop.disabled = false;
        ensureTick();
        updateProgressDisplay();
      } else {
        if (activeTrackKey || pendingTrackKey) resetTrackState();
        btnSkip.disabled = true;
        btnStop.disabled = true;
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        if (lastNowData?.current || lastNowData?.upNext) {
          renderMeta(lastNowData);
          renderQueue(lastNowData.queue || []);
          setStatus('⚠️ Koneksi lambat — data terakhir ditampilkan', true);
        } else {
          setStatus('Koneksi radio terputus — mencoba lagi...', true);
        }
      }
    } finally {
      pollInFlight = false;
    }
  }

  async function postAction(path, { keepListening = false } = {}) {
    markUserInteraction();
    btnSkip.disabled = true;
    btnStop.disabled = true;
    setStatus('Memproses...');
    const wasListening = playbackArmed;
    if (!keepListening) {
      disarmLocalPlayback();
      lastStreamTrackKey = null;
      lastMetaKey = '';
      lastQueueKey = '';
      lyricsState.trackKey = null;
      lyricsState.contentKey = null;
      lyricsState.data = null;
    }
    player.pause();
    try {
      const r = await fetch(path, { method: 'POST', cache: 'no-store' });
      const d = await r.json();
      setStatus(d.message || (d.ok ? 'OK' : 'Gagal'), !d.ok);
      await pollNow();
      burstLyricsPoll();
      if (wasListening || keepListening) {
        armLocalPlayback();
        lastKnownServerPaused = false;
        userPaused = false;
        const d = lastNowData;
        const serverPaused = Boolean(d?.paused ?? d?.playback?.paused);
        if (d?.playbackActive && d?.hasStream && !serverPaused) {
          prepareStream(d);
        } else if (d && (d.isPreparing || d.waitingPlay || (d.queueLength || 0) > 0)) {
          void followAutoAdvance();
        }
      }
    } catch (e) {
      setStatus('Gagal menghubungi server', true);
    } finally {
      btnSkip.disabled = false;
      btnStop.disabled = false;
    }
  }

  async function postPlaybackAction(path) {
    const r = await fetch(path, { method: 'POST', cache: 'no-store' });
    const body = await r.json();
    if (!body.ok && path !== API_PAUSE) {
      throw new Error(body.message || 'Gagal');
    }
    return body;
  }

  async function requestServerPlay() {
    const r = await fetch(API_PLAY, { method: 'POST', cache: 'no-store' });
    const body = await r.json();
    if (!body.ok && !body.preparing) {
      setStatus(body.message || 'Gagal memulai', true);
      return false;
    }
    const maxWait = estimatePrepareWaitMs(lastNowData);
    const maxIter = Math.ceil(maxWait / 400);
    for (let i = 0; i < maxIter; i++) {
      await new Promise((res) => setTimeout(res, 400));
      await pollNow();
      if (lastNowData?.playbackActive && lastNowData?.hasStream) return true;
      if (!lastNowData?.isPreparing && i > 15 && !lastNowData?.hasStream && !(lastNowData?.queueLength || 0)) break;
    }
    return Boolean(lastNowData?.playbackActive && lastNowData?.hasStream);
  }

  btnPlay?.addEventListener('click', async () => {
    markUserInteraction();
    if (playBusy) return;

    const hasQueue = (lastNowData?.queueLength > 0) || lastNowData?.upNext || lastNowData?.waitingPlay;
    if (!hasQueue && !lastNowData?.playbackActive) {
      await pollNow();
      setStatus('Belum ada lagu — tambah via !play di WhatsApp', false);
      updatePlayBtn();
      return;
    }

    const serverPaused = Boolean(lastNowData?.paused ?? lastNowData?.playback?.paused);
    const hasLive = Boolean(lastNowData?.playbackActive && lastNowData?.hasStream);

    playBusy = true;
    updatePlayBtn();

    try {
      if (hasLive && !serverPaused) {
        await postPlaybackAction(API_PAUSE);
        lastKnownServerPaused = true;
        userPaused = true;
        if (playbackArmed) pausePlayerPlayback();
        await pollNow();
        setStatus('⏸️ Dijeda — admin & Discord ikut', false);
        return;
      }

      if (hasLive && serverPaused) {
        const body = await postPlaybackAction(API_RESUME);
        lastKnownServerPaused = false;
        userPaused = false;
        armLocalPlayback();
        if (body.playback) lastNowData = { ...lastNowData, playback: body.playback, paused: false };
        setStatus('▶️ Lanjut — sinkron admin & Discord', false);
        prepareStream(lastNowData);
        await pollNow();
        return;
      }

      armLocalPlayback();
      if (lastNowData?.playbackActive && lastNowData?.hasStream) {
        setStatus('🔊 Menyambung ke stream radio...', false);
        prepareStream(lastNowData);
        return;
      }
      if (lastNowData?.isPreparing && !lastNowData?.playbackActive) {
        setStatus('⏳ Mengunduh lagu...', false);
        void followAutoAdvance();
        return;
      }
      setStatus('⏳ Memulai pemutaran...', false);
      const ok = await requestServerPlay();
      if (!ok) {
        disarmLocalPlayback();
        setStatus('Gagal memulai — coba lagi', true);
        return;
      }
      prepareStream(lastNowData);
    } catch (e) {
      setStatus(e.message || 'Gagal', true);
    } finally {
      playBusy = false;
      updatePlayBtn();
    }
  });

  btnSkip?.addEventListener('click', () => postAction('/radio/api/skip', { keepListening: true }));
  btnStop?.addEventListener('click', () => {
    if (!confirm('Hentikan radio dan kosongkan antrian?')) return;
    postAction('/radio/api/stop');
  });

  player?.addEventListener('play', () => {
    if (!playbackArmed) {
      disarmLocalPlayback();
      return;
    }
    userPaused = false;
    updatePlayBtn();
  });
  player?.addEventListener('pause', updatePlayBtn);
  player?.addEventListener('playing', () => {
    if (!playbackArmed) {
      disarmLocalPlayback();
      return;
    }
    lastAudioProgressAt = Date.now();
    updatePlayBtn();
  });
  player?.addEventListener('ended', () => {
    if (playbackArmed) void followAutoAdvance();
    else void pollNow();
  });
  player?.addEventListener('timeupdate', () => {
    if (!playbackArmed) return;
    updateProgressFromPlayer();
  });
  player?.addEventListener('loadeddata', () => {
    if (!playbackArmed && player?.src) disarmLocalPlayback();
  });

  disarmLocalPlayback();
  initRobotEyes();

  resizeWave();
  if (!animWave) drawWave();
  window.addEventListener('resize', resizeWave);

  pollNow();
  pollLyrics();
  pollTimer = setInterval(pollNow, 800);
  setLyricsPollInterval(true);

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) disarmLocalPlayback();
  });

  window.addEventListener('beforeunload', () => {
    clearInterval(pollTimer);
    clearInterval(lyricsPollTimer);
    stopTick();
  });
})();