import fs from 'fs';
import path from 'path';
import express from 'express';
import ffmpeg from 'fluent-ffmpeg';
import { downloadYoutubeToMp3 } from '../utils/ytdlp-download.js';
import { enrichTrackMeta, formatDurationSec } from '../utils/youtube-meta.js';
import { mountAdminApi } from './admin-api.js';
import { mountWatchServer } from './watch-server.js';
import { mountPortfolioServer } from './portfolio-server.js';

const RADIO_PORT = Number(process.env.RADIO_PORT || 3920);
const RADIO_DIR = './temp/radio';
const CURRENT_MP3 = path.join(RADIO_DIR, 'current.mp3');

let trackIdCounter = 0;
let serverStarted = false;
let advanceTimer = null;
let radioGeneration = 0;
let loadMutex = Promise.resolve();
const trackChangeListeners = new Set();

export function getRadioStreamEpoch() {
    return radioGeneration;
}

function bumpRadioGeneration() {
    radioGeneration += 1;
    return radioGeneration;
}

function resetPlayPipeline() {
    bumpRadioGeneration();
    radio.isPreparing = false;
}

function withLoadLock(fn) {
    const run = loadMutex.then(fn);
    loadMutex = run.catch(() => {});
    return run;
}

function stopCurrentPlayback() {
    clearAdvanceTimer();
    radio.current = null;
    if (fs.existsSync(CURRENT_MP3)) {
        try { fs.unlinkSync(CURRENT_MP3); } catch (_) {}
    }
    emitTrackChange();
}

export function getCurrentMp3Path() {
    return CURRENT_MP3;
}

export function onRadioTrackChange(fn) {
    trackChangeListeners.add(fn);
    return () => trackChangeListeners.delete(fn);
}

function emitTrackChange() {
    const payload = radio.current;
    for (const fn of trackChangeListeners) {
        try { fn(payload); } catch (e) { console.error('radio track listener:', e.message); }
    }
}

export const radio = {
    queue: [],
    current: null,
    isPreparing: false,
    listeners: 0
};

function nextId() {
    trackIdCounter += 1;
    return trackIdCounter;
}

function syncGlobalQueue() {
    global.radioQueue = radio.queue.map((t) => ({
        title: t.title,
        url: t.url,
        duration: t.duration,
        requestedBy: t.requestedBy,
        thumbnail: t.thumbnail
    }));
}

function clearAdvanceTimer() {
    if (advanceTimer) {
        clearTimeout(advanceTimer);
        advanceTimer = null;
    }
}

function getMp3DurationSec(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, data) => {
            if (err) return resolve(0);
            resolve(Math.floor(data?.format?.duration || 0));
        });
    });
}

export function isCurrentTrackFinished() {
    const cur = radio.current;
    if (!cur?.preparedAt || !cur.durationSec) return false;
    return (Date.now() - cur.preparedAt) / 1000 >= cur.durationSec - 0.5;
}

export function getRadioPlayback() {
    const cur = radio.current;
    if (!cur?.preparedAt) {
        return { positionSec: 0, durationSec: 0, progress: 0, elapsedLabel: '0:00', durationLabel: '0:00' };
    }
    const durationSec = cur.durationSec || 0;
    const positionSec = durationSec > 0
        ? Math.min(durationSec, Math.max(0, Math.floor((Date.now() - cur.preparedAt) / 1000)))
        : Math.max(0, Math.floor((Date.now() - cur.preparedAt) / 1000));
    const progress = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
    return {
        positionSec,
        durationSec,
        progress,
        elapsedLabel: formatDurationSec(positionSec),
        durationLabel: formatDurationSec(durationSec) || cur.duration || '-'
    };
}

function scheduleAutoAdvance() {
    clearAdvanceTimer();
    const cur = radio.current;
    if (!cur?.preparedAt || !cur.durationSec || cur.durationSec < 3) return;

    const remainingMs = (cur.durationSec * 1000) - (Date.now() - cur.preparedAt) + 600;
    if (remainingMs <= 0) {
        finishCurrentAndPlayNext().catch((e) => console.error('📻 Radio auto-advance:', e.message));
        return;
    }

    advanceTimer = setTimeout(() => {
        finishCurrentAndPlayNext().catch((e) => console.error('📻 Radio auto-advance:', e.message));
    }, remainingMs);
}

