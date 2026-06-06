export function extractYoutubeVideoId(url = '') {
    const m = String(url).match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

export function youtubeThumbnail(url, videoId) {
    const id = videoId || extractYoutubeVideoId(url);
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

export function parseDurationSec(value) {
    if (value == null || value === '-') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    const raw = String(value).trim();
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);
    const parts = raw.split(':').map((p) => parseInt(p, 10));
    if (parts.some((n) => Number.isNaN(n))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
}

export function formatDurationSec(sec) {
    if (!sec || sec <= 0) return '-';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export function enrichTrackMeta(track = {}) {
    const videoId = track.videoId || extractYoutubeVideoId(track.url);
    const durationSec = track.durationSec
        || parseDurationSec(track.seconds)
        || parseDurationSec(track.timestamp)
        || parseDurationSec(track.duration);
    return {
        ...track,
        videoId: videoId || null,
        thumbnail: track.thumbnail || youtubeThumbnail(track.url, videoId),
        durationSec,
        duration: track.duration && track.duration !== '-'
            ? track.duration
            : formatDurationSec(durationSec)
    };
}