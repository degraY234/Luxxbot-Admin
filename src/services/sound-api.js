import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { downloadAudioToMp3 } from '../utils/ytdlp-download.js';

const PIXABAY_KEY = process.env.PIXABAY_API_KEY || '';
const FREESOUND_RAW = process.env.FREESOUND_API_KEY || '';
/** Token Freesound = string pendek dari /apiv2/apply — bukan URL browser */
const FREESOUND_KEY = FREESOUND_RAW.startsWith('http') ? '' : FREESOUND_RAW;
if (FREESOUND_RAW.startsWith('http')) {
    console.warn('⚠️ FREESOUND_API_KEY salah format (URL). Isi dengan API token dari freesound.org/apiv2/apply');
}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const axiosCfg = {
    timeout: 25000,
    headers: { 'User-Agent': UA, Accept: 'application/json,text/html' }
};

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'dan', 'yang', 'itu', 'ini', 'nya', 'ga', 'gak',
    'banget', 'bet', 'dong', 'sih', 'deh', 'lah', 'atau', 'untuk', 'dari', 'ke', 'di',
    'sfx', 'effect', 'audio', 'meme'
]);

// Durasi maks video YouTube yang dianggap "sound effect" (detik)
const YT_MAX_DURATION_SEC = 120;

function normalizeItem(raw, source = 'myinstants') {
    if (!raw?.mp3 && !raw?.ytUrl) return null;
    return {
        id: String(raw.id || ''),
        title: String(raw.title || 'Sound').trim(),
        mp3: raw.mp3 ? String(raw.mp3) : null,
        ytUrl: raw.ytUrl || null,
        url: raw.url || '',
        source
    };
}

/** Scrape satu halaman MyInstants */
async function scrapeMyInstantsPage(query, page = 1) {
    try {
        const q = encodeURIComponent(query.trim());
        const pageParam = page > 1 ? `&page=${page}` : '';
        const res = await axios.get(`https://www.myinstants.com/en/search/?name=${q}${pageParam}`, {
            ...axiosCfg,
            responseType: 'text',
            validateStatus: s => s < 500
        });
        if (res.status !== 200) return [];

        const $ = cheerio.load(res.data);
        const items = [];
        $('.instant').each((_, el) => {
            const link = $(el).find('a.instant-link').attr('href') || '';
            const title = $(el).find('.instant-link').text().trim();
            const mp3 = $(el).find('button.small-button').attr('onclick')?.match(/play\('([^']+)'/)?.[1];
            if (!title || !mp3) return;
            const id = link.split('/').filter(Boolean).pop() || title;
            const item = normalizeItem({
                id,
                title,
                mp3: mp3.startsWith('http') ? mp3 : `https://www.myinstants.com${mp3.startsWith('/') ? '' : '/'}${mp3}`,
                url: link.startsWith('http') ? link : `https://www.myinstants.com${link}`,
            }, 'myinstants');
            if (item) items.push(item);
        });
        return items;
    } catch (e) {
        console.warn(`⚠️ MyInstants scrape page ${page}:`, e.message);
        return [];
    }
}

/** Scrape MyInstants multi-halaman secara paralel */
async function scrapeMyInstants(query, pages = 2) {
    const pagePromises = Array.from({ length: pages }, (_, i) =>
        scrapeMyInstantsPage(query, i + 1)
    );
    const results = await Promise.all(pagePromises);
    return dedupeItems(results.flat());
}

/** Cari YouTube via yt-search, filter video pendek */
async function searchYouTube(query, limit = 15) {
    try {
        const yts = (await import('yt-search')).default;
        const result = await yts(query);
        const videos = (result.videos || [])
            .filter(v => v.seconds > 0 && v.seconds <= YT_MAX_DURATION_SEC)
            .slice(0, limit);

        return videos.map(v => normalizeItem({
            id: `yt-${v.videoId}`,
            title: v.title,
            mp3: null,
            ytUrl: v.url,
            url: v.url
        }, 'youtube')).filter(Boolean);
    } catch (e) {
        console.warn('⚠️ YouTube search:', e.message);
        return [];
    }
}

/** Pixabay — key valid untuk image/video; endpoint sound belum publik (404) */
async function searchPixabay(_query, _limit = 8) {
    if (!PIXABAY_KEY) return [];
    return [];
}

