/** Parse LRC / synced lyrics → [{ timeSec, text }] */
export function parseSyncedLyrics(lrc) {
    if (!lrc || typeof lrc !== 'string') return [];
    const lines = [];
    for (const raw of lrc.split('\n')) {
        const m = raw.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{2,3}))?\]\s*(.*)$/);
        if (!m) continue;
        const min = Number(m[1]);
        const sec = Number(m[2]);
        const frac = m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0;
        const text = m[4].trim();
        if (!text) continue;
        lines.push({ timeSec: min * 60 + sec + frac, text });
    }
    return lines.sort((a, b) => a.timeSec - b.timeSec);
}

function parseVttTimestamp(ts) {
    const raw = String(ts || '').trim().replace(',', '.');
    const parts = raw.split(':');
    if (parts.length === 3) {
        return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + parseFloat(parts[2]);
    }
    if (parts.length === 2) {
        return Number(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return 0;
}

/** Parse WebVTT → synced lines (timing sama persis dengan audio YouTube) */
export function parseVttSyncedLyrics(vtt) {
    const syncedLines = [];
    let prev = '';

    for (const block of String(vtt || '').split(/\n\n+/)) {
        const rows = block.split('\n').map((l) => l.trim()).filter(Boolean);
        let cueStart = null;
        const textRows = [];

        for (const row of rows) {
            if (row === 'WEBVTT' || row.startsWith('NOTE') || row.startsWith('STYLE')) continue;
            if (row.includes('-->')) {
                cueStart = parseVttTimestamp(row.split('-->')[0]);
                continue;
            }
            if (/^\d+$/.test(row)) continue;
            textRows.push(row);
        }

        if (cueStart == null || !textRows.length) continue;

        const text = textRows
            .join(' ')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
            .replace(/\s+/g, ' ')
            .trim();

        if (!text || text === prev) continue;
        prev = text;
        syncedLines.push({ timeSec: cueStart, text });
    }

    return syncedLines.sort((a, b) => a.timeSec - b.timeSec);
}

/** Gabung cue VTT pendek berurutan supaya tidak terlalu cepat ganti baris */
export function mergeVttSyncedLines(syncedLines, minGapSec = 0.55) {
    if (!syncedLines?.length) return [];
    const out = [{ ...syncedLines[0] }];

    for (let i = 1; i < syncedLines.length; i++) {
        const cur = syncedLines[i];
        const last = out[out.length - 1];
        const gap = cur.timeSec - last.timeSec;
        if (gap < minGapSec && cur.text.length < 28 && last.text.length < 80) {
            last.text = `${last.text} ${cur.text}`.trim();
            continue;
        }
        out.push({ ...cur });
    }
    return out;
}

/** Estimasi sync plain — bobot per panjang baris, intro singkat */
export function buildEstimatedSyncedLines(plainText, durationSec) {
    const lines = String(plainText || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^\[/.test(l) && !/^(verse|chorus|bridge|intro|outro|refrain)\s*:/i.test(l));

    if (lines.length < 2 || !durationSec || durationSec < 12) return [];

    const weights = lines.map((l) => Math.max(2, l.replace(/[^\p{L}\p{N}]/gu, '').length || l.length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const startPad = Math.min(6, Math.max(2, durationSec * 0.035));
    const endPad = Math.min(8, durationSec * 0.06);
    const singSpan = Math.max(durationSec * 0.55, durationSec - startPad - endPad);

    let acc = 0;
    return lines.map((text, i) => {
        const slice = (weights[i] / totalWeight) * singSpan;
        const timeSec = Math.min(durationSec - 0.4, startPad + acc);
        acc += slice;
        return { timeSec, text };
    });
}

/** Sesuaikan LRC studio ke timeline MP3 YouTube (lead-in ekstra di awal video) */
export function alignLrcForYoutubeMp3(syncedLines, durationSec) {
    if (!syncedLines?.length || !durationSec || durationSec < 20) return syncedLines;

    const first = syncedLines[0].timeSec;
    const last = syncedLines[syncedLines.length - 1].timeSec;
    const span = Math.max(1, last - first);

    if (first > 25) return syncedLines;

    const vocalStart = Math.min(Math.max(4, durationSec * 0.04), 16);
    const vocalEnd = Math.min(durationSec * 0.93, last + (durationSec - last) * 0.45);
    const targetSpan = Math.max(span, vocalEnd - vocalStart);

    if (Math.abs(targetSpan - span) < span * 0.06 && Math.abs(vocalStart - first) < 2) {
        return syncedLines;
    }

    const scale = targetSpan / span;
    const shift = vocalStart - first * scale;

    return syncedLines.map((l) => ({
        ...l,
        timeSec: Math.max(0, Math.min(durationSec - 0.2, shift + l.timeSec * scale))
    }));
}

export function formatLrcTime(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${m}:${String(r).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export function syncedLinesToLrc(syncedLines) {
    return (syncedLines || [])
        .map((l) => `[${formatLrcTime(l.timeSec)}] ${l.text}`)
        .join('\n');
}

export function finalizeSyncedLines(syncedLines, track, { realSync = false, vttSync = false } = {}) {
    if (!syncedLines?.length) return [];

    let lines = syncedLines.map((l) => ({ timeSec: Number(l.timeSec) || 0, text: String(l.text || '').trim() }))
        .filter((l) => l.text);

    if (vttSync) return mergeVttSyncedLines(lines);

    const durationSec = track?.durationSec || 0;
    const fromYoutube = Boolean(track?.url && /youtube|youtu\.be/i.test(track.url));

    if (realSync && fromYoutube && !vttSync) {
        lines = alignLrcForYoutubeMp3(lines, durationSec);
    }

    return lines;
}

export function getActiveLyricIndex(syncedLines, positionSec, plainLineCount = 0, durationSec = 0) {
    const pos = Math.max(0, Number(positionSec) || 0);

    if (syncedLines?.length) {
        let idx = 0;
        for (let i = 0; i < syncedLines.length; i++) {
            const t = syncedLines[i].timeSec;
            const next = syncedLines[i + 1]?.timeSec;
            const boundary = next != null ? (t + next) / 2 : t + 2.5;
            if (pos >= t - 0.08 && pos < boundary) return i;
            if (pos >= t - 0.08) idx = i;
        }
        return idx;
    }

    if (plainLineCount > 1 && durationSec > 3) {
        return Math.min(plainLineCount - 1, Math.floor((pos / durationSec) * plainLineCount));
    }

    return 0;
}

export function lyricsDisplayLines(lyricsPayload) {
    if (lyricsPayload?.syncedLines?.length) {
        return lyricsPayload.syncedLines.map((l) => l.text);
    }
    return (lyricsPayload?.lyrics || '').split('\n').filter((l) => l.trim());
}