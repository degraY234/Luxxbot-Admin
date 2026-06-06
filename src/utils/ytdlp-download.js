import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';

const COOKIE_BROWSERS = (process.env.YTDLP_COOKIES_BROWSER || 'chrome,edge,firefox')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function runYtDlp(args, label = 'yt-dlp') {
    return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', args, { windowsHide: true });
        let stderr = '';
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        proc.on('error', (err) => reject(new Error(`${label}: ${err.message}`)));
        proc.on('close', (code) => {
            if (code === 0) return resolve(stderr);
            reject(new Error(stderr.trim() || `${label} exited with code ${code}`));
        });
    });
}

function resolveOutputFile(basePath, extensions) {
    for (const ext of extensions) {
        const p = `${basePath}.${ext}`;
        if (fs.existsSync(p)) return p;
    }
    const dir = path.dirname(basePath);
    const prefix = path.basename(basePath);
    if (fs.existsSync(dir)) {
        const found = fs.readdirSync(dir).find((f) => f.startsWith(prefix + '.'));
        if (found) return path.join(dir, found);
    }
    return null;
}

function isInstagramUrl(url) {
    return /instagram\.com|instagr\.am/i.test(url);
}

async function runYtDlpWithFallback(url, buildArgs) {
    const attempts = [];
    if (isInstagramUrl(url)) {
        for (const browser of COOKIE_BROWSERS) {
            attempts.push({
                label: `cookies-${browser}`,
                args: ['--cookies-from-browser', browser, ...buildArgs(url)]
            });
        }
    }
    attempts.push({ label: 'default', args: buildArgs(url) });

    let lastErr;
    for (const { label, args } of attempts) {
        try {
            return await runYtDlp(args, label);
        } catch (e) {
            lastErr = e;
            const msg = e.message || '';
            if (!/instagram|login|cookie|empty media/i.test(msg) && label === 'default') break;
        }
    }
    throw lastErr || new Error('yt-dlp gagal');
}

/**
 * Download audio as MP3 from supported URL (YouTube, IG, TikTok, dll.)
 */
export async function downloadAudioToMp3(url, outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, path.basename(outputPath, '.mp3'));
    const template = `${base}.%(ext)s`;

    for (const f of [outputPath, `${base}.mp3`]) {
        if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch (_) {}
    }

    const buildArgs = () => [
        '-x', '--audio-format', 'mp3', '--audio-quality', '0',
        '-o', template, '--no-playlist', '--no-warnings', '--no-check-certificates',
        '--ffmpeg-location', ffmpegPath,
        '--retries', '5', '--socket-timeout', '60',
        '--extractor-retries', '3',
        url
    ];

    await runYtDlpWithFallback(url, buildArgs);

    const file = resolveOutputFile(base, ['mp3', 'm4a', 'opus', 'webm']);
    if (!file) throw new Error('File MP3 tidak ditemukan setelah unduhan');
    if (path.resolve(file) !== path.resolve(outputPath)) {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        fs.renameSync(file, outputPath);
    }
    return outputPath;
}

/**
 * Download video HD (max 1080p mp4) via yt-dlp
 */
export async function downloadVideoHd(url, outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(outputPath) || '.mp4';
    const base = path.join(dir, path.basename(outputPath, ext));
    const template = `${base}.%(ext)s`;

    try {
        for (const f of fs.readdirSync(dir).filter((x) => x.startsWith(path.basename(base)))) {
            fs.unlinkSync(path.join(dir, f));
        }
    } catch (_) {}

    const format = isInstagramUrl(url)
        ? 'best[ext=mp4]/best'
        : 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[ext=mp4]/best';

    const buildArgs = () => [
        '-f', format,
        '--merge-output-format', 'mp4',
        '-o', template, '--no-playlist', '--no-warnings', '--no-check-certificates',
        '--ffmpeg-location', ffmpegPath,
        '--retries', '5', '--socket-timeout', '60',
        '--extractor-retries', '3',
        url
    ];

    await runYtDlpWithFallback(url, buildArgs);

    const file = resolveOutputFile(base, ['mp4', 'mkv', 'webm']);
    if (!file) throw new Error('File video tidak ditemukan setelah unduhan');
    if (path.resolve(file) !== path.resolve(outputPath)) {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        fs.renameSync(file, outputPath);
    }
    return outputPath;
}

/** Alias untuk radio-server (kompatibilitas) */
export async function downloadYoutubeToMp3(url, outputPath) {
    return downloadAudioToMp3(url, outputPath);
}

export async function getYtDlpTitle(url) {
    const attempts = [
        ['--print', 'title', '--no-warnings', url],
        ...COOKIE_BROWSERS.map((b) => ['--cookies-from-browser', b, '--print', 'title', '--no-warnings', url])
    ];
    for (const args of attempts) {
        try {
            const out = await new Promise((resolve, reject) => {
                const proc = spawn('yt-dlp', args, { windowsHide: true });
                let stdout = '';
                proc.stdout.on('data', (c) => { stdout += c.toString(); });
                proc.on('close', (code) => (code === 0 ? resolve(stdout.trim()) : reject()));
            });
            if (out) return out;
        } catch (_) {}
    }
    return 'Media';
}