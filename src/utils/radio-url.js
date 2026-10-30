import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import axios from 'axios';
import { getListenPort, isRailwayRuntime, isRenderRuntime } from './listen-port.js';
import { persistRadioPublicUrl } from './env-persist.js';
import { publishBotDiscovery } from './bot-discovery-publish.js';

const RADIO_PORT = getListenPort();
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;

function isValidTunnelHost(url) {
    try {
        const { hostname } = new URL(url);
        return /\.trycloudflare\.com$/i.test(hostname) && hostname !== 'api.trycloudflare.com';
    } catch {
        return false;
    }
}

let cache = { base: null, at: 0 };
let lastTunnelRecoverAt = 0;
const TUNNEL_RECOVER_COOLDOWN_MS = 90_000;

const TUNNEL_LOG_PATHS = [
    path.join(process.cwd(), 'temp', 'radio-tunnel-new.log'),
    path.join(process.cwd(), 'temp', 'radio-tunnel.log'),
    path.join(process.cwd(), 'temp', 'radio-tunnel-setup.log'),
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.pm2', 'logs', 'luxx-tunnel-out.log')
];

export function getLanIPv4() {
    const nets = os.networkInterfaces();
    for (const ifaces of Object.values(nets)) {
        for (const net of ifaces || []) {
            if (net.family === 'IPv4' && !net.internal) return net.address;
        }
    }
    return null;
}

function isPrivateHost(hostname) {
    if (!hostname) return true;
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
    if (/^192\.168\./.test(h)) return true;
    if (/^10\./.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return false;
}

async function probeBase(base) {
    const { data } = await axios.get(`${base.replace(/\/$/, '')}/health`, {
        timeout: 2500,
        validateStatus: (s) => s === 200
    });
    return Boolean(data?.ok);
}

function getRailwayBaseUrl() {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
    if (domain) return `https://${domain}`.replace(/\/$/, '');
    const staticUrl = process.env.RAILWAY_STATIC_URL?.trim().replace(/\/$/, '');
    if (staticUrl && !/localhost|127\.0\.0\.1/i.test(staticUrl)) return staticUrl;
    return '';
}

function getRenderBaseUrl() {
    const ext = process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, '');
    if (ext && !/localhost|127\.0\.0\.1/i.test(ext)) return ext;
    const host = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
    if (host && !/localhost|127\.0\.0\.1/i.test(host)) return `https://${host}`.replace(/\/$/, '');
    return '';
}

function getConfiguredBaseUrl() {
    const railway = getRailwayBaseUrl();
    if (railway) return railway;
    const render = getRenderBaseUrl();
    if (render) return render;
    const configured = process.env.RADIO_PUBLIC_URL?.trim().replace(/\/$/, '') || '';
    if ((isRailwayRuntime() || isRenderRuntime()) && /\.trycloudflare\.com/i.test(configured)) {
        return railway || render || '';
    }
    if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) return configured;
    return '';
}

/** URL publik dari .env (tunnel/domain/VPS) — bukan localhost/LAN. */
export function getConfiguredPublicBaseUrl() {
    const configured = getConfiguredBaseUrl();
    if (!configured) return null;
    try {
        const { hostname } = new URL(configured);
        if (!isPrivateHost(hostname)) return configured;
    } catch {
        /* invalid */
    }
    return null;
}

/** Ambil URL trycloudflare terbaru dari log tunnel (kalau .env ketinggalan). */
export function extractTunnelUrlsFromLogs(limit = 5) {
    const ordered = [];
    const seen = new Set();
    for (const logPath of TUNNEL_LOG_PATHS) {
        try {
            if (!fs.existsSync(logPath)) continue;
            const content = fs.readFileSync(logPath, 'utf8');
            for (const m of content.matchAll(TUNNEL_URL_RE)) {
                const u = m[0];
                if (!isValidTunnelHost(u)) continue;
                if (seen.has(u)) {
                    ordered.splice(ordered.indexOf(u), 1);
                } else {
                    seen.add(u);
                }
                ordered.push(u);
            }
        } catch {
            /* skip */
        }
    }
    return ordered.reverse().slice(0, limit);
}

async function collectPublicCandidates() {
    const out = [];
    const push = (u) => {
        const clean = String(u || '').trim().replace(/\/$/, '');
        if (clean && !out.includes(clean)) out.push(clean);
    };
    // Log tunnel lebih baru dari .env — coba yang terbaru dulu (maks 3)
    for (const u of extractTunnelUrlsFromLogs(3)) push(u);
    push(getConfiguredPublicBaseUrl());
    return out;
}

/**
 * Cari URL publik yang benar-benar hidup (probe /health).
 * @returns {Promise<{ base: string|null, source: string, localOk: boolean }>}
 */
