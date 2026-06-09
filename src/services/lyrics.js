import axios from 'axios';
import ytSearch from 'yt-search';
import {
    parseSyncedLyrics,
    buildEstimatedSyncedLines,
    finalizeSyncedLines,
    syncedLinesToLrc
} from '../utils/lyrics-sync.js';
import { parseTrackIdentity } from './google-lyrics.js';

function cleanTrackTitle(title) {
    return String(title || '')
        .replace(/\([^)]*(official|video|lyric|audio|mv|music|hd|4k|visualizer)[^)]*\)/gi, '')
        .replace(/\[[^\]]*\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanArtistName(author) {
    const a = String(author || '').trim();
    if (!a || /^unknown$/i.test(a) || /^-+$/.test(a)) return '';
    return a.replace(/\s+/g, ' ').trim();
}

function buildSearchQueries(track) {
    const rawTitle = track?.title || '';
    const title = cleanTrackTitle(rawTitle);
    const author = cleanArtistName(track?.author);
    const queries = [];

    if (title && author) {
        queries.push(`${title} ${author}`);
        queries.push(`${author} ${title}`);
        queries.push(`${author} - ${title}`);
    }
    if (title) queries.push(title);
    if (rawTitle && rawTitle !== title) queries.push(rawTitle);

    return [...new Set(queries.filter(Boolean))];
}

async function getLrclibExact(artist, title, durationSec) {
    const params = {
        artist_name: artist || '',
        track_name: title || ''
    };
    if (durationSec && durationSec > 0) params.duration = Math.round(durationSec);

    const { data, status } = await axios.get('https://lrclib.net/api/get', {
        params,
        timeout: 12000,
        validateStatus: () => true
    });
    if (status !== 200 || !data) return null;
    if (!data.plainLyrics && !data.syncedLyrics) return null;
    return data;
}

async function searchLrclib(query) {
    const { data } = await axios.get('https://lrclib.net/api/search', {
        params: { q: query },
        timeout: 12000
    });
    if (!Array.isArray(data) || !data.length) return null;
    return data.find(t => t.plainLyrics || t.syncedLyrics) || data[0];
}

function formatDuration(sec) {
    if (!sec) return '-';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function stripSyncedTags(text) {
    return text.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{2,3})?\]/g, '').trim();
}

function normalizeTitle(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function lyricsMatchesTrack(hit, track) {
    const wantTitle = normalizeTitle(cleanTrackTitle(track?.title));
    const wantArtist = normalizeTitle(cleanArtistName(track?.author));
    const gotTitle = normalizeTitle(hit?.title || hit?.trackName);
    const gotArtist = normalizeTitle(hit?.artist || hit?.artistName);

    if (!wantTitle) return false;
    const titleOk = gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle)
        || wantTitle.split(' ').filter((w) => w.length > 3).some((w) => gotTitle.includes(w));
    if (!titleOk) return false;

    if (wantArtist && gotArtist) {
        const w = wantArtist.split(' ')[0];
        const g = gotArtist.split(' ')[0];
        if (w.length > 2 && g.length > 2 && !gotArtist.includes(w) && !wantArtist.includes(g)) return false;
    }
    return true;
}

function lyricsLooseMatch(hit, track) {
    const wantTitle = normalizeTitle(cleanTrackTitle(track?.title));
    const gotTitle = normalizeTitle(hit?.title || hit?.trackName);
    if (!wantTitle || !gotTitle) return false;
    const words = wantTitle.split(' ').filter((w) => w.length > 2);
    if (!words.length) return gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle);
    const matched = words.filter((w) => gotTitle.includes(w)).length;
    return matched >= Math.min(2, Math.max(1, Math.ceil(words.length * 0.4)));
}

function withLyricsTimeout(promise, ms = 62000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Lyrics fetch timeout')), ms);
        })
    ]);
}

