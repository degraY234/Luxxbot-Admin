import axios from 'axios';
import { groqAI } from './ai.js';

const HTTP = {
    timeout: 12000,
    headers: {
        'User-Agent': 'LuxxBot/3.1 (WhatsApp)',
        Accept: 'application/json'
    }
};

async function translateMyMemory(text) {
    const q = String(text || '').trim().slice(0, 480);
    if (!q) return q;
    const { data } = await axios.get('https://api.mymemory.translated.net/get', {
        params: { q, langpair: 'en|id' },
        timeout: 9000,
        headers: HTTP.headers
    });
    const out = data?.responseData?.translatedText?.trim();
    if (!out || out.toUpperCase() === q.toUpperCase()) return null;
    if (/QUERY LENGTH LIMIT|MYMEMORY WARNING/i.test(out)) return null;
    return out;
}

async function toIndonesian(text, hint = 'teks') {
    const raw = String(text || '').trim();
    if (!raw) return raw;

    try {
        const mem = await translateMyMemory(raw);
        if (mem) return mem;
    } catch (e) {
        console.log('MyMemory skip:', e.message);
    }

    try {
        const ai = await Promise.race([
            groqAI(
                `Terjemahkan ke Bahasa Indonesia natural (${hint}). Hanya teks hasil:\n${raw.slice(0, 500)}`
            ),
            new Promise((r) => setTimeout(() => r(null), 5000))
        ]);
        if (ai?.trim()) return ai.trim().replace(/^["']|["']$/g, '');
    } catch {
        /* fallback EN */
    }

    return raw;
}

/** Kutipan dunia nyata — FavQs → Quotable → ZenQuotes → AdviceSlip */
export async function fetchRealWorldQuote() {
    const errors = [];

    try {
        const { data } = await axios.get('https://favqs.com/api/qotd', HTTP);
        const q = data?.quote;
        if (q?.body) {
            const text = await toIndonesian(q.body, 'kutipan');
            const tags = Array.isArray(q.tags) ? q.tags.join(', ') : '';
            return {
                text,
                author: q.author || 'Anonim',
                origin: tags ? `Kutipan inspiratif · topik: ${tags}` : 'Kutipan inspiratif hari ini'
            };
        }
    } catch (e) {
        errors.push(`FavQs: ${e.message}`);
    }

    try {
        const { data } = await axios.get('https://api.quotable.io/random', HTTP);
        if (data?.content) {
            const text = await toIndonesian(data.content, 'kutipan');
            const tags = Array.isArray(data.tags) ? data.tags.slice(0, 3).join(', ') : '';
            return {
                text,
                author: data.author || 'Anonim',
                origin: tags ? `Kutipan publik · topik: ${tags}` : 'Kutipan publik terkenal'
            };
        }
    } catch (e) {
        errors.push(`Quotable: ${e.message}`);
    }

    try {
        const { data } = await axios.get('https://zenquotes.io/api/random', {
            ...HTTP,
            timeout: 15000
        });
        const row = Array.isArray(data) ? data[0] : data;
        if (row?.q) {
            const text = await toIndonesian(row.q, 'kutipan');
            return {
                text,
                author: row.a || 'Anonim',
                origin: 'Kutipan terkenal · wisdom & motivasi'
            };
        }
    } catch (e) {
        errors.push(`ZenQuotes: ${e.message}`);
    }

    try {
        const { data } = await axios.get('https://api.adviceslip.com/advice', HTTP);
        if (data?.slip?.advice) {
            const text = await toIndonesian(data.slip.advice, 'nasihat');
            return {
                text,
                author: 'Anonim',
                origin: 'Nasihat kehidupan · kebijaksanaan sehari-hari'
            };
        }
    } catch (e) {
        errors.push(`AdviceSlip: ${e.message}`);
    }

    throw new Error('layanan kutipan tidak tersedia');
}

/** Quote anime — AnimeChan.io */
export async function fetchAnimeQuote() {
    try {
        const { data } = await axios.get('https://api.animechan.io/v1/quotes/random', HTTP);
        const row = data?.data;
        if (row?.content) {
            const quote = await toIndonesian(row.content, 'dialog anime');
            return {
                quote,
                character: row.character?.name || 'Karakter',
                anime: row.anime?.name || row.anime?.altName || 'Anime'
            };
        }
    } catch (e) {
        throw new Error('layanan quote anime tidak tersedia');
    }
    throw new Error('quote anime kosong');
}

/** Dark joke — JokeAPI */
export async function fetchDarkJoke() {
    const flags = 'nsfw,religious,political,racist,sexist,explicit';
    const url = `https://v2.jokeapi.dev/joke/Dark?type=twopart&blacklistFlags=${flags}&format=json`;
    const errors = [];

    try {
        const { data } = await axios.get(url, HTTP);
        if (data?.error) throw new Error(data.message || 'JokeAPI error');

        let setup = '';
        let punch = '';

        if (data.type === 'twopart') {
            setup = data.setup || '';
            punch = data.delivery || '';
        } else if (data.joke) {
            const parts = String(data.joke).split(/\n+/);
            setup = parts[0] || data.joke;
            punch = parts[1] || '…';
        }

        if (!setup) throw new Error('Joke kosong');

        const setupId = await toIndonesian(setup, 'setup joke');
        const punchId = await toIndonesian(punch, 'punchline joke');

        return {
            setup: setupId,
            punch: punchId,
            tag: data.category || 'humor gelap'
        };
    } catch (e) {
        errors.push(e.message);
    }

    try {
        const fallback = `https://v2.jokeapi.dev/joke/Any?type=twopart&blacklistFlags=${flags}&format=json`;
        const { data } = await axios.get(fallback, HTTP);
        if (!data?.error && data?.setup) {
            return {
                setup: await toIndonesian(data.setup, 'setup'),
                punch: await toIndonesian(data.delivery || '…', 'punchline'),
                tag: data.category || 'humor'
            };
        }
    } catch (e) {
        errors.push(e.message);
    }

    throw new Error('layanan joke tidak tersedia');
}