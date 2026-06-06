import fs from 'fs';
import path from 'path';
import express from 'express';
import { downloadYoutubeToMp3 } from '../utils/ytdlp-download.js';
import { mountAdminApi } from './admin-api.js';

const RADIO_PORT = Number(process.env.RADIO_PORT || 3920);
const RADIO_DIR = './temp/radio';
const CURRENT_MP3 = path.join(RADIO_DIR, 'current.mp3');

let trackIdCounter = 0;
let serverStarted = false;
const trackChangeListeners = new Set();

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

export function getRadioPublicUrl() {
    return (process.env.RADIO_PUBLIC_URL || `http://localhost:${RADIO_PORT}`).replace(/\/$/, '');
}

export function getRadioListenUrl() {
    return `${getRadioPublicUrl()}/radio`;
}

function ensureDirs() {
    if (!fs.existsSync(RADIO_DIR)) fs.mkdirSync(RADIO_DIR, { recursive: true });
}

async function prepareTrack(track) {
    ensureDirs();
    const tmpPath = path.join(RADIO_DIR, `track-${track.id}.mp3`);
    await downloadYoutubeToMp3(track.url, tmpPath);
    if (fs.existsSync(CURRENT_MP3)) fs.unlinkSync(CURRENT_MP3);
    fs.renameSync(tmpPath, CURRENT_MP3);
    radio.current = { ...track, preparedAt: Date.now() };
    emitTrackChange();
}

async function playNext() {
    if (radio.isPreparing) return;
    if (!radio.queue.length) {
        radio.current = null;
        return;
    }

    radio.isPreparing = true;
    const track = radio.queue.shift();
    try {
        console.log(`📻 Radio: memuat ${track.title}...`);
        await prepareTrack(track);
        console.log(`📻 Radio: now playing ${track.title}`);
    } catch (e) {
        console.error('📻 Radio gagal memuat:', track.title, e.message);
        radio.isPreparing = false;
        if (radio.queue.length) return playNext();
        radio.current = null;
        emitTrackChange();
        return;
    }
    radio.isPreparing = false;
}

export async function addTrackToRadio(track, requestedBy = 'user') {
    const entry = {
        id: nextId(),
        title: track.title,
        url: track.url,
        duration: track.timestamp || track.duration || '-',
        author: track.author?.name || track.author || 'Unknown',
        requestedBy
    };
    radio.queue.push(entry);
    global.radioQueue = radio.queue.map(t => ({
        title: t.title,
        url: t.url,
        duration: t.duration,
        requestedBy: t.requestedBy
    }));

    if (!radio.current && !radio.isPreparing) {
        playNext().catch((e) => console.error('📻 Radio playNext:', e.message));
    }
    return entry;
}

export async function skipRadioTrack() {
    if (radio.isPreparing) {
        return { ok: false, message: 'Radio masih memuat lagu, tunggu sebentar...' };
    }
    const skipped = radio.current?.title;
    if (!skipped && radio.queue.length === 0) {
        return { ok: false, message: 'Tidak ada lagu yang diputar.' };
    }
    radio.current = null;
    if (!radio.queue.length) {
        if (fs.existsSync(CURRENT_MP3)) try { fs.unlinkSync(CURRENT_MP3); } catch (_) {}
        emitTrackChange();
        return { ok: true, message: `⏭️ Skip: *${skipped || '—'}* · Antrian kosong.` };
    }
    await playNext();
    return { ok: true, message: `⏭️ Skip: *${skipped || '—'}*` };
}

export function clearRadioQueue() {
    radio.queue = [];
    radio.current = null;
    radio.isPreparing = false;
    global.radioQueue = [];
    if (fs.existsSync(CURRENT_MP3)) {
        try { fs.unlinkSync(CURRENT_MP3); } catch (_) {}
    }
    emitTrackChange();
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
            isPreparing: radio.isPreparing
        });
    });

    app.get('/radio', (req, res) => {
        const title = radio.current?.title || 'LuxxBot Radio';
        const artist = radio.current?.author || '—';
        const streamUrl = '/radio/live.mp3';
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<!DOCTYPE html>
<html lang="id"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LuxxBot Radio</title>
<style>
  body{font-family:system-ui;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:rgba(255,255,255,.08);backdrop-filter:blur(12px);border-radius:20px;padding:2rem;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.3)}
  h1{margin:0 0 .5rem;font-size:1.5rem} p{opacity:.85;margin:.3rem 0}
  audio{width:100%;margin-top:1.2rem} .badge{display:inline-block;background:#ff69b4;padding:.2rem .6rem;border-radius:8px;font-size:.75rem}
</style></head><body>
<div class="card">
  <span class="badge">LIVE</span>
  <h1>📻 LuxxBot Radio</h1>
  <p id="track"><b>${title}</b><br/>${artist}</p>
  <audio id="player" controls autoplay src="${streamUrl}"></audio>
  <p style="font-size:.8rem;margin-top:1rem">Antrian: <span id="q">0</span> · Auto-refresh saat ganti lagu</p>
</div>
<script>
let lastId = null;
const player = document.getElementById('player');
async function poll() {
  try {
    const r = await fetch('/radio/api/now');
    const d = await r.json();
    document.getElementById('q').textContent = d.queueLength;
    if (d.current) {
      document.getElementById('track').innerHTML = '<b>'+d.current.title+'</b><br/>'+d.current.author;
      const id = d.current.id;
      if (lastId !== id) { lastId = id; player.src = '${streamUrl}?t=' + Date.now(); player.play().catch(()=>{}); }
    }
  } catch(e) {}
}
setInterval(poll, 5000); poll();
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