import { resolveRadioBaseUrl } from '../utils/radio-url.js';
import { getWatchRoomState } from '../services/watch-server.js';

export async function handleWatchCommand({ sock, from, msg }) {
    try {
        const base = await resolveRadioBaseUrl();
        const url = `${base}/watch`;
        const room = getWatchRoomState();
        const viewers = room.viewerCount || 0;
        const film = room.film?.title;

        await sock.sendMessage(from, {
            text:
                `📺 *LUXX WATCH — NONTON BARENG*\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `🔗 *Masuk ruang TV:*\n${url}\n\n` +
                `✨ Login cukup **username** (tanpa token)\n` +
                `🎬 Pilih film dari katalog LK21\n` +
                `💬 Chat live · 🎙️ Voice · 🎧 Discord voice\n\n` +
                (film ? `▶️ Sedang diputar: *${film}*\n` : '') +
                `👥 Penonton online: ${viewers}\n\n` +
                `_Admin full control: /admin (owner only)_`
        }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(from, { text: '❌ Gagal ambil link watch.' }, { quoted: msg });
    }
}