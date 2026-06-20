import { ensureLivePublicBase, getRadioUrlHint, getRadioPublicUrl, invalidateRadioUrlCache } from '../utils/radio-url.js';

const PREVIEW_MS = 6000;

async function sendTapLink(sock, from, { text, url, title, description, quoted }) {
    const opts = quoted ? { quoted } : {};
    try {
        await Promise.race([
            sock.sendMessage(from, {
                text,
                linkPreview: {
                    'canonical-url': url,
                    'matched-text': url,
                    title,
                    description
                }
            }, opts),
            new Promise((_, reject) => setTimeout(() => reject(new Error('linkPreview timeout')), PREVIEW_MS))
        ]);
    } catch (e) {
        console.log('watch tap link fallback:', e?.message || e);
        await sock.sendMessage(from, { text }, opts);
    }
}

export async function handleWatchCommand({ sock, from, msg }) {
    try {
        invalidateRadioUrlCache();

        let viewers = 0;
        let film = '';
        try {
            const { getWatchRoomState } = await import('../services/watch-server.js');
            const room = getWatchRoomState();
            viewers = room.viewerCount || 0;
            film = room.film?.title || '';
        } catch (e) {
            console.log('watch room skip:', e?.message || e);
        }

        const status = await ensureLivePublicBase();
        const stamp = new Date().toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' });

        // Kalau server down total (tidak ada URL sama sekali)
        if (!status.base && status.source === 'down') {
            const hint = process.env.RAILWAY_ENVIRONMENT
                ? 'Cek Railway: service online + `RADIO_PUBLIC_URL=https://domain.up.railway.app`.'
                : 'Jalankan `npm run pm2:start` di terminal lalu coba lagi.';
            return await sock.sendMessage(from, {
                text: `❌ *Luxx Watch tidak bisa diakses*\n\n${hint}`
            }, { quoted: msg });
        }

        // Gunakan base yang ada — meski mungkin stale/tunnel mati, tetap kirim link
        const base = (status.base || getRadioPublicUrl()).replace(/\/$/, '');
        const url = `${base}/watch/`;
        const hint = getRadioUrlHint(base, status);

        let statusNote = '';
        if (status.source === 'stale') {
            statusNote = '⚠️ _Tunnel di .env mungkin sudah beda URL — kalau gagal buka, minta owner restart tunnel._\n\n';
        } else if (status.source === 'lan' || status.source === 'local') {
            statusNote = '⚠️ _Link lokal — hanya bisa diakses dari HP yang satu WiFi dengan PC bot._\n\n';
        }

        const text =
            `📺 *LUXX WATCH — NONTON BARENG*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `✨ Ketik *username* → masuk & mulai nonton\n` +
            `🎬 Katalog LK21 + Rebahin · 💬 Chat live · 🎙️ Voice\n\n` +
            (film ? `▶️ Sedang diputar: *${film}*\n` : `🍿 Belum ada film diputar\n`) +
            `👥 Penonton: ${viewers}\n\n` +
            statusNote +
            `🔗 *LINK AKTIF (${stamp}):*\n${url}${hint}\n\n` +
            `_Ketuk link → masuk dengan username → pilih film dari katalog._`;

        await sendTapLink(sock, from, {
            text,
            url,
            title: '📺 Luxx Watch — Nonton Bareng',
            description: 'Katalog LK21 + Rebahin · Chat live · Voice',
            quoted: msg
        });
    } catch (e) {
        console.error('WATCH ERROR:', e?.message || e);
        // Fallback: kirim link dari env langsung tanpa probe
        try {
            const fallbackBase = getRadioPublicUrl().replace(/\/$/, '');
            const fallbackUrl = `${fallbackBase}/watch/`;
            await sock.sendMessage(from, {
                text: `📺 *Luxx Watch*\n\n🔗 ${fallbackUrl}\n\n_Ketuk link → masuk dengan username_`
            }, { quoted: msg });
        } catch (_) {
            await sock.sendMessage(from, {
                text: '❌ Gagal ambil link watch. Pastikan bot & tunnel berjalan, lalu coba lagi.'
            }, { quoted: msg });
        }
    }
}
