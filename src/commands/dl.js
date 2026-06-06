import { downloadMediaFromUrl, parseDlArgs, getDlHelpText } from '../services/dl-media.js';

const WA_VIDEO_MAX = 64 * 1024 * 1024;
const WA_AUDIO_MAX = 16 * 1024 * 1024;

export async function handleDlCommand({ sock, from, msg, args }) {
    if (!args.length || args[0]?.toLowerCase() === 'help') {
        return sock.sendMessage(from, { text: getDlHelpText() }, { quoted: msg });
    }

    const { mode, url } = parseDlArgs(args);
    if (!url) {
        return sock.sendMessage(from, {
            text: '⚠️ Format:\n`!dl <link>` → video HD\n`!dl mp3 <link>` → audio MP3\n\n' + getDlHelpText()
        }, { quoted: msg });
    }

    const isAudio = mode === 'audio';
    await sock.sendMessage(from, {
        text: isAudio ? '🎵 Mengunduh & konversi MP3...' : '📥 Mengunduh video HD...'
    }, { quoted: msg });

    try {
        const result = await downloadMediaFromUrl(url, mode);
        let buffer = result.buffer;

        if (isAudio && buffer.length > WA_AUDIO_MAX) {
            throw new Error('File MP3 terlalu besar untuk WhatsApp (max ~16MB)');
        }
        if (!isAudio && buffer.length > WA_VIDEO_MAX) {
            throw new Error('Video terlalu besar untuk WhatsApp (max ~64MB)');
        }

        const caption =
            `✅ *${result.title}*\n` +
            `${isAudio ? '🎵 MP3' : '🎬 Video HD'} · ${(buffer.length / 1024 / 1024).toFixed(2)} MB\n` +
            `_LuxxBot Download_`;

        if (isAudio) {
            await sock.sendMessage(from, {
                audio: buffer,
                mimetype: result.mimetype || 'audio/mpeg',
                fileName: result.fileName,
                caption
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, {
                video: buffer,
                mimetype: result.mimetype || 'video/mp4',
                caption
            }, { quoted: msg });
        }
    } catch (e) {
        console.error('DL ERROR:', e.message);
        await sock.sendMessage(from, {
            text:
                `❌ Gagal unduh media.\n\n` +
                `💡 *Tips:*\n` +
                `• Link harus publik (bukan private)\n` +
                `• YouTube MP3: \`!dl mp3 <link yt>\`\n` +
                `• Video HD IG/TikTok: \`!dl <link>\`\n` +
                `• IG butuh login? Buka reel di Chrome lalu coba lagi\n` +
                `• Error: _${(e.message || 'unknown').slice(0, 150)}_`
        }, { quoted: msg });
    }
}