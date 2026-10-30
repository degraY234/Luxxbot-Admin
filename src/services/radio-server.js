import fs from 'fs';
import path from 'path';
import express from 'express';
import ffmpeg from 'fluent-ffmpeg';
import { configureFluentFfmpeg } from '../utils/ffmpeg-path.js';

configureFluentFfmpeg(ffmpeg);
import { downloadYoutubeToMp3 } from '../utils/ytdlp-download.js';
import { enrichTrackMeta, formatDurationSec, youtubeThumbnail } from '../utils/youtube-meta.js';
import { mountAdminApi } from './admin-api.js';
import { mountWatchServer } from './watch-server.js';
import { mountPortfolioServer } from './portfolio-server.js';
import { getRadioPublicUrl as resolvePublicUrl, getLanIPv4, extractTunnelUrlsFromLogs } from '../utils/radio-url.js';
import { getListenPort } from '../utils/listen-port.js';
import { registerWaQrRoutes } from './wa-qr.js';
import { applyLuxxAppCors } from '../utils/app-cors.js';
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

function requestDiscordSync(reason, delayMs = 500) {
    discordRadioApi?.requestDiscordRadioSync?.(reason, delayMs);
}

const RADIO_PORT = getListenPort();
const RADIO_DIR = './temp/radio';

let trackIdCounter = 0;
let serverStarted = false;
const playbackHistory = [];
const playerModes = { shuffle: false, repeat: 'off' };
let lastFinishedTrack = null;
let advanceTimer = null;
let radioGeneration = 0;
let playbackSeq = 0;
let loadMutex = Promise.resolve();
let activeMp3Path = null;
/** @type {Map<number, Promise<void>>} */
const prefetchJobs = new Map();
const trackChangeListeners = new Set();
const playbackStateListeners = new Set();

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
            if (/\.(webm|part)$/i.test(name)) {
                try { fs.unlinkSync(full); } catch { /* ignore */ }
                continue;
            }
            if (!/^(play-|parked-|track-|prefetch-|current\.mp3)/.test(name)) continue;
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
    prefetchJobs.clear();
    abortActiveYtDlpDownload();
}

function withLoadLock(fn) {
    const run = loadMutex.then(fn);
    loadMutex = run.catch(() => {});
    return run;
}

function stopCurrentPlayback({ keepSession = false } = {}) {
    clearAdvanceTimer();
    radio.current = null;
    radio.playbackActive = false;
    radio.paused = false;
    if (!keepSession) radio.sessionActive = false;
    if (activeMp3Path) {
        parkMp3File(activeMp3Path);
        activeMp3Path = null;
    }
    emitTrackChange();
    emitPlaybackStateChange();
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
    emitPlaybackStateChange();
}

export function onRadioPlaybackStateChange(fn) {
    playbackStateListeners.add(fn);
    return () => playbackStateListeners.delete(fn);
}

function emitPlaybackStateChange() {
    const payload = {
        paused: Boolean(radio.paused),
        positionSec: getPlaybackPositionSec(),
        track: radio.current,
        streamEpoch: radioGeneration,
        playbackSeq
    };
    for (const fn of playbackStateListeners) {
        try { fn(payload); } catch (e) { console.error('radio playback listener:', e.message); }
    }
}

export const radio = {
    queue: [],
    current: null,
    isPreparing: false,
    playbackActive: false,
    /** True setelah Putar pertama — lagu berikutnya auto-advance + prefetch antrian */
    sessionActive: false,
    paused: false,
    listeners: 0,
    lastPrepareError: null,
    lastPrepareAt: null
};

export function isRadioPlaying() {
    return Boolean(radio.current?.preparedAt);
}

export function isRadioPaused() {
    return Boolean(radio.paused && isRadioPlaying());
}

export function isRadioSessionActive() {
    return Boolean(radio.sessionActive);
}

function getPlaybackPositionSec() {
    const cur = radio.current;
    if (!cur?.preparedAt) return 0;
    if (radio.paused) {
        return Math.max(0, cur.pausedPositionSec || 0);
    }
    const durationSec = cur.durationSec || 0;
    const pos = (Date.now() - cur.preparedAt) / 1000;
    return durationSec > 0 ? Math.min(durationSec, Math.max(0, pos)) : Math.max(0, pos);
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
    if (!cur?.preparedAt || !cur.durationSec || radio.paused) return false;
    return getPlaybackPositionSec() >= cur.durationSec - 0.5;
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
            paused: false,
            elapsedLabel: '0:00',
            durationLabel: dur > 0 ? formatDurationSec(dur) : (display?.duration || '0:00')
        };
    }
    const durationSec = cur.durationSec || 0;
    const positionSec = getPlaybackPositionSec();
    const progress = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
    return {
        positionSec,
        durationSec,
        progress,
        preparedAt: cur.preparedAt,
        paused: Boolean(radio.paused),
        playbackSeq,
        elapsedLabel: formatDurationSec(positionSec),
        durationLabel: formatDurationSec(durationSec) || cur.duration || '-'
    };
}

export function getRadioPlaybackSeq() {
    return playbackSeq;
}

