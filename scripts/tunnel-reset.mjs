/**
 * Reset tunnel — satu cloudflared, URL baru. npm run tunnel:reset
 */
import 'dotenv/config';
import { spawnSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PM2_OPTS = { shell: process.platform === 'win32', windowsHide: true };

function run(cmd, cwd = root) {
    console.log(`> ${cmd}`);
    const r = spawnSync(cmd, { cwd, shell: true, stdio: 'inherit', windowsHide: true });
    if (r.status !== 0) throw new Error(`Gagal: ${cmd}`);
}

function readEnvUrl() {
    try {
        const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
        const m = env.match(/^\s*RADIO_PUBLIC_URL\s*=\s*(.+)\s*$/m);
        return m ? m[1].trim().replace(/\/$/, '') : '';
    } catch {
        return '';
    }
}

async function probeUrl(base) {
    try {
        const { data } = await axios.get(`${base.replace(/\/$/, '')}/health`, {
            timeout: 6000,
            validateStatus: (s) => s === 200
        });
        return Boolean(data?.ok);
    } catch {
        return false;
    }
}

function readTunnelUrlsFromLog() {
    const logPath = path.join(root, 'temp', 'radio-tunnel.log');
    try {
        const content = fs.readFileSync(logPath, 'utf8');
        const matches = [...content.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi)];
        return [...new Set(matches.map((m) => m[0]))].reverse();
    } catch {
        return [];
    }
}

function readLan() {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(root, 'portfolio', 'luxx-bot-url.json'), 'utf8'));
        return j.lanUrl || '';
    } catch {
        return '';
    }
}

console.log('\n=== Reset Cloudflare Tunnel ===\n');

if (process.platform === 'win32') {
    try {
        execSync('taskkill /F /IM cloudflared.exe', { stdio: 'ignore', windowsHide: true });
        console.log('[1/4] cloudflared lama dihentikan');
    } catch {
        console.log('[1/4] tidak ada cloudflared lama');
    }
} else {
    console.log('[1/4] skip kill (non-Windows)');
}

const prevUrl = readEnvUrl();
console.log('[2/4] restart luxx-tunnel...');
spawnSync('pm2', ['restart', 'luxx-tunnel', '--update-env'], { cwd: root, stdio: 'inherit', ...PM2_OPTS });

async function main() {
    console.log('[3/4] tunggu URL hidup (maks 45 detik)...');
    let url = '';
    for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const candidates = [...readTunnelUrlsFromLog(), readEnvUrl()].filter(Boolean);
        for (const candidate of candidates) {
            if (await probeUrl(candidate)) {
                url = candidate.replace(/\/$/, '');
                break;
            }
        }
        if (url && url !== prevUrl) break;
        if (url && !prevUrl) break;
    }
    if (!url) {
        console.warn('URL tunnel belum hidup — cek: pm2 logs luxx-tunnel');
    } else {
        const tag = url === prevUrl ? '(sama, sudah hidup)' : '(baru)';
        console.log(`[4/4] URL tunnel ${tag}: ${url}`);
        try { run('node scripts/sync-discovery-github.mjs'); } catch { /* */ }
        try { run('pm2 restart luxx --update-env'); } catch { /* */ }
    }

    const lan = readLan();
    console.log('\n=== Bot online ===\n');
    if (lan) console.log(`LAN Web: ${lan}/admin`);
    if (url) console.log(`Tunnel:  ${url}/admin`);
    if (url) console.log(`Pairing: ${url}/pair\n`);
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});