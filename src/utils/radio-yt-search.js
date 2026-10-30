import ytSearch from 'yt-search';
import { extractYoutubeVideoId, youtubeThumbnail } from './youtube-meta.js';
import { getYtDlpTitle } from './ytdlp-download.js';

const LIVE_MIX_RE = /\b(live|24\/7|24-7|non.?stop|stream|full album|continuous|hours?|jam)\b/i;
const MIX_RE = /\b(mix|playlist|compilation|megamix|best of)\b/i;

function isLiveOrLongMix(video = {}, maxSec = 6000) {
    const title = String(video.title || '');
    const sec = video.seconds || 0;
    if (LIVE_MIX_RE.test(title)) return true;
    if (MIX_RE.test(title) && sec > 900) return true;
    if (sec > maxSec) return true;
    return false;
}

/** Pencarian YouTube untuk app & admin (tanpa token). */
export async function searchYoutubeTracks(q, { fast = false, limit = 10 } = {}) {
    const query = String(q || '').trim();
    if (!query || query.length < 2) {
        throw new Error('Ketik minimal 2 karakter atau paste link YouTube.');
    }

    const directId = extractYoutubeVideoId(query);
    if (directId) {
        const url = query.startsWith('http') ? query : `https://www.youtube.com/watch?v=${directId}`;
        const title = await getYtDlpTitle(url).catch(() => 'YouTube');
        return {
            query,
            results: [{
                title,
                url,
                videoId: directId,
                author: 'YouTube',
                duration: '—',
                seconds: 0,
                thumbnail: youtubeThumbnail(url, directId)
            }]
        };
    }

    const maxSec = Number(process.env.RADIO_MAX_DURATION_SEC || 6000);
    const minSec = Number(process.env.RADIO_MIN_DURATION_SEC || 45);

    const mapVideo = (v) => ({
        title: v.title,
        url: v.url,
        videoId: v.videoId,
        author: v.author?.name || v.author || 'Unknown',
        duration: v.timestamp,
        seconds: v.seconds,
        durationSec: v.seconds || 0,
        thumbnail: v.image || youtubeThumbnail(v.url, v.videoId)
    });

    const pickVideos = (videos, limit = 10) => {
        const list = (Array.isArray(videos) ? videos : []).filter((v) => v?.videoId && !isLiveOrLongMix(v, maxSec));
        const tiers = [
            (v) => {
                const sec = v.seconds || 0;
                return sec >= minSec && sec <= maxSec;
            },
            (v) => {
                const sec = v.seconds || 0;
                return sec >= 30 && sec <= maxSec;
            },
            (v) => !v.seconds
        ];
        for (const match of tiers) {
            const picked = list.filter(match).slice(0, limit).map(mapVideo);
            if (picked.length) return picked;
        }
        return list
            .filter((v) => {
                const sec = v.seconds || 0;
                return !sec || (sec >= 30 && sec <= maxSec);
            })
            .slice(0, limit)
            .map(mapVideo);
    };

    const runQuery = async (text) => {
        const found = await ytSearch(text);
        return pickVideos(found?.videos, 12);
    };

    const cleaned = query.replace(/\b(playlist|mix|beats|radio|hour|live|type beat)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const variants = fast
        ? [query, `${query} official audio`]
        : [
            query,
            `${query} official audio`,
            `${query} official music video`,
            `${cleaned} song`
        ];
    const uniqueVariants = variants.filter((v, i, arr) => v.length >= 2 && arr.indexOf(v) === i);

    const seen = new Set();
    const results = [];
    const maxResults = Math.max(3, Math.min(12, Number(limit) || 10));
    const minBeforeStop = fast ? 3 : 5;

    for (const variant of uniqueVariants) {
        const picked = await runQuery(variant).catch(() => []);
        for (const row of picked) {
            if (!row.videoId || seen.has(row.videoId)) continue;
            seen.add(row.videoId);
            results.push(row);
            if (results.length >= maxResults) break;
        }
        if (results.length >= minBeforeStop) break;
    }

    return { query, results };
}