/** Freesound.org (opsional, butuh FREESOUND_API_KEY di .env) */
async function searchFreesound(query, limit = 8) {
    if (!FREESOUND_KEY) return [];
    try {
        const res = await axios.get('https://freesound.org/apiv2/search/text/', {
            ...axiosCfg,
            params: { query, page_size: limit, fields: 'id,name,previews' },
            headers: { ...axiosCfg.headers, Authorization: `Token ${FREESOUND_KEY}` },
            validateStatus: s => s < 500
        });
        if (res.status !== 200) return [];
        const results = res.data?.results || [];
        return results.map(r => normalizeItem({
            id: `freesound-${r.id}`,
            title: r.name || 'Freesound',
            mp3: r.previews?.['preview-hq-mp3'] || r.previews?.['preview-lq-mp3'],
            url: `https://freesound.org/sounds/${r.id}/`,
        }, 'freesound')).filter(Boolean);
    } catch (e) {
        console.warn('⚠️ Freesound:', e.message);
        return [];
    }
}

function dedupeItems(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = `${item.source}:${item.mp3 || item.ytUrl || item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

/** Kata keyboard acak / tanpa vokal — jangan dipakai untuk ranking */
function isNoiseWord(word) {
    const w = String(word || '').toLowerCase();
    if (w.length < 4) return false;
    const vowels = (w.match(/[aeiou]/g) || []).length;
    if (vowels === 0) return true;
    if (w.length >= 5 && vowels / w.length < 0.25) return true;
    if (/^[bcdfghjklmnpqrstvwxyz]{5,}$/i.test(w)) return true;
    return false;
}

export function extractSearchKeywords(query) {
    const words = String(query || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/[\s-]+/)
        .map(w => w.trim())
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

    const unique = [...new Set(words)];
    const meaningful = unique.filter(w => !isNoiseWord(w));
    const sorted = (meaningful.length ? meaningful : unique)
        .sort((a, b) => b.length - a.length);

    return { all: unique, meaningful: meaningful.sort((a, b) => b.length - a.length), search: sorted };
}

function scoreTitle(title, keywordPack, fullQuery = '') {
    const t = String(title || '').toLowerCase();
    let score = 0;
    const keywords = keywordPack?.meaningful?.length
        ? keywordPack.meaningful
        : (keywordPack?.all || keywordPack || []);

    const fq = fullQuery.toLowerCase().trim();
    if (fq.length >= 3 && t.includes(fq)) score += 120;

    for (const w of keywords) {
        if (isNoiseWord(w)) continue;
        if (t.includes(w)) score += w.length * 3;
        else if (w.length >= 5 && t.includes(w.slice(0, Math.max(4, w.length - 2)))) score += 2;
    }
    return score;
}

function rankItems(items, keywordPack, fullQuery) {
    return [...items].sort((a, b) => {
        const diff = scoreTitle(b.title, keywordPack, fullQuery) - scoreTitle(a.title, keywordPack, fullQuery);
        return diff || a.title.localeCompare(b.title);
    });
}

/**
 * Pencarian pintar multi-sumber:
 * 1. MyInstants (multi-page) + YouTube + Freesound — exact query
 * 2. Fallback per kata kunci — gabung & ranking
 */
export async function searchSounds(query, limit = 15) {
    const q = query?.trim();
    if (!q) return { items: [], mode: 'empty', keywords: [] };

    const keywordPack = extractSearchKeywords(q);
    const displayKeywords = keywordPack.meaningful.length
        ? keywordPack.meaningful
        : keywordPack.all;

    // --- Tahap 1: exact full query — semua sumber paralel ---
    const [myinstants, youtube, freesound, pixabay] = await Promise.all([
        scrapeMyInstants(q, 2),
        searchYouTube(q, 15),
        searchFreesound(q, limit),
        searchPixabay(q, limit)
    ]);

    let items = dedupeItems([...myinstants, ...youtube, ...pixabay, ...freesound]);

    if (items.length) {
        return {
            items: rankItems(items, keywordPack, q).slice(0, limit),
            mode: 'exact',
            keywords: [q]
        };
    }

    // --- Tahap 2: pecah kata bermakna & cari paralel ---
    const searchTerms = keywordPack.search.length ? keywordPack.search.slice(0, 6) : [q];
    const pools = await Promise.all(searchTerms.map(term =>
        Promise.all([
            scrapeMyInstants(term, 1),
            searchYouTube(term, 10),
            searchPixabay(term, 6),
            searchFreesound(term, 6)
        ]).then(parts => parts.flat())
    ));

    items = dedupeItems(pools.flat());
    if (!items.length) {
        return { items: [], mode: 'none', keywords: displayKeywords };
    }

    const ranked = rankItems(items, keywordPack, q);
    const relevant = ranked.filter(i => scoreTitle(i.title, keywordPack, q) > 0);

    return {
        items: (relevant.length ? relevant : ranked).slice(0, limit),
        mode: 'keyword',
        keywords: displayKeywords
    };
}

export async function fetchTrendingSounds(_region = 'id', limit = 10) {
    try {
        const res = await axios.get('https://www.myinstants.com/en/trending/', {
            ...axiosCfg,
            responseType: 'text',
            validateStatus: s => s < 500
        });
        if (res.status !== 200) return [];
        const $ = cheerio.load(res.data);
        const items = [];
        $('.instant').each((_, el) => {
            const link = $(el).find('a.instant-link').attr('href') || '';
            const title = $(el).find('.instant-link').text().trim();
            const mp3 = $(el).find('button.small-button').attr('onclick')?.match(/play\('([^']+)'/)?.[1];
            if (!title || !mp3) return;
            const id = link.split('/').filter(Boolean).pop() || title;
            const item = normalizeItem({
                id, title,
                mp3: mp3.startsWith('http') ? mp3 : `https://www.myinstants.com${mp3.startsWith('/') ? '' : '/'}${mp3}`,
                url: link.startsWith('http') ? link : `https://www.myinstants.com${link}`,
            }, 'myinstants');
            if (item) items.push(item);
        });
        return items.slice(0, limit);
    } catch (e) {
        console.warn('⚠️ Sound trending gagal:', e.message);
        return [];
    }
}

