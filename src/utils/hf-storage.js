/**
 * hf-storage.js — Hugging Face storage integration untuk LuxxBot
 *
 * Dipanggil dari dalam bot (wa-session.js, index.js) untuk push session
 * ke HF secara otomatis setelah QR scan / session update.
 *
 * Semua operasi async, non-blocking, dengan debounce bawaan.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HF_SYNC_SCRIPT = path.resolve(__dirname, '../../scripts/hf-sync.mjs');

const HF_TOKEN  = process.env.HF_TOKEN  || '';
const HF_REPO   = process.env.HF_REPO   || '';

/** Apakah HF storage dikonfigurasi? */
export function isHfConfigured() {
    return Boolean(HF_TOKEN && HF_REPO);
}

// ─── Debounce push ────────────────────────────────────────────────────────────
let _pushTimer = null;
let _pushPending = false;

/**
 * Schedule push ke HF (debounced, delay 30 detik).
 * Dipanggil setiap kali session/creds berubah.
 * Multiple panggilan dalam 30 detik → hanya 1 push yang jalan.
 */
export function schedulePushToHf(delayMs = 30_000) {
    if (!isHfConfigured()) return;
    _pushPending = true;
    if (_pushTimer) clearTimeout(_pushTimer);
    _pushTimer = setTimeout(async () => {
        _pushTimer = null;
        _pushPending = false;
        await pushToHfNow();
    }, delayMs);
}

/** Push langsung tanpa debounce (untuk shutdown SIGTERM). */
export async function pushToHfNow() {
    if (!isHfConfigured()) {
        console.log('\x1b[33m[hf] HF_TOKEN/HF_REPO tidak diset, skip push\x1b[0m');
        return false;
    }
    try {
        // Jalankan hf-sync.mjs push sebagai subprocess
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        console.log('\x1b[36m[hf] 📤 Pushing session ke Hugging Face...\x1b[0m');
        const { stdout, stderr } = await execFileAsync(
            process.execPath,
            ['--input-type=module', HF_SYNC_SCRIPT, 'push'],
            {
                env: process.env,
                timeout: 60_000,
                maxBuffer: 1024 * 512,
            }
        );
        if (stdout) console.log(stdout.trim());
        if (stderr) console.warn(stderr.trim());
        console.log('\x1b[32m[hf] ✅ Session berhasil di-push ke HF\x1b[0m');
        return true;
    } catch (e) {
        console.error('\x1b[31m[hf] ❌ Gagal push ke HF:', e.message, '\x1b[0m');
        return false;
    }
}

/** Pull dari HF (dipanggil saat startup). */
export async function pullFromHfOnStartup() {
    if (!isHfConfigured()) return false;
    try {
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        console.log('\x1b[36m[hf] 📥 Pulling session dari Hugging Face...\x1b[0m');
        const { stdout, stderr } = await execFileAsync(
            process.execPath,
            ['--input-type=module', HF_SYNC_SCRIPT, 'pull'],
            {
                env: process.env,
                timeout: 60_000,
                maxBuffer: 1024 * 512,
            }
        );
        if (stdout) console.log(stdout.trim());
        if (stderr) console.warn(stderr.trim());
        console.log('\x1b[32m[hf] ✅ Pull dari HF selesai\x1b[0m');
        return true;
    } catch (e) {
        console.warn('\x1b[33m[hf] ⚠️ Gagal pull dari HF (lanjut tanpa session):', e.message, '\x1b[0m');
        return false;
    }
}

/** Flush push pending sebelum shutdown. */
export async function flushHfBeforeShutdown() {
    if (_pushPending || _pushTimer) {
        if (_pushTimer) clearTimeout(_pushTimer);
        _pushTimer = null;
        _pushPending = false;
        console.log('\x1b[36m[hf] 🔄 SIGTERM detected — final push ke HF...\x1b[0m');
        await pushToHfNow();
    }
}

export default {
    isHfConfigured,
    schedulePushToHf,
    pushToHfNow,
    pullFromHfOnStartup,
    flushHfBeforeShutdown,
};
