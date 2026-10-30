/**
 * Start luxx + luxx-tunnel, tunggu URL tunnel, sync semua URL otomatis.
 * npm run pm2:start:all
 */
import { spawnSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pm2(...args) {
    return spawnSync('pm2', args, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
}

function run(cmd) {
    console.log(`> ${cmd}`);
    const r = spawnSync(cmd, { cwd: root, shell: true, stdio: 'inherit', windowsHide: true });
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

function readLan() {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(root, 'portfolio', 'luxx-bot-url.json'), 'utf8'));
        return j.lanUrl || '';
    } catch {
        return '';
    }
}

async function main() {
    console.log('\n=== PM2 Start Luxx + Tunnel ===\n');

    if (process.platform === 'win32') {
        try {
            execSync('taskkill /F /IM cloudflared.exe', { stdio: 'ignore', windowsHide: true });
            console.log('[prep] cloudflared lama dihentikan');
        } catch { /* */ }
    }

    console.log('[1/5] pm2 start luxx + luxx-tunnel...');
    pm2('start', 'ecosystem.config.cjs', '--update-env');
    pm2('start', 'luxx-tunnel', '--update-env');

    console.log('[3/5] tunggu URL tunnel (maks 60 detik)...');
    let url = readEnvUrl();
    for (let i = 0; i < 20 && !url; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        url = readEnvUrl();
    }

    if (url) {
        console.log(`[4/5] URL: ${url}`);
        try { run('node scripts/sync-discovery-github.mjs'); } catch { /* */ }
        pm2('restart', 'luxx', '--update-env');
    } else {        console.warn('[4/5] URL belum ada — tunggu luxx-tunnel aktif');
    }

    console.log('[5/5] pm2 save...');
    pm2('save');

    const lan = readLan();
    console.log('\n=== Bot online ===\n');
    if (lan) console.log(`LAN Web: ${lan}/admin`);
    if (url) console.log(`Tunnel:  ${url}/admin`);
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});