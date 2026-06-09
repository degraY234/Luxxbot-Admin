import { getConfiguredPublicBaseUrl } from './radio-url.js';

function isLocalUrl(url) {
    try {
        const { hostname } = new URL(url);
        if (!hostname) return true;
        const h = hostname.toLowerCase();
        if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
        if (/^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
        return false;
    } catch {
        return true;
    }
}

function normalizeBase(url) {
    return String(url || '').trim().replace(/\/$/, '');
}

/** Cari URL publik Railway/domain — abaikan localhost di .env */
export function detectPublicBaseUrl() {
    const direct = getConfiguredPublicBaseUrl();
    if (direct && !isLocalUrl(direct)) return normalizeBase(direct);

    const candidates = [];

    const push = (u) => {
        const clean = normalizeBase(u);
        if (clean && !isLocalUrl(clean) && !candidates.includes(clean)) candidates.push(clean);
    };

    push(process.env.RAILWAY_STATIC_URL);
    if (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()) {
        push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`);
    }

    for (const [key, val] of Object.entries(process.env)) {
        const v = String(val || '').trim();
        if (!v) continue;
        if (/\.up\.railway\.app/i.test(v)) {
            push(/^https?:\/\//i.test(v) ? v : `https://${v}`);
        }
        if (/PUBLIC.*URL|STATIC.*URL|SERVICE.*URL/i.test(key) && /^https:\/\//i.test(v)) {
            push(v);
        }
    }

    return candidates[0] || null;
}

export function getPublicBaseUrl() {
    return detectPublicBaseUrl() || `http://127.0.0.1:${Number(process.env.RADIO_PORT || process.env.PORT || 3920)}`;
}

export function getPairLink() {
    const base = detectPublicBaseUrl();
    if (base) return `${base}/pair`;
    const port = Number(process.env.RADIO_PORT || process.env.PORT || 3920);
    return `http://127.0.0.1:${port}/pair`;
}

/** Satu link jelas — yang user perlu buka */
export function printPairLinkBanner() {
    const pair = getPairLink();
    const isPublic = /^https:\/\//i.test(pair) && !isLocalUrl(pair);

    console.log('');
    if (isPublic) {
        console.log('\x1b[32m════════════════════════════════════════════════════════\x1b[0m');
        console.log('\x1b[33m  📱 PAIR WHATSAPP — BUKA LINK INI DI LAPTOP:\x1b[0m');
        console.log('\x1b[32m════════════════════════════════════════════════════════\x1b[0m');
        console.log(`\x1b[1m\x1b[36m  ${pair}\x1b[0m`);
        console.log('\x1b[32m════════════════════════════════════════════════════════\x1b[0m');
        console.log('\x1b[36m  Lalu scan QR di layar laptop pakai WhatsApp di HP\x1b[0m');
        console.log('');
        return;
    }

    console.log('\x1b[31m════════════════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[31m  ⚠️  LINK PUBLIK BELUM ADA — pair tidak bisa dibuka dari luar\x1b[0m');
    console.log('\x1b[31m════════════════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[33m  Railway → Service → Settings → Networking → Generate Domain\x1b[0m');
    console.log('\x1b[33m  Variables → RADIO_PUBLIC_URL=https://NAMA.up.railway.app\x1b[0m');
    console.log('\x1b[33m  Lalu Redeploy. Jangan isi 127.0.0.1 di RADIO_PUBLIC_URL.\x1b[0m');
    console.log(`\x1b[90m  (lokal saja: ${pair})\x1b[0m`);
    console.log('');
}

/** @deprecated use printPairLinkBanner */
export function printStartupBanner() {
    printPairLinkBanner();
}

export function getServiceLinks() {
    const base = getPublicBaseUrl();
    return {
        base,
        pair: `${base}/pair`,
        admin: `${base}/admin`,
        radio: `${base}/portfolio/radio`,
        watch: `${base}/watch`,
        health: `${base}/health`
    };
}