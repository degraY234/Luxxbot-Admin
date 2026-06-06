import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';

const MAX_PTT_SEC = 120;

/**
 * Konversi MP3 → OGG Opus (format voice note WhatsApp).
 * Tanpa ini, ptt:true + audio/mpeg = "file bermasalah" di WA.
 */
export function mp3BufferToPttOgg(buffer) {
    return new Promise((resolve, reject) => {
        const id = crypto.randomBytes(6).toString('hex');
        const tmpIn = path.join(os.tmpdir(), `luxx-sp-${id}.mp3`);
        const tmpOut = path.join(os.tmpdir(), `luxx-sp-${id}.ogg`);

        const cleanup = () => {
            for (const f of [tmpIn, tmpOut]) {
                try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
            }
        };

        try {
            fs.writeFileSync(tmpIn, buffer);
        } catch (e) {
            return reject(new Error('Gagal tulis file sementara'));
        }

        ffmpeg(tmpIn)
            .noVideo()
            .audioCodec('libopus')
            .audioChannels(1)
            .audioFrequency(48000)
            .audioBitrate('64k')
            .format('ogg')
            .duration(MAX_PTT_SEC)
            .output(tmpOut)
            .on('end', () => {
                try {
                    const out = fs.readFileSync(tmpOut);
                    if (!out?.length) throw new Error('Konversi voice note kosong');
                    cleanup();
                    resolve(out);
                } catch (e) {
                    cleanup();
                    reject(e);
                }
            })
            .on('error', (err) => {
                cleanup();
                reject(new Error(`Konversi voice note gagal: ${err.message?.slice(0, 80) || 'ffmpeg error'}`));
            })
            .run();
    });
}