import { ensureLivePublicBase, getRadioUrlHint, invalidateRadioUrlCache } from '../utils/radio-url.js';

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
        if (!status.base || status.source === 'down') {
            const hint = process.env.RAILWAY_ENVIRONMENT
                ? 'Cek Railway: service online + `RADIO_PUBLIC_URL=https://domain.up.railway.app` (bukan tunnel lokal).'
                : 'Owner jalankan `npm run watch:setup` atau `pm2 status` (luxx + luxx-tunnel online).';
            return await sock.sendMessage(from, {
                text: `❌ *Luxx Watch belum bisa diakses*\n\n${hint}`
            }, { quoted: msg });
        }

        const base = status.base.replace(/\/$/, '');
        const url = `${base}/watch/`;
        const hint = getRadioUrlHint(base, status);
        const stamp = new Date().toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' });

        const text =
            `📺 *LUXX WATCH — NONTON BARENG*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `✨ Ketik *username* → masuk dashboard nonton bareng\n` +
            `🎬 Katalog LK21 · 💬 Chat · 🎙️ Voice\n\n` +
            (film ? `▶️ Sedang diputar: *${film}*\n` : '') +
            `👥 Penonton: ${viewers}\n\n` +
            (status.source !== 'tunnel'
                ? '⚠️ _Tunnel sedang disinkronkan — kalau error refresh & pakai link ini_\n\n'
                : '') +
            `🔗 *LINK AKTIF (${stamp}):*\n${url}${hint}\n\n` +
            `_Pakai link di atas (bukan link lama di chat)._`;

        await sendTapLink(sock, from, {
            text,
            url,
            title: '📺 Luxx Watch — Masuk Ruang TV',
            description: 'Ketuk → username → dashboard nonton bareng',
            quoted: msg
        });
    } catch (e) {
        console.error('WATCH ERROR:', e?.message || e);
        await sock.sendMessage(from, { text: '❌ Gagal ambil link watch. Coba lagi.' }, { quoted: msg });
    }
}