import fs from 'fs';
import path from 'path';
import express from 'express';
import ffmpeg from 'fluent-ffmpeg';
import { configureFluentFfmpeg } from '../utils/ffmpeg-path.js';

configureFluentFfmpeg(ffmpeg);
import { downloadYoutubeToMp3 } from '../utils/ytdlp-download.js';
import { enrichTrackMeta, formatDurationSec } from '../utils/youtube-meta.js';
import { mountAdminApi } from './admin-api.js';
import { mountWatchServer } from './watch-server.js';
import { mountPortfolioServer } from './portfolio-server.js';
import { getRadioPublicUrl as resolvePublicUrl } from '../utils/radio-url.js';
import { getListenPort } from '../utils/listen-port.js';
import { registerWaQrRoutes } from './wa-qr.js';
import {
    getCachedLyricsForTrack,
    getLyricsPrefetchStatus,
    prefetchQueueLyrics,
    scheduleLyricsPrefetch
} from './radio-lyrics.js';

/** Lazy — hindari circular import dengan discord-radio */
let discordRadioApi = null;
import('./discord-radio.js')
    .then((m) => { discordRadioApi = m; })
    .catch(() => {});

function getDiscordRadioBlock() {
    if (!discordRadioApi?.isDiscordRadioEnabled?.()) {
        return { enabled: false, inVoice: false, voiceChannel: null };
    }
    const d = discordRadioApi.getDiscordDiagnostics();
    return { enabled: true, inVoice: d.inVoice, voiceChannel: d.voiceChannel };
}

const RADIO_PORT = getListenPort();
const RADIO_DIR = './temp/radio';

let trackIdCounter = 0;
let serverStarted = false;
let advanceTimer = null;
let radioGeneration = 0;
let loadMutex = Promise.resolve();
let activeMp3Path = null;
const trackChangeListeners = new Set();

function ensureDirs() {
    if (!fs.existsSync(RADIO_DIR)) fs.mkdirSync(RADIO_DIR, { recursive: true });
}

function getActiveMp3Path() {
    return activeMp3Path && fs.existsSync(activeMp3Path) ? activeMp3Path : null;
}

function parkMp3File(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    try {
        fs.unlinkSync(filePath);
        return;
    } catch {
        /* Windows: file masih dibuka player/stream */
    }
    try {
        const parked = path.join(RADIO_DIR, `parked-${Date.now()}-${path.basename(filePath)}`);
        fs.renameSync(filePath, parked);
    } catch {
        /* biarkan — dibersihkan nanti */
    }
}

