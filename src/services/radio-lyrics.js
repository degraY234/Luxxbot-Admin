import { fetchLyricsForRadioTrack, buildLirikSearchQuery } from './lyrics.js';

const cache = new Map();
const queryCache = new Map();
const inflight = new Map();
const failUntil = new Map();
let lastResolvedKey = null;

const FAIL_RETRY_MS = 10_000;
const CACHE_MAX = 72;
const MAX_PREFETCH_SLOTS = 5;
const PREFETCH_QUEUE_LIMIT = 15;

const waitPrefetch = [];
let prefetchSlots = 0;

function trackKey(track) {
    if (!track?.title) return null;
    return `${track.id || ''}:${track.title}:${track.author || ''}`;
}

function queryKey(track) {
    const q = buildLirikSearchQuery(track);
    return q ? q.toLowerCase().replace(/\s+/g, ' ').trim() : null;
}

function emptyLyrics(loading = false) {
    return { found: false, loading, lyrics: null, title: null, artist: null, source: null };
}

function loadingLyrics(track) {
    return {
        ...emptyLyrics(true),
        trackId: track.id ?? null,
        title: track.title,
        artist: track.author || '—'
    };
}

function trimCache() {
    while (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest === lastResolvedKey) {
            const keys = [...cache.keys()];
            const drop = keys.find((k) => k !== lastResolvedKey);
            if (drop) cache.delete(drop);
            else break;
        } else {
            cache.delete(oldest);
        }
    }
}

function storeCache(key, qk, payload) {
    cache.set(key, payload);
    if (qk) queryCache.set(qk, payload);
    trimCache();
}

function readCached(track) {
    const key = trackKey(track);
    const qk = queryKey(track);

    if (key && cache.has(key)) {
        const cached = cache.get(key);
        if (cached?.found && cached.lyrics) {
            return { ...cached, trackId: track.id ?? null, loading: false };
        }
    }

    if (qk && queryCache.has(qk)) {
        const cached = queryCache.get(qk);
        if (cached?.found && cached.lyrics) {
            const payload = { ...cached, trackId: track.id ?? null, loading: false };
            if (key) cache.set(key, payload);
            return payload;
        }
    }

    return null;
}

function shouldSkipFetch(key) {
    if (!key) return true;
    if (cache.get(key)?.found) return true;
    if (inflight.has(key)) return true;
    const retryAt = failUntil.get(key) || 0;
    return retryAt > Date.now();
}

function startLyricsFetch(track, key) {
    const trackId = track.id ?? null;
    const qk = queryKey(track);

    const promise = fetchLyricsForRadioTrack(track)
        .then((result) => {
            failUntil.delete(key);

            if (result?.found && result?.lyrics) {
                const payload = { ...result, trackId, loading: false, synced: false };
                storeCache(key, qk, payload);
                return payload;
            }

            failUntil.set(key, Date.now() + FAIL_RETRY_MS);
            return {
                found: false,
                loading: false,
                trackId,
                title: track.title,
                artist: track.author || '—',
                lyrics: null,
                source: null
            };
        })
        .catch((e) => {
            console.log('radio lyrics load:', e.message);
            failUntil.set(key, Date.now() + FAIL_RETRY_MS);
            return {
                found: false,
                loading: false,
                trackId,
                title: track.title,
                artist: track.author || '—',
                lyrics: null,
                source: null,
                error: e.message
            };
        })
        .finally(() => inflight.delete(key));

    inflight.set(key, promise);
    return promise;
}

function drainPrefetch() {
    while (prefetchSlots < MAX_PREFETCH_SLOTS && waitPrefetch.length) {
        const track = waitPrefetch.shift();
        const key = trackKey(track);
        if (!key || shouldSkipFetch(key)) continue;

        prefetchSlots += 1;
        startLyricsFetch(track, key)
            .then((hit) => {
                if (hit?.found) {
                    console.log(`📝 Lirik siap (antrian): ${buildLirikSearchQuery(track).slice(0, 52)} · ${hit.source || '?'}`);
                }
            })
            .catch(() => {})
            .finally(() => {
                prefetchSlots -= 1;
                drainPrefetch();
            });
    }
}

