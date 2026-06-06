import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import TiktokDownloader from '@tobyg74/tiktok-api-dl';
import { downloadAudioToMp3, downloadVideoHd, getYtDlpTitle } from '../utils/ytdlp-download.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export function parseDlArgs(args) {
    const parts = [...args];
    let mode = 'video';
    if (parts[0]?.toLowerCase() === 'mp3' || parts[0]?.toLowerCase() === 'audio') {
        mode = 'audio';
        parts.shift();
    } else if (parts[0]?.toLowerCase() === 'video') {
        parts.shift();
    }
    const joined = parts.join(' ');
    const urlMatch = joined.match(/https?:\/\/[^\s]+/i);
    const url = urlMatch?.[0]?.replace(/[>,\])}]+$/, '') || parts.find((p) => /^https?:\/\//i.test(p));
    return { mode, url };
}

function detectPlatform(url) {
    const u = url.toLowerCase();
    if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
    if (u.includes('tiktok.com') || u.includes('vt.tiktok') || u.includes('vm.tiktok')) return 'tiktok';
    if (u.includes('instagram.com') || u.includes('instagr.am')) return 'instagram';
    if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook';
    return 'other';
}

function sanitizeFileName(name) {
    return name.replace(/[<>:"/\\|?*]/g, '').slice(0, 80) || 'media';
}

function pickBestMediaUrl(candidates) {
    const list = [...new Set(candidates.filter(Boolean))];
    if (!list.length) return null;
    const scored = list.map((url) => {
        let score = 0;
        if (/\.mp4/i.test(url)) score += 10;
        if (/hd|high|1080|720/i.test(url)) score += 8;
        if (/cdninstagram|fbcdn|tiktok/i.test(url)) score += 5;
        if (/thumbnail|jpg|jpeg|png|webp/i.test(url)) score -= 20;
        return { url, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].url;
}

async function fetchBufferFromUrl(mediaUrl, maxMb = 64) {
    const res = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        timeout: 180000,
        maxContentLength: maxMb * 1024 * 1024,
        maxRedirects: 5,
        headers: { 'User-Agent': UA, Referer: mediaUrl, Accept: '*/*' }
    });
    return Buffer.from(res.data);
}

/** TikTok HD via tikwm */
async function downloadTiktokApi(url) {
    const res = await axios.get('https://tikwm.com/api/', {
        params: { url, hd: 1 },
        headers: { 'User-Agent': UA },
        timeout: 45000
    });
    const data = res.data?.data;
    if (!data) throw new Error('TikTok tidak ditemukan');
    const videoUrl = data.hdplay || data.play || data.wmplay;
    if (!videoUrl) throw new Error('Link video TikTok kosong');
    const buffer = await fetchBufferFromUrl(videoUrl);
    return {
        buffer,
        title: data.title || 'TikTok Video',
        mimetype: 'video/mp4',
        fileName: 'tiktok_hd.mp4'
    };
}

async function downloadTiktokLib(url) {
    const result = await TiktokDownloader.Downloader(url, { version: 'v1' });
    if (result?.status !== 'success' || !result.result) throw new Error('TikTok downloader gagal');
    const v = result.result.video || result.result;
    const videoUrl = v.hdplay || v.play || v.downloadAddr;
    if (!videoUrl) throw new Error('Link TikTok tidak ada');
    const buffer = await fetchBufferFromUrl(videoUrl);
    return {
        buffer,
        title: result.result.desc || result.result.title || 'TikTok',
        mimetype: 'video/mp4',
        fileName: 'tiktok_hd.mp4'
    };
}

async function downloadSnapinsta(url) {
    const res = await axios.get('https://snapinsta.app/api/ajaxSearch', {
        params: { url },
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        timeout: 35000
    });
    const media = res.data?.media;
    if (!Array.isArray(media) || !media.length) throw new Error('SnapInsta kosong');
    const urls = media.map((m) => m.url || m.downloadUrl).filter(Boolean);
    const videoSrc = pickBestMediaUrl(urls);
    if (!videoSrc) throw new Error('Link SnapInsta tidak valid');
    const buffer = await fetchBufferFromUrl(videoSrc);
    return {
        buffer,
        title: res.data?.title || 'Instagram',
        mimetype: 'video/mp4',
        fileName: 'instagram_hd.mp4'
    };
}

async function downloadSaveinsta(url) {
    const res = await axios.post(
        'https://saveinsta.io/core/ajax.php',
        new URLSearchParams({ url, submit: '' }),
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': UA,
                Referer: 'https://saveinsta.io/'
            },
            timeout: 35000
        }
    );
    const html = typeof res.data === 'string' ? res.data : res.data?.data || '';
    if (!html) throw new Error('SaveInsta kosong');
    const $ = cheerio.load(html);
    const urls = [];
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href?.startsWith('http')) urls.push(href);
    });
    const mp4Match = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/gi) || [];
    urls.push(...mp4Match);
    const videoSrc = pickBestMediaUrl(urls);
    if (!videoSrc) throw new Error('Link SaveInsta tidak ditemukan');
    const buffer = await fetchBufferFromUrl(videoSrc);
    return { buffer, title: 'Instagram', mimetype: 'video/mp4', fileName: 'instagram_hd.mp4' };
}