export function pauseRadioPlayback() {
    if (!isRadioPlaying()) {
        return { ok: false, message: 'Tidak ada lagu yang diputar.' };
    }
    if (radio.paused) {
        return {
            ok: true,
            paused: true,
            positionSec: getPlaybackPositionSec(),
            playbackSeq,
            message: 'Sudah dijeda.',
            streamEpoch: radioGeneration
        };
    }
    const positionSec = getPlaybackPositionSec();
    radio.current.pausedPositionSec = positionSec;
    radio.paused = true;
    playbackSeq += 1;
    clearAdvanceTimer();
    console.log(`📻 Radio dijeda @ ${formatDurationSec(positionSec)}`);
    emitPlaybackStateChange();
    return {
        ok: true,
        paused: true,
        positionSec,
        playbackSeq,
        message: `⏸️ Dijeda — ${radio.current.title} @ ${formatDurationSec(positionSec)}`,
        streamEpoch: radioGeneration
    };
}

export function resumeRadioPlayback() {
    if (!isRadioPlaying()) {
        return { ok: false, message: 'Tidak ada lagu aktif.' };
    }
    if (!radio.paused) {
        return {
            ok: true,
            paused: false,
            positionSec: getPlaybackPositionSec(),
            message: 'Sudah diputar.',
            streamEpoch: radioGeneration
        };
    }
    const positionSec = Math.max(0, radio.current.pausedPositionSec || 0);
    radio.current.preparedAt = Date.now() - positionSec * 1000;
    delete radio.current.pausedPositionSec;
    radio.paused = false;
    radio.sessionActive = true;
    playbackSeq += 1;
    scheduleAutoAdvance();
    console.log(`📻 Radio lanjut @ ${formatDurationSec(positionSec)}`);
    emitPlaybackStateChange();
    return {
        ok: true,
        paused: false,
        positionSec,
        playbackSeq,
        message: `▶️ Lanjut — ${radio.current.title} @ ${formatDurationSec(positionSec)}`,
        streamEpoch: radioGeneration
    };
}

async function refreshCurrentDuration() {
    const cur = radio.current;
    if (!cur?.filePath || !fs.existsSync(cur.filePath)) return 0;
    const dur = await getMp3DurationSec(cur.filePath);
    if (dur > 0 && cur === radio.current) {
        cur.durationSec = dur;
        cur.duration = formatDurationSec(dur) || cur.duration || '-';
        emitPlaybackStateChange();
    }
    return dur;
}

function scheduleAutoAdvance() {
    clearAdvanceTimer();
    const cur = radio.current;
    if (radio.paused || !cur?.preparedAt) return;

    if (!cur.durationSec || cur.durationSec < 3) {
        void refreshCurrentDuration().then((dur) => {
            if (dur >= 3 && radio.current === cur && !radio.paused) scheduleAutoAdvance();
        });
        return;
    }

    const remainingMs = (cur.durationSec * 1000) - getPlaybackPositionSec() * 1000 + 600;
    if (remainingMs <= 0) {
        handleTrackEnded().catch((e) => console.error('📻 Radio track ended:', e.message));
        return;
    }

    advanceTimer = setTimeout(() => {
        handleTrackEnded().catch((e) => console.error('📻 Radio track ended:', e.message));
    }, remainingMs);
}

/** Putar head antrian — tanpa lock (hanya dari dalam withLoadLock) */
async function playNextInQueue(reason = 'advance') {
    radio.paused = false;
    if (!radio.queue.length) {
        console.log(`📻 Radio: ${reason} — antrian kosong`);
        return { ok: false, message: 'Antrian kosong.' };
    }
    const nextTitle = radio.queue[0]?.title || 'lagu';
    console.log(`📻 Radio: ${reason} — auto-play "${nextTitle}"`);
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
}

/** Langsung putar lagu berikutnya — dengan lock (antrian baru / lagu habis) */
async function autoPlayNextTrack(reason = 'advance') {
    return withLoadLock(() => playNextInQueue(reason));
}

/** Lagu selesai — lanjut otomatis ke antrian berikutnya */
async function handleTrackEnded() {
    if (radio.isPreparing && radio.current) return;
    clearAdvanceTimer();
    console.log('📻 Radio: lagu selesai');
    const finished = radio.current ? { ...radio.current } : null;
    if (finished) lastFinishedTrack = finished;
    const hadSession = radio.sessionActive;
    stopCurrentPlayback({ keepSession: hadSession });

    if (hadSession && playerModes.repeat === 'one' && finished) {
        try {
            const entry = await addTrackToRadio(finished, finished.requestedBy || 'Web');
            radio.queue.unshift(entry);
            syncGlobalQueue();
            await autoPlayNextTrack('repeat-one');
            return;
        } catch (e) {
            console.error('📻 Radio repeat-one:', e?.message || e);
        }
    }

    if (hadSession && playerModes.repeat === 'all' && finished) {
        try {
            await addTrackToRadio(finished, finished.requestedBy || 'Web');
        } catch (e) {
            console.error('📻 Radio repeat-all:', e?.message || e);
        }
    }

    if (!hadSession || !radio.queue.length) return;
    try {
        await autoPlayNextTrack('lagu selesai');
    } catch (e) {
        console.error('📻 Radio auto-advance:', e?.message || e);
    }
}

export function getRadioPublicUrl() {
    return resolvePublicUrl();
}

