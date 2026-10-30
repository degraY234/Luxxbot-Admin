import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import os from 'os';
import express from 'express';
import ytSearch from 'yt-search';
import {
    radio,
    skipRadioTrack,
    clearRadioQueue,
    addTrackToRadio,
    handleRadioPlayRequest,
    pauseRadioPlayback,
    resumeRadioPlayback,
    getRadioListenUrl,
    getRadioPlayback,
    getRadioPlaybackSeq,
    getRadioStreamEpoch,
    isRadioPaused
} from './radio-server.js';
import { extractYoutubeVideoId, youtubeThumbnail } from '../utils/youtube-meta.js';
import { getYtDlpTitle } from '../utils/ytdlp-download.js';
import {
    getWatchRoomState,
    adminWatchSkip,
    adminWatchStop,
    adminWatchClearQueue
} from './watch-server.js';
import { getDiscordDiagnostics, requestDiscordRadioSync } from './discord-radio.js';
import { getGuardianStatus, getGuardianAlerts, acknowledgeGuardianAlert, startGuardian } from './guardian.js';
import { BOT_NAME, PM2_APP_NAME, startTime } from '../config.js';
import { state } from '../state.js';
import { runtime } from '../utils/runtime.js';
import { getYoutubeCookiesStatus, saveYoutubeCookies } from '../utils/youtube-cookies.js';
import { getSessionDiagnostics } from '../utils/wa-session.js';
import { getCachedLyricsForTrack } from './radio-lyrics.js';
import { buildSystemDiagnostics, pruneRuntimeCaches } from '../utils/admin-diagnostics.js';
import { applyLuxxAppCors, isLuxxAppOrigin } from '../utils/app-cors.js';
import { getRadioPublicUrl, getLanIPv4 } from '../utils/radio-url.js';
import { getListenPort, isRailwayRuntime, isRenderRuntime } from '../utils/listen-port.js';
import { addPremiumUser, removePremiumUser, getPremiumUsers } from './premium-users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminStaticDir = path.resolve(__dirname, '../../admin');

function getAdminToken() {
    return process.env.ADMIN_API_TOKEN?.trim() || '';
}

function isAllowedCorsOrigin(origin) {
    if (!origin) return true;
    if (isLuxxAppOrigin(origin)) return true;
    const configured = process.env.ADMIN_CORS_ORIGIN?.trim();
    if (!configured || configured === '*') return true;
    const list = configured.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (list.includes(origin)) return true;
    if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin)) return true;
    return false;
}

function applyCors(req, res) {
    if (isAllowedCorsOrigin(req.headers.origin)) {
        return applyLuxxAppCors(req, res);
    }
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return true;
    }
    return false;
}

function requireAdmin(req, res) {
    const token = getAdminToken();
    if (!token) {
        res.status(503).json({ ok: false, error: 'Admin API disabled — set ADMIN_API_TOKEN di .env' });
        return false;
    }
    const auth = (req.headers.authorization || '').trim();
    const expected = `Bearer ${token}`;
    if (auth !== expected) {
        res.status(401).json({ ok: false, error: 'Unauthorized — token tidak cocok dengan ADMIN_API_TOKEN di .env' });
        return false;
    }
    return true;
}

function buildStatusPayload() {
    const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
    const mem = process.memoryUsage();
    const discord = getDiscordDiagnostics();

    return {
        ok: true,
        bot: BOT_NAME,
        uptime: runtime(uptimeSec),
        uptimeSec,
        ramMb: Math.round(mem.rss / 1024 / 1024),
        host: `${os.platform()} ${os.arch()}`,
        sleeping: state.isSleeping,
        selfMode: state.isSelfMode,
        antiLink: state.antiLink,
        radio: {
            current: radio.current,
            queue: radio.queue,
            queueLength: radio.queue.length,
            isPreparing: radio.isPreparing,
            lastPrepareError: radio.lastPrepareError,
            listenUrl: getRadioListenUrl(),
            streamPath: '/radio/live.mp3',
            playback: getRadioPlayback(),
            paused: isRadioPaused(),
            playbackSeq: getRadioPlaybackSeq(),
            streamEpoch: getRadioStreamEpoch(),
            lyrics: null
        },
        discord: {
            guildCount: discord.guildCount,
            inVoice: discord.inVoice,
            voiceChannel: discord.voiceChannel,
            slashReady: discord.slashReady,
            inviteUrl: discord.inviteUrl
        },
        watch: getWatchRoomState(),
        session: getSessionDiagnostics(),
        youtubeCookies: getYoutubeCookiesStatus()
    };
}