async function finishCurrentAndPlayNext() {
    if (radio.isPreparing) return;
    clearAdvanceTimer();
    if (fs.existsSync(CURRENT_MP3)) {
        try { fs.unlinkSync(CURRENT_MP3); } catch (_) {}
    }
    radio.current = null;
    emitTrackChange();
    if (radio.queue.length) {
        await withLoadLock(() => startQueueHead(radioGeneration));
    }
}

export function getRadioPublicUrl() {
    return (process.env.RADIO_PUBLIC_URL || `http://localhost:${RADIO_PORT}`).replace(/\/$/, '');
}

export function getRadioListenUrl() {
    return `${getRadioPublicUrl()}/radio`;
}

function ensureDirs() {
    if (!fs.existsSync(RADIO_DIR)) fs.mkdirSync(RADIO_DIR, { recursive: true });
}

async function prepareTrack(track, gen) {
    ensureDirs();
    const tmpPath = path.join(RADIO_DIR, `track-${track.id}.mp3`);
    try {
        await downloadYoutubeToMp3(track.url, tmpPath);
    } catch (e) {
        if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch (_) {}
        throw e;
    }

    if (gen !== radioGeneration) {
        if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch (_) {}
        return false;
    }

    if (fs.existsSync(CURRENT_MP3)) fs.unlinkSync(CURRENT_MP3);
    fs.renameSync(tmpPath, CURRENT_MP3);

    if (gen !== radioGeneration) {
        if (fs.existsSync(CURRENT_MP3)) try { fs.unlinkSync(CURRENT_MP3); } catch (_) {}
        return false;
    }

    const fileDuration = await getMp3DurationSec(CURRENT_MP3);
    const durationSec = fileDuration || track.durationSec || 0;
    radio.current = {
        ...track,
        durationSec,
        duration: formatDurationSec(durationSec) || track.duration || '-',
        preparedAt: Date.now()
    };
    emitTrackChange();
    scheduleAutoAdvance();
    return true;
}

async function startQueueHead(gen) {
    if (gen !== radioGeneration) return false;
    if (!radio.queue.length) return false;
    if (radio.isPreparing) return false;

    radio.isPreparing = true;
    const track = radio.queue[0];

    try {
        console.log(`📻 Radio: memuat ${track.title}... (antrian: ${radio.queue.length})`);
        const ok = await prepareTrack(track, gen);
        if (!ok || gen !== radioGeneration) {
            console.log(`📻 Radio: dibatalkan — ${track.title}`);
            return false;
        }
        radio.queue.shift();
        syncGlobalQueue();
        console.log(`📻 Radio: now playing ${track.title} (sisa antrian: ${radio.queue.length})`);
        return true;
    } catch (e) {
        if (gen !== radioGeneration) return false;
        console.error('📻 Radio gagal memuat:', track.title, e.message);
        radio.queue.shift();
        syncGlobalQueue();
        if (radio.queue.length && gen === radioGeneration) {
            radio.isPreparing = false;
            return startQueueHead(gen);
        }
        radio.current = null;
        emitTrackChange();
        return false;
    } finally {
        if (gen === radioGeneration) radio.isPreparing = false;
    }
}

function kickPlaybackIfIdle() {
    if (radio.current || radio.isPreparing || !radio.queue.length) return;
    withLoadLock(() => startQueueHead(radioGeneration))
        .catch((e) => console.error('📻 kickPlayback:', e.message));
}

export async function addTrackToRadio(track, requestedBy = 'user') {
    const meta = enrichTrackMeta(track);
    const entry = {
        id: nextId(),
        title: meta.title || 'Unknown',
        url: meta.url,
        duration: meta.duration,
        durationSec: meta.durationSec,
        thumbnail: meta.thumbnail,
        videoId: meta.videoId,
        author: meta.author?.name || meta.author || 'Unknown',
        requestedBy
    };
    radio.queue.push(entry);
    syncGlobalQueue();

    kickPlaybackIfIdle();
    if (isCurrentTrackFinished() && !radio.isPreparing) {
        await finishCurrentAndPlayNext();
    }
    return entry;
}

