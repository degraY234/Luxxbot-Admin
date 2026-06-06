import https from 'https';
import crypto from 'crypto';
import vm from 'vm';
import { TextDecoder, TextEncoder } from 'util';
import axios from 'axios';

const agent = new https.Agent({ rejectUnauthorized: false });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let bundle = null;
let bundleAt = 0;
const BUNDLE_TTL_MS = 6 * 60 * 60 * 1000;

function extractArray(src, startIdx) {
    let i = startIdx;
    while (src[i] !== '[') i++;
    const begin = i;
    let depth = 0;
    let str = null;
    let esc = false;
    for (; i < src.length; i++) {
        const c = src[i];
        if (str) {
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === str) str = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { str = c; continue; }
        if (c === '[') depth++;
        else if (c === ']') {
            depth--;
            if (depth === 0) return src.slice(begin, i + 1);
        }
    }
    throw new Error('Array parse gagal');
}

export function parseVideoId(embedUrl = '') {
    const hash = String(embedUrl).match(/#([a-z0-9]+)/i);
    if (hash) return hash[1];
    const path = String(embedUrl).match(/\/v\/([a-z0-9]+)/i);
    return path?.[1] || '';
}

function pickHost(embedUrl = '') {
    try {
        return new URL(embedUrl).hostname || 'sf21.vidplayer.live';
    } catch {
        return 'sf21.vidplayer.live';
    }
}

async function loadBundle() {
    if (bundle && Date.now() - bundleAt < BUNDLE_TTL_MS) return bundle;

    const headers = { 'User-Agent': UA, Referer: 'https://lk21.us/', Accept: '*/*' };
    const { data: html } = await axios.get('https://sf21.vidplayer.live/', { httpsAgent: agent, headers, timeout: 15000 });
    const jsMatch = String(html).match(/src="(\/assets\/[^"]+\.js)"/);
    if (!jsMatch) throw new Error('Bundle player tidak ditemukan');

    const { data: js } = await axios.get(`https://sf21.vidplayer.live${jsMatch[1]}`, { httpsAgent: agent, headers, timeout: 30000 });
    const s = String(js);

    const dlPos = s.indexOf('function Dl(){const n=[');
    const arr = extractArray(s, dlPos);
    const shuffleStart = s.lastIndexOf('(function(', dlPos);
    const shuffleEnd = s.indexOf('})(Dl,', shuffleStart)
        + s.slice(s.indexOf('})(Dl,', shuffleStart)).match(/^\}\)\(Dl,\d+\)/)[0].length;
    const shuffleCode = s.slice(shuffleStart, shuffleEnd);
    const cryptoStart = s.indexOf('f=m=>{const E=le;return new Uint8Array');
    const cryptoEnd = s.indexOf(',M=async m=>', cryptoStart);
    const cryptoBlock = s.slice(cryptoStart, cryptoEnd);

    const sandbox = {
        window: {
            location: { protocol: 'https:', hash: '#oh1qd', host: 'sf21.vidplayer.live', hostname: 'sf21.vidplayer.live' },
            TextDecoder,
            TextEncoder
        },
        Uint8Array,
        Array,
        String,
        parseInt,
        JSON,
        Math,
        setTimeout: () => 0
    };

    const ctx = vm.createContext(sandbox);
    const exp = vm.runInContext(`
const n = ${arr};
function Dl(){return n}
let le=function(a,b){const t=Dl();le=function(s,i){return t[s-291]};return le(a,b)};
${shuffleCode}
${cryptoBlock}
({S,T,f,R})
`, ctx);

    bundle = { exp, sandbox };
    bundleAt = Date.now();
    return bundle;
}

function pickStream(parsed, host) {
    if (!parsed || typeof parsed !== 'object') return '';
    const rel = parsed.hlsVideoTiktok || '';
    if (rel.startsWith('/')) return `https://${host}${rel}`;
    if (/^https?:\/\//i.test(rel)) return rel;
    if (parsed.source && /^https?:\/\//i.test(parsed.source)) return parsed.source;
    return '';
}

export function isVidplayerUrl(url = '') {
    return /vidplayer\.live/i.test(url);
}

export async function resolveVidplayerStream(embedUrl) {
    const videoId = parseVideoId(embedUrl);
    if (!videoId) return null;

    const host = pickHost(embedUrl);
    const { exp, sandbox } = await loadBundle();
    const id = parseVideoId(embedUrl);
    sandbox.window.location = {
        protocol: 'https:',
        hash: id ? `#${id}` : '',
        host,
        hostname: host
    };

    const headers = {
        'User-Agent': UA,
        Referer: `https://${host}/`,
        Origin: `https://${host}`,
        Accept: '*/*'
    };

    const apiUrl = `https://${host}/api/v1/video?id=${videoId}&w=1920&h=1080&r=lk21.us`;
    const { data: hex } = await axios.get(apiUrl, { httpsAgent: agent, headers, timeout: 20000 });
    if (!hex || typeof hex !== 'string') return null;

    try {
        const key = Buffer.from(exp.S());
        const iv = Buffer.from(exp.T());
        const data = Buffer.from(exp.f(hex));
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
        const parsed = exp.R(plain, {});
        const streamUrl = pickStream(parsed, host);
        if (!streamUrl) return null;
        return { streamUrl, title: parsed?.title || '', videoId };
    } catch (e) {
        console.log('vidplayer resolve:', e.message);
        return null;
    }
}