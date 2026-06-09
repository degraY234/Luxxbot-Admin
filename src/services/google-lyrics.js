import axios from 'axios';
import * as cheerio from 'cheerio';
import ytSearch from 'yt-search';
import { ai, GEMINI_API_KEY, openai } from '../config.js';
import { fetchYoutubeSubtitleLyrics } from '../utils/ytdlp-download.js';
import {
    parseSyncedLyrics,
    buildEstimatedSyncedLines,
    finalizeSyncedLines,
    syncedLinesToLrc,
    formatLrcTime
} from '../utils/lyrics-sync.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const GEMINI_LYRICS_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];
const MIN_LYRICS_LEN = 30;

function cleanTrackTitle(title) {
    return String(title || '')
        .replace(/\([^)]*(official|video|lyric|audio|mv|music|hd|4k|visualizer|live)[^)]*\)/gi, '')
        .replace(/\[[^\]]*\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanArtistName(author) {
    const a = String(author || '').trim();
    if (!a || /^unknown$/i.test(a) || /^-+$/.test(a)) return '';
    return a.replace(/\s+/g, ' ').trim();
}

export function parseTrackIdentity(track) {
    const rawTitle = track?.title || '';
    let artist = cleanArtistName(track?.author);
    let title = cleanTrackTitle(rawTitle);

    const dash = rawTitle.split(/\s*[-–|]\s*/).map((s) => cleanTrackTitle(s)).filter(Boolean);
    if (dash.length >= 2) {
        if (!artist) {
            artist = cleanArtistName(dash[0]);
            title = cleanTrackTitle(dash.slice(1).join(' - ')) || dash[1];
        } else if (!title || title.length < 2) {
            title = cleanTrackTitle(dash.find((p) => !cleanArtistName(p).toLowerCase().includes(artist.toLowerCase().split(' ')[0])) || dash[1]);
        }
    }

    if (!title) title = cleanTrackTitle(rawTitle) || rawTitle.trim();
    return { title, artist, rawTitle };
}

function normalizeTitle(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildQueries(track) {
    const { title, artist, rawTitle } = parseTrackIdentity(track);
    const queries = [];
    if (title && artist) {
        queries.push(`${artist} ${title}`);
        queries.push(`${title} ${artist}`);
        queries.push(`${artist} - ${title}`);
    }
    if (title) queries.push(title);
    if (rawTitle && rawTitle !== title) queries.push(cleanTrackTitle(rawTitle));
    return [...new Set(queries.filter(Boolean))];
}

function trackYoutubeUrl(track) {
    if (track?.url && /youtube|youtu\.be/i.test(track.url)) return track.url;
    if (track?.videoId) return `https://www.youtube.com/watch?v=${track.videoId}`;
    return null;
}

async function searchLrclibAll(query) {
    const { data } = await axios.get('https://lrclib.net/api/search', {
        params: { q: query },
        timeout: 12000
    });
    return Array.isArray(data) ? data : [];
}

async function getLrclibExact(artist, title, durationSec) {
    const params = { artist_name: artist || '', track_name: title || '' };
    if (durationSec > 0) params.duration = Math.round(durationSec);
    const { data, status } = await axios.get('https://lrclib.net/api/get', {
        params,
        timeout: 12000,
        validateStatus: () => true
    });
    if (status !== 200 || !data?.plainLyrics && !data?.syncedLyrics) return null;
    return data;
}

function scoreLrcHit(hit, identity, track) {
    const wantTitle = normalizeTitle(identity.title);
    const wantArtist = normalizeTitle(identity.artist);
    const gotTitle = normalizeTitle(hit.trackName || hit.title);
    const gotArtist = normalizeTitle(hit.artistName || hit.artist);
    let score = 0;

    if (hit.syncedLyrics) score += 60;
    else if (hit.plainLyrics) score += 20;

    if (wantTitle && gotTitle) {
        if (gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle)) score += 35;
        const words = wantTitle.split(' ').filter((w) => w.length > 2);
        const matched = words.filter((w) => gotTitle.includes(w)).length;
        score += matched * 8;
    }

    if (wantArtist && gotArtist) {
        const wa = wantArtist.split(' ')[0];
        if (wa.length > 2 && gotArtist.includes(wa)) score += 20;
    }

    const dur = track?.durationSec || 0;
    if (dur > 0 && hit.duration && Math.abs(Number(hit.duration) - dur) <= 4) score += 25;

    return score;
}

function stripSyncedTags(text) {
    return text.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{2,3})?\]/g, '').trim();
}

