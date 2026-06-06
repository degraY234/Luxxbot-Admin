import axios from 'axios';
import ytSearch from 'yt-search';

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
    return text.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();
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

export async function fetchLyrics(songQuery) {
    const query = songQuery.trim();
    if (!query) return null;

    // 1) LRCLIB search (cocok untuk !lirik multo)
    try {
        const hit = await searchLrclib(query);
        if (hit) {
            const raw = hit.plainLyrics || stripSyncedTags(hit.syncedLyrics || '');
            if (raw) {
                return formatLyricsMessage({
                    title: hit.trackName || query,
                    artist: hit.artistName || 'Tidak diketahui',
                    album: hit.albumName || '',
                    duration: formatDuration(hit.duration),
                    published: ''
                }, raw, 'LRCLIB');
            }
        }
    } catch (e) {
        console.log('LRCLIB skip:', e.message);
    }

    // 2) YouTube metadata + LRCLIB by title/artist
    try {
        const search = await ytSearch(query);
        const video = search.videos?.[0];
        if (video) {
            const hit2 = await searchLrclib(`${video.title} ${video.author?.name || ''}`);
            if (hit2?.plainLyrics || hit2?.syncedLyrics) {
                const raw = hit2.plainLyrics || stripSyncedTags(hit2.syncedLyrics);
                return formatLyricsMessage({
                    title: hit2.trackName || video.title,
                    artist: hit2.artistName || video.author?.name || '-',
                    album: hit2.albumName || '',
                    duration: formatDuration(hit2.duration) || video.timestamp || '-',
                    published: video.ago ? `≈ ${video.ago} (YT)` : ''
                }, raw, 'LRCLIB + YouTube');
            }
        }
    } catch (e) {
        console.log('YT+LRCLIB skip:', e.message);
    }

    // 3) lyrics.ovh dengan split judul - artis
    const parts = query.split('-').map(s => s.trim());
    const title = parts[0];
    const artist = parts[1] || parts[0];
    try {
        const res = await axios.get(
            `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
            { timeout: 10000 }
        );
        if (res.data?.lyrics) {
            return formatLyricsMessage({
                title,
                artist: parts[1] ? artist : '—',
                album: '',
                duration: '',
                published: ''
            }, res.data.lyrics, 'lyrics.ovh');
        }
    } catch (_) {}

    return null;
}