/** Prefetch background — sama seperti !lirik / /lirik, cari dari judul */
export function scheduleLyricsPrefetch(track, { priority = false } = {}) {
    if (!track?.title) return;

    const key = trackKey(track);
    const cached = readCached(track);
    if (cached) {
        if (priority) lastResolvedKey = key;
        return;
    }

    if (shouldSkipFetch(key)) return;

    if (priority) {
        failUntil.delete(key);
        startLyricsFetch(track, key)
            .then((hit) => {
                if (hit?.found) {
                    lastResolvedKey = key;
                    console.log(`📝 Lirik siap: ${buildLirikSearchQuery(track).slice(0, 52)} · ${hit.source || '?'}`);
                }
            })
            .catch(() => {});
        return;
    }

    if (waitPrefetch.some((t) => trackKey(t) === key)) return;
    waitPrefetch.push(track);
    drainPrefetch();
}

/** Prefetch semua lagu di antrian + yang sedang diputar */
export function prefetchQueueLyrics(queue = [], current = null) {
    if (current) scheduleLyricsPrefetch(current, { priority: true });

    const seen = new Set();
    if (current) seen.add(trackKey(current));

    for (const track of queue.slice(0, PREFETCH_QUEUE_LIMIT)) {
        const key = trackKey(track);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        scheduleLyricsPrefetch(track);
    }
}

function ensureCurrentLyrics(track) {
    const key = trackKey(track);
    if (!key) return emptyLyrics();

    const cached = readCached(track);
    if (cached) {
        lastResolvedKey = key;
        return cached;
    }

    if (inflight.has(key)) {
        return { ...loadingLyrics(track), trackId: track.id ?? null };
    }

    const retryAt = failUntil.get(key) || 0;
    if (retryAt > Date.now()) {
        return {
            found: false,
            loading: false,
            trackId: track.id ?? null,
            title: track.title,
            artist: track.author || '—',
            lyrics: null,
            source: null,
            retryInSec: Math.ceil((retryAt - Date.now()) / 1000)
        };
    }

    if (retryAt > 0) failUntil.delete(key);
    scheduleLyricsPrefetch(track, { priority: true });
    return { ...loadingLyrics(track), trackId: track.id ?? null };
}

export function getRadioLyricsState() {
    if (!lastResolvedKey) return emptyLyrics();
    const cached = cache.get(lastResolvedKey);
    return cached?.found ? { ...cached, loading: false } : emptyLyrics();
}

export function getLyricsPrefetchStatus(track) {
    if (!track?.title) return { ready: false, loading: false };
    const cached = readCached(track);
    if (cached?.found) return { ready: true, loading: false, source: cached.source || null };
    const key = trackKey(track);
    if (key && inflight.has(key)) return { ready: false, loading: true };
    return { ready: false, loading: false };
}

export function getCachedLyricsForTrack(track) {
    if (!track?.title) return emptyLyrics();
    return ensureCurrentLyrics(track);
}

export async function resolveLyricsForTrack(track) {
    if (!track?.title) return emptyLyrics();
    const cached = readCached(track);
    if (cached) return cached;

    const key = trackKey(track);
    if (inflight.has(key)) return inflight.get(key);

    return startLyricsFetch(track, key);
}

export function bindRadioLyricsWatcher(onTrackChange) {
    onTrackChange((track) => {
        if (!track) {
            lastResolvedKey = null;
            return;
        }
        const key = trackKey(track);
        failUntil.delete(key);
        lastResolvedKey = cache.get(key)?.found ? key : null;
        scheduleLyricsPrefetch(track, { priority: true });
    });
}