import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { randomBytes } from 'crypto';
import axios from 'axios';
import { getRadioPublicUrl } from '../utils/radio-url.js';
import {
    searchLk21, getLk21Film, fetchLatestLk21, fetchLk21Genres,
    browseLk21Genre, browseLk21, getLk21HomeMeta
} from './lk21.js';
import { isVidplayerUrl, resolveVidplayerStream } from './vidplayer.js';

const streamAgent = new https.Agent({ rejectUnauthorized: false });
const STREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PLAYER_REFERER = 'https://sf21.vidplayer.live/';
const PLAYER_ORIGIN = 'https://sf21.vidplayer.live';

function streamFetchHeaders(url, req) {
    const headers = { 'User-Agent': STREAM_UA, Accept: '*/*' };
    const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    if (/vidplayer\.live|\/v4\/|\.m3u8/i.test(url) || /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(host)) {
        headers.Referer = PLAYER_REFERER;
        headers.Origin = PLAYER_ORIGIN;
    } else {
        headers.Referer = 'https://lk21.us/';
    }
    if (req?.headers?.range) headers.Range = req.headers.range;
    return headers;
}

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

function cleanEmbedFallbacks(embedUrl, fallbacks = []) {
    return fallbacks.filter((u) => {
        if (!u || u === embedUrl) return false;
        if (/vidplayer\.live\/?$/i.test(u) && !/#[a-z0-9]+/i.test(u)) return false;
        return true;
    }).slice(0, 4);
}

function proxyEmbedUrl(url) {
    if (!url) return '';
    return `/watch/embed?u=${encodeB64Url(url)}`;
}

function clientEmbedUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return '';
    return proxyEmbedUrl(url);
}

function enrichFilmForClient(film) {
    if (!film) return null;
    const out = { ...film };
    if (out.hls && out.videoUrl) {
        out.playVideoUrl = `/watch/api/hls?u=${encodeB64Url(out.videoUrl)}`;
        out.playUseHls = true;
    } else if (out.videoUrl) {
        out.playVideoUrl = `/watch/api/stream?u=${encodeB64Url(out.videoUrl)}`;
    }
    if (out.embedUrl) {
        out.playEmbedUrl = clientEmbedUrl(out.embedUrl);
        out.playEmbedProxyUrl = out.playEmbedUrl;
    }
    if (out.embedFallbacks?.length) {
        const cleaned = cleanEmbedFallbacks(out.embedUrl, out.embedFallbacks);
        out.playEmbedFallbacks = cleaned.map((u) => clientEmbedUrl(u)).filter(Boolean);
    }
    return out;
}

async function tryResolveVidplayer(embedUrl) {
    try {
        return await resolveVidplayerStream(embedUrl);
    } catch (e) {
        const status = e.response?.status;
        if (status === 429) console.log('vidplayer rate limited — pakai embed');
        else console.log('vidplayer resolve skip:', e.message);
        return null;
    }
}