export function getRadioListenUrl() {
    return `${getRadioPublicUrl()}/portfolio/radio`;
}

const MAX_RADIO_DURATION_SEC = Number(process.env.RADIO_MAX_DURATION_SEC || 6000);

const PREPARE_TIMEOUT_BASE_MS = Number(process.env.RADIO_PREPARE_TIMEOUT_MS || 120_000);
const PREPARE_TIMEOUT_MAX_MS = Number(process.env.RADIO_PREPARE_TIMEOUT_MAX_MS || 3_600_000);

function isTrackTooLong(track = {}) {
    const dur = track.durationSec || 0;
    return dur > MAX_RADIO_DURATION_SEC;
}

function longTrackMessage(track = {}) {
    return `Lagu terlalu panjang (${formatDurationSec(track.durationSec) || '?'}) — maks ${formatDurationSec(MAX_RADIO_DURATION_SEC)}`;
}

function getPrepareTimeoutMs(track = {}) {
    const dur = Math.min(track.durationSec || 0, MAX_RADIO_DURATION_SEC);
    const scaled = dur > 0 ? dur * 800 + 90_000 : PREPARE_TIMEOUT_BASE_MS;
    return Math.min(PREPARE_TIMEOUT_MAX_MS, Math.max(90_000, scaled));
}

function getPrefetchPath(track) {
    return path.join(RADIO_DIR, `prefetch-${track.id}.mp3`);
}

function isTrackPrefetched(track) {
    const p = track.prefetchPath || getPrefetchPath(track);
    try {
        return fs.existsSync(p) && fs.statSync(p).size > 4096;
    } catch {
        return false;
    }
}

async function downloadTrackToMp3(track, destPath) {
    ensureDirs();
    const prepareTimeoutMs = getPrepareTimeoutMs(track);
    await Promise.race([
        downloadYoutubeToMp3(track.url, destPath, { abortable: true }),
        new Promise((_, reject) => {
            setTimeout(
                () => reject(new Error(`Download radio timeout (${Math.round(prepareTimeoutMs / 1000)}s)`)),
                prepareTimeoutMs
            );
        })
    ]);
}

function clearTrackPrefetch(track) {
    if (!track) return;
    prefetchJobs.delete(track.id);
    const p = track.prefetchPath || getPrefetchPath(track);
    if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
    track.prefetchReady = false;
    track.prefetchPath = null;
    track.prefetchState = 'pending';
}

async function prefetchSingleTrack(track) {
    if (!radio.sessionActive) return;
    if (isTrackPrefetched(track)) {
        track.prefetchReady = true;
        track.prefetchPath = track.prefetchPath || getPrefetchPath(track);
        track.prefetchState = 'ready';
        return;
    }
    if (track.prefetchState === 'downloading' && prefetchJobs.has(track.id)) {
        return prefetchJobs.get(track.id);
    }

    const dest = getPrefetchPath(track);
    track.prefetchState = 'downloading';
    const job = (async () => {
        try {
            await downloadTrackToMp3(track, dest);
            if (!radio.sessionActive) return;
            if (!radio.queue.some((t) => t.id === track.id)) {
                try { fs.unlinkSync(dest); } catch { /* ignore */ }
                return;
            }
            track.prefetchPath = dest;
            track.prefetchReady = true;
            track.prefetchState = 'ready';
            console.log(`📻 Prefetch siap: ${track.title} (${radio.queue.length} di antrian)`);
            emitPlaybackStateChange();
        } catch (e) {
            track.prefetchState = 'failed';
            if (fs.existsSync(dest)) try { fs.unlinkSync(dest); } catch { /* ignore */ }
            console.warn(`📻 Prefetch gagal: ${track.title} — ${e.message}`);
        } finally {
            prefetchJobs.delete(track.id);
        }
    })();

    prefetchJobs.set(track.id, job);
    return job;
}

const PREFETCH_AHEAD = Math.max(1, Math.min(4, Number(process.env.RADIO_PREFETCH_AHEAD || 3)));

/** Unduh beberapa lagu berikutnya saja — hindari beban berat saat antrian panjang */
function scheduleQueuePrefetch() {
    if (!radio.sessionActive) return;
    if (!isRadioPlaying() && !radio.isPreparing) return;

    const start = isRadioPlaying() ? 0 : 1;
    const tracks = radio.queue.slice(start, start + PREFETCH_AHEAD);
    for (const track of tracks) {
        if (isTrackTooLong(track)) continue;
        void prefetchSingleTrack(track);
    }
}

async function validateDownloadedAudio(filePath, track = {}) {
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        throw new Error('File audio tidak ditemukan setelah unduhan');
    }
    if (stat.size < 4096) {
        throw new Error('File audio terlalu kecil — unduhan gagal');
    }
    const maxBytes = Number(process.env.RADIO_MAX_FILE_BYTES || 360_000_000);
    if (stat.size > maxBytes) {
        throw new Error(
            `File terlalu besar (${Math.round(stat.size / 1e6)}MB) — kemungkinan video panjang, bukan lagu`
        );
    }
    const dur = await getMp3DurationSec(filePath);
    if (dur > MAX_RADIO_DURATION_SEC) {
        throw new Error(longTrackMessage({ durationSec: dur }));
    }
    const expected = Number(track.durationSec) || 0;
    if (expected >= 30 && dur > expected * 2 + 180) {
        throw new Error(
            `Durasi unduhan (${formatDurationSec(dur)}) tidak cocok metadata (${formatDurationSec(expected)})`
        );
    }
    return dur;
}

