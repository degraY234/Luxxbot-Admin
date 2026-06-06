import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import os from 'os';
import express from 'express';
import {
    radio,
    skipRadioTrack,
    clearRadioQueue,
    getRadioListenUrl,
    getRadioPlayback,
    getRadioStreamEpoch
} from './radio-server.js';
import {
    getWatchRoomState,
    adminWatchSkip,
    adminWatchStop,
    adminWatchClearQueue
} from './watch-server.js';
import { getDiscordDiagnostics } from './discord-radio.js';
import { BOT_NAME, PM2_APP_NAME, startTime } from '../config.js';
import { state } from '../state.js';
import { runtime } from '../utils/runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminStaticDir = path.resolve(__dirname, '../../admin');

function getAdminToken() {
    return process.env.ADMIN_API_TOKEN?.trim() || '';
}

function isAllowedCorsOrigin(origin) {
    if (!origin) return true;
    const configured = process.env.ADMIN_CORS_ORIGIN?.trim();
    if (!configured || configured === '*') return true;
    const list = configured.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (list.includes(origin)) return true;
    if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin)) return true;
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
    return false;
}

function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin && isAllowedCorsOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } else if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
            listenUrl: getRadioListenUrl(),
            streamPath: '/radio/live.mp3',
            playback: getRadioPlayback(),
            streamEpoch: getRadioStreamEpoch()
        },
        discord: {
            guildCount: discord.guildCount,
            inVoice: discord.inVoice,
            voiceChannel: discord.voiceChannel,
            slashReady: discord.slashReady,
            inviteUrl: discord.inviteUrl
        },
        watch: getWatchRoomState()
    };
}

export function mountAdminApi(app) {
    app.use('/admin/api', (req, res, next) => {
        if (applyCors(req, res)) return;
        if (!requireAdmin(req, res)) return;
        next();
    });

    app.get('/admin/api/status', (req, res) => {
        res.json(buildStatusPayload());
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
        res.json({ ok: result.ok, message: result.message });
    });

    app.post('/admin/api/clear', (req, res) => {
        clearRadioQueue();
        res.json({ ok: true, message: 'Antrian dikosongkan.', streamEpoch: getRadioStreamEpoch() });
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

    app.post('/admin/api/restart', (req, res) => {
        res.json({ ok: true, message: `Restart ${PM2_APP_NAME} diminta...` });
        setTimeout(() => {
            spawn('pm2', ['restart', PM2_APP_NAME, '--update-env'], {
                detached: true,
                stdio: 'ignore',
                shell: true
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

    const token = getAdminToken();
    if (token) {
        console.log(`\x1b[35m🔐 Admin panel: /admin (token aktif)\x1b[0m`);
    } else {
        console.log('\x1b[33m🔐 Admin API: set ADMIN_API_TOKEN di .env untuk mengaktifkan\x1b[0m');
    }
}