function packLyricsResult(hit, source, track = null) {
    const rawSynced = hit.syncedLyrics || null;
    const plain = (hit.plainLyrics || stripSyncedTags(rawSynced || '') || hit.lyrics || '').trim();
    if (!plain) return null;

    const vttSync = Boolean(hit.vttSync);
    const hasRawLines = Array.isArray(hit.syncedLines) && hit.syncedLines.length;
    let syncedLines = hasRawLines ? hit.syncedLines : parseSyncedLyrics(rawSynced);
    const realSync = Boolean(vttSync || rawSynced || hit.realSync);

    if (!syncedLines.length && track?.durationSec > 0) {
        syncedLines = buildEstimatedSyncedLines(plain, track.durationSec);
    } else if (syncedLines.length) {
        syncedLines = finalizeSyncedLines(syncedLines, track, { realSync, vttSync });
    }

    const lyrics = syncedLines.length
        ? syncedLines.map((l) => l.text).join('\n')
        : plain;

    const identity = track ? parseTrackIdentity(track) : null;

    return {
        found: true,
        trackId: track?.id ?? null,
        title: hit.trackName || hit.title || identity?.title || track?.title || '',
        artist: hit.artistName || hit.artist || identity?.artist || track?.author || '—',
        album: hit.albumName || hit.album || '',
        duration: formatDuration(hit.duration) || track?.duration || '',
        lyrics,
        syncedLyrics: rawSynced || (syncedLines.length ? syncedLinesToLrc(syncedLines) : null),
        syncedLines,
        synced: syncedLines.length > 0,
        realSync: realSync && syncedLines.length > 0,
        vttSync,
        source
    };
}

