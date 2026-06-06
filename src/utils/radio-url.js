import os from 'os';
import axios from 'axios';

const RADIO_PORT = Number(process.env.RADIO_PORT || 3920);

let cache = { base: null, at: 0 };

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
        timeout: 4000,
        validateStatus: (s) => s === 200
    });
    return Boolean(data?.ok);
}

/**
 * Pilih URL radio yang benar-benar hidup: publik (tunnel) → LAN → localhost.
 */
export async function resolveRadioBaseUrl() {
    const configured = process.env.RADIO_PUBLIC_URL?.trim().replace(/\/$/, '');
    if (cache.base && Date.now() - cache.at < 45000) return cache.base;

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
    const base = await resolveRadioBaseUrl();
    return `${base}/radio`;
}

export function getRadioUrlHint(baseUrl) {
    try {
        const { hostname } = new URL(baseUrl);
        if (!isPrivateHost(hostname)) return '';
        if (hostname === '127.0.0.1' || hostname === 'localhost') {
            return '\n\n💡 _Link ini cuma di PC bot. Untuk HP luar jaringan: jalankan tunnel lalu update `.env`._';
        }
        return '\n\n💡 _Link WiFi/LAN — HP harus satu WiFi dengan PC bot. Untuk internet: jalankan tunnel._';
    } catch {
        return '\n\n⚠️ _URL radio tidak valid._';
    }
}

export function invalidateRadioUrlCache() {
    cache = { base: null, at: 0 };
}