async function activateTrackFromFile(track, sourcePath, gen) {
    if (gen !== radioGeneration) return false;
    if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size < 4096) return false;

    let fileDuration;
    try {
        fileDuration = await validateDownloadedAudio(sourcePath, track);
    } catch (e) {
        try { fs.unlinkSync(sourcePath); } catch { /* ignore */ }
        throw e;
    }

    if (activeMp3Path) parkMp3File(activeMp3Path);

    const playPath = promoteTmpToPlayFile(sourcePath, gen, track.id);
    if (gen !== radioGeneration) {
        parkMp3File(playPath);
        return false;
    }

    activeMp3Path = playPath;
    pruneOldRadioFiles(playPath);

    const durationSec = fileDuration || track.durationSec || 0;
    radio.playbackActive = true;
    radio.paused = false;
    playbackSeq += 1;
    if (radio.current?.title) {
        playbackHistory.unshift({
            id: radio.current.id,
            title: radio.current.title,
            author: radio.current.author,
            requestedBy: radio.current.requestedBy,
            thumbnail: radio.current.thumbnail,
            videoId: radio.current.videoId,
            url: radio.current.url,
            duration: radio.current.duration,
            durationSec: radio.current.durationSec
        });
        if (playbackHistory.length > 25) playbackHistory.length = 25;
    }
    radio.current = {
        ...track,
        durationSec,
        duration: formatDurationSec(durationSec) || track.duration || '-',
        preparedAt: Date.now(),
        filePath: playPath,
        prefetchReady: false,
        prefetchPath: null,
        prefetchState: 'played'
    };
    emitTrackChange();
    scheduleAutoAdvance();
    scheduleQueuePrefetch();
    return true;
}

async function prepareTrack(track, gen) {
    ensureDirs();
    const tmpPath = path.join(RADIO_DIR, `track-${track.id}.mp3`);
    try {
        await downloadTrackToMp3(track, tmpPath);
    } catch (e) {
        if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch (_) {}
        throw e;
    }

    if (gen !== radioGeneration) {
        if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch (_) {}
        return false;
    }

    return activateTrackFromFile(track, tmpPath, gen);
}

