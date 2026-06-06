import axios from 'axios';

const MAX_CHARS = 200;

export async function fetchTtsBuffer(text, lang = 'id') {
    const q = encodeURIComponent(text.slice(0, MAX_CHARS));
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${q}`;
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 20000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });
    if (!res.data?.byteLength) throw new Error('Audio kosong');
    return Buffer.from(res.data);
}

export async function handleTtsCommand({ sock, from, msg, args }) {
    const text = args.join(' ').trim();
    if (!text) {
        return sock.sendMessage(from, {
            text: '⚠️ Format: `!tts <teks>`\nContoh: `!tts Halo semuanya, selamat pagi!`'
        }, { quoted: msg });
    }
    if (text.length > MAX_CHARS) {
        return sock.sendMessage(from, {
            text: `⚠️ Maksimal ${MAX_CHARS} karakter untuk TTS.`
        }, { quoted: msg });
    }

    await sock.sendMessage(from, { text: '🎙️ Membuat voice note...' }, { quoted: msg });

    try {
        const buffer = await fetchTtsBuffer(text);
        await sock.sendMessage(from, {
            audio: buffer,
            mimetype: 'audio/mpeg',
            ptt: true,
            caption: `🎙️ *TTS LuxxBot*\n_"${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"_`
        }, { quoted: msg });
    } catch (e) {
        console.error('TTS ERROR:', e.message);
        await sock.sendMessage(from, {
            text: `❌ Gagal buat TTS.\n_${e.message?.slice(0, 80) || 'error'}_`
        }, { quoted: msg });
    }
}