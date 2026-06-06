import {
    formatWisdomCaption,
    parseCustomQuote
} from '../services/quote-content.js';
import { fetchRealWorldQuote } from '../services/quote-fetch.js';

export async function handleQuoteCommand({ sock, from, msg, args }) {
    const raw = args.join(' ').trim();

    if (!raw) {
        await sock.sendMessage(from, {
            text: '✨ Sedang mencari kutipan...'
        }, { quoted: msg });

        try {
            const entry = await fetchRealWorldQuote();
            const caption = formatWisdomCaption(entry, false);
            return sock.sendMessage(from, { text: caption }, { quoted: msg });
        } catch (e) {
            console.error('!quote:', e.message);
            return sock.sendMessage(from, {
                text:
                    `❌ *Gagal mengambil kutipan*\n\n` +
                    `Coba lagi sebentar, atau kirim kutipan sendiri:\n` +
                    `\`!quote teks | penulis | asal\``
            }, { quoted: msg });
        }
    }

    const custom = parseCustomQuote(raw);
    if (!custom) {
        return sock.sendMessage(from, {
            text:
                '⚠️ *Format !quote*\n\n' +
                '• `!quote` — kutipan acak\n' +
                '• `!quote <kalimat> | <penulis> | <asal>` — kutipan kamu\n\n' +
                '💡 `!quote Hidup itu perjalanan | Soekarno | Indonesia`'
        }, { quoted: msg });
    }

    const caption = formatWisdomCaption(custom, true);
    await sock.sendMessage(from, { text: caption }, { quoted: msg });
}