export async function discoverLivePublicBase() {
    let localOk = false;
    try {
        localOk = await probeBase(`http://127.0.0.1:${RADIO_PORT}`);
    } catch {
        localOk = false;
    }

    const candidates = await collectPublicCandidates();
    for (const base of candidates) {
        try {
            if (await probeBase(base)) {
                const configured = getConfiguredPublicBaseUrl();
                if (configured && configured !== base) {
                    console.log(`\x1b[33m🌐 Tunnel URL baru terdeteksi: ${base}\x1b[0m`);
                }
                return { base, source: 'tunnel', localOk };
            }
        } catch {
            /* coba berikutnya */
        }
    }

    if (localOk) {
        const railway = getRailwayBaseUrl();
        const render = getRenderBaseUrl();
        const cloudBase = railway || render;
        if (cloudBase) {
            try {
                if (await probeBase(cloudBase)) {
                    return { base: cloudBase, source: railway ? 'railway' : 'render', localOk };
                }
            } catch { /* lanjut */ }
            return { base: cloudBase, source: railway ? 'railway-local' : 'render-local', localOk };
        }
        const configured = getConfiguredPublicBaseUrl();
        if (configured) {
            return { base: configured, source: 'stale', localOk };
        }
        const lan = getLanIPv4();
        if (lan) return { base: `http://${lan}:${RADIO_PORT}`, source: 'lan', localOk };
        return { base: `http://127.0.0.1:${RADIO_PORT}`, source: 'local', localOk };
    }

    return { base: null, source: 'down', localOk: false };
}

/** Cari URL publik hidup — tanpa restart tunnel (restart = URL baru = link lama mati). */
export async function ensureLivePublicBase() {
    invalidateRadioUrlCache();
    return discoverLivePublicBase();
}

/**
 * Restart luxx-tunnel dan tunggu URL trycloudflare yang benar-benar hidup.
 * Dipanggil saat tunnel di .env mati tapi bot lokal masih jalan.
 */
export async function tryRecoverTunnelUrl({ force = false } = {}) {
    if (isRailwayRuntime() || isRenderRuntime()) return null;
    if (!force && Date.now() - lastTunnelRecoverAt < TUNNEL_RECOVER_COOLDOWN_MS) return null;
    lastTunnelRecoverAt = Date.now();

    const prev = getConfiguredPublicBaseUrl() || '';
    if (process.platform === 'win32') {
        try {
            spawnSync('taskkill', ['/F', '/IM', 'cloudflared.exe'], { stdio: 'ignore', shell: true, windowsHide: true });
        } catch { /* ignore */ }
    }

    try {
        const { ensurePm2Tunnel } = await import('./ensure-pm2-tunnel.js');
        const { isLuxxAutoTunnelEnabled } = await import('./luxx-pm2-flags.js');
        if (isLuxxAutoTunnelEnabled()) {
            ensurePm2Tunnel({ quiet: true, forceStart: true });
        }
    } catch { /* ignore */ }

    for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        invalidateRadioUrlCache();
        for (const base of extractTunnelUrlsFromLogs(3)) {
            try {
                if (await probeBase(base)) {
                    if (base !== prev) {
                        persistRadioPublicUrl(base, { injectApp: false });
try { publishBotDiscovery(base); } catch { /* ignore */ }
                        console.log(`\x1b[32m🌐 Tunnel dipulihkan: ${base}\x1b[0m`);
                    }
                    cache = { base, at: Date.now() };
                    return base;
                }
            } catch { /* tunggu URL berikutnya */ }
        }
    }
    return null;
}

/** URL untuk dibagikan ke WhatsApp — tidak pakai LAN/local. */
export async function resolveWaShareBase() {
    invalidateRadioUrlCache();
    let status = await discoverLivePublicBase();
    if (status.source === 'tunnel') return { base: status.base, status };

    if (status.localOk && status.source !== 'railway') {
        const recovered = await tryRecoverTunnelUrl();
        if (recovered) {
            status = { base: recovered, source: 'tunnel', localOk: true };
            return { base: recovered, status };
        }
    }

    if (status.source === 'stale' || status.source === 'railway' || status.source === 'railway-local') {
        return { base: status.base, status };
    }

    const configured = getConfiguredPublicBaseUrl();
    if (configured) {
        return { base: configured, status: { ...status, base: configured, source: 'stale' } };
    }

    return { base: null, status };
}

/**
 * URL untuk dibagikan ke user (!radio, !watch).
 */
export async function resolveShareBaseUrl() {
    if (cache.base && Date.now() - cache.at < 30000) return cache.base;

    const live = await discoverLivePublicBase();
    if (live.base && live.source === 'tunnel') {
        cache = { base: live.base, at: Date.now() };
        return live.base;
    }

    const configured = getConfiguredPublicBaseUrl();
    if (configured) {
        cache = { base: configured, at: Date.now() };
        return configured;
    }

    return resolveRadioBaseUrl();
}

export async function getShareBaseStatus() {
    return discoverLivePublicBase();
}