async function downloadSaveig(url) {
    const body = new URLSearchParams({ q: url.split('?')[0], t: 'media', lang: 'en' });
    const res = await axios.post('https://v3.saveig.app/api/ajaxSearch', body, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA,
            Origin: 'https://saveig.app',
            Referer: 'https://saveig.app/'
        },
        timeout: 35000
    });
    const html = res.data?.data || res.data?.html || '';
    if (!html) throw new Error('SaveIG kosong');
    const $ = cheerio.load(html);
    const urls = [];
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) urls.push(href.startsWith('http') ? href : `https://saveig.app${href}`);
    });
    const mp4Match = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/gi) || [];
    urls.push(...mp4Match);
    const videoSrc = pickBestMediaUrl(urls);
    if (!videoSrc) throw new Error('Link SaveIG tidak ditemukan');
    const buffer = await fetchBufferFromUrl(videoSrc);
    return { buffer, title: 'Instagram', mimetype: 'video/mp4', fileName: 'instagram_hd.mp4' };
}

async function downloadInstagram(url, mode) {
    const errors = [];
    const tryApi = async (name, fn) => {
        try {
            return await fn();
        } catch (e) {
            errors.push(`${name}: ${e.message}`);
            return null;
        }
    };

    if (mode === 'video') {
        for (const [name, fn] of [
            ['SnapInsta', () => downloadSnapinsta(url)],
            ['SaveInsta', () => downloadSaveinsta(url)],
            ['SaveIG', () => downloadSaveig(url)]
        ]) {
            const r = await tryApi(name, fn);
            if (r) return r;
        }
    }

    try {
        return await downloadViaYtDlp(url, mode, path.join('./temp/dl', `ig-${Date.now()}`));
    } catch (e) {
        errors.push(`yt-dlp: ${e.message}`);
    }

    throw new Error(errors.slice(-3).join(' · ') || 'Instagram gagal diunduh');
}

async function downloadViaYtDlp(url, mode, tmpBase) {
    const title = await getYtDlpTitle(url);
    if (mode === 'audio') {
        const out = `${tmpBase}.mp3`;
        await downloadAudioToMp3(url, out);
        return {
            buffer: fs.readFileSync(out),
            title,
            mimetype: 'audio/mpeg',
            fileName: `${sanitizeFileName(title)}.mp3`
        };
    }
    const out = `${tmpBase}.mp4`;
    await downloadVideoHd(url, out);
    return {
        buffer: fs.readFileSync(out),
        title,
        mimetype: 'video/mp4',
        fileName: `${sanitizeFileName(title)}.mp4`
    };
}

function cleanupTmp(tmpBase) {
    try {
        const dir = path.dirname(tmpBase);
        const prefix = path.basename(tmpBase);
        if (!fs.existsSync(dir)) return;
        for (const f of fs.readdirSync(dir)) {
            if (f.startsWith(prefix)) fs.unlinkSync(path.join(dir, f));
        }
    } catch (_) {}
}

/**
 * @returns {{ buffer: Buffer, title: string, mimetype: string, fileName: string, mode: string }}
 */
export async function downloadMediaFromUrl(url, mode = 'video') {
    const platform = detectPlatform(url);
    const id = Date.now();
    const tmpBase = path.join('./temp/dl', `media-${id}`);

    if (!fs.existsSync('./temp/dl')) fs.mkdirSync('./temp/dl', { recursive: true });

    try {
        if (platform === 'tiktok' && mode === 'video') {
            try {
                return { ...(await downloadTiktokApi(url)), mode };
            } catch (e) {
                console.log('tikwm fail:', e.message, '→ tiktok lib');
                return { ...(await downloadTiktokLib(url)), mode };
            }
        }

        if (platform === 'instagram') {
            return { ...(await downloadInstagram(url, mode)), mode };
        }

        return { ...(await downloadViaYtDlp(url, mode, tmpBase)), mode };
    } finally {
        cleanupTmp(tmpBase);
    }
}

export function getDlHelpText() {
    return (
        `📥 *DOWNLOAD MEDIA*\n\n` +
        `🎬 Video HD:\n\`!dl <link>\`\n` +
        `🎵 Audio MP3:\n\`!dl mp3 <link>\`\n\n` +
        `✅ YouTube · TikTok · Instagram · Facebook\n` +
        `_IG/TikTok prioritas HD · YT kirim MP3_`
    );
}