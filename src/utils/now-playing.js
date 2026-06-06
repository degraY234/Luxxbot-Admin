import { radio } from '../services/radio-server.js';

export function getNowPlayingText() {
    const cur = radio.current;
    if (radio.isPreparing && !cur) {
        return (
            `🎶 *NOW PLAYING*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `⏳ Sedang memuat lagu...\n\n` +
            `📋 Antrian: ${radio.queue.length} lagu`
        );
    }
    if (!cur) {
        return (
            `🎶 *NOW PLAYING*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `⏸️ Tidak ada lagu yang diputar.\n\n` +
            `🎵 Tambah: \`!play judul lagu\`\n` +
            `📋 Antrian: ${radio.queue.length} lagu`
        );
    }

    const next = radio.queue[0];
    let text =
        `🎶 *NOW PLAYING*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🎵 *${cur.title}*\n` +
        `👨‍🎤 ${cur.author || 'Unknown'}\n` +
        `🙋 Request: ${cur.requestedBy || '-'}\n\n` +
        `📋 Antrian: ${radio.queue.length} lagu`;

    if (next) {
        text += `\n⏭️ Berikutnya: ${next.title}`;
    }

    return text;
}