import fs from 'fs';
import path from 'path';
import { isRailwayRuntime } from './listen-port.js';

const PERSIST_DIR = path.resolve(process.env.PERSIST_DIR || '/app/persist');
const DEFAULT_COOKIES_PATH = path.join(PERSIST_DIR, 'data', 'youtube-cookies.txt');
const LOCAL_COOKIES_PATH = path.resolve('./data/youtube-cookies.txt');

function envCookiesPath() {
    const p = process.env.YTDLP_COOKIES_FILE?.trim();
    return p ? path.resolve(p) : null;
}

/** Path cookies YouTube yang dipakai yt-dlp (persist volume). */
export function resolveYoutubeCookiesPath() {
    const fromEnv = envCookiesPath();
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

    if (fs.existsSync(DEFAULT_COOKIES_PATH)) return DEFAULT_COOKIES_PATH;
    if (fs.existsSync(LOCAL_COOKIES_PATH)) return LOCAL_COOKIES_PATH;
    return fromEnv || DEFAULT_COOKIES_PATH;
}

export function hasYoutubeCookies() {
    const p = resolveYoutubeCookiesPath();
    try {
        return fs.existsSync(p) && fs.statSync(p).size > 80;
    } catch {
        return false;
    }
}

export function getYoutubeCookiesStatus() {
    const pathInUse = resolveYoutubeCookiesPath();
    let bytes = 0;
    let mtime = null;
    let valid = false;
    try {
        if (fs.existsSync(pathInUse)) {
            const st = fs.statSync(pathInUse);
            bytes = st.size;
            mtime = st.mtimeMs;
            const head = fs.readFileSync(pathInUse, 'utf8').slice(0, 400);
            valid = bytes > 80 && (
                head.includes('youtube.com') || head.includes('.youtube.') || head.includes('# HTTP Cookie File')
            );
        }
    } catch { /* ignore */ }

    return {
        configured: Boolean(process.env.YTDLP_COOKIES_FILE?.trim()),
        path: pathInUse,
        exists: bytes > 0,
        bytes,
        valid,
        mtime,
        ready: valid,
        hint: valid
            ? 'Cookies YouTube aktif — !play / Discord /radio siap unduh'
            : isRailwayRuntime()
                ? 'Wajib upload cookies: jalankan scripts/export-youtube-cookies.ps1 di PC lalu upload di admin'
                : 'Export cookies: scripts/export-youtube-cookies.ps1'
    };
}

export function saveYoutubeCookies(content) {
    const text = String(content || '').trim();
    if (text.length < 80) {
        throw new Error('File cookies terlalu pendek — export ulang dari browser (format Netscape).');
    }
    if (!/youtube/i.test(text) && !/# HTTP Cookie File/i.test(text) && !/# Netscape HTTP Cookie File/i.test(text)) {
        throw new Error('Format cookies tidak valid — harus berisi cookie youtube.com (Netscape).');
    }

    const target = envCookiesPath() || DEFAULT_COOKIES_PATH;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text.endsWith('\n') ? text : `${text}\n`, 'utf8');

    process.env.YTDLP_COOKIES_FILE = target;
    const st = fs.statSync(target);
    console.log(`\x1b[32m✅ YouTube cookies disimpan: ${target} (${st.size} bytes)\x1b[0m`);
    return { path: target, bytes: st.size };
}

export function getYoutubePoTokenArg() {
    const raw = process.env.YTDLP_PO_TOKEN?.trim() || process.env.YOUTUBE_PO_TOKEN?.trim();
    if (!raw) return [];
    return ['--extractor-args', `youtube:po_token=${raw}`];
}