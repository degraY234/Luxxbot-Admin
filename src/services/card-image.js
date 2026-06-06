import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

function escapeDrawtext(text) {
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:')
        .replace(/%/g, '\\%');
}

function wrapLines(text, maxLen = 28) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (test.length > maxLen && line) {
            lines.push(line);
            line = w;
        } else line = test;
    }
    if (line) lines.push(line);
    return lines.slice(0, 8);
}

function runFfmpegCard(width, height, bg, vf) {
    if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });
    const outPath = path.join('./temp', `card-${Date.now()}.png`);

    return new Promise((resolve, reject) => {
        const args = [
            '-y',
            '-f', 'lavfi',
            '-i', `color=c=${bg}:s=${width}x${height}`,
            '-vf', vf,
            '-frames:v', '1',
            outPath
        ];
        const proc = spawn(ffmpegPath, args, { windowsHide: true });
        let err = '';
        proc.stderr.on('data', (c) => { err += c.toString(); });
        proc.on('close', (code) => {
            if (code !== 0) return reject(new Error(err.slice(-300) || `ffmpeg exit ${code}`));
            try {
                const buf = fs.readFileSync(outPath);
                fs.unlinkSync(outPath);
                resolve(buf);
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Render kartu teks (about / quote) via ffmpeg spawn
 */
export function renderTextCard({ width = 720, height = 900, bg = '0x1a1a2e', lines = [], accent = '0xFF69B4' }) {
    const filters = [
        `drawbox=x=0:y=0:w=iw:h=8:color=${accent}@1:t=fill`,
        `drawbox=x=0:y=ih-8:w=iw:h=8:color=${accent}@1:t=fill`,
        `drawbox=x=0:y=0:w=8:h=ih:color=${accent}@0.8:t=fill`,
        `drawbox=x=iw-8:y=0:w=8:h=ih:color=${accent}@0.8:t=fill`
    ];

    let y = 80;
    for (const line of lines) {
        const safe = escapeDrawtext(line.slice(0, 60));
        const size = line.startsWith('╔') || line.includes('LUX') ? 40 : line.startsWith('─') || line.startsWith('╚') ? 26 : 34;
        filters.push(
            `drawtext=text='${safe}':fontsize=${size}:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=${y}`
        );
        y += size + 26;
        if (y > height - 80) break;
    }

    return runFfmpegCard(width, height, bg, filters.join(','));
}

export async function renderQuoteCard(quote, author) {
    const qLines = wrapLines(quote, 32);
    const lines = [
        '━━━━━━━━━━━━━━━━',
        '💬 QUOTE OF THE DAY',
        '━━━━━━━━━━━━━━━━',
        '',
        ...qLines.map((l) => `"${l}"`),
        '',
        '─ ─ ─ ─ ─ ─ ─ ─',
        `— ${author || 'Anonim'}`,
        '',
        '🌸 LuxxBot'
    ];
    return renderTextCard({ width: 720, height: 720, bg: '0x16213e', lines, accent: '0x00D4FF' });
}