function packResult(hit, source, track, identity) {
    const rawSynced = hit.syncedLyrics || null;
    const plain = (hit.plainLyrics || stripSyncedTags(rawSynced || '') || hit.lyrics || '').trim();
    if (!plain) return null;

    const vttSync = Boolean(hit.vttSync);
    const hasRawLines = Array.isArray(hit.syncedLines) && hit.syncedLines.length;
    let syncedLines = hasRawLines
        ? hit.syncedLines
        : parseSyncedLyrics(rawSynced);

    const realSync = Boolean(vttSync || rawSynced || hit.realSync);

    if (!syncedLines.length && track?.durationSec > 0) {
        syncedLines = buildEstimatedSyncedLines(plain, track.durationSec);
    } else if (syncedLines.length) {
        syncedLines = finalizeSyncedLines(syncedLines, track, { realSync, vttSync });
    }

    const lyrics = syncedLines.length
        ? syncedLines.map((l) => l.text).join('\n')
        : plain;

    return {
        found: true,
        trackId: track?.id ?? null,
        title: hit.trackName || hit.title || identity.title || track?.title || '',
        artist: hit.artistName || hit.artist || identity.artist || track?.author || '—',
        album: hit.albumName || hit.album || '',
        duration: track?.duration || '',
        lyrics,
        syncedLyrics: rawSynced || (syncedLines.length ? syncedLinesToLrc(syncedLines) : null),
        syncedLines,
        synced: syncedLines.length > 0,
        realSync: realSync && syncedLines.length > 0,
        vttSync,
        source
    };
}

async function fetchLrclibExactOnly(track) {
    const identity = parseTrackIdentity(track);
    const pairs = [
        [identity.artist, identity.title],
        [identity.title, identity.artist]
    ].filter(([a, t]) => a && t);

    for (const [artist, title] of pairs) {
        try {
            const exact = await getLrclibExact(artist, title, track.durationSec);
            if (exact) {
                const packed = packResult(exact, 'LRCLIB Exact', track, { title, artist, rawTitle: identity.rawTitle });
                if (packed) return packed;
            }
        } catch (e) {
            console.log('LRCLIB exact:', e.message);
        }
    }
    return null;
}

async function fetchLrclibSearchOnly(track) {
    const identity = parseTrackIdentity(track);
    const queries = buildQueries(track);
    let bestHit = null;
    let bestScore = 0;

    for (const q of queries) {
        try {
            const hits = await searchLrclibAll(q);
            for (const hit of hits) {
                if (!hit.plainLyrics && !hit.syncedLyrics) continue;
                const score = scoreLrcHit(hit, identity, track);
                if (score > bestScore) {
                    bestScore = score;
                    bestHit = hit;
                }
            }
        } catch (e) {
            console.log('LRCLIB search:', e.message);
        }
    }

    if (bestHit && bestScore >= 8) {
        return packResult(bestHit, 'LRCLIB', track, identity);
    }
    return null;
}

