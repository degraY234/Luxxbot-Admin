import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveFfmpegPath } from './ffmpeg-path.js';
import { ensureWaCompatibleMp4 } from './wa-video.js';

const COOKIE_BROWSERS = (process.env.YTDLP_COOKIES_BROWSER || 'chrome,edge,firefox')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const YTDLP_TIMEOUT_MS = Number(process.env.YTDLP_TIMEOUT_MS || 240_000);

function runYtDlp(args, label = 'yt-dlp', timeoutMs = YTDLP_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', args, { windowsHide: true });
        let stderr = '';
        let stdout = '';
        const timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* ignore */ }
            reject(new Error(`${label}: timeout ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`${label}: ${err.message}`));
        });
        proc.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) return resolve(stdout.trim() || stderr.trim());
            reject(new Error((stderr || stdout).trim().slice(-500) || `${label} exit ${code}`));
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

function isYoutubeUrl(url) {
    return /youtube\.com|youtu\.be|music\.youtube/i.test(url);
}

function commonFlags(template) {
    const ffmpegLoc = resolveFfmpegPath();
    return [
        '-o', template,
        '--no-playlist', '--no-warnings', '--no-check-certificates',
        '--ffmpeg-location', ffmpegLoc,
        '--retries', '3',
        '--socket-timeout', '25',
        '--extractor-retries', '3',
        '--geo-bypass'
    ];
}

async function runYtDlpWithFallback(url, buildArgsList) {
    const list = Array.isArray(buildArgsList) ? buildArgsList : [buildArgsList];
    let lastErr;
    for (const item of list) {
        const attempts = [];
        if (isInstagramUrl(url)) {
            for (const browser of COOKIE_BROWSERS) {
                attempts.push({
                    label: `cookies-${browser}`,
                    args: ['--cookies-from-browser', browser, ...item(url)]
                });
            }
        }
        attempts.push({ label: 'default', args: item(url) });

        for (const { label, args } of attempts) {
            try {
                return await runYtDlp(args, label);
            } catch (e) {
                lastErr = e;
                const msg = e.message || '';
                console.error(`yt-dlp ${label} gagal:`, msg.slice(0, 200));
                if (!/instagram|login|cookie|empty media/i.test(msg) && label === 'default') break;
            }
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

    const buildAudioArgs = (extra = []) => (targetUrl) => [
        '-x', '--audio-format', 'mp3', '--audio-quality', '0',
        ...commonFlags(template),
        ...extra,
        targetUrl
    ];

    const builders = [buildAudioArgs()];
    if (isYoutubeUrl(url)) {
        builders.push(
            buildAudioArgs(['--extractor-args', 'youtube:player_client=android,web']),
            buildAudioArgs(['--extractor-args', 'youtube:player_client=tv_embedded,web']),
            buildAudioArgs(['--extractor-args', 'youtube:player_client=mweb,web'])
        );
    }

    await runYtDlpWithFallback(url, builders);

    const file = resolveOutputFile(base, ['mp3', 'm4a', 'opus', 'webm']);
    if (!file) throw new Error('File MP3 tidak ditemukan setelah unduhan');
    if (path.resolve(file) !== path.resolve(outputPath)) {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        fs.renameSync(file, outputPath);
    }
    return outputPath;
}

export async function downloadVideoHd(url, outputPath) {
    return downloadVideoRaw(url, outputPath, 1080);
}

export async function downloadVideoForWhatsApp(url, outputPath, { maxHeight = 720 } = {}) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const rawPath = outputPath.replace(/\.mp4$/i, '') + '.raw.mp4';

    await downloadVideoRaw(url, rawPath, maxHeight);

    try {
        await ensureWaCompatibleMp4(rawPath, outputPath, { maxHeight });
    } finally {
        if (fs.existsSync(rawPath) && path.resolve(rawPath) !== path.resolve(outputPath)) {
            try { fs.unlinkSync(rawPath); } catch (_) {}
        }
    }
    return outputPath;
}

async function downloadVideoRaw(url, outputPath, maxHeight = 1080) {
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
        : [
            `bestvideo[height<=${maxHeight}][vcodec^=avc][ext=mp4]+bestaudio[acodec^=mp4a][ext=m4a]`,
            `bestvideo[height<=${maxHeight}][ext=mp4]+bestaudio[ext=m4a]`,
            `bestvideo[height<=${maxHeight}]+bestaudio`,
            'best[ext=mp4]/best'
        ].join('/');

    const buildArgs = () => (targetUrl) => [
        '-f', format,
        '--merge-output-format', 'mp4',
        '--postprocessor-args', 'ffmpeg:-movflags +faststart',
        ...commonFlags(template),
        targetUrl
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

export async function downloadYoutubeToMp3(url, outputPath) {
    return downloadAudioToMp3(url, outputPath);
}

export async function getYtDlpTitle(url) {
    const ytClients = isYoutubeUrl(url)
        ? [['--extractor-args', 'youtube:player_client=android,web'], ['--extractor-args', 'youtube:player_client=tv_embedded,web']]
        : [[]];
    const attempts = [];
    for (const extra of ytClients) {
        attempts.push(['--print', 'title', '--no-warnings', ...extra, url]);
    }
    for (const browser of COOKIE_BROWSERS) {
        attempts.push(['--cookies-from-browser', browser, '--print', 'title', '--no-warnings', url]);
    }

    for (const args of attempts) {
        try {
            const out = await runYtDlp(args, 'title', 45_000);
            if (out?.trim()) return out.trim();
        } catch (_) {}
    }
    return 'Media';
}