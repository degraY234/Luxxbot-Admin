import fs from 'fs';
import { execSync } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

let cachedFfmpeg = null;
let cachedFfprobe = null;

export function resolveFfmpegPath() {
    if (cachedFfmpeg) return cachedFfmpeg;
    if (process.env.FFMPEG_PATH) {
        const p = process.env.FFMPEG_PATH.trim();
        if (fs.existsSync(p)) {
            cachedFfmpeg = p;
            return p;
        }
    }
    for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
        if (fs.existsSync(p)) {
            cachedFfmpeg = p;
            return p;
        }
    }
    try {
        const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
        const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        const first = out.split(/\r?\n/).find((l) => l.trim());
        if (first && fs.existsSync(first.trim())) {
            cachedFfmpeg = first.trim();
            return cachedFfmpeg;
        }
    } catch { /* ignore */ }
    cachedFfmpeg = ffmpegStatic || 'ffmpeg';
    return cachedFfmpeg;
}

export function resolveFfprobePath() {
    if (cachedFfprobe) return cachedFfprobe;
    const ff = resolveFfmpegPath();
    const probe = ff.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    if (fs.existsSync(probe)) {
        cachedFfprobe = probe;
        return probe;
    }
    for (const p of ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe']) {
        if (fs.existsSync(p)) {
            cachedFfprobe = p;
            return p;
        }
    }
    cachedFfprobe = 'ffprobe';
    return cachedFfprobe;
}

export function configureFluentFfmpeg(ffmpeg) {
    const bin = resolveFfmpegPath();
    const probe = resolveFfprobePath();
    ffmpeg.setFfmpegPath(bin);
    if (probe) ffmpeg.setFfprobePath(probe);
    return bin;
}