async function startQueueHead(gen) {
    if (gen !== radioGeneration) return false;
    if (!radio.queue.length) return false;
    if (radio.isPreparing && isRadioPlaying()) return false;
    if (radio.isPreparing && !radio.current) {
        console.log('📻 Radio: reset flag isPreparing macet');
        radio.isPreparing = false;
    }
    if (radio.isPreparing) return false;

    radio.isPreparing = true;
    radio.lastPrepareError = null;

    while (radio.queue.length && isTrackTooLong(radio.queue[0])) {
        const skipped = radio.queue.shift();
        syncGlobalQueue();
        clearTrackPrefetch(skipped);
        radio.lastPrepareError = { title: skipped.title, message: longTrackMessage(skipped), at: Date.now() };
        console.warn(`📻 Lewati terlalu panjang: ${skipped.title} (${skipped.durationSec}s)`);
    }
    if (!radio.queue.length) {
        radio.isPreparing = false;
        return false;
    }

    const track = radio.queue[0];

    try {
        if (prefetchJobs.has(track.id)) {
            try { await prefetchJobs.get(track.id); } catch { /* unduh ulang di bawah */ }
        }

        const prefetchPath = isTrackPrefetched(track)
            ? (track.prefetchPath || getPrefetchPath(track))
            : null;

        let ok;
        if (prefetchPath) {
            console.log(`📻 Radio: langsung putar ${track.title} (prefetch)`);
            ok = await activateTrackFromFile(track, prefetchPath, gen);
        } else {
            console.log(`📻 Radio: memuat ${track.title}... (antrian: ${radio.queue.length})`);
            ok = await prepareTrack(track, gen);
        }
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

/** Respons HTTP cepat — unduhan jalan di background (hindari timeout Failed to fetch) */
export async function handleRadioPlayRequest() {
    if (radio.isPreparing) {
        return {
            ok: true,
            preparing: true,
            message: '⏳ Sedang mengunduh lagu...',
            streamEpoch: radioGeneration,
            queueLength: radio.queue.length
        };
    }
    if (!radio.queue.length) {
        return { ok: false, message: 'Antrian kosong — tambah via !play dulu.' };
    }
    if (isRadioPlaying()) {
        if (radio.paused) return resumeRadioPlayback();
        return {
            ok: true,
            message: `▶️ ${radio.current.title} — sedang diputar`,
            streamEpoch: radioGeneration,
            queueLength: radio.queue.length,
            positionSec: getPlaybackPositionSec()
        };
    }

    const title = radio.queue[0]?.title || 'lagu';
    void startRadioPlayback().catch((e) => {
        console.error('📻 Radio play background:', e?.message || e);
    });

    return {
        ok: true,
        preparing: true,
        message: `⏳ Memuat: ${title}...`,
        streamEpoch: radioGeneration,
        queueLength: radio.queue.length
    };
}

/** Mulai lagu dari antrian — manual (tombol Putar) atau auto-advance (skip/lagu habis) */
export async function startRadioPlayback({ autoAdvance = false } = {}) {
    if (radio.isPreparing && !autoAdvance) {
        return { ok: false, preparing: true, message: '⏳ Sedang mengunduh lagu...' };
    }
    if (!radio.queue.length) {
        return { ok: false, message: 'Antrian kosong — tambah via !play dulu.' };
    }
    if (isRadioPlaying()) {
        if (radio.paused) {
            return resumeRadioPlayback();
        }
        return {
            ok: true,
            message: `▶️ ${radio.current.title} — sedang diputar`,
            streamEpoch: radioGeneration,
            queueLength: radio.queue.length,
            positionSec: getPlaybackPositionSec()
        };
    }

    if (!autoAdvance) radio.sessionActive = true;
    scheduleQueuePrefetch();
    return withLoadLock(() => playNextInQueue(autoAdvance ? 'auto' : 'manual'));
}

export async function addTrackToRadio(track, requestedBy = 'user') {
    const meta = enrichTrackMeta(track);
    if (isTrackTooLong(meta)) {
        const err = new Error(longTrackMessage(meta));
        err.code = 'TRACK_TOO_LONG';
        throw err;
    }
    const entry = {
        id: nextId(),
        title: meta.title || 'Unknown',
        url: meta.url,
        duration: meta.duration,
        durationSec: meta.durationSec,
        thumbnail: meta.thumbnail,
        videoId: meta.videoId,
        author: meta.author?.name || meta.author || 'Unknown',
        requestedBy,
        prefetchReady: false,
        prefetchPath: null,
        prefetchState: 'pending'
    };
    radio.queue.push(entry);
    scheduleLyricsPrefetch(entry);
    syncGlobalQueue();
    console.log(`📻 Antrian +1: ${entry.title} (total ${radio.queue.length})`);
    if (radio.sessionActive && (isRadioPlaying() || radio.isPreparing)) {
        scheduleQueuePrefetch();
    }
    emitPlaybackStateChange();
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
        const keepSession = radio.sessionActive || wasPlaying;
        if (keepSession) radio.sessionActive = true;
        stopCurrentPlayback({ keepSession });

        if (wasPlaying) {
            /* lagu yang diputar sudah di-shift saat startQueueHead — tidak perlu shift lagi */
        } else if (wasPreparingOnly && radio.queue.length) {
            const skippedTrack = radio.queue[0];
            clearTrackPrefetch(skippedTrack);
            radio.queue.shift();
            syncGlobalQueue();
        } else if (radio.queue.length) {
            if (playerModes.shuffle && radio.queue.length > 1) {
                const idx = Math.floor(Math.random() * radio.queue.length);
                if (idx > 0) {
                    const [pick] = radio.queue.splice(idx, 1);
                    radio.queue.unshift(pick);
                }
            }
            const skippedTrack = radio.queue[0];
            clearTrackPrefetch(skippedTrack);
            radio.queue.shift();
            syncGlobalQueue();
        }

        const nextTitle = radio.queue[0]?.title;
        console.log(`📻 Skip selesai · sisa antrian ${radio.queue.length}${nextTitle ? ` · berikutnya: ${nextTitle}` : ''}`);
        if (radio.queue.length && radio.sessionActive) {
            try {
                await playNextInQueue('skip');
            } catch (e) {
                console.error('📻 Radio skip-advance:', e?.message || e);
            }
        }
        return {
            ok: true,
            message: nextTitle
                ? `⏭️ Skip: *${skipped || '—'}* · Memutar: *${nextTitle}*`
                : `⏭️ Skip: *${skipped || '—'}* · Antrian kosong.`,
            streamEpoch: radioGeneration,
            queueLength: radio.queue.length,
            autoPlay: Boolean(radio.queue.length && isRadioPlaying())
        };
    });
}

export function seekRadioPlayback(positionSec) {
    if (!isRadioPlaying()) return { ok: false, error: 'Tidak ada lagu aktif' };
    const dur = radio.current.durationSec || 0;
    const pos = dur > 0
        ? Math.max(0, Math.min(Math.max(0, dur - 0.5), Number(positionSec) || 0))
        : Math.max(0, Number(positionSec) || 0);
    radio.current.preparedAt = Date.now() - pos * 1000;
    if (isRadioPaused()) radio.current.pausedPositionSec = pos;
    playbackSeq += 1;
    emitPlaybackStateChange();
    scheduleAutoAdvance();
    return {
        ok: true,
        positionSec: pos,
        playbackSeq,
        streamEpoch: radioGeneration
    };
}

export function getPlayerModes() {
    return { ...playerModes };
}

export function setPlayerModes({ shuffle, repeat } = {}) {
    if (typeof shuffle === 'boolean') playerModes.shuffle = shuffle;
    if (repeat === 'off' || repeat === 'one' || repeat === 'all') playerModes.repeat = repeat;
    return { ...playerModes };
}

