import { formatDarkJokeCaption } from '../services/quote-content.js';
import { fetchDarkJoke } from '../services/quote-fetch.js';

export async function handleDarkJokesCommand({ sock, from, msg }) {
    await sock.sendMessage(from, {
        text: '😈 Sedang menyiapkan dark joke...'
    }, { quoted: msg });

    try {
        const joke = await fetchDarkJoke();
        const caption = formatDarkJokeCaption(joke);
        await sock.sendMessage(from, { text: caption }, { quoted: msg });
    } catch (e) {
        console.error('!darkjokes:', e.message);
        await sock.sendMessage(from, {
            text: '❌ *Gagal mengambil dark joke.*\n\nCoba lagi nanti ya.'
        }, { quoted: msg });
    }
}