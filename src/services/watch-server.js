import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { randomBytes } from 'crypto';
import axios from 'axios';
import { getRadioPublicUrl } from './radio-server.js';
import {
    searchLk21, getLk21Film, fetchLatestLk21, fetchLk21Genres,
    browseLk21Genre, browseLk21, getLk21HomeMeta
} from './lk21.js';

const streamAgent = new https.Agent({ rejectUnauthorized: false });
const STREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getWatchDiscordInvite() {
    return process.env.DISCORD_SERVER_INVITE?.trim() || 'https://discord.gg/QJQVDfvx';
}

function getDiscordServerName() {
    return process.env.DISCORD_SERVER_NAME?.trim() || "DoxxBorx's server";
}

function encodeB64Url(str) {
    return Buffer.from(String(str), 'utf8').toString('base64url');
}

function decodeB64Url(str) {
    return Buffer.from(String(str), 'base64url').toString('utf8');
}

function enrichFilmForClient(film) {
    if (!film) return null;
    const out = { ...film };
    if (out.embedUrl) out.playEmbedUrl = `/watch/embed?u=${encodeB64Url(out.embedUrl)}`;
    if (out.videoUrl) out.playVideoUrl = `/watch/api/stream?u=${encodeB64Url(out.videoUrl)}`;
    return out;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watchStaticDir = path.resolve(__dirname, '../../watch');
const CHAT_MAX = 200;
const VIEWER_TTL_MS = 90_000;

const room = {
    film: null,
    playback: { position: 0, playing: false, updatedAt: Date.now(), by: '' },
    queue: [],
    chat: [],
    viewers: new Map(),
    voiceSignals: []
};

function filmKey(film) {
    if (!film) return '';
    return film.key || film.embedUrl || film.videoUrl || film.pageUrl || film.title || '';
}

function getEffectivePlayback() {
    const pb = room.playback;
    if (!pb?.playing) return pb?.position || 0;
    return (pb.position || 0) + (Date.now() - (pb.updatedAt || Date.now())) / 1000;
}

function setPlayback({ position, playing, by }) {
    room.playback = {
        position: Math.max(0, Number(position) || 0),
        playing: !!playing,
        updatedAt: Date.now(),
        by: by || room.playback?.by || ''
    };
}

function withFilmKey(film) {
    const key = filmKey(film);
    return { ...film, key };
}

function playbackSnapshot() {
    return { ...room.playback, now: getEffectivePlayback() };
}

function newId() {
    return randomBytes(8).toString('hex');
}

function cleanUsername(raw) {
    const u = String(raw || '').trim().replace(/[^\w\s-]/g, '').slice(0, 20);
    return u.length >= 2 ? u : '';
}

function pruneViewers() {
    const now = Date.now();
    for (const [id, v] of room.viewers) {
        if (now - v.lastSeen > VIEWER_TTL_MS) room.viewers.delete(id);
    }
}

function pushChat(username, text) {
    room.chat.push({ id: newId(), username, text: text.slice(0, 500), at: Date.now() });
    if (room.chat.length > CHAT_MAX) room.chat = room.chat.slice(-CHAT_MAX);
}

function roomSnapshot() {
    pruneViewers();
    return {
        film: enrichFilmForClient(room.film),
        playback: playbackSnapshot(),
        queue: room.queue.slice(0, 20),
        chat: room.chat.slice(-60),
        viewers: [...room.viewers.values()].map((v) => ({ username: v.username, joinedAt: v.joinedAt })),
        viewerCount: room.viewers.size,
        discordInvite: getWatchDiscordInvite(),
        discordServerName: getDiscordServerName(),
        watchUrl: `${getRadioPublicUrl()}/watch`
    };
}

function applyCors(req, res) {
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } else {
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

export function getWatchRoomState() {
    return roomSnapshot();
}

async function playNextFromQueue(by) {
    if (!room.queue.length) return { ok: false, error: 'Antrian kosong.' };
    const next = room.queue.shift();
    try {
        const film = withFilmKey(await getLk21Film(next.url));
        room.film = film;
        setPlayback({ position: 0, playing: true, by });
        pushChat('⏭️ TV', `${by} skip → ${film.title}`);
        return { ok: true, film };
    } catch (e) {
        room.queue.unshift(next);
        return { ok: false, error: e.message };
    }
}

export async function adminWatchSkip() {
    return playNextFromQueue('Admin');
}

export function adminWatchStop() {
    room.film = null;
    setPlayback({ position: 0, playing: false, by: 'Admin' });
    pushChat('📺 TV', 'Admin menghentikan pemutaran');
    return { ok: true };
}

export function adminWatchClearQueue() {
    room.queue = [];
    pushChat('📋 Antrian', 'Admin mengosongkan antrian');
    return { ok: true };
}

export function mountWatchServer(app) {
    if (!fs.existsSync(watchStaticDir)) {
        console.log('\x1b[33m📺 Watch folder tidak ada — lewati /watch\x1b[0m');
        return;
    }

    const indexHtml = path.join(watchStaticDir, 'index.html');
    const sendWatch = (_req, res) => res.sendFile(indexHtml);

    // API dulu — jangan ditimpa static files
    app.use('/watch/api', (req, res, next) => {
        if (applyCors(req, res)) return;
        next();
    });

    app.post('/watch/api/join', (req, res) => {
        const username = cleanUsername(req.body?.username);
        if (!username) return res.status(400).json({ ok: false, error: 'Username minimal 2 karakter.' });
        let sessionId = req.body?.sessionId;
        let isNew = false;
        if (sessionId && room.viewers.has(sessionId)) {
            const v = room.viewers.get(sessionId);
            v.username = username;
            v.lastSeen = Date.now();
        } else {
            isNew = true;
            sessionId = newId();
            room.viewers.set(sessionId, { username, joinedAt: Date.now(), lastSeen: Date.now() });
            pushChat('🌸 LuxxBot', `${username} bergabung ke ruang nonton`);
        }
        res.json({ ok: true, sessionId, username, room: roomSnapshot() });
    });

    app.post('/watch/api/ping', (req, res) => {
        const { sessionId, reportPlayback, position, playing } = req.body || {};
        if (sessionId && room.viewers.has(sessionId)) {
            const viewer = room.viewers.get(sessionId);
            viewer.lastSeen = Date.now();
            if (reportPlayback && room.film?.videoUrl) {
                const clientPos = Number(position) || 0;
                const serverPos = getEffectivePlayback();
                const clientPlaying = !!playing;
                if (
                    Math.abs(clientPos - serverPos) > 1.2
                    || clientPlaying !== room.playback.playing
                    || (room.playback.updatedAt && Date.now() - room.playback.updatedAt > 4000)
                ) {
                    setPlayback({ position: clientPos, playing: clientPlaying, by: viewer.username });
                }
            }
        }
        res.json({ ok: true, room: roomSnapshot() });
    });

    app.post('/watch/api/playback', (req, res) => {
        const { sessionId, position, playing } = req.body || {};
        if (!sessionId || !room.viewers.has(sessionId)) {
            return res.status(401).json({ ok: false, error: 'Sesi habis — login ulang.' });
        }
        if (!room.film?.videoUrl) {
            return res.status(400).json({ ok: false, error: 'Sync posisi hanya untuk stream MP4 langsung.' });
        }
        const user = room.viewers.get(sessionId).username;
        setPlayback({ position, playing, by: user });
        res.json({ ok: true, room: roomSnapshot() });
    });

    app.get('/watch/api/state', (_req, res) => res.json({ ok: true, room: roomSnapshot() }));

    app.get('/watch/api/search', async (req, res) => {
        const q = String(req.query.q || '').trim();
        const page = Math.max(1, Number(req.query.page) || 1);
        try {
            res.json({ ok: true, results: await searchLk21(q, page), page, query: q });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/watch/api/latest', async (req, res) => {
        try {
            const page = Math.max(1, Number(req.query.page) || 1);
            const sort = String(req.query.sort || 'newest').toLowerCase() === 'oldest' ? 'oldest' : 'newest';
            const data = await browseLk21({ page, sort });
            res.json({ ok: true, ...data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/watch/api/browse', async (req, res) => {
        try {
            const page = Math.max(1, Number(req.query.page) || 1);
            const sort = String(req.query.sort || 'newest').toLowerCase() === 'oldest' ? 'oldest' : 'newest';
            const genre = String(req.query.genre || req.query.g || '').trim();
            const data = await browseLk21({ page, sort, genre });
            res.json({ ok: true, ...data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/watch/api/catalog-meta', async (_req, res) => {
        try {
            const meta = await getLk21HomeMeta();
            res.json({ ok: true, totalPages: meta.totalPages, base: meta.base });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/watch/api/genres', async (_req, res) => {
        try {
            res.json({ ok: true, genres: await fetchLk21Genres() });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/watch/api/genre', async (req, res) => {
        const slug = String(req.query.g || req.query.slug || req.query.genre || '').trim();
        if (!slug) return res.status(400).json({ ok: false, error: 'Genre kosong.' });
        try {
            const page = Math.max(1, Number(req.query.page) || 1);
            const sort = String(req.query.sort || 'newest').toLowerCase() === 'oldest' ? 'oldest' : 'newest';
            const data = await browseLk21({ page, sort, genre: slug });
            res.json({ ok: true, genre: slug, ...data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.get('/watch/api/stream', async (req, res) => {
        try {
            const raw = req.query.u;
            if (!raw) return res.status(400).json({ ok: false, error: 'URL kosong.' });
            const url = decodeB64Url(raw);
            if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'URL tidak valid.' });
            const referers = [
                'https://lk21.us/',
                `https://${new URL(url).hostname}/`,
                'https://www.lk21.us/',
                ''
            ];
            let response = null;
            let lastErr = null;
            for (const referer of referers) {
                try {
                    const headers = { 'User-Agent': STREAM_UA, Accept: '*/*' };
                    if (referer) headers.Referer = referer;
                    if (req.headers.range) headers.Range = req.headers.range;
                    response = await axios.get(url, {
                        responseType: 'stream',
                        httpsAgent: streamAgent,
                        headers,
                        timeout: 120000,
                        maxRedirects: 5,
                        validateStatus: (s) => s >= 200 && s < 400
                    });
                    break;
                } catch (e) {
                    lastErr = e;
                }
            }
            if (!response) throw lastErr || new Error('Stream gagal');
            if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
            if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
            if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(response.status);
            response.data.pipe(res);
        } catch (e) {
            console.log('watch stream proxy:', e.message);
            if (!res.headersSent) res.status(502).json({ ok: false, error: 'Gagal memuat video. Coba film terbaru dengan player embed.' });
        }
    });

    app.get('/watch/embed', (req, res) => {
        const raw = req.query.u;
        if (!raw) return res.status(400).send('URL kosong');
        let target;
        try {
            target = decodeB64Url(raw);
        } catch (_) {
            return res.status(400).send('URL tidak valid');
        }
        if (!/^https?:\/\//i.test(target)) return res.status(400).send('URL tidak valid');
        const safe = target.replace(/"/g, '&quot;');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><style>*{margin:0;padding:0}html,body{height:100%;background:#000;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${safe}" referrerpolicy="no-referrer-when-downgrade" allowfullscreen allow="autoplay;encrypted-media;picture-in-picture;fullscreen"></iframe></body></html>`);
    });

    app.post('/watch/api/play', async (req, res) => {
        const { sessionId, url, title, embedUrl, poster } = req.body || {};
        if (!sessionId || !room.viewers.has(sessionId)) {
            return res.status(401).json({ ok: false, error: 'Sesi habis — login ulang.' });
        }
        const user = room.viewers.get(sessionId).username;
        try {
            let film;
            if (embedUrl) {
                film = {
                    title: title || 'Video',
                    embedUrl,
                    videoUrl: req.body?.videoUrl || '',
                    poster: poster || '',
                    pageUrl: url || '',
                    source: 'custom'
                };
            } else if (url) {
                film = await getLk21Film(url);
            } else {
                return res.status(400).json({ ok: false, error: 'URL film kosong.' });
            }
            room.film = withFilmKey(film);
            setPlayback({ position: 0, playing: true, by: user });
            pushChat('📺 TV', `${user} memutar ${film.title}`);
            res.json({ ok: true, room: roomSnapshot() });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/watch/api/queue', (req, res) => {
        const { sessionId, url, title } = req.body || {};
        if (!sessionId || !room.viewers.has(sessionId)) return res.status(401).json({ ok: false, error: 'Sesi habis.' });
        if (!url) return res.status(400).json({ ok: false, error: 'URL kosong.' });
        const user = room.viewers.get(sessionId).username;
        room.queue.push({ id: newId(), title: title || url, url, by: user });
        if (room.queue.length > 30) room.queue = room.queue.slice(-30);
        pushChat('📋 Antrian', `${user} + ${title || 'film'}`);
        res.json({ ok: true, room: roomSnapshot() });
    });

    app.post('/watch/api/skip', async (req, res) => {
        const { sessionId } = req.body || {};
        if (!sessionId || !room.viewers.has(sessionId)) return res.status(401).json({ ok: false, error: 'Sesi habis.' });
        const user = room.viewers.get(sessionId).username;
        const result = await playNextFromQueue(user);
        if (!result.ok) return res.status(400).json(result);
        res.json({ ok: true, room: roomSnapshot() });
    });

    app.post('/watch/api/chat', (req, res) => {
        const { sessionId, text } = req.body || {};
        if (!sessionId || !room.viewers.has(sessionId)) return res.status(401).json({ ok: false, error: 'Sesi habis.' });
        const msg = String(text || '').trim();
        if (!msg) return res.status(400).json({ ok: false, error: 'Pesan kosong.' });
        pushChat(room.viewers.get(sessionId).username, msg);
        res.json({ ok: true, chat: room.chat.slice(-20) });
    });

    app.post('/watch/api/voice/signal', (req, res) => {
        const { sessionId, to, data } = req.body || {};
        if (!sessionId || !room.viewers.has(sessionId)) return res.status(401).json({ ok: false, error: 'Sesi habis.' });
        room.voiceSignals.push({
            id: newId(), from: sessionId, fromName: room.viewers.get(sessionId).username,
            to: to || '*', data, at: Date.now()
        });
        if (room.voiceSignals.length > 100) room.voiceSignals = room.voiceSignals.slice(-100);
        res.json({ ok: true });
    });

    app.get('/watch/api/voice/signals', (req, res) => {
        const sessionId = String(req.query.sessionId || '');
        const since = Number(req.query.since) || 0;
        const list = room.voiceSignals.filter((s) => s.at > since && (s.to === '*' || s.to === sessionId || s.from === sessionId));
        res.json({ ok: true, signals: list });
    });

    app.get('/watch', sendWatch);
    app.get('/watch/', sendWatch);
    app.use('/watch', express.static(watchStaticDir, { index: false, redirect: false }));

    console.log(`\x1b[35m📺 Luxx Watch: ${getRadioPublicUrl()}/watch\x1b[0m`);
}