/**
 * Pilih URL yang hidup untuk cek internal: .env lokal → LAN → localhost.
 */
export async function resolveRadioBaseUrl() {
    const configured = getConfiguredBaseUrl();
    if (cache.base && Date.now() - cache.at < 45000) return cache.base;

    const publicBase = getConfiguredPublicBaseUrl();
    if (publicBase) {
        cache = { base: publicBase, at: Date.now() };
        return publicBase;
    }

    const candidates = [];
    if (configured) candidates.push(configured);
    const lan = getLanIPv4();
    if (lan) candidates.push(`http://${lan}:${RADIO_PORT}`);
    candidates.push(`http://127.0.0.1:${RADIO_PORT}`);

    for (const base of candidates) {
        try {
            if (await probeBase(base)) {
                cache = { base, at: Date.now() };
                return base;
            }
        } catch {
            /* coba kandidat berikutnya */
        }
    }

    const fallback = configured || `http://127.0.0.1:${RADIO_PORT}`;
    cache = { base: fallback, at: Date.now() };
    return fallback;
}

export async function getRadioListenUrlAsync() {
    const base = await resolveShareBaseUrl();
    return `${base}/portfolio/radio`;
}

export function getRadioUrlHint(baseUrl, status = null) {
    if (status?.source === 'stale') {
        return '\n\n⚠️ _Tunnel di .env mungkin mati. Owner: jalankan `scripts\\radio-tunnel.ps1` lalu restart bot._';
    }
    if (status?.source === 'down') {
        return '\n\n❌ _Server watch belum hidup. Pastikan bot (pm2) & tunnel jalan._';
    }
    try {
        const { hostname } = new URL(baseUrl);
        if (!isPrivateHost(hostname)) return '';
        if (hostname === '127.0.0.1' || hostname === 'localhost') {
            return '\n\n💡 _Link ini cuma di PC bot. Untuk HP luar jaringan: jalankan tunnel lalu update `.env`._';
        }
        return '\n\n💡 _Link WiFi/LAN — HP harus satu WiFi dengan PC bot. Untuk internet: jalankan tunnel._';
    } catch {
        return '\n\n⚠️ _URL tidak valid._';
    }
}

export function invalidateRadioUrlCache() {
    cache = { base: null, at: 0 };
}

/** URL publik untuk share (/radio, /watch) */
export function getRadioPublicUrl() {
    const live = process.env.RADIO_PUBLIC_URL?.trim().replace(/\/$/, '');
    try {
        if (live && !isPrivateHost(new URL(live).hostname)) return live;
    } catch { /* invalid url */ }
    return (
        getConfiguredPublicBaseUrl() ||
        getConfiguredBaseUrl() ||
        `http://127.0.0.1:${RADIO_PORT}`
    );
}

/**
 * Sinkronkan RADIO_PUBLIC_URL dari tunnel hidup → process.env + .env.
 * Dipanggil saat boot, periodic, dan saat tunnel ganti URL.
 */
export async function syncPublicUrl({ persist = true, quiet = false } = {}) {
    try {
        invalidateRadioUrlCache();
        let live = await discoverLivePublicBase();
        if (live.source === 'stale' && live.localOk && !isRailwayRuntime() && !isRenderRuntime()) {
            const recovered = await tryRecoverTunnelUrl();
            if (recovered) {
                live = { base: recovered, source: 'tunnel', localOk: true };
            }
        }
        if (!live.base) return live;

        const clean = live.base.replace(/\/$/, '');
        const prev = process.env.RADIO_PUBLIC_URL?.trim().replace(/\/$/, '') || '';

        if (persist && live.source === 'tunnel') {
            const { changed, fileWritten } = persistRadioPublicUrl(clean, { injectApp: false });
            if (changed) {
try { publishBotDiscovery(clean); } catch { /* ignore */ }
            }
            if (changed && !quiet) {
                const tag = fileWritten ? '→ .env' : 'memori';
                const lan = getLanIPv4();
                const lanHint = lan ? ` · LAN: http://${lan}:${RADIO_PORT}` : '';
                console.log(`\x1b[32m🌐 Tunnel URL ${prev && prev !== clean ? 'baru' : 'aktif'}: ${clean} (${tag})${lanHint}\x1b[0m`);
            }
        } else if (clean !== prev) {
            process.env.RADIO_PUBLIC_URL = clean;
            if (!quiet) {
                console.log(`\x1b[32m🌐 Public URL aktif: ${clean} (${live.source})\x1b[0m`);
            }
        }

        cache = { base: clean, at: Date.now() };
        return { ...live, base: clean };
    } catch (e) {
        if (!quiet) console.warn('🌐 syncPublicUrl:', e.message);
        return { base: getRadioPublicUrl(), source: 'local', localOk: true };
    }
}

/** @deprecated gunakan syncPublicUrl */
export async function bootstrapPublicUrl() {
    return syncPublicUrl({ persist: true, quiet: false });
}