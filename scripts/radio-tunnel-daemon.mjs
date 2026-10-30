/**
 * PM2 luxx-tunnel — satu proses cloudflared, tanpa spawn CMD/pm2 loop.
 * Quick tunnel: update .env saja (TIDAK restart luxx otomatis).
 */
import { spawn, spawnSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { persistRadioPublicUrl } from '../src/utils/env-persist.js';
import { publishBotDiscovery } from '../src/utils/bot-discovery-publish.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.RADIO_PORT || 3920);
const localUrl = `http://127.0.0.1:${port}`;
const logFile = path.join(root, 'temp', 'radio-tunnel.log');
const namedConfig = path.join(root, 'config', 'cloudflared.yml');
fs.mkdirSync(path.dirname(logFile), { recursive: true });

const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
let lastTunnelUrl = '';
let activeChild = null;

function pm2LuxxOnline() {
    try {
        const r = spawnSync('pm2', ['jlist'], {
            cwd: root,
            encoding: 'utf8',
            windowsHide: true,
            shell: process.platform === 'win32'
        });
        if (r.status !== 0 || !r.stdout?.trim()) return false;
        const list = JSON.parse(r.stdout);
        const luxx = Array.isArray(list) ? list.find((p) => p?.name === 'luxx') : null;
        return luxx?.pm2_env?.status === 'online';
    } catch {
        return false;
    }
}

function appendLog(line) {
    if (!line) return;
    fs.appendFileSync(logFile, `${line}\n`);
    process.stdout.write(`${line}\n`);
}

function findCloudflared() {
    const candidates = [
        process.env.CLOUDFLARED_PATH?.trim(),
        'C:\\Program Files\\cloudflared\\cloudflared.exe',
        'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe'
    ].filter(Boolean);
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    try {
        const out = execSync('where cloudflared', {
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        const first = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l && fs.existsSync(l));
        if (first) return first;
    } catch { /* not in PATH */ }
    return null;
}

/** Tulis .env — luxx sync otomatis dari log tanpa restart. */
function applyTunnelUrl(rawUrl) {
    const clean = String(rawUrl || '').match(urlPattern)?.[0]?.replace(/\/$/, '');
    if (!clean || clean === lastTunnelUrl) return;
    lastTunnelUrl = clean;
    const { changed, fileWritten } = persistRadioPublicUrl(clean, { injectApp: false });
    if (changed) {
        appendLog(`[luxx-tunnel] RADIO_PUBLIC_URL -> ${clean}${fileWritten ? ' (.env)' : ''}`);
        try { publishBotDiscovery(clean); } catch { /* ignore */ }
        setTimeout(() => {
            if (!pm2LuxxOnline()) {
                appendLog('[luxx-tunnel] luxx tidak jalan — lewati restart');
                return;
            }
            try {
                spawnSync('pm2', ['restart', 'luxx', '--update-env'], {
                    cwd: root,
                    stdio: 'ignore',
                    windowsHide: true,
                    shell: process.platform === 'win32'
                });
                appendLog('[luxx-tunnel] luxx restarted — URL sinkron');
            } catch { /* ignore */ }
        }, 4000);
    }
}

async function waitRadioUp(maxMs = 120000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        try {
            const { status } = await axios.get(`${localUrl}/health`, {
                timeout: 2500,
                validateStatus: () => true
            });
            if (status === 200) return true;
        } catch { /* luxx belum listen */ }
        await new Promise((r) => setTimeout(r, 3000));
    }
    return false;
}

function runCloudflared(args) {
    const bin = findCloudflared();
    if (!bin) {
        appendLog('[luxx-tunnel] cloudflared tidak ditemukan. Install: winget install Cloudflare.cloudflared');
        process.exit(1);
    }

    if (activeChild) {
        try { activeChild.kill('SIGTERM'); } catch { /* ignore */ }
        activeChild = null;
    }

    appendLog(`[luxx-tunnel] cloudflared start: ${bin}`);

    const child = spawn(bin, args, {
        cwd: root,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    activeChild = child;

    const onLine = (line) => {
        appendLog(line);
        if (urlPattern.test(line)) {
            applyTunnelUrl(line);
        }
    };

    child.stdout?.on('data', (buf) => {
        for (const line of buf.toString().split(/\r?\n/)) onLine(line);
    });
    child.stderr?.on('data', (buf) => {
        for (const line of buf.toString().split(/\r?\n/)) onLine(line);
    });

    child.on('error', (err) => {
        appendLog(`[luxx-tunnel] cloudflared error: ${err.message}`);
    });

    child.on('exit', (code, signal) => {
        activeChild = null;
        appendLog(`[luxx-tunnel] cloudflared exit code=${code} signal=${signal || ''}`);
        // Biarkan PM2 yang restart (restart_delay 8s) — hindari tight loop + CMD spam
        process.exit(code ?? 1);
    });
}

function shutdown() {
    if (activeChild) {
        try { activeChild.kill('SIGTERM'); } catch { /* ignore */ }
    }
    process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function killOrphanCloudflared() {
    if (process.platform !== 'win32') return;
    try {
        execSync('taskkill /F /IM cloudflared.exe', { windowsHide: true, stdio: 'ignore' });
        appendLog('[luxx-tunnel] cloudflared lama dihentikan (satu tunnel saja)');
    } catch { /* tidak ada proses */ }
}

async function main() {
    killOrphanCloudflared();
    appendLog('[luxx-tunnel] daemon start (stable mode)');

    if (fs.existsSync(namedConfig)) {
        appendLog(`[luxx-tunnel] Named tunnel: ${namedConfig}`);
        await waitRadioUp(90000);
        runCloudflared(['tunnel', '--config', namedConfig, 'run', '--metrics', '127.0.0.1:3921']);
        return;
    }

    appendLog('[luxx-tunnel] Quick tunnel — URL tetap selama proses ini hidup');
    appendLog('[luxx-tunnel] Tip: named tunnel = URL permanen (scripts/radio-tunnel-named-setup.ps1)');
    await waitRadioUp(90000);
    runCloudflared(['tunnel', '--url', localUrl, '--metrics', '127.0.0.1:3921']);
}

main().catch((e) => {
    appendLog(`[luxx-tunnel] fatal: ${e.message}`);
    process.exit(1);
});