export async function skipRadioTrack() {
    const skipped = radio.current?.title;
    const hadSomething = Boolean(radio.current || radio.queue.length || radio.isPreparing);
    if (!hadSomething) {
        return { ok: false, message: 'Tidak ada lagu yang diputar.' };
    }

    const queueBefore = radio.queue.length;
    console.log(`📻 Skip diminta: "${skipped || '—'}" · antrian ${queueBefore}`);

    return withLoadLock(async () => {
        resetPlayPipeline();
        const gen = radioGeneration;
        stopCurrentPlayback();

        if (!radio.queue.length) {
            console.log('📻 Skip: antrian kosong setelah hentikan lagu sekarang');
            return {
                ok: true,
                message: `⏭️ Skip: *${skipped || '—'}* · Antrian kosong.`,
                streamEpoch: gen,
                queueLength: 0
            };
        }

        await startQueueHead(gen);

        const nextTitle = radio.current?.title || radio.queue[0]?.title || 'lagu berikutnya';
        console.log(`📻 Skip selesai → "${nextTitle}" · sisa antrian ${radio.queue.length}`);
        return {
            ok: true,
            message: `⏭️ Skip: *${skipped || '—'}* → *${nextTitle}*`,
            streamEpoch: gen,
            queueLength: radio.queue.length
        };
    });
}

export function clearRadioQueue() {
    resetPlayPipeline();
    radio.queue = [];
    global.radioQueue = [];
    stopCurrentPlayback();
    console.log('📻 Antrian dikosongkan (clear)');
}

export function getRadioStatusText() {
    const now = radio.current
        ? `🎶 *Sedang diputar:*\n${radio.current.title}\n👤 ${radio.current.author}\n🙋 ${radio.current.requestedBy}`
        : radio.isPreparing
            ? '⏳ Sedang memuat lagu...'
            : '_Belum ada lagu diputar._';

    const queueLines = radio.queue.length
        ? radio.queue.slice(0, 8).map((t, i) => `${i + 1}. ${t.title} — ${t.requestedBy}`).join('\n')
        : '_Antrian kosong_';

    return (
        `📻 *LUXXBOT RADIO* (dengar musik)\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${now}\n\n` +
        `📋 *Antrian (${radio.queue.length}):*\n${queueLines}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👇 _Link player dikirim terpisah — ketuk kartu biru untuk buka_\n\n` +
        `🎵 \`!play\` · 🎶 \`!nowplaying\` · 📋 \`!queue\` · ⏭️ \`!skip\` · 📝 \`!lirik\`\n` +
        `🎧 \`!discord\` · Discord \`/join\` \`/play\` \`/queue\` \`/lirik\` \`/leave\` \`/stop\``
    );
}

