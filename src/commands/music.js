import ytSearch from 'yt-search';
import { fetchLyrics } from '../services/lyrics.js';
import {
    radio,
    addTrackToRadio,
    skipRadioTrack,
    clearRadioQueue,
    getRadioStatusText,
    getRadioListenUrl
} from '../services/radio-server.js';
import { getDiscordRadioStatus } from '../services/discord-radio.js';
import { getOrCreateRoom } from '../services/w2g.js';
import { sendWaRadioLink } from '../utils/wa-radio-link.js';

// ============================================================
// 🎵 !play — cari lagu, pilih angka → antrian RADIO (bukan W2G)
// ============================================================
export async function handlePlayCommand({ sock, from, msg, args }) {
    const musicQuery = args.join(' ');
    if (!musicQuery) {
        return await sock.sendMessage(from, {
            text: '⚠️ Format: `!play judul_lagu`\nContoh: `!play multo`'
        }, { quoted: msg });
    }

    await sock.sendMessage(from, { text: '🎵 Sedang mencari musik...' }, { quoted: msg });

    try {
        const search = await ytSearch(musicQuery);
        const videos = search.videos.slice(0, 5);

        if (!videos.length) {
            return await sock.sendMessage(from, { text: '❌ Musik tidak ditemukan.' }, { quoted: msg });
        }

        let listText = `🎵 *Hasil Pencarian:* "${musicQuery}"\n\nPilih dengan mengetik angka:\n\n`;
        videos.forEach((v, i) => {
            listText += `*${i + 1}.* ${v.title}\n👨‍🎤 ${v.author.name} | ⏱️ ${v.timestamp}\n\n`;
        });
        listText += `_Balas angka 1-${videos.length} → masuk antrian radio_\n`;
        listText += `_Dengar: \`!radio\`_`;

        global.playSession = global.playSession || {};
        global.playSession[from] = {
            mode: 'radio',
            tracks: videos.map(v => ({
                title: v.title,
                url: v.url,
                timestamp: v.timestamp,
                author: v.author
            }))
        };

        await sock.sendMessage(from, { text: listText }, { quoted: msg });
    } catch (e) {
        console.error('Play command error:', e);
        await sock.sendMessage(from, { text: '❌ Error saat mencari musik.' }, { quoted: msg });
    }
}

// ============================================================
// 📻 !radio — link dengar musik (terpisah dari W2G)
// ============================================================
export async function handleRadioCommand({ sock, from, msg }) {
    try {
        await sendWaRadioLink(sock, from, {
            statusText: getRadioStatusText() + `\n\n${getDiscordRadioStatus()}`,
            quoted: msg
        });
    } catch (e) {
        console.error('Radio error:', e);
        await sock.sendMessage(from, { text: '❌ Gagal ambil info radio.' }, { quoted: msg });
    }
}

// ============================================================
// 🎬 !stream — nonton bareng W2G (video, bukan radio musik)
// ============================================================
export async function handleStreamCommand({ sock, from, msg, getOrCreateRoom }) {
    try {
        await sock.sendMessage(from, { text: '🎬 Mengambil link nonton bareng...' }, { quoted: msg });
        const room = await getOrCreateRoom();
        await sock.sendMessage(from, {
            text:
                `🎬 *NONTON BARENG (Watch2Gether)*\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `🔗 *Link room:*\n${room.url}\n\n` +
                `_Ini untuk nonton video bareng, bukan radio musik._\n` +
                `📻 Dengar musik: \`!radio\` · Tambah lagu: \`!play\``
        }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(from, { text: '❌ Gagal ambil link W2G. Cek STREAM_TOKEN di .env' }, { quoted: msg });
    }
}

// ============================================================
// 📋 !queue
// ============================================================
export async function handleQueueCommand({ sock, from, msg }) {
    const q = radio.queue;
    const cur = radio.current;

    if (!cur && !q.length) {
        return await sock.sendMessage(from, {
            text: '📭 Antrian kosong.\n\n🎵 Tambah: `!play judul lagu`\n📻 Dengar: `!radio`'
        }, { quoted: msg });
    }

    let text = `📋 *ANTRIAN RADIO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    if (cur) text += `▶️ *Now playing:* ${cur.title}\n👤 ${cur.author}\n\n`;
    if (q.length) {
        q.slice(0, 12).forEach((t, i) => {
            text += `${i + 1}. 🎵 *${t.title}*\n   ⏱️ ${t.duration} | 🙋 ${t.requestedBy}\n\n`;
        });
        if (q.length > 12) text += `_...dan ${q.length - 12} lagu lainnya_\n`;
    } else {
        text += `_Tidak ada lagu berikutnya di antrian._\n`;
    }
    await sendWaRadioLink(sock, from, { statusText: text, quoted: msg });
}

// ============================================================
// ⏭️ !skip
// ============================================================
export async function handleSkipCommand({ sock, from, msg }) {
    const result = await skipRadioTrack();
    if (!result.ok) {
        return await sock.sendMessage(from, { text: `❌ ${result.message}` }, { quoted: msg });
    }
    await sendWaRadioLink(sock, from, {
        statusText: result.message,
        quoted: msg
    });
}

// ============================================================
// 🛑 !stop — kosongkan radio (owner)
// ============================================================
export async function handleStopCommand({ sock, from, msg, isAdmin }) {
    if (!isAdmin) {
        return await sock.sendMessage(from, { text: '❌ Hanya Owner yang bisa menghentikan radio.' }, { quoted: msg });
    }
    clearRadioQueue();
    await sock.sendMessage(from, { text: '🛑 Radio dihentikan dan antrian dikosongkan.' }, { quoted: msg });
}

// ============================================================
// 📝 !lirik
// ============================================================
export async function handleLyricsCommand({ sock, from, msg, args }) {
    const songQuery = args.join(' ');
    if (!songQuery) {
        return await sock.sendMessage(from, {
            text: '⚠️ Format: `!lirik nama lagu`\nContoh: `!lirik multo` atau `!lirik judul - artis`'
        }, { quoted: msg });
    }

    await sock.sendMessage(from, { text: '📝 Mencari lirik...' }, { quoted: msg });

    const result = await fetchLyrics(songQuery);
    if (result) {
        return await sock.sendMessage(from, { text: result }, { quoted: msg });
    }

    await sock.sendMessage(from, {
        text: `❌ Lirik *"${songQuery}"* tidak ditemukan.\nCoba: \`!lirik multo\` atau \`!lirik judul - artis\``
    }, { quoted: msg });
}