function pruneOldRadioFiles(keepPath = null) {
    try {
        ensureDirs();
        const now = Date.now();
        for (const name of fs.readdirSync(RADIO_DIR)) {
            const full = path.join(RADIO_DIR, name);
            if (full === keepPath) continue;
            if (!/^(play-|parked-|track-|current\.mp3)/.test(name)) continue;
            try {
                const age = now - fs.statSync(full).mtimeMs;
                if (age > 30 * 60 * 1000) parkMp3File(full);
            } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
}

function promoteTmpToPlayFile(tmpPath, gen, trackId) {
    ensureDirs();
    const dest = path.join(RADIO_DIR, `play-${gen}-${trackId}.mp3`);
    if (fs.existsSync(dest)) parkMp3File(dest);
    try {
        fs.renameSync(tmpPath, dest);
    } catch (e) {
        if (e?.code === 'EPERM' || e?.code === 'EBUSY') {
            fs.copyFileSync(tmpPath, dest);
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        } else {
            throw e;
        }
    }
    return dest;
}

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
    radio.playbackActive = false;
    if (activeMp3Path) {
        parkMp3File(activeMp3Path);
        activeMp3Path = null;
    }
    emitTrackChange();
}

export function getCurrentMp3Path() {
    return getActiveMp3Path() || path.join(RADIO_DIR, 'current.mp3');
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
    playbackActive: false,
    listeners: 0,
    lastPrepareError: null,
    lastPrepareAt: null
};

export function isRadioPlaying() {
    return Boolean(radio.current?.preparedAt);
}

function getUpNextTrack() {
    return radio.queue[0] || null;
}

function getDisplayTrack() {
    if (isRadioPlaying()) return radio.current;
    return getUpNextTrack();
}

function nextId() {
    trackIdCounter += 1;
    return trackIdCounter;
}

function syncGlobalQueue() {
    prefetchQueueLyrics(radio.queue, radio.current || radio.queue[0] || null);
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
    const display = getDisplayTrack();
    if (!cur?.preparedAt) {
        const dur = display?.durationSec || 0;
        return {
            positionSec: 0,
            durationSec: dur,
            progress: 0,
            preparedAt: 0,
            elapsedLabel: '0:00',
            durationLabel: dur > 0 ? formatDurationSec(dur) : (display?.duration || '0:00')
        };
    }
    const durationSec = cur.durationSec || 0;
    const positionSec = durationSec > 0
        ? Math.min(durationSec, Math.max(0, (Date.now() - cur.preparedAt) / 1000))
        : Math.max(0, (Date.now() - cur.preparedAt) / 1000);
    const progress = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
    return {
        positionSec,
        durationSec,
        progress,
        preparedAt: cur.preparedAt,
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
        handleTrackEnded().catch((e) => console.error('📻 Radio track ended:', e.message));
        return;
    }

    advanceTimer = setTimeout(() => {
        handleTrackEnded().catch((e) => console.error('📻 Radio track ended:', e.message));
    }, remainingMs);
}

/** Lagu selesai — berhenti, antrian berikutnya tunggu tombol Putar di web */
async function handleTrackEnded() {
    if (radio.isPreparing) return;
    clearAdvanceTimer();
    console.log('📻 Radio: lagu selesai — tunggu Putar untuk lagu berikutnya');
    stopCurrentPlayback();
}

export function getRadioPublicUrl() {
    return resolvePublicUrl();
}

export function getRadioListenUrl() {
    return `${getRadioPublicUrl()}/portfolio/radio`;
}

const PREPARE_TIMEOUT_MS = Number(process.env.RADIO_PREPARE_TIMEOUT_MS || 300_000);

async function prepareTrack(track, gen) {
    ensureDirs();
    const tmpPath = path.join(RADIO_DIR, `track-${track.id}.mp3`);
    try {
        await Promise.race([
            downloadYoutubeToMp3(track.url, tmpPath),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Download radio timeout')), PREPARE_TIMEOUT_MS);
            })
        ]);
    } catch (e) {
        if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch (_) {}
        throw e;
    }

    if (gen !== radioGeneration) {
        if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch (_) {}
        return false;
    }

    if (activeMp3Path) parkMp3File(activeMp3Path);

    const playPath = promoteTmpToPlayFile(tmpPath, gen, track.id);
    if (gen !== radioGeneration) {
        parkMp3File(playPath);
        return false;
    }

    activeMp3Path = playPath;
    pruneOldRadioFiles(playPath);

    const fileDuration = await getMp3DurationSec(playPath);
    const durationSec = fileDuration || track.durationSec || 0;
    radio.playbackActive = true;
    radio.current = {
        ...track,
        durationSec,
        duration: formatDurationSec(durationSec) || track.duration || '-',
        preparedAt: Date.now(),
        filePath: playPath
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
    radio.lastPrepareError = null;
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
        radio.lastPrepareError = null;
        console.log(`📻 Radio: now playing ${track.title} (sisa antrian: ${radio.queue.length})`);
        return true;
    } catch (e) {
        if (gen !== radioGeneration) return false;
        const errMsg = e.message || String(e);
        radio.lastPrepareError = { title: track.title, message: errMsg, at: Date.now() };
        console.error('📻 Radio gagal memuat:', track.title, errMsg);
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

/** Mulai lagu dari antrian — hanya dipanggil saat tombol Putar di web */
export async function startRadioPlayback() {
    if (radio.isPreparing) {
        return { ok: false, preparing: true, message: '⏳ Sedang mengunduh lagu...' };
    }
    if (!radio.queue.length) {
        return { ok: false, message: 'Antrian kosong — tambah via !play dulu.' };
    }
    if (isRadioPlaying()) {
        radio.current.preparedAt = Date.now();
        bumpRadioGeneration();
        scheduleAutoAdvance();
        return {
            ok: true,
            restarted: true,
            message: `▶️ ${radio.current.title} — mulai dari awal`,
            streamEpoch: radioGeneration
        };
    }

    return withLoadLock(async () => {
        const gen = radioGeneration;
        const ok = await startQueueHead(gen);
        return {
            ok,
            preparing: false,
            restarted: false,
            message: ok
                ? `▶️ Memutar: ${radio.current?.title || 'lagu'}`
                : (radio.lastPrepareError?.message || 'Gagal memuat lagu'),
            streamEpoch: radioGeneration,
            queueLength: radio.queue.length
        };
    });
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
    scheduleLyricsPrefetch(entry);
    syncGlobalQueue();
    console.log(`📻 Antrian +1: ${entry.title} (total ${radio.queue.length}) — tunggu Putar di web`);
    return entry;
}

export async function skipRadioTrack() {
    const preparingTitle = radio.isPreparing ? radio.queue[0]?.title : null;
    const skipped = radio.current?.title || preparingTitle;
    const hadSomething = Boolean(radio.current || radio.queue.length || radio.isPreparing);
    if (!hadSomething) {
        return { ok: false, message: 'Tidak ada lagu yang diputar.' };
    }

    const wasPreparingOnly = !radio.current && radio.isPreparing;
    const queueBefore = radio.queue.length;
    console.log(`📻 Skip diminta: "${skipped || '—'}" · antrian ${queueBefore}${wasPreparingOnly ? ' (batalkan unduhan)' : ''}`);

    return withLoadLock(async () => {
        resetPlayPipeline();
        const gen = radioGeneration;

        if (radio.isPreparing) {
            radio.isPreparing = false;
        }

        const wasPlaying = isRadioPlaying();
        stopCurrentPlayback();

        if (wasPlaying) {
            /* lagu yang diputar sudah di-shift saat startQueueHead — tidak perlu shift lagi */
        } else if (wasPreparingOnly && radio.queue.length) {
            radio.queue.shift();
            syncGlobalQueue();
        } else if (radio.queue.length) {
            radio.queue.shift();
            syncGlobalQueue();
        }

        const nextTitle = radio.queue[0]?.title;
        console.log(`📻 Skip selesai · sisa antrian ${radio.queue.length}${nextTitle ? ` · berikutnya: ${nextTitle}` : ''}`);
        return {
            ok: true,
            message: nextTitle
                ? `⏭️ Skip: *${skipped || '—'}* · Berikutnya: *${nextTitle}* — klik Putar di web`
                : `⏭️ Skip: *${skipped || '—'}* · Antrian kosong.`,
            streamEpoch: gen,
            queueLength: radio.queue.length
        };
    });
}

export function clearRadioQueue() {
    resetPlayPipeline();
    radio.queue = [];
    stopCurrentPlayback();
    console.log('📻 Antrian dikosongkan (clear)');
}

export function getRadioStatusText() {
    const now = isRadioPlaying()
        ? `🎶 *Sedang diputar:*\n${radio.current.title}\n👤 ${radio.current.author}\n🙋 ${radio.current.requestedBy}`
        : radio.isPreparing
            ? '⏳ Sedang memuat lagu...'
            : radio.queue.length
                ? `⏸️ *Siap diputar:*\n${radio.queue[0].title}\n👤 ${radio.queue[0].author}\n🙋 ${radio.queue[0].requestedBy}\n_Klik Putar di web untuk mulai._`
                : '_Belum ada lagu di antrian._';

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

export function attachRadioServer(app) {
    if (app._luxxRadioAttached) return;
    app._luxxRadioAttached = true;
    ensureDirs();

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
        const streamPath = getActiveMp3Path();
        if (!streamPath) {
            return res.status(404).send('No track');
        }
        const stat = fs.statSync(streamPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache, no-store');

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            if (Number.isNaN(start) || start >= fileSize) {
                res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
                return;
            }
            const safeEnd = Math.min(end, fileSize - 1);
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${safeEnd}/${fileSize}`);
            res.setHeader('Content-Length', safeEnd - start + 1);
            fs.createReadStream(streamPath, { start, end: safeEnd }).pipe(res);
            return;
        }

        res.setHeader('Content-Length', fileSize);
        fs.createReadStream(streamPath).pipe(res);
    });

    function resolveRadioTrackById(id) {
        if (!id) return null;
        if (radio.current?.id === id) return radio.current;
        return radio.queue.find((t) => t.id === id) || null;
    }

    app.get('/radio/api/lyrics', (req, res) => {
        const wantId = Number(req.query.id);
        const track = wantId
            ? resolveRadioTrackById(wantId)
            : (isRadioPlaying() ? radio.current : getUpNextTrack());
        if (!track) {
            return res.json({ found: false, loading: false, lyrics: null, trackId: wantId || null });
        }
        const lyrics = getCachedLyricsForTrack(track);
        res.json({ ...lyrics, trackId: track.id });
    });

    app.post('/radio/api/play', async (req, res) => {
        const result = await startRadioPlayback();
        res.json({
            ...result,
            queueLength: radio.queue.length,
            hasStream: Boolean(getActiveMp3Path() && isRadioPlaying())
        });
    });

    app.get('/radio/api/now', (req, res) => {
        const playing = isRadioPlaying();
        const upNext = !playing ? getUpNextTrack() : null;
        const lyricsTrack = playing ? radio.current : upNext;
        const lyrics = lyricsTrack
            ? { ...getCachedLyricsForTrack(lyricsTrack), trackId: lyricsTrack.id }
            : { found: false, loading: false, lyrics: null, trackId: null };

        const mapTrack = (t) => t ? {
            id: t.id,
            title: t.title,
            author: t.author,
            requestedBy: t.requestedBy,
            thumbnail: t.thumbnail,
            duration: t.duration,
            durationSec: t.durationSec
        } : null;

        res.json({
            current: playing ? mapTrack(radio.current) : null,
            upNext: mapTrack(upNext),
            playbackActive: playing,
            waitingPlay: Boolean(!playing && radio.queue.length),
            queue: radio.queue.map((t) => {
                const ls = getLyricsPrefetchStatus(t);
                return {
                    id: t.id,
                    title: t.title,
                    author: t.author,
                    requestedBy: t.requestedBy,
                    duration: t.duration,
                    lyricsReady: ls.ready,
                    lyricsLoading: ls.loading
                };
            }),
            queueLength: radio.queue.length,
            isPreparing: radio.isPreparing,
            lastPrepareError: radio.lastPrepareError,
            hasStream: Boolean(getActiveMp3Path() && playing),
            playback: getRadioPlayback(),
            streamEpoch: radioGeneration,
            lyrics,
            discord: getDiscordRadioBlock(),
            serverTime: Date.now()
        });
    });

    app.post('/radio/api/skip', async (req, res) => {
        const result = await skipRadioTrack();
        res.json({
            ok: result.ok,
            message: result.message,
            streamEpoch: result.streamEpoch ?? radioGeneration,
            queueLength: result.queueLength ?? radio.queue.length
        });
    });

    app.post('/radio/api/stop', (req, res) => {
        clearRadioQueue();
        res.json({
            ok: true,
            message: 'Radio dihentikan dan antrian dikosongkan.',
            streamEpoch: radioGeneration,
            queueLength: 0
        });
    });

    app.get('/radio', (_req, res) => {
        res.redirect(302, '/portfolio/radio');
    });

}

export function startRadioServer(externalApp = null) {
    if (serverStarted) return externalApp;
    serverStarted = true;

    const app = externalApp || express();
    if (!externalApp) {
        app.set('trust proxy', true);
        app.use(express.json({ limit: '1mb' }));
    }

    attachRadioServer(app);

    if (!externalApp) {
        registerWaQrRoutes(app);
        const bindHost = process.env.RADIO_BIND_HOST || '0.0.0.0';
        app.listen(RADIO_PORT, bindHost, () => {
            console.log(`\x1b[35m📻 LuxxBot Radio: ${getRadioListenUrl()} (bind ${bindHost}:${RADIO_PORT})\x1b[0m`);
            const pub = getRadioPublicUrl();
            if (/localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./i.test(pub)) {
                console.log('\x1b[33m⚠️  RADIO_PUBLIC_URL masih lokal/LAN — jalankan scripts/radio-tunnel.ps1 untuk link publik\x1b[0m');
            }
        });
    }

    return app;
}