export async function fetchBestSounds(_region = 'id', limit = 10) {
    try {
        const res = await axios.get('https://www.myinstants.com/en/best_of_all_time/', {
            ...axiosCfg,
            responseType: 'text',
            validateStatus: s => s < 500
        });
        if (res.status !== 200) return [];
        const $ = cheerio.load(res.data);
        const items = [];
        $('.instant').each((_, el) => {
            const link = $(el).find('a.instant-link').attr('href') || '';
            const title = $(el).find('.instant-link').text().trim();
            const mp3 = $(el).find('button.small-button').attr('onclick')?.match(/play\('([^']+)'/)?.[1];
            if (!title || !mp3) return;
            const id = link.split('/').filter(Boolean).pop() || title;
            const item = normalizeItem({
                id, title,
                mp3: mp3.startsWith('http') ? mp3 : `https://www.myinstants.com${mp3.startsWith('/') ? '' : '/'}${mp3}`,
                url: link.startsWith('http') ? link : `https://www.myinstants.com${link}`,
            }, 'myinstants');
            if (item) items.push(item);
        });
        return items.slice(0, limit);
    } catch (e) {
        console.warn('⚠️ Sound best gagal:', e.message);
        return [];
    }
}

/**
 * Download sound — HTTP untuk MyInstants/Freesound, yt-dlp untuk YouTube
 */
export async function downloadSound(mp3Url, source = 'myinstants', ytUrl = null) {
    if (source === 'youtube' && ytUrl) {
        return downloadYouTubeAudio(ytUrl);
    }

    const referer = source === 'pixabay'
        ? 'https://pixabay.com/'
        : source === 'freesound'
            ? 'https://freesound.org/'
            : 'https://www.myinstants.com/';

    const res = await axios.get(mp3Url, {
        responseType: 'arraybuffer',
        timeout: 45000,
        maxContentLength: 16 * 1024 * 1024,
        headers: { 'User-Agent': UA, Referer: referer }
    });
    const buffer = Buffer.from(res.data);
    if (!buffer.length) throw new Error('File sound kosong');
    if (buffer.length > 16 * 1024 * 1024) throw new Error('Sound terlalu besar untuk WhatsApp (max ~16MB)');
    return buffer;
}

/** Download audio YouTube via yt-dlp, kembalikan Buffer */
async function downloadYouTubeAudio(url) {
    const tmpDir = path.join('./temp', 'sp-yt');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const tmpFile = path.join(tmpDir, `sp-${Date.now()}.mp3`);
    try {
        await downloadAudioToMp3(url, tmpFile);
        if (!fs.existsSync(tmpFile)) throw new Error('File audio YouTube tidak ditemukan setelah unduhan');
        const stat = fs.statSync(tmpFile);
        if (stat.size === 0) throw new Error('File audio YouTube kosong');
        if (stat.size > 16 * 1024 * 1024) throw new Error('Audio terlalu besar untuk WhatsApp (max ~16MB)');
        const buffer = fs.readFileSync(tmpFile);
        return buffer;
    } finally {
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    }
}