export function mountAdminApi(app) {
    app.use('/admin/api', express.json({ limit: '2mb' }));

    app.use('/admin/api', (req, res, next) => {
        if (applyCors(req, res)) return;
        if (!requireAdmin(req, res)) return;
        next();
    });

    app.get('/admin/api/status', (req, res) => {
        const payload = buildStatusPayload();
        payload.radio.lyrics = payload.radio?.current
            ? getCachedLyricsForTrack(payload.radio.current)
            : { found: false, loading: false, lyrics: null };
        payload.guardian = getGuardianStatus();
        res.json(payload);
    });

    app.get('/admin/api/radio-lyrics', (req, res) => {
        res.json({
            ok: true,
            currentId: radio.current?.id ?? null,
            playback: getRadioPlayback(),
            lyrics: radio.current
                ? getCachedLyricsForTrack(radio.current)
                : { found: false, loading: false, lyrics: null }
        });
    });

    app.get('/admin/api/system', (req, res) => {
        res.json({ ok: true, ...buildSystemDiagnostics() });
    });

    app.get('/admin/api/guardian', (req, res) => {
        res.json({ ok: true, alerts: getGuardianAlerts(), status: getGuardianStatus() });
    });

    app.post('/admin/api/guardian/ack', (req, res) => {
        const id = String(req.body?.id || '').trim();
        if (!id) return res.status(400).json({ ok: false, error: 'Alert ID wajib.' });
        const alert = acknowledgeGuardianAlert(id);
        if (!alert) return res.status(404).json({ ok: false, error: 'Alert tidak ditemukan.' });
        res.json({ ok: true, alert });
    });

    app.get('/admin/api/ops', async (_req, res) => {
        const publicUrl = getRadioPublicUrl().replace(/\/$/, '');
        const lan = getLanIPv4();
        const lanUrl = lan ? `http://${lan}:${getListenPort()}` : null;
        const tunnelPublic = /localhost|127\.0\.0\.1/i.test(publicUrl) ? null : publicUrl;
        res.json({
            ok: true,
            tunnel: {
                publicUrl: tunnelPublic,
                lanUrl,
                quickTunnel: /\.trycloudflare\.com/i.test(publicUrl)
            },
            deploy: {
                railway: isRailwayRuntime(),
                render: isRenderRuntime(),
                pm2Local: !isRailwayRuntime() && !isRenderRuntime(),
                hints: [
                    'npm run pm2:start:all',
                    'npm run tunnel:reset',
                    'npm run test:smoke'
                ]
            }
        });
    });

    app.get('/admin/api/premium-users', async (req, res) => {
        try {
            const users = await getPremiumUsers();
            res.json({ ok: true, users });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message || 'Gagal ambil daftar premium.' });
        }
    });

    app.post('/admin/api/premium-users', async (req, res) => {
        const number = String(req.body?.number || '').trim();
        if (!number) {
            return res.status(400).json({ ok: false, error: 'Nomor WA premium wajib diisi.' });
        }
        const result = await addPremiumUser(number);
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json(result);
    });

    app.delete('/admin/api/premium-users', async (req, res) => {
        const number = String(req.body?.number || '').trim();
        if (!number) {
            return res.status(400).json({ ok: false, error: 'Nomor WA premium wajib diisi.' });
        }
        const result = await removePremiumUser(number);
        const ok = typeof result === 'boolean' ? result : Boolean(result?.ok);
        if (!ok) {
            return res.status(404).json({ ok: false, error: 'Pengguna tidak ditemukan di daftar premium.' });
        }
        res.json({ ok: true, message: 'Berhasil menghapus pengguna premium.' });
    });

    app.post('/admin/api/cache/prune', (req, res) => {
        const result = pruneRuntimeCaches();
        res.json({ ok: true, message: 'Cache runtime dibersihkan.', ...result, system: buildSystemDiagnostics() });
    });

    app.get('/admin/api/queue', (req, res) => {
        res.json({
            ok: true,
            current: radio.current,
            queue: radio.queue,
            isPreparing: radio.isPreparing
        });
    });

    app.post('/admin/api/skip', async (req, res) => {
        const result = await skipRadioTrack();
        requestDiscordRadioSync('admin-skip', 600);
        const nextTitle = radio.queue[0]?.title;
        res.json({
            ok: result.ok,
            message: nextTitle
                ? `⏭️ Skip · berikutnya: ${nextTitle}`
                : result.message,
            streamEpoch: getRadioStreamEpoch(),
            queueLength: radio.queue.length,
            isPreparing: radio.isPreparing
        });
    });

    app.post('/admin/api/play', async (req, res) => {
        const result = await handleRadioPlayRequest();
        requestDiscordRadioSync('admin-play', 800);
        res.json({
            ...result,
            streamEpoch: getRadioStreamEpoch(),
            queueLength: radio.queue.length,
            isPreparing: radio.isPreparing,
            paused: isRadioPaused(),
            playback: getRadioPlayback()
        });
    });

    app.post('/admin/api/pause', (req, res) => {
        const result = pauseRadioPlayback();
        requestDiscordRadioSync('admin-pause', 200);
        res.json({
            ...result,
            queueLength: radio.queue.length,
            playback: getRadioPlayback()
        });
    });

    app.post('/admin/api/resume', (req, res) => {
        const result = resumeRadioPlayback();
        requestDiscordRadioSync('admin-resume', 400);
        res.json({
            ...result,
            queueLength: radio.queue.length,
            hasStream: Boolean(radio.current),
            playback: getRadioPlayback()
        });
    });

    app.post('/admin/api/clear', (req, res) => {
        clearRadioQueue();
        res.json({ ok: true, message: 'Antrian dikosongkan.', streamEpoch: getRadioStreamEpoch() });
    });

    app.get('/admin/api/search', async (req, res) => {
        const q = String(req.query.q || '').trim();
        if (!q) {
            return res.status(400).json({ ok: false, error: 'Ketik judul lagu atau paste link YouTube.' });
        }

        try {
            const directId = extractYoutubeVideoId(q);
            if (directId) {
                const url = q.startsWith('http') ? q : `https://www.youtube.com/watch?v=${directId}`;
                const title = await getYtDlpTitle(url).catch(() => 'YouTube');
                return res.json({
                    ok: true,
                    query: q,
                    results: [{
                        title,
                        url,
                        videoId: directId,
                        author: 'YouTube',
                        duration: '—',
                        seconds: 0,
                        thumbnail: youtubeThumbnail(url, directId)
                    }]
                });
            }

            const search = await ytSearch(q);
            const results = search.videos.slice(0, 8).map((v) => ({
                title: v.title,
                url: v.url,
                videoId: v.videoId,
                author: v.author?.name || v.author || 'Unknown',
                duration: v.timestamp,
                seconds: v.seconds,
                thumbnail: v.image || youtubeThumbnail(v.url, v.videoId)
            }));

            res.json({ ok: true, query: q, results });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message || 'Pencarian gagal' });
        }
    });

    app.post('/admin/api/queue/add', async (req, res) => {
        const body = req.body || {};
        const url = String(body.url || '').trim();
        if (!url) {
            return res.status(400).json({ ok: false, error: 'URL lagu wajib diisi.' });
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
            }, String(body.requestedBy || body.username || 'Admin Panel').trim().slice(0, 48) || 'Admin Panel');

            let playResult = null;
            if (body.playNow) {
                playResult = await handleRadioPlayRequest();
            }

            res.json({
                ok: true,
                message: body.playNow
                    ? `"${entry.title}" masuk antrian & diputar.`
                    : `"${entry.title}" masuk antrian radio.`,
                track: entry,
                play: playResult,
                streamEpoch: getRadioStreamEpoch(),
                queueLength: radio.queue.length
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message || 'Gagal menambah lagu' });
        }
    });

    app.post('/admin/api/watch/skip', async (req, res) => {
        const result = await adminWatchSkip();
        res.json({ ...result, room: getWatchRoomState() });
    });

    app.post('/admin/api/watch/stop', (req, res) => {
        const result = adminWatchStop();
        res.json({ ...result, room: getWatchRoomState() });
    });

    app.post('/admin/api/watch/clear-queue', (req, res) => {
        const result = adminWatchClearQueue();
        res.json({ ...result, room: getWatchRoomState() });
    });

    app.get('/admin/api/youtube-cookies', (req, res) => {
        res.json({ ok: true, ...getYoutubeCookiesStatus() });
    });

    app.post('/admin/api/youtube-cookies', (req, res) => {
        try {
            const content = req.body?.content || req.body?.cookies || req.body?.text || '';
            const saved = saveYoutubeCookies(content);
            res.json({ ok: true, message: 'Cookies YouTube tersimpan di volume persist.', ...saved });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    app.post('/admin/api/restart', (req, res) => {
        res.json({ ok: true, message: `Restart ${PM2_APP_NAME} diminta...` });
        setTimeout(() => {
            spawn('pm2', ['restart', PM2_APP_NAME, '--update-env'], {
                detached: true,
                stdio: 'ignore',
                shell: true,
                windowsHide: true
            }).unref();
        }, 800);
    });

    if (fs.existsSync(adminStaticDir)) {
        const indexHtml = path.join(adminStaticDir, 'index.html');
        const sendAdmin = (_req, res) => res.sendFile(indexHtml);
        app.get('/admin', sendAdmin);
        app.get('/admin/', sendAdmin);
        app.use('/admin', express.static(adminStaticDir, { index: false, redirect: false }));
    }

    startGuardian();

    const token = getAdminToken();
    if (token) {
        console.log(`\x1b[35m🔐 Admin panel: /admin (token aktif)\x1b[0m`);
    } else {
        console.log('\x1b[33m🔐 Admin API: set ADMIN_API_TOKEN di .env untuk mengaktifkan\x1b[0m');
    }
}