async function resolveFilmPlayback(film) {
    if (!film || film.videoUrl) return film;

    const candidates = [
        film.embedUrl,
        ...(film.embedFallbacks || [])
    ].filter(Boolean);

    if (!candidates.length) return film;

    for (const url of candidates) {
        if (!isVidplayerUrl(url)) continue;
        const resolved = await tryResolveVidplayer(url);
        if (resolved?.streamUrl) {
            const rest = candidates.filter((u) => u !== url);
            const nonVid = rest.filter((u) => !isVidplayerUrl(u));
            return {
                ...film,
                title: film.title || resolved.title || film.title,
                videoUrl: resolved.streamUrl,
                hls: true,
                embedUrl: url,
                embedFallbacks: [...nonVid, ...rest.filter((u) => isVidplayerUrl(u) && u !== url)].slice(0, 5)
            };
        }
    }

    const nonVid = candidates.filter((u) => !isVidplayerUrl(u));
    if (nonVid.length && isVidplayerUrl(film.embedUrl)) {
        return {
            ...film,
            embedUrl: nonVid[0],
            embedFallbacks: [...nonVid.slice(1), ...candidates.filter((u) => isVidplayerUrl(u))].slice(0, 5),
            videoUrl: ''
        };
    }

    return film;
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
    if (room.viewers.size === 0) {
        room.film = null;
        room.playback = { position: 0, playing: false, updatedAt: Date.now(), by: '' };
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

async function loadFilmFromUrl(url, title = '') {
    let film = withFilmKey(await getLk21Film(url, { title }));
    film = withFilmKey(await resolveFilmPlayback(film));
    if (!film.embedUrl && !film.videoUrl) {
        throw new Error('Player tidak ditemukan untuk film ini.');
    }
    return film;
}

async function playNextFromQueue(by, { auto = false } = {}) {
    if (!room.queue.length) {
        return { ok: false, error: auto ? 'Antrian kosong — film selesai.' : 'Antrian kosong — tambahkan film dulu.' };
    }
    const next = room.queue.shift();
    try {
        const film = await loadFilmFromUrl(next.url, next.title);
        room.film = film;
        setPlayback({ position: 0, playing: false, by });
        const label = auto ? 'auto lanjut' : 'skip';
        pushChat('⏭️ TV', `${by} ${label} → ${film.title}`);
        return { ok: true, film, auto };
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

    app.post('/watch/api/ping', async (req, res) => {
        const { sessionId, reportPlayback, position, playing } = req.body || {};
        if (sessionId && room.viewers.has(sessionId)) {
            const viewer = room.viewers.get(sessionId);
            viewer.lastSeen = Date.now();
            const finished = !!req.body?.finished;
            if (finished && room.film) {
                await playNextFromQueue(viewer.username, { auto: true });
            } else if (reportPlayback && room.film?.videoUrl) {
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

    app.get('/watch/api/health', (_req, res) => {
        res.json({
            ok: true,
            service: 'luxx-watch',
            viewers: room.viewers.size,
            hasFilm: Boolean(room.film),
            publicUrl: `${getRadioPublicUrl()}/watch`
        });
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
            let response = null;
            let lastErr = null;
            try {
                response = await axios.get(url, {
                    responseType: 'stream',
                    httpsAgent: streamAgent,
                    headers: streamFetchHeaders(url, req),
                    timeout: 120000,
                    maxRedirects: 5,
                    validateStatus: (s) => s >= 200 && s < 400
                });
            } catch (e) {
                lastErr = e;
            }
            if (!response) throw lastErr || new Error('Stream gagal');
            if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
            if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
            if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'no-store');
            res.status(response.status);

            const upstream = response.data;
            const cleanup = () => {
                try { upstream.destroy(); } catch (_) {}
            };
            req.on('close', cleanup);
            res.on('close', cleanup);
            upstream.on('error', () => {
                if (!res.headersSent) {
                    res.status(502).json({ ok: false, error: 'Stream putus. Coba film dengan player embed.' });
                } else {
                    res.end();
                }
            });
            upstream.pipe(res);
        } catch (e) {
            console.log('watch stream proxy:', e.message);
            if (!res.headersSent) res.status(502).json({ ok: false, error: 'Gagal memuat video. Coba film terbaru dengan player embed.' });
        }
    });

    app.get('/watch/api/hls', async (req, res) => {
        try {
            const raw = req.query.u;
            if (!raw) return res.status(400).send('URL kosong');
            const url = decodeB64Url(raw);
            if (!/^https?:\/\//i.test(url)) return res.status(400).send('URL tidak valid');

            let text = '';
            try {
                const response = await axios.get(url, {
                    httpsAgent: streamAgent,
                    headers: streamFetchHeaders(url, req),
                    timeout: 30000,
                    responseType: 'text',
                    validateStatus: (s) => s >= 200 && s < 400
                });
                text = String(response.data || '');
            } catch (_) {}
            if (!text) return res.status(502).send('Gagal memuat playlist');

            const base = url.substring(0, url.lastIndexOf('/') + 1);
            const publicRoot = `${getRadioPublicUrl()}/watch/api/stream?u=`;
            const rewritten = text.split('\n').map((line) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return line;
                const abs = /^https?:\/\//i.test(trimmed) ? trimmed : new URL(trimmed, base).href;
                return `${publicRoot}${encodeB64Url(abs)}`;
            }).join('\n');

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'no-store');
            res.send(rewritten);
        } catch (e) {
            console.log('watch hls proxy:', e.message);
            if (!res.headersSent) res.status(502).send('Gagal memuat HLS');
        }
    });

    app.get('/watch/lk21', (req, res) => {
        const raw = req.query.u;
        if (!raw) return res.status(400).send('URL kosong');
        let target;
        try {
            target = decodeB64Url(raw);
        } catch (_) {
            return res.status(400).send('URL tidak valid');
        }
        if (!/^https?:\/\//i.test(target) || !/\/sinopsis\//i.test(target)) {
            return res.status(400).send('URL LK21 tidak valid');
        }
        const safe = target.replace(/"/g, '&quot;').replace(/</g, '&lt;');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><meta name="referrer" content="no-referrer-when-downgrade"/><title>Player</title><style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;background:#000;overflow:hidden}#stage{position:relative;width:100%;height:100%;overflow:hidden;background:#000}#lk21-frame{position:absolute;left:0;width:100%;height:280%;top:-132%;border:0;display:block;background:#000;pointer-events:auto}@media(max-width:768px){#lk21-frame{height:310%;top:-138%}}</style></head><body><div id="stage"><iframe id="lk21-frame" src="${safe}" referrerpolicy="no-referrer-when-downgrade" allowfullscreen allow="autoplay;encrypted-media;picture-in-picture;fullscreen;clipboard-write"></iframe></div></body></html>`);
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
        const safe = target.replace(/"/g, '&quot;').replace(/</g, '&lt;');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><meta name="referrer" content="no-referrer-when-downgrade"/><title>Player</title><style>*{margin:0;padding:0}html,body{height:100%;background:#000;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${safe}" referrerpolicy="no-referrer-when-downgrade" allowfullscreen allow="autoplay;encrypted-media;picture-in-picture;fullscreen;clipboard-write"></iframe></body></html>`);
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
                film = withFilmKey(await resolveFilmPlayback({
                    title: title || 'Video',
                    embedUrl,
                    videoUrl: req.body?.videoUrl || '',
                    poster: poster || '',
                    pageUrl: url || '',
                    source: 'custom',
                    embedFallbacks: req.body?.embedFallbacks || []
                }));
            } else if (url) {
                film = await loadFilmFromUrl(url, title);
            } else {
                return res.status(400).json({ ok: false, error: 'URL film kosong.' });
            }
            room.film = film;
            if (!room.film.embedUrl && !room.film.videoUrl) {
                throw new Error('Player LK21 tidak ditemukan untuk film ini.');
            }
            setPlayback({ position: 0, playing: false, by: user });
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
    app.use('/watch', express.static(watchStaticDir, {
        index: false,
        redirect: false,
        maxAge: '1h',
        setHeaders(res, filePath) {
            if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        }
    }));

    console.log(`\x1b[35m📺 Luxx Watch: ${getRadioPublicUrl()}/watch\x1b[0m`);
}