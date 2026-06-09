import { downloadMediaFromUrl, parseDlArgs, getDlHelpText } from '../services/dl-media.js';

const WA_VIDEO_MAX = 64 * 1024 * 1024;
const WA_AUDIO_MAX = 16 * 1024 * 1024;

export async function handleDlCommand({ sock, from, msg, args }) {
    if (!args.length || args[0]?.toLowerCase() === 'help') {
        return sock.sendMessage(from, { text: getDlHelpText() }, { quoted: msg });
    }

    const { mode, url, quality } = parseDlArgs(args);
    if (!url) {
        return sock.sendMessage(from, {
            text: '⚠️ Format:\n`!dl <link>` → video MP4\n`!dl mp3 <link>` → audio MP3\n`!dl mp4hd <link>` → video 1080p\n\n' + getDlHelpText()
        }, { quoted: msg });
    }

    const isAudio = mode === 'audio';
    const statusText = isAudio
        ? '🎵 Mengunduh & konversi MP3 (kualitas tinggi)...'
        : quality === 'hd'
            ? '📥 Mengunduh video MP4 1080p + optimasi HP...'
            : '📥 Mengunduh video MP4 720p + optimasi HP...';

    await sock.sendMessage(from, { text: statusText }, { quoted: msg });

    try {
        const result = await downloadMediaFromUrl(url, mode, quality);
        let buffer = result.buffer;

        if (isAudio && buffer.length > WA_AUDIO_MAX) {
            throw new Error('File MP3 terlalu besar untuk WhatsApp (max ~16MB)');
        }
        if (!isAudio && buffer.length > WA_VIDEO_MAX) {
            throw new Error('Video terlalu besar untuk WhatsApp (max ~64MB). Coba `!dl mp3 <link>` atau video lebih pendek.');
        }

        const typeLabel = isAudio
            ? '🎵 MP3 HQ'
            : (result.qualityLabel || '🎬 MP4');

        const caption =
            `✅ *${result.title}*\n` +
            `${typeLabel} · ${(buffer.length / 1024 / 1024).toFixed(2)} MB\n` +
            `_LuxxBot Download · kompatibel WhatsApp mobile_`;

        if (isAudio) {
            await sock.sendMessage(from, {
                audio: buffer,
                mimetype: result.mimetype || 'audio/mpeg',
                fileName: result.fileName || 'audio.mp3',
                caption
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, {
                video: buffer,
                mimetype: 'video/mp4',
                fileName: result.fileName || 'video.mp4',
                caption
            }, { quoted: msg });
        }
    } catch (e) {
        console.error('DL ERROR:', e.message);
        await sock.sendMessage(from, {
            text:
                `❌ Gagal unduh media.\n\n` +
                `💡 *Format:*\n` +
                `• \`!dl <link>\` → MP4 (YT/IG/TikTok)\n` +
                `• \`!dl mp3 <link yt>\` → MP3\n` +
                `• \`!dl mp4hd <link yt>\` → 1080p\n\n` +
                `_IG/TikTok: kirim link langsung. YouTube biasanya tanpa cookies._\n` +
                `_${(e.message || 'unknown').slice(0, 220)}_`
        }, { quoted: msg });
    }
}