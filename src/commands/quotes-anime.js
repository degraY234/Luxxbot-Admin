import { formatAnimeQuoteCaption } from '../services/quote-content.js';
import { fetchAnimeQuote } from '../services/quote-fetch.js';

export async function handleQuotesAnimeCommand({ sock, from, msg }) {
    await sock.sendMessage(from, {
        text: '🎌 Sedang mencari quote anime...'
    }, { quoted: msg });

    try {
        const data = await fetchAnimeQuote();
        const caption = formatAnimeQuoteCaption(data);
        await sock.sendMessage(from, { text: caption }, { quoted: msg });
    } catch (e) {
        console.error('!quotesanime:', e.message);
        await sock.sendMessage(from, {
            text: '❌ *Gagal mengambil quote anime.*\n\nCoba lagi beberapa detik ya.'
        }, { quoted: msg });
    }
}