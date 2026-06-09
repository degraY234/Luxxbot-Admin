import fs from 'fs';
import path from 'path';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import {
    videoToSticker,
    videoToStickerWithText,
    addTextToImageV3,
    parseStickerArgs,
    getStickerHelpText,
    STICKER_STYLES
} from '../services/media.js';

const TEMP_DIR = './temp';

function ensureTemp() {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export async function handleStickerCommand({ sock, from, msg, args }) {
    const parsed = parseStickerArgs(args);
    if (parsed.help) {
        return sock.sendMessage(from, { text: getStickerHelpText() }, { quoted: msg });
    }

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const mediaMsg =
        msg.message?.imageMessage ||
        msg.message?.videoMessage ||
        quoted?.imageMessage ||
        quoted?.videoMessage;

    if (!mediaMsg) {
        return sock.sendMessage(from, {
            text:
                `⚠️ *Reply gambar atau video* lalu ketik perintah.\n\n` +
                getStickerHelpText()
        }, { quoted: msg });
    }

    const { style, topText, bottomText } = parsed;
    const meta = STICKER_STYLES[style] || STICKER_STYLES.premium;

    await sock.sendMessage(from, {
        text: `🎨 Membuat stiker *${meta.label}*${topText || bottomText ? ' + teks' : ''}...`
    }, { quoted: msg });

    try {
        ensureTemp();
        const isVideo = mediaMsg?.mimetype?.includes('video') || false;
        const stream = await downloadContentFromMessage(mediaMsg, isVideo ? 'video' : 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        if (isVideo) {
            const inputPath = path.join(TEMP_DIR, `input-${Date.now()}.mp4`);
            const outputPath = path.join(TEMP_DIR, `output-${Date.now()}.webp`);
            fs.writeFileSync(inputPath, buffer);
            if (topText || bottomText) await videoToStickerWithText(inputPath, outputPath, topText, bottomText);
            else await videoToSticker(inputPath, outputPath);
            const stickerBuffer = fs.readFileSync(outputPath);
            await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
            try { fs.unlinkSync(inputPath); fs.unlinkSync(outputPath); } catch (_) {}
            await sock.sendMessage(from, {
                text: `✅ Stiker video *${meta.label}* siap!`
            });
            return;
        }

        const finalBuffer = await addTextToImageV3(buffer, topText, bottomText, style).catch(async (err) => {
            console.error('addTextToImageV3 fallback:', err.message);
            return buffer;
        });
        const stiker = new Sticker(finalBuffer, {
            pack: meta.pack,
            author: 'LuxxBot',
            type: StickerTypes.CROPPED,
            quality: 90
        });
        await sock.sendMessage(from, { sticker: await stiker.toBuffer() }, { quoted: msg });
        await sock.sendMessage(from, {
            text: `✅ Stiker *${meta.label}* siap! _\`!s help\` untuk tema & teks_`
        });
    } catch (e) {
        console.error('STICKER ERROR:', e);
        await sock.sendMessage(from, {
            text:
                `❌ Gagal buat sticker.\n` +
                `_${(e.message || 'unknown').slice(0, 120)}_\n\n` +
                `💡 Reply gambar/video lalu:\n` +
                `\`!s\` · \`!s gold|Luxx\` · \`!s dua|Atas|Bawah\``
        }, { quoted: msg });
    }
}