export async function prevRadioTrack() {
    if (!playbackHistory.length) {
        return { ok: false, error: 'Belum ada lagu sebelumnya' };
    }
    const prev = playbackHistory.shift();
    return withLoadLock(async () => {
        resetPlayPipeline();
        const keepSession = radio.sessionActive || isRadioPlaying();
        stopCurrentPlayback({ keepSession });
        radio.sessionActive = true;
        const entry = await addTrackToRadio(prev, prev.requestedBy || 'Web');
        radio.queue = [entry, ...radio.queue.filter((t) => t.id !== entry.id)];
        syncGlobalQueue();
        const gen = radioGeneration;
        await startQueueHead(gen);
        requestDiscordSync('radio-prev', 600);
        return {
            ok: true,
            message: `⏮️ ${prev.title}`,
            queueLength: radio.queue.length,
            streamEpoch: radioGeneration
        };
    });
}

export function removeQueueTrack(id) {
    const idx = radio.queue.findIndex((t) => t.id === id);
    if (idx < 0) return { ok: false, error: 'Tidak ada di antrian' };
    const [removed] = radio.queue.splice(idx, 1);
    clearTrackPrefetch(removed);
    syncGlobalQueue();
    return { ok: true, removed, queueLength: radio.queue.length };
}

export function reorderQueue(ids = []) {
    const order = ids.map(Number).filter(Boolean);
    if (!order.length) return { ok: false, error: 'ids wajib' };
    const byId = new Map(radio.queue.map((t) => [t.id, t]));
    const reordered = [];
    for (const id of order) {
        const t = byId.get(id);
        if (t) {
            reordered.push(t);
            byId.delete(id);
        }
    }
    for (const t of byId.values()) reordered.push(t);
    radio.queue = reordered;
    syncGlobalQueue();
    return { ok: true, queueLength: radio.queue.length };
}

export function clearRadioQueue() {
    for (const track of radio.queue) clearTrackPrefetch(track);
    resetPlayPipeline();
    radio.queue = [];
    radio.sessionActive = false;
    stopCurrentPlayback();
    console.log('📻 Antrian dikosongkan (clear)');
}

