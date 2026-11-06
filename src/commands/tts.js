import fs from 'fs';
import path from 'path';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}

const TEMP_DIR = path.resolve(process.cwd(), 'temp');

function ensureTemp() {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const SUPPORTED_LANGS = new Set([
    'id', 'en', 'ja', 'ar', 'ko', 'zh', 'ru', 'fr', 'de', 'es', 'it'
]);

export async function handleTtsCommand({ sock, from, msg, args }) {
    if (!args || args.length === 0) {
        return await sock.sendMessage(from, {
            text:
                `🗣️ *TEXT-TO-SPEECH (TTS)*\n\n` +
                `Ubah teks menjadi pesan suara (voice note WhatsApp)!\n\n` +
                `*Format:*\n` +
                `• \`!tts <teks>\` (Otomatis bahasa Indonesia)\n` +
                `• \`!tts <kode_bahasa> <teks>\`\n\n` +
                `*Bahasa tersedia:* id, en, ja, ar, ko, zh, ru, fr, de, es\n\n` +
                `*Contoh:*\n` +
                `• \`!tts Halo semua selamat datang di grup!\`\n` +
                `• \`!tts en Hello everyone, welcome to the community!\`\n` +
                `• \`!tts ja Konnichiwa minna-san\``
        }, { quoted: msg });
    }

    let lang = 'id';
    let textToSpeak = '';

    const firstWord = args[0].toLowerCase();
    if (SUPPORTED_LANGS.has(firstWord) && args.length > 1) {
        lang = firstWord;
        textToSpeak = args.slice(1).join(' ').trim();
    } else {
        textToSpeak = args.join(' ').trim();
    }

    if (textToSpeak.length > 300) {
        return await sock.sendMessage(from, {
            text: '⚠️ Maksimal panjang teks adalah 300 karakter per permintaan voice note.'
        }, { quoted: msg });
    }

    ensureTemp();
    const id = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const mp3Path = path.join(TEMP_DIR, `tts_${id}.mp3`);
    const oggPath = path.join(TEMP_DIR, `tts_${id}.ogg`);

    try {
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(textToSpeak)}`;
        const res = await axios.get(ttsUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            responseType: 'arraybuffer',
            timeout: 10000
        });

        const rawBuffer = Buffer.from(res.data);
        fs.writeFileSync(mp3Path, rawBuffer);

        let finalAudioBuffer = rawBuffer;
        let finalMimeType = 'audio/mp4';

        if (ffmpegPath) {
            try {
                await new Promise((resolve, reject) => {
                    ffmpeg(mp3Path)
                        .audioCodec('libopus')
                        .audioChannels(1)
                        .audioFrequency(48000)
                        .toFormat('ogg')
                        .save(oggPath)
                        .on('end', () => resolve(oggPath))
                        .on('error', (err) => reject(err));
                });
                if (fs.existsSync(oggPath)) {
                    finalAudioBuffer = fs.readFileSync(oggPath);
                    finalMimeType = 'audio/ogg; codecs=opus';
                }
            } catch (_) {
                finalAudioBuffer = rawBuffer;
                finalMimeType = 'audio/mp4';
            }
        }

        await sock.sendMessage(from, {
            audio: finalAudioBuffer,
            mimetype: finalMimeType,
            ptt: true
        }, { quoted: msg });
    } catch (err) {
        console.error('!tts error:', err.message);
        await sock.sendMessage(from, {
            text: '❌ Gagal menghasilkan audio Text-to-Speech. Silakan coba lagi.'
        }, { quoted: msg });
    } finally {
        try { if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path); } catch (_) {}
        try { if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath); } catch (_) {}
    }
}
