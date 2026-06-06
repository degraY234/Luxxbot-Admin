import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.RADIO_PORT || 3920);
const localUrl = `http://127.0.0.1:${port}`;
const logFile = path.join(root, 'temp', 'radio-tunnel.log');
const namedConfig = path.join(root, 'config', 'cloudflared.yml');
const envFile = path.join(root, '.env');

fs.mkdirSync(path.dirname(logFile), { recursive: true });

const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
let urlApplied = false;

function appendLog(line) {
    if (!line) return;
    fs.appendFileSync(logFile, `${line}\n`);
    process.stdout.write(`${line}\n`);
}

function findCloudflared() {
    const candidates = [
        'cloudflared',
        'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
        'C:\\Program Files\\cloudflared\\cloudflared.exe'
    ];
    for (const c of candidates) {
        if (c.includes('\\') && fs.existsSync(c)) return c;
        if (!c.includes('\\')) return c;
    }
    return null;
}

function setRadioPublicUrl(url) {
    if (!fs.existsSync(envFile)) return;
    const clean = url.replace(/\/$/, '');
    const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
    let found = false;
    const out = lines.map((line) => {
        if (/^\s*RADIO_PUBLIC_URL\s*=/.test(line)) {
            found = true;
            return `RADIO_PUBLIC_URL=${clean}`;
        }
        return line;
    });
    if (!found) out.push(`RADIO_PUBLIC_URL=${clean}`);
    const next = out.join('\n');
    const prev = lines.join('\n');
    if (next === prev) return;
    fs.writeFileSync(envFile, next.endsWith('\n') ? next : `${next}\n`);
    appendLog(`[luxx-tunnel] RADIO_PUBLIC_URL -> ${clean}`);
    const pm2 = spawn('pm2', ['restart', 'luxx', '--update-env'], {
        cwd: root,
        shell: true,
        stdio: 'ignore'
    });
    pm2.unref();
}

async function waitRadioHealth(maxMs = 180000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        try {
            const { data } = await axios.get(`${localUrl}/health`, { timeout: 2000 });
            if (data?.ok) return true;
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
}

function runCloudflared(args) {
    const bin = findCloudflared();
    if (!bin) {
        appendLog('[luxx-tunnel] cloudflared tidak ditemukan. Install: winget install Cloudflare.cloudflared');
        process.exit(1);
    }

    const child = spawn(bin, args, { cwd: root, shell: bin === 'cloudflared' });
    child.stdout.on('data', (buf) => {
        for (const line of buf.toString().split(/\r?\n/)) {
            appendLog(line);
            if (!urlApplied && urlPattern.test(line)) {
                urlApplied = true;
                setRadioPublicUrl(line.match(urlPattern)[0]);
            }
        }
    });
    child.stderr.on('data', (buf) => {
        for (const line of buf.toString().split(/\r?\n/)) {
            appendLog(line);
            if (!urlApplied && urlPattern.test(line)) {
                urlApplied = true;
                setRadioPublicUrl(line.match(urlPattern)[0]);
            }
        }
    });
    child.on('exit', (code, signal) => {
        appendLog(`[luxx-tunnel] cloudflared exit code=${code} signal=${signal || ''}`);
        process.exit(code ?? 1);
    });

    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
}

async function main() {
    appendLog('[luxx-tunnel] daemon start');

    if (fs.existsSync(namedConfig)) {
        appendLog(`[luxx-tunnel] Named tunnel: ${namedConfig}`);
        if (!(await waitRadioHealth(90000))) {
            appendLog(`[luxx-tunnel] Radio belum siap di ${localUrl} — tunnel tetap jalan`);
        }
        runCloudflared(['tunnel', '--config', namedConfig, 'run', '--metrics', '127.0.0.1:3921']);
        return;
    }

    appendLog('[luxx-tunnel] Quick tunnel. URL tetap: npm run radio:tunnel:setup');
    appendLog(`[luxx-tunnel] Menunggu radio di ${localUrl}...`);
    if (!(await waitRadioHealth(90000))) {
        appendLog('[luxx-tunnel] Radio belum merespons — tunnel tetap dicoba');
    }
    runCloudflared(['tunnel', '--url', localUrl, '--metrics', '127.0.0.1:3921']);
}

main().catch((e) => {
    appendLog(`[luxx-tunnel] error: ${e.message}`);
    process.exit(1);
});