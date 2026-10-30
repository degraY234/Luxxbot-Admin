/**
 * Boot luxx + luxx-tunnel setelah login Windows — hanya jika LUXX_AUTO_START=1 di .env.
 * Default: tidak apa-apa (manual: npm run pm2:start).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFlag(name) {
    try {
        const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
        const m = env.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm'));
        if (!m) return false;
        const v = m[1].trim().replace(/^["']|["']$/g, '').toLowerCase();
        return v === '1' || v === 'true' || v === 'yes';
    } catch {
        return false;
    }
}

if (!readEnvFlag('LUXX_AUTO_START')) {
    process.exit(0);
}
const PM2_OPTS = {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
    shell: process.platform === 'win32'
};

function pm2(...args) {
    return spawnSync('pm2', args, PM2_OPTS);
}

function pm2Json() {
    try {
        const r = spawnSync('pm2', ['jlist'], {
            cwd: root,
            encoding: 'utf8',
            windowsHide: true,
            shell: process.platform === 'win32'
        });
        if (r.status !== 0 || !r.stdout?.trim()) return [];
        const list = JSON.parse(r.stdout);
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

import { setTimeout as delay } from 'timers/promises';

await delay(5000);

try {
    pm2('resurrect');

    const list = pm2Json();
    const luxx = list.find((p) => p?.name === 'luxx');
    const tunnel = list.find((p) => p?.name === 'luxx-tunnel');

    if (!luxx) {
        pm2('start', 'ecosystem.config.cjs', '--update-env');
    } else if (luxx.pm2_env?.status !== 'online') {
        pm2('start', 'luxx', '--update-env');
    }

    if (!tunnel) {
        pm2('start', 'ecosystem.config.cjs', '--only', 'luxx-tunnel', '--update-env');
    } else if (tunnel.pm2_env?.status !== 'online') {
        pm2('start', 'luxx-tunnel', '--update-env');
    }

    pm2('save');
} catch {
    // Jangan paksa start jika dump/PM2 belum siap.
}