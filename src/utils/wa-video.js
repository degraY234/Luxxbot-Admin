import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegPath);

function probe(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, data) => {
            if (err) return reject(err);
            const video = data.streams?.find(s => s.codec_type === 'video');
            const audio = data.streams?.find(s => s.codec_type === 'audio');
            resolve({
                videoCodec: video?.codec_name || '',
                audioCodec: audio?.codec_name || '',
                height: video?.height || 0,
                width: video?.width || 0
            });
        });
    });
}

function runFfmpeg(inputPath, outputPath, outputOptions) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions(outputOptions)
            .on('end', () => resolve(outputPath))
            .on('error', reject)
            .save(outputPath);
    });
}

/**
 * Pastikan MP4 bisa diputar di WhatsApp mobile (H.264 + AAC + faststart).
 */
export async function ensureWaCompatibleMp4(inputPath, outputPath, { maxHeight = 720 } = {}) {
    let meta = { videoCodec: '', audioCodec: '' };
    try {
        meta = await probe(inputPath);
    } catch (_) {}

    const isH264 = /h264|avc/i.test(meta.videoCodec);
    const isAac = /aac|mp4a/i.test(meta.audioCodec);
    const heightOk = !meta.height || meta.height <= maxHeight + 2;

    if (isH264 && isAac && heightOk) {
        try {
            await runFfmpeg(inputPath, outputPath, [
                '-c', 'copy',
                '-movflags', '+faststart',
                '-map_metadata', '-1'
            ]);
            return outputPath;
        } catch (_) {}
    }

    const scale = `scale='min(${maxHeight === 1080 ? 1920 : 1280},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease`;
    await runFfmpeg(inputPath, outputPath, [
        '-vf', scale,
        '-c:v', 'libx264',
        '-profile:v', 'baseline',
        '-level', '3.1',
        '-pix_fmt', 'yuv420p',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-map_metadata', '-1'
    ]);
    return outputPath;
}