export function startRadioServer() {
    if (serverStarted) return;
    ensureDirs();

    const app = express();
    app.use(express.json());

    mountAdminApi(app);
    mountWatchServer(app);
    mountPortfolioServer(app);

    app.get('/', (req, res) => {
        res.redirect(302, '/admin');
    });

    app.get('/health', (req, res) => {
        res.json({
            ok: true,
            current: radio.current?.title || null,
            queueLength: radio.queue.length,
            isPreparing: radio.isPreparing,
            listenUrl: getRadioListenUrl()
        });
    });

    app.get('/radio/live.mp3', (req, res) => {
        if (!fs.existsSync(CURRENT_MP3)) {
            return res.status(404).send('No track');
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(CURRENT_MP3).pipe(res);
    });

    app.get('/radio/api/now', (req, res) => {
        res.json({
            current: radio.current,
            queueLength: radio.queue.length,
            isPreparing: radio.isPreparing,
            playback: getRadioPlayback(),
            streamEpoch: radioGeneration
        });
    });

    app.get('/radio', (req, res) => {
        const title = radio.current?.title || 'LuxxBot Radio';
        const artist = radio.current?.author || '—';
        const thumb = radio.current?.thumbnail || '';
        const streamUrl = '/radio/live.mp3';
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<!DOCTYPE html>
<html lang="id"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LuxxBot Radio</title>
<style>
  body{font-family:system-ui;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:rgba(255,255,255,.08);backdrop-filter:blur(12px);border-radius:20px;padding:1.4rem;max-width:440px;width:92%;box-shadow:0 8px 32px rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1)}
  .row{display:flex;gap:1rem;align-items:center}
  .thumb{width:88px;height:66px;border-radius:10px;object-fit:cover;background:#222;border:1px solid rgba(255,255,255,.12)}
  h1{margin:0 0 .35rem;font-size:1.2rem} p{opacity:.85;margin:.2rem 0}
  audio{width:100%;margin-top:1rem;height:36px}
  .badge{display:inline-block;background:#ff69b4;padding:.2rem .6rem;border-radius:8px;font-size:.75rem;margin-bottom:.6rem}
</style></head><body>
<div class="card">
  <span class="badge">LIVE</span>
  <div class="row">
    <img id="thumb" class="thumb" src="${thumb}" alt="" onerror="this.style.display='none'"/>
    <div><h1>📻 LuxxBot Radio</h1><p id="track"><b>${title}</b><br/>${artist}</p></div>
  </div>
  <audio id="player" controls autoplay src="${streamUrl}"></audio>
  <p style="font-size:.8rem;margin-top:1rem">Antrian: <span id="q">0</span></p>
</div>
<script>
let lastKey = null;
const player = document.getElementById('player');
function stopPlayer() {
  player.pause();
  player.removeAttribute('src');
  player.load();
}
async function poll() {
  try {
    const r = await fetch('/radio/api/now');
    const d = await r.json();
    document.getElementById('q').textContent = d.queueLength;
    const key = (d.streamEpoch || 0) + ':' + (d.current?.id || 'idle');
    if (d.isPreparing && !d.current) {
      const next = d.queueLength ? 'Memuat lagu berikutnya...' : 'Tunggu sebentar';
      document.getElementById('track').innerHTML = '<b>Memuat lagu...</b><br/>' + next;
      document.getElementById('thumb').style.display = 'none';
      if (lastKey !== key) { lastKey = key; stopPlayer(); }
    } else if (d.current) {
      document.getElementById('track').innerHTML = '<b>' + d.current.title + '</b><br/>' + d.current.author;
      const t = document.getElementById('thumb');
      if (d.current.thumbnail) {
        if (lastKey !== key) { t.style.display = 'block'; t.src = d.current.thumbnail + '?v=' + d.current.id; }
      } else t.style.display = 'none';
      if (lastKey !== key) {
        lastKey = key;
        stopPlayer();
        player.src = '${streamUrl}?epoch=' + d.streamEpoch + '&id=' + d.current.id + '&t=' + Date.now();
        player.play().catch(() => {});
      }
    } else {
      lastKey = null;
      document.getElementById('track').innerHTML = '<b>Belum ada lagu</b><br/>Tambah via !play';
      document.getElementById('thumb').style.display = 'none';
      stopPlayer();
    }
  } catch (e) {}
}
setInterval(poll, 3000); poll();
</script></body></html>`);
    });

    const bindHost = process.env.RADIO_BIND_HOST || '0.0.0.0';
    app.listen(RADIO_PORT, bindHost, () => {
        console.log(`\x1b[35m📻 LuxxBot Radio: ${getRadioListenUrl()} (bind ${bindHost}:${RADIO_PORT})\x1b[0m`);
        const pub = getRadioPublicUrl();
        if (/localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./i.test(pub)) {
            console.log('\x1b[33m⚠️  RADIO_PUBLIC_URL masih lokal/LAN — jalankan scripts/radio-tunnel.ps1 untuk link publik\x1b[0m');
        }
    });
    serverStarted = true;
}