export function getRadioStatusText() {
    const now = isRadioPlaying()
        ? `🎶 *Sedang diputar:*\n${radio.current.title}\n👤 ${radio.current.author}\n🙋 ${radio.current.requestedBy}`
        : radio.isPreparing
            ? '⏳ Sedang memuat lagu...'
            : radio.queue.length
                ? `📋 *Antrian:*\n${radio.queue[0].title}\n👤 ${radio.queue[0].author}\n🙋 ${radio.queue[0].requestedBy}\n_Klik Putar di player untuk mulai_`
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

    app.get('/luxx-bot-url.json', (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        if (applyLuxxAppCors(req, res)) return;
        const manifest = path.join(process.cwd(), 'portfolio', 'luxx-bot-url.json');
        if (fs.existsSync(manifest)) {
            return res.sendFile(manifest);
        }
        const publicUrl = resolvePublicUrl().replace(/\/$/, '');
        const lan = getLanIPv4();
        const lanUrl = lan ? `http://${lan}:${getListenPort()}` : null;
        const recentUrls = extractTunnelUrlsFromLogs()
            .map((u) => u.replace(/\/$/, ''))
            .filter((u) => u && !/localhost|127\.0\.0\.1/i.test(u))
            .slice(0, 10);
        res.json({
            publicUrl: publicUrl || null,
            lanUrl,
            recentUrls: [...new Set([publicUrl, ...recentUrls].filter(Boolean))].slice(0, 10),
            updatedAt: new Date().toISOString()
        });
    });

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

    app.use('/radio', (req, res, next) => {
        if (applyLuxxAppCors(req, res)) return;
        next();
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
        const result = await handleRadioPlayRequest();
        requestDiscordSync('radio-play', 800);
        res.json({
            ...result,
            queueLength: radio.queue.length,
            isPreparing: radio.isPreparing,
            paused: isRadioPaused(),
            hasStream: Boolean(getActiveMp3Path() && isRadioPlaying())
        });
    });

    app.post('/radio/api/pause', (req, res) => {
        const result = pauseRadioPlayback();
        requestDiscordSync('radio-pause', 200);
        res.json({
            ...result,
            queueLength: radio.queue.length,
            playback: getRadioPlayback()
        });
    });

    app.post('/radio/api/resume', (req, res) => {
        const result = resumeRadioPlayback();
        requestDiscordSync('radio-resume', 400);
        res.json({
            ...result,
            queueLength: radio.queue.length,
            hasStream: Boolean(getActiveMp3Path() && isRadioPlaying()),
            playback: getRadioPlayback()
        });
    });

    app.get('/radio/api/config', (_req, res) => {
        const publicUrl = getRadioPublicUrl().replace(/\/$/, '');
        const recentUrls = extractTunnelUrlsFromLogs()
            .map((u) => u.replace(/\/$/, ''))
            .filter((u) => u && !/localhost|127\.0\.0\.1/i.test(u))
            .slice(0, 10);
        const lan = getLanIPv4();
        const lanUrl = lan ? `http://${lan}:${getListenPort()}` : null;

        res.json({
            ok: true,
            publicUrl: /localhost|127\.0\.0\.1/i.test(publicUrl) ? null : publicUrl,
            lanUrl,
            adminUrl: publicUrl ? `${publicUrl}/admin` : null,
            recentUrls,
            serverTime: Date.now()
        });
    });

    app.get('/radio/api/search', async (req, res) => {
        try {
            const { searchYoutubeTracks } = await import('../utils/radio-yt-search.js');
            const { query, results } = await searchYoutubeTracks(req.query.q);
            res.json({ ok: true, query, results });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message || 'Pencarian gagal' });
        }
    });


    app.post('/radio/api/queue/play-id', async (req, res) => {
        const id = Number(req.body?.id);
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID lagu wajib.' });
        }
        const idx = radio.queue.findIndex((t) => t.id === id);
        if (idx < 0) {
            return res.status(404).json({ ok: false, error: 'Lagu tidak ada di antrian.' });
        }
        if (idx > 0) {
            const [track] = radio.queue.splice(idx, 1);
            radio.queue.unshift(track);
            syncGlobalQueue();
            scheduleQueuePrefetch();
        }
        const result = await handleRadioPlayRequest();
        requestDiscordSync('radio-play', 800);
        res.json({
            ok: true,
            message: `"${radio.queue[0]?.title || 'lagu'}" diputar.`,
            play: result,
            queueLength: radio.queue.length,
            isPreparing: radio.isPreparing,
            paused: isRadioPaused(),
            hasStream: Boolean(getActiveMp3Path() && isRadioPlaying())
        });
    });

    const recentQueueAdds = new Map();

    app.post('/radio/api/queue/add', async (req, res) => {
        const body = req.body || {};
        const url = String(body.url || '').trim();
        if (!url) {
            return res.status(400).json({ ok: false, error: 'URL lagu wajib.' });
        }
        const who = String(body.requestedBy || body.username || 'Web').trim().slice(0, 48) || 'Web';
        const dedupeKey = `${url}|${Boolean(body.playNow)}|${Boolean(body.playNext)}`;
        const prev = recentQueueAdds.get(dedupeKey);
        if (prev && Date.now() - prev.at < 2500) {
            return res.json({
                ok: true,
                message: `"${prev.entry.title}" sudah di antrian.`,
                track: prev.entry,
                queueLength: radio.queue.length,
                deduped: true
            });
        }
        try {
            const entry = await addTrackToRadio({
                title: body.title || 'Unknown',
                url,
                videoId: body.videoId,
                thumbnail: body.thumbnail,
                author: body.author,
                seconds: body.seconds,
                duration: body.duration
            }, who);
            if (body.playNext && !body.playNow) {
                radio.queue.pop();
                radio.queue.unshift(entry);
                syncGlobalQueue();
            }
            let playResult = null;
            if (body.playNow) {
                if (radio.queue.length > 1) {
                    const idx = radio.queue.findIndex((t) => t.id === entry.id);
                    if (idx > 0) {
                        const [t] = radio.queue.splice(idx, 1);
                        radio.queue.unshift(t);
                        syncGlobalQueue();
                    }
                }
                playResult = await handleRadioPlayRequest();
            }
            recentQueueAdds.set(dedupeKey, { at: Date.now(), entry });
            if (recentQueueAdds.size > 80) {
                const cutoff = Date.now() - 10_000;
                for (const [k, v] of recentQueueAdds) {
                    if (v.at < cutoff) recentQueueAdds.delete(k);
                }
            }
            res.json({
                ok: true,
                message: body.playNow ? `"${entry.title}" diputar.` : `"${entry.title}" masuk antrian.`,
                track: entry,
                play: playResult,
                queueLength: radio.queue.length
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message || 'Gagal menambah' });
        }
    });

    app.get('/radio/api/now', (req, res) => {
        const playing = isRadioPlaying();
        const upNext = !playing ? getUpNextTrack() : null;
        const lyricsTrack = playing ? radio.current : upNext;
        const lyrics = lyricsTrack
            ? { ...getCachedLyricsForTrack(lyricsTrack), trackId: lyricsTrack.id }
            : { found: false, loading: false, lyrics: null, trackId: null };

        const mapTrack = (t) => {
            if (!t) return null;
            const e = enrichTrackMeta(t);
            return {
                id: e.id,
                title: e.title,
                author: e.author,
                requestedBy: e.requestedBy,
                thumbnail: e.thumbnail || youtubeThumbnail(e.url, e.videoId),
                videoId: e.videoId,
                url: e.url,
                duration: e.duration,
                durationSec: e.durationSec
            };
        };

        res.json({
            current: playing ? mapTrack(radio.current) : null,
            upNext: mapTrack(upNext),
            playbackActive: playing,
            paused: isRadioPaused(),
            waitingPlay: Boolean(!playing && radio.queue.length),
            sessionActive: radio.sessionActive,
            queue: radio.queue.map((t) => {
                const ls = getLyricsPrefetchStatus(t);
                const e = enrichTrackMeta(t);
                return {
                    id: e.id,
                    title: e.title,
                    author: e.author,
                    requestedBy: e.requestedBy,
                    thumbnail: e.thumbnail || youtubeThumbnail(e.url, e.videoId),
                    videoId: e.videoId,
                    url: e.url,
                    duration: e.duration,
                    durationSec: e.durationSec,
                    lyricsReady: ls.ready,
                    lyricsLoading: ls.loading,
                    prefetchReady: Boolean(t.prefetchReady || isTrackPrefetched(t)),
                    prefetchLoading: t.prefetchState === 'downloading'
                };
            }),
            queueLength: radio.queue.length,
            isPreparing: radio.isPreparing,
            lastPrepareError: radio.lastPrepareError,
            hasStream: Boolean(getActiveMp3Path() && playing),
            playback: getRadioPlayback(),
            playbackSeq,
            streamEpoch: radioGeneration,
            lyrics,
            discord: getDiscordRadioBlock(),
            playerModes: { ...playerModes },
            playbackHistory: playbackHistory.slice(0, 10),
            serverTime: Date.now()
        });
    });


    app.post('/radio/api/queue/bulk-add', async (req, res) => {
        const body = req.body || {};
        const tracks = Array.isArray(body.tracks) ? body.tracks : [];
        if (!tracks.length) return res.status(400).json({ ok: false, error: 'tracks wajib' });
        const who = String(body.requestedBy || body.username || 'Web').trim().slice(0, 48) || 'Web';
        const replace = Boolean(body.replace);
        const shuffle = Boolean(body.shuffle);
        const playNow = Boolean(body.playNow);
        const slice = tracks.slice(0, 40);

        const pushTrack = async (raw) => {
            const url = String(raw?.url || '').trim();
            if (!url) return null;
            try {
                return await addTrackToRadio({
                    title: raw.title || 'Unknown',
                    url,
                    videoId: raw.videoId,
                    thumbnail: raw.thumbnail,
                    author: raw.author,
                    seconds: raw.seconds,
                    duration: raw.duration,
                    durationSec: raw.durationSec
                }, who);
            } catch (e) {
                if (e?.code === 'TRACK_TOO_LONG') {
                    console.warn(`📻 Bulk skip panjang: ${raw.title || url}`);
                    return null;
                }
                throw e;
            }
        };

        const shuffleQueueKeepHead = (head) => {
            if (!shuffle || radio.queue.length <= 1) return;
            const anchor = head || (playNow ? radio.queue.shift() : null);
            for (let i = radio.queue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [radio.queue[i], radio.queue[j]] = [radio.queue[j], radio.queue[i]];
            }
            if (anchor) radio.queue.unshift(anchor);
            syncGlobalQueue();
        };

        try {
            if (replace) clearRadioQueue();
            const added = [];
            let playResult = null;

            if (playNow && slice.length > 0) {
                let firstIdx = -1;
                for (let i = 0; i < slice.length; i++) {
                    const entry = await pushTrack(slice[i]);
                    if (entry) {
                        added.push(entry);
                        firstIdx = i;
                        break;
                    }
                }
                if (!added.length) {
                    return res.status(400).json({ ok: false, error: 'Semua lagu stasiun terlalu panjang atau tidak valid' });
                }
                radio.sessionActive = true;
                playResult = await handleRadioPlayRequest();

                res.json({
                    ok: true,
                    added: added.length,
                    queueLength: radio.queue.length,
                    play: playResult,
                    preparing: Boolean(playResult?.preparing)
                });

                const rest = slice.slice(firstIdx + 1);
                if (rest.length) {
                    void (async () => {
                        for (const raw of rest) {
                            const entry = await pushTrack(raw);
                            if (entry) added.push(entry);
                        }
                        shuffleQueueKeepHead(radio.queue[0]);
                    })().catch((e) => console.error('📻 bulk-add background:', e?.message || e));
                }
                return;
            }

            for (const raw of slice) {
                const entry = await pushTrack(raw);
                if (entry) added.push(entry);
            }
            shuffleQueueKeepHead(null);
            if (playNow && radio.queue.length) {
                radio.sessionActive = true;
                playResult = await handleRadioPlayRequest();
            }
            res.json({
                ok: true,
                added: added.length,
                queueLength: radio.queue.length,
                play: playResult
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message || 'Gagal bulk add' });
        }
    });

    app.get('/radio/api/player/modes', (_req, res) => {
        res.json({ ok: true, modes: getPlayerModes() });
    });

    app.post('/radio/api/player/modes', (req, res) => {
        res.json({ ok: true, modes: setPlayerModes(req.body || {}) });
    });

    app.post('/radio/api/seek', (req, res) => {
        const result = seekRadioPlayback(Number(req.body?.positionSec ?? req.body?.position));
        res.status(result.ok ? 200 : 400).json({ ...result, playback: getRadioPlayback() });
    });

    app.post('/radio/api/prev', async (_req, res) => {
        try {
            const result = await prevRadioTrack();
            res.status(result.ok ? 200 : 400).json({
                ...result,
                playback: getRadioPlayback(),
                modes: getPlayerModes()
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message || 'Gagal previous' });
        }
    });

    app.post('/radio/api/queue/remove', (req, res) => {
        const result = removeQueueTrack(Number(req.body?.id));
        res.status(result.ok ? 200 : 400).json(result);
    });

    app.post('/radio/api/queue/reorder', (req, res) => {
        const result = reorderQueue(req.body?.ids || []);
        res.status(result.ok ? 200 : 400).json(result);
    });

    app.post('/radio/api/skip', async (req, res) => {
        const result = await skipRadioTrack();
        requestDiscordSync('radio-skip', 600);
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

    app.get('/radio/api/admin/analytics', async (_req, res) => {
        const { getAnalytics } = await import('./analytics.js');
        res.json({ ok: true, ...getAnalytics() });
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