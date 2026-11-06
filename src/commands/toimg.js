import fs from 'fs';
import path from 'path';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}

const TEMP_DIR = path.resolve(process.cwd(), 'temp');

function ensureTemp() {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export async function handleToimgCommand({ sock, from, msg }) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const stickerMsg = msg.message?.stickerMessage || quoted?.stickerMessage;

    if (!stickerMsg) {
        return await sock.sendMessage(from, {
            text: '⚠️ *Reply stiker* atau kirim stiker dengan caption `!toimg` untuk mengubahnya menjadi gambar!'
        }, { quoted: msg });
    }

    await sock.sendMessage(from, {
        text: '🖼️ Mengonversi stiker ke media...'
    }, { quoted: msg });

    ensureTemp();
    const id = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const inputPath = path.join(TEMP_DIR, `sticker_${id}.webp`);
    const isAnimated = Boolean(stickerMsg.isAnimated);
    const outputPath = path.join(TEMP_DIR, `media_${id}.${isAnimated ? 'mp4' : 'png'}`);

    try {
        const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        fs.writeFileSync(inputPath, buffer);

        await new Promise((resolve, reject) => {
            let cmd = ffmpeg(inputPath);
            if (isAnimated) {
                cmd
                    .outputOptions([
                        '-pix_fmt yuv420p',
                        '-movflags +faststart',
                        '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'
                    ])
                    .toFormat('mp4');
            } else {
                cmd
                    .outputOptions(['-vcodec png'])
                    .toFormat('image2');
            }

            cmd
                .save(outputPath)
                .on('end', () => resolve(outputPath))
                .on('error', (err) => reject(err));
        });

        const outBuffer = fs.readFileSync(outputPath);

        if (isAnimated) {
            await sock.sendMessage(from, {
                video: outBuffer,
                caption: '✅ *Stiker animasi berhasil dikonversi ke video!*',
                gifPlayback: true
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, {
                image: outBuffer,
                caption: '✅ *Stiker berhasil dikonversi ke gambar!*'
            }, { quoted: msg });
        }
    } catch (err) {
        console.error('!toimg error:', err);
        await sock.sendMessage(from, {
            text: '❌ Gagal mengonversi stiker. Pastikan stiker valid dan coba lagi.'
        }, { quoted: msg });
    } finally {
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
    }
}