async function fetchLyricsOvh(track) {
    const identity = parseTrackIdentity(track);
    const pairs = [
        [identity.artist, identity.title],
        [identity.title, identity.artist],
        [identity.artist.split(' ')[0], identity.title]
    ].filter(([a, t]) => a && t);

    for (const [artist, title] of pairs) {
        try {
            const res = await axios.get(
                `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
                { timeout: 10000, validateStatus: () => true }
            );
            if (res.status === 200 && res.data?.lyrics) {
                return packResult({
                    trackName: title,
                    artistName: artist,
                    plainLyrics: res.data.lyrics
                }, 'lyrics.ovh', track, identity);
            }
        } catch { /* next */ }
    }
    return null;
}

async function fetchYoutubeLrclib(track) {
    const identity = parseTrackIdentity(track);
    const q = `${identity.artist || ''} ${identity.title}`.trim();
    if (!q) return null;
    try {
        const search = await ytSearch(q);
        const video = search.videos?.[0];
        if (!video) return null;
        const hits = await searchLrclibAll(`${video.title} ${video.author?.name || ''}`);
        let best = null;
        let bestScore = 0;
        for (const hit of hits) {
            if (!hit.plainLyrics && !hit.syncedLyrics) continue;
            const score = scoreLrcHit(hit, identity, track) + 5;
            if (score > bestScore) {
                bestScore = score;
                best = hit;
            }
        }
        if (best && bestScore >= 8) {
            return packResult(best, 'YouTube+LRCLIB', track, identity);
        }
    } catch (e) {
        console.log('YT+LRCLIB:', e.message);
    }
    return null;
}

async function fetchYoutubeSubtitles(track) {
    const url = trackYoutubeUrl(track);
    if (!url) return null;
    const identity = parseTrackIdentity(track);
    try {
        const sub = await fetchYoutubeSubtitleLyrics(url, 26_000);
        if (!sub?.plain || sub.plain.length < MIN_LYRICS_LEN) return null;
        return packResult({
            trackName: identity.title,
            artistName: identity.artist || '—',
            plainLyrics: sub.plain,
            syncedLines: sub.syncedLines,
            syncedLyrics: sub.syncedLyrics,
            realSync: true,
            vttSync: true
        }, 'YouTube Subtitle', track, identity);
    } catch (e) {
        console.log('YT subtitle pack:', e.message);
        return null;
    }
}

function cleanLyricsText(text) {
    return String(text || '')
        .replace(/^NOT_FOUND$/i, '')
        .replace(/^\s*lirik.*?:\s*/i, '')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function lyricsPrompt(identity, withSearch = true) {
    return (
        `Cari lirik lagu lengkap "${identity.title}" oleh ${identity.artist || 'penyanyi terkait'} ` +
        `${withSearch ? 'menggunakan Google Search. ' : ''}` +
        `Kembalikan HANYA teks lirik asli lagu (satu baris per baris lirik).\n` +
        `Tanpa judul, tanpa [Verse], tanpa terjemahan, tanpa penjelasan.\n` +
        `Jika benar-benar tidak ditemukan, jawab: NOT_FOUND`
    );
}

async function fetchGeminiGoogleLyrics(track) {
    if (!GEMINI_API_KEY) return null;
    const identity = parseTrackIdentity(track);
    const prompt = lyricsPrompt(identity, true);

    for (const model of GEMINI_LYRICS_MODELS) {
        try {
            const res = await ai.models.generateContent({
                model,
                contents: prompt,
                config: {
                    tools: [{ googleSearch: {} }],
                    temperature: 0.1
                }
            });
            const text = cleanLyricsText(res?.text || '');
            if (!text || /^NOT_FOUND/i.test(text) || text.length < MIN_LYRICS_LEN) continue;
            return packResult({
                trackName: identity.title,
                artistName: identity.artist || '—',
                plainLyrics: text
            }, 'Google Search (Gemini)', track, identity);
        } catch (e) {
            const status = e?.status || e?.error?.code;
            console.log(`Gemini lyrics ${model}:`, status || e.message);
            if (status === 401 || status === 403) break;
        }
    }

    const plainPrompt = lyricsPrompt(identity, false);
    for (const model of GEMINI_LYRICS_MODELS) {
        try {
            const res = await ai.models.generateContent({
                model,
                contents: plainPrompt,
                config: { temperature: 0.1 }
            });
            const text = cleanLyricsText(res?.text || '');
            if (!text || /^NOT_FOUND/i.test(text) || text.length < MIN_LYRICS_LEN) continue;
            return packResult({
                trackName: identity.title,
                artistName: identity.artist || '—',
                plainLyrics: text
            }, 'Gemini', track, identity);
        } catch (e) {
            console.log(`Gemini lyrics plain ${model}:`, e.message);
        }
    }
    return null;
}

async function fetchOpenAiLyrics(track) {
    if (!process.env.OPENAI_API_KEY) return null;
    const identity = parseTrackIdentity(track);
    if (!identity.title) return null;
    try {
        const res = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.1,
            messages: [{
                role: 'user',
                content:
                    `Berikan lirik lengkap asli lagu "${identity.title}" oleh ${identity.artist || 'penyanyi terkait'}.\n` +
                    'Satu baris per baris lirik. Tanpa [Verse]/[Chorus], tanpa terjemahan, tanpa penjelasan.\n' +
                    'Jika tidak tahu pasti, jawab: NOT_FOUND'
            }]
        });
        const text = cleanLyricsText(res.choices?.[0]?.message?.content || '');
        if (!text || /^NOT_FOUND/i.test(text) || text.length < MIN_LYRICS_LEN) return null;
        return packResult({
            trackName: identity.title,
            artistName: identity.artist || '—',
            plainLyrics: text
        }, 'OpenAI', track, identity);
    } catch (e) {
        console.log('OpenAI lyrics:', e.message);
        return null;
    }
}

function extractGoogleLyricsFromHtml(html, identity) {
    const chunks = [];

    const jsonMatches = html.matchAll(/"lyrics":\s*"((?:\\.|[^"\\])*)"/g);
    for (const m of jsonMatches) {
        try {
            const decoded = JSON.parse(`"${m[1]}"`);
            if (decoded.length >= 80) chunks.push(decoded);
        } catch { /* skip */ }
    }

    const $ = cheerio.load(html);
    $('div[data-lyricid], div[data-lyrics], [data-lyric-id]').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        if (t.length >= 80) chunks.push(t);
    });

    $('div, span, p').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        if (t.length < 80 || t.length > 8000 || t.split(' ').length < 12) return;
        const titleWord = identity.title.split(' ').find((w) => w.length > 3)?.toLowerCase();
        if (/lyrics|lirik|verse|chorus/i.test(t) || (titleWord && t.toLowerCase().includes(titleWord))) {
            chunks.push(t);
        }
    });

    const best = chunks.sort((a, b) => b.length - a.length)[0];
    if (!best || best.length < 60) return null;

    const lines = best
        .replace(new RegExp(`^.*?${identity.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '')
        .split(/\n|(?<=[.!?])\s+/)
        .map((l) => l.trim())
        .filter((l) => l.length > 2 && l.length < 160);

    return lines.length >= 4 ? lines.join('\n') : best;
}

/** Scrape cuplikan lirik dari hasil Google Search */
async function fetchGoogleSnippetLyrics(track) {
    const identity = parseTrackIdentity(track);
    const queries = [
        `${identity.artist || ''} ${identity.title} lyrics`.trim(),
        `${identity.title} lirik ${identity.artist || ''}`.trim(),
        `${identity.title} song lyrics full`
    ].filter(Boolean);

    for (const q of [...new Set(queries)]) {
        try {
            const { data: html } = await axios.get(`https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en`, {
                headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9,id-ID,id;q=0.8' },
                timeout: 12000
            });
            const plain = extractGoogleLyricsFromHtml(html, identity);
            if (!plain || plain.length < 60) continue;
            return packResult({
                trackName: identity.title,
                artistName: identity.artist || '—',
                plainLyrics: plain
            }, 'Google', track, identity);
        } catch (e) {
            console.log('Google snippet:', e.message);
        }
    }
    return null;
}

function isValidLyricsHit(hit) {
    return Boolean(hit?.found && hit?.lyrics && hit.lyrics.length >= MIN_LYRICS_LEN);
}

/** Jalankan banyak sumber paralel — ambil hasil pertama yang valid */
function parallelLyricsRace(track, sources, timeoutMs = 58_000) {
    return new Promise((resolve) => {
        let settled = false;
        let pending = sources.length;

        const finish = (hit) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(isValidLyricsHit(hit) ? hit : null);
        };

        const timer = setTimeout(() => finish(null), timeoutMs);

        for (const fn of sources) {
            Promise.resolve()
                .then(() => fn(track))
                .then((hit) => {
                    if (!settled && isValidLyricsHit(hit)) finish(hit);
                })
                .catch((e) => console.log('lyrics source:', fn.name || 'anon', e.message))
                .finally(() => {
                    pending -= 1;
                    if (!settled && pending === 0) finish(null);
                });
        }
    });
}

/** Cepat dulu (exact/ovh/search), lalu sumber berat */
export async function fetchLyricsFromGoogle(track) {
    if (!track?.title) return null;

    const fast = await parallelLyricsRace(track, [
        fetchYoutubeSubtitles,
        fetchLrclibExactOnly,
        fetchLyricsOvh,
        fetchLrclibSearchOnly
    ], 12_000);
    if (fast) return fast;

    return parallelLyricsRace(track, [
        fetchYoutubeLrclib,
        fetchGoogleSnippetLyrics,
        fetchGeminiGoogleLyrics,
        fetchOpenAiLyrics
    ], 42_000);
}