export function formatLyricsMessage(track, rawLyrics, source = 'LRCLIB') {
    const lyrics = (rawLyrics || '').trim();
    const body = lyrics.length > 3200 ? lyrics.slice(0, 3200) + '\n\n_...(lirik dipotong)_' : lyrics;
    return (
        `🎵 *LIRIK LAGU*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *Judul:* ${track.title}\n` +
        `👤 *Artis:* ${track.artist}\n` +
        (track.album ? `💿 *Album:* ${track.album}\n` : '') +
        (track.duration ? `⏱️ *Durasi:* ${track.duration}\n` : '') +
        (track.published ? `📅 *Rilis:* ${track.published}\n` : '') +
        `\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${body}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `✨ _LuxxBot · ${source}_`
    );
}

/** Query pencarian — sama konsep !lirik / /lirik */
export function buildLirikSearchQuery(track) {
    const identity = parseTrackIdentity(track);
    if (identity.artist && identity.title) {
        return `${identity.title} ${identity.artist}`;
    }
    return identity.title || track?.title || '';
}

export function packPlainRadioLyrics(hit, track = null) {
    if (!hit) return null;
    const raw = hit.plainLyrics || hit.lyrics || '';
    const lyrics = stripSyncedTags(String(raw)).trim();
    if (!lyrics || lyrics.length < 20) return null;

    const identity = track ? parseTrackIdentity(track) : null;

    return {
        found: true,
        trackId: track?.id ?? hit.trackId ?? null,
        title: hit.title || hit.trackName || identity?.title || track?.title || '',
        artist: hit.artist || hit.artistName || identity?.artist || track?.author || '—',
        lyrics,
        source: hit.source || 'LRCLIB',
        synced: false,
        loading: false
    };
}

/** Radio — LRCLIB + lyrics.ovh saja (tanpa yt-search yang lambat) */
async function fetchLyricsPlainFast(query, track = null) {
    const q = String(query || '').trim();
    if (!q) return null;

    const identity = track ? parseTrackIdentity(track) : null;
    if (identity?.title) {
        try {
            const exact = await getLrclibExact(
                identity.artist || '',
                identity.title,
                track?.durationSec
            );
            if (exact?.plainLyrics || exact?.syncedLyrics) {
                const packed = packLyricsResult(exact, 'LRCLIB', track);
                if (packed) return packed;
            }
        } catch { /* next */ }
    }

    try {
        const hit = await searchLrclib(q);
        if (hit?.plainLyrics || hit?.syncedLyrics) {
            const packed = packLyricsResult(hit, 'LRCLIB', track);
            if (packed) return packed;
        }
    } catch { /* next */ }

    const parts = q.split(/\s*[-–]\s*/).map((s) => s.trim()).filter(Boolean);
    const title = parts[0] || q;
    const artist = parts[1] || identity?.artist || parts[0] || q;
    const pairs = [
        [artist, title],
        [identity?.artist, identity?.title],
        [title, artist]
    ].filter(([a, t]) => a && t);

    for (const [a, t] of pairs) {
        try {
            const res = await axios.get(
                `https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(t)}`,
                { timeout: 7000, validateStatus: () => true }
            );
            if (res.status === 200 && res.data?.lyrics) {
                const packed = packLyricsResult({
                    trackName: t,
                    artistName: a,
                    plainLyrics: res.data.lyrics
                }, 'lyrics.ovh', track);
                if (packed) return packed;
            }
        } catch { /* next */ }
    }

    return null;
}

async function fetchLyricsPlainOnce(query) {
    const q = String(query || '').trim();
    if (!q) return null;

    try {
        const hit = await searchLrclib(q);
        if (hit?.plainLyrics || hit?.syncedLyrics) {
            const packed = packLyricsResult(hit, 'LRCLIB', null);
            if (packed) return packed;
        }
    } catch (e) {
        console.log('LRCLIB plain skip:', e.message);
    }

    try {
        const search = await ytSearch(q);
        const video = search.videos?.[0];
        if (video) {
            const hit2 = await searchLrclib(`${video.title} ${video.author?.name || ''}`);
            if (hit2?.plainLyrics || hit2?.syncedLyrics) {
                const packed = packLyricsResult({
                    ...hit2,
                    trackName: hit2.trackName || video.title,
                    artistName: hit2.artistName || video.author?.name
                }, 'LRCLIB + YouTube', null);
                if (packed) return packed;
            }
        }
    } catch (e) {
        console.log('YT+LRCLIB plain skip:', e.message);
    }

    const parts = q.split(/\s*[-–]\s*/).map((s) => s.trim()).filter(Boolean);
    const title = parts[0] || q;
    const artist = parts[1] || parts[0] || q;
    const pairs = [
        [artist, title],
        [title, artist],
        [parts[0], parts.slice(1).join(' ') || parts[0]]
    ].filter(([a, t]) => a && t);

    for (const [a, t] of pairs) {
        try {
            const res = await axios.get(
                `https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(t)}`,
                { timeout: 10000, validateStatus: () => true }
            );
            if (res.status === 200 && res.data?.lyrics) {
                const packed = packLyricsResult({
                    trackName: t,
                    artistName: a,
                    plainLyrics: res.data.lyrics
                }, 'lyrics.ovh', null);
                if (packed) return packed;
            }
        } catch { /* next */ }
    }

    return null;
}

/** Radio + !lirik — cari lewat judul lagu */
export async function fetchLyricsForRadioTrack(track) {
    if (!track?.title) return null;

    const primary = buildLirikSearchQuery(track);
    const queries = [...new Set([primary, ...buildSearchQueries(track)].filter(Boolean))];

    try {
        const hit = await withLyricsTimeout(fetchLyricsPlainFast(primary, track), 12_000);
        const packed = packPlainRadioLyrics(hit, track);
        if (packed) return packed;
    } catch (e) {
        console.log('radio lirik fast:', primary.slice(0, 40), e.message);
    }

    for (const q of queries.slice(1, 3)) {
        try {
            const hit = await withLyricsTimeout(fetchLyricsPlainFast(q, track), 10_000);
            const packed = packPlainRadioLyrics(hit, track);
            if (packed) return packed;
        } catch (e) {
            console.log('radio lirik:', q.slice(0, 40), e.message);
        }
    }

    return null;
}

export async function fetchLyricsPlain(songQuery, track = null) {
    const queries = [];
    if (songQuery?.trim()) queries.push(songQuery.trim());
    if (track) queries.push(...buildSearchQueries(track));

    for (const q of [...new Set(queries.filter(Boolean))]) {
        const hit = await fetchLyricsPlainOnce(q);
        if (hit) return hit;
    }
    return null;
}

export async function fetchLyrics(songQuery) {
    const query = songQuery.trim();
    if (!query) return null;

    const plain = await fetchLyricsPlain(query);
    if (!plain?.lyrics) return null;
    return formatLyricsMessage({
        title: plain.title,
        artist: plain.artist,
        album: plain.album || '',
        duration: plain.duration || '',
        published: ''
    }, plain.lyrics, plain.source);
}