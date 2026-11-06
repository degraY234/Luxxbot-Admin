/**
 * Cek ffmpeg + file radio siap untuk Discord voice.
 * Jalankan: node scripts/test-discord-voice.mjs
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { resolveFfmpegPath } from '../src/utils/ffmpeg-path.js';

const RADIO_DIR = './temp/radio';
const FFMPEG = resolveFfmpegPath();

function findMp3() {
    if (!fs.existsSync(RADIO_DIR)) return null;
    const files = fs.readdirSync(RADIO_DIR)
        .filter((n) => n.endsWith('.mp3'))
        .map((n) => path.join(RADIO_DIR, n))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return files[0] || null;
}

function probeFfmpeg() {
    return new Promise((resolve) => {
        const proc = spawn(FFMPEG, ['-hide_banner', '-version'], { windowsHide: true });
        let out = '';
        proc.stdout.on('data', (c) => { out += c; });
        proc.stderr.on('data', (c) => { out += c; });
        proc.on('close', (code) => resolve({ code, out: out.split('\n')[0] }));
        proc.on('error', (e) => resolve({ code: -1, out: e.message }));
    });
}

function testOpusPipe(file, startSec = 0) {
    return new Promise((resolve) => {
        const args = ['-hide_banner', '-loglevel', 'error'];
        if (startSec > 0.5) args.push('-ss', String(startSec));
        args.push(
            '-i', path.resolve(file),
            '-vn', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2',
            '-f', 'ogg', 'pipe:1'
        );
        const proc = spawn(FFMPEG, args, { windowsHide: true });
        let bytes = 0;
        let stderr = '';
        proc.stdout.on('data', (c) => { bytes += c.length; });
        proc.stderr.on('data', (c) => { stderr += c.toString(); });
        proc.on('close', (code) => resolve({ code, bytes, stderr: stderr.trim() }));
        proc.on('error', (e) => resolve({ code: -1, bytes: 0, stderr: e.message }));
        setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
        }, 2500);
    });
}

const ff = await probeFfmpeg();
console.log(`ffmpeg: ${FFMPEG}`);
console.log(`version: ${ff.out || '(gagal)'}`);

const mp3 = findMp3();
if (!mp3) {
    console.log('❌ Tidak ada MP3 di temp/radio — putar lagu dulu lewat admin');
    process.exit(1);
}

const size = fs.statSync(mp3).size;
console.log(`file: ${mp3} (${size} bytes)`);

const pipe = await testOpusPipe(mp3, 0);
if (pipe.bytes > 2000 && pipe.code !== 0) {
    console.log(`✅ Opus pipe OK — ${pipe.bytes} bytes dalam 2.5s (ffmpeg exit ${pipe.code} setelah kill)`);
} else if (pipe.bytes > 2000) {
    console.log(`✅ Opus pipe OK — ${pipe.bytes} bytes`);
} else {
    console.log(`❌ Opus pipe gagal — bytes=${pipe.bytes} code=${pipe.code}`);
    if (pipe.stderr) console.log(pipe.stderr.slice(-400));
    process.exit(1);
}