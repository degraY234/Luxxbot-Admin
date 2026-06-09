import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import TiktokDownloader from '@tobyg74/tiktok-api-dl';
import {
    downloadAudioToMp3,
    downloadVideoHd,
    downloadVideoForWhatsApp,
    getYtDlpTitle
} from '../utils/ytdlp-download.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const IG_APP_ID = '936619743392459';
const IG_GRAPHQL_DOC_IDS = ['8845758582119845', '23826011839236744'];

export function parseDlArgs(args) {
    const parts = args.join(' ').trim().split(/\s+/).filter(Boolean);
    let mode = 'video';
    let quality = 'wa';

    const head = (parts[0] || '').toLowerCase();
    if (head === 'mp3' || head === 'audio') {
        mode = 'audio';
        parts.shift();
    } else if (head === 'mp4' || head === 'video') {
        parts.shift();
    } else if (head === 'mp4hd' || head === 'hd' || head === '1080') {
        quality = 'hd';
        parts.shift();
    }

    const joined = parts.join(' ');
    const urlMatch = joined.match(/https?:\/\/[^\s]+/i);
    const url = urlMatch?.[0]?.replace(/[>,\])}]+$/, '') || parts.find((p) => /^https?:\/\//i.test(p));
    return { mode, url, quality };
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

function extractIgShortcode(url) {
    const m = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i)
        || url.match(/instagr\.am\/(?:p|reel)\/([A-Za-z0-9_-]+)/i);
    return m?.[1] || null;
}

function normalizeIgReferer(url) {
    const sc = extractIgShortcode(url);
    return sc ? `https://www.instagram.com/reel/${sc}/` : url.split('?')[0];
}

function igCaptionFromMedia(media) {
    const text = media?.edge_media_to_caption?.edges?.[0]?.node?.text;
    return text?.trim().slice(0, 80) || 'Instagram';
}

function pickBestIgVideoUrl(node) {
    if (!node?.is_video) return null;
    const versions = [...(node.video_versions || [])];
    if (node.video_url) {
        versions.push({
            url: node.video_url,
            width: node.dimensions?.width || 0,
            height: node.dimensions?.height || 0
        });
    }
    if (!versions.length) return null;
    versions.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
    return versions[0].url;
}

function pickIgVideoMedia(media) {
    if (!media) return null;
    const children = media.edge_sidecar_to_children?.edges || [];
    for (const edge of children) {
        const url = pickBestIgVideoUrl(edge.node);
        if (url) return { url, title: igCaptionFromMedia(media) };
    }
    const url = pickBestIgVideoUrl(media);
    if (url) return { url, title: igCaptionFromMedia(media) };
    return null;
}

async function fetchInstagramGraphqlMedia(shortcode, referer, docId) {
    const res = await axios.get('https://www.instagram.com/graphql/query/', {
        params: {
            doc_id: docId,
            variables: JSON.stringify({ shortcode })
        },
        headers: {
            'User-Agent': UA,
            'X-IG-App-ID': IG_APP_ID,
            'X-ASBD-ID': '129477',
            Referer: referer,
            Accept: '*/*'
        },
        timeout: 35000,
        validateStatus: () => true
    });
    if (res.status >= 400) throw new Error(`GraphQL HTTP ${res.status}`);
    return res.data?.data?.xdt_shortcode_media || null;
}

async function fetchBufferFromUrl(mediaUrl, maxMb = 64, referer) {
    const res = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        timeout: 180000,
        maxContentLength: maxMb * 1024 * 1024,
        maxRedirects: 5,
        headers: {
            'User-Agent': UA,
            Referer: referer || mediaUrl,
            Accept: '*/*'
        }
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

async function downloadInstagramGraphql(url) {
    const shortcode = extractIgShortcode(url);
    if (!shortcode) throw new Error('Link Instagram tidak valid');

    const referer = normalizeIgReferer(url);
    let media = null;
    const gqlErrors = [];

    for (const docId of IG_GRAPHQL_DOC_IDS) {
        try {
            media = await fetchInstagramGraphqlMedia(shortcode, referer, docId);
            if (media) break;
        } catch (e) {
            gqlErrors.push(e.message);
        }
    }

    const picked = pickIgVideoMedia(media);
    if (!picked?.url) {
        throw new Error(
            gqlErrors.at(-1) ||
            (media ? 'Postingan Instagram bukan video' : 'Video tidak ditemukan (privat atau link salah)')
        );
    }

    const buffer = await fetchBufferFromUrl(picked.url, 64, 'https://www.instagram.com/');
    return {
        buffer,
        title: picked.title,
        mimetype: 'video/mp4',
        fileName: 'instagram_hd.mp4',
        qualityLabel: 'MP4 HD'
    };
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
        const gql = await tryApi('IG', () => downloadInstagramGraphql(url));
        if (gql) return gql;

        for (const [name, fn] of [
            ['SaveIG', () => downloadSaveig(url)],
            ['SaveInsta', () => downloadSaveinsta(url)],
            ['SnapInsta', () => downloadSnapinsta(url)]
        ]) {
            const r = await tryApi(name, fn);
            if (r) return { ...r, qualityLabel: 'MP4 HD' };
        }
    }

    try {
        return await downloadViaYtDlp(url, mode, path.join('./temp/dl', `ig-${Date.now()}`), mode === 'video' ? 'hd' : 'wa');
    } catch (e) {
        errors.push(`yt-dlp: ${e.message}`);
    }

    throw new Error(errors.slice(-3).join(' · ') || 'Instagram gagal diunduh');
}

async function downloadViaYtDlp(url, mode, tmpBase, quality = 'wa') {
    const title = await getYtDlpTitle(url);
    const platform = detectPlatform(url);

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
    const useWa = platform === 'youtube' || platform === 'facebook' || quality === 'wa';
    if (useWa) {
        await downloadVideoForWhatsApp(url, out, { maxHeight: quality === 'hd' ? 1080 : 720 });
    } else {
        await downloadVideoHd(url, out);
    }

    return {
        buffer: fs.readFileSync(out),
        title,
        mimetype: 'video/mp4',
        fileName: `${sanitizeFileName(title)}.mp4`,
        qualityLabel: quality === 'hd' ? 'MP4 1080p' : 'MP4 720p (HP)'
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
export async function downloadMediaFromUrl(url, mode = 'video', quality = 'wa') {
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

        return { ...(await downloadViaYtDlp(url, mode, tmpBase, quality)), mode };
    } finally {
        cleanupTmp(tmpBase);
    }
}

export function getDlHelpText() {
    return (
        `📥 *DOWNLOAD MEDIA*\n\n` +
        `🎬 *Video MP4* (bisa dibuka di HP):\n` +
        `\`!dl <link yt>\` → MP4 720p jernih\n` +
        `\`!dl mp4 <link>\` → sama (eksplisit video)\n` +
        `\`!dl mp4hd <link>\` → MP4 1080p\n\n` +
        `🎵 *Audio MP3* kualitas tinggi:\n` +
        `\`!dl mp3 <link yt>\`\n\n` +
        `✅ YouTube · TikTok · Instagram · Facebook\n` +
        `_IG/TikTok: kirim link langsung, video HD tanpa login_\n` +
        `_Video YT dioptimasi H.264+AAC biar lancar di WhatsApp mobile_`
    );
}