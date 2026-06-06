/**
 * Setup Luxx Watch publik: pastikan bot + tunnel PM2 jalan, update .env, verifikasi.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.RADIO_PORT || 3920);
const localUrl = `http://127.0.0.1:${port}`;
const envFile = path.join(root, '.env');
const tunnelLog = path.join(root, 'temp', 'radio-tunnel.log');
const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;

function log(msg) {
    console.log(`[setup-watch] ${msg}`);
}

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { shell: true, cwd: root, stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
    });
}

async function waitLocalHealth(maxMs = 90000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        try {
            const { data } = await axios.get(`${localUrl}/health`, { timeout: 2500 });
            if (data?.ok) return true;
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
}

function readLatestTunnelUrl() {
    const logs = [
        tunnelLog,
        path.join(root, 'temp', 'radio-tunnel-setup.log'),
        path.join(root, 'temp', 'radio-tunnel-new.log')
    ];
    let last = null;
    for (const file of logs) {
        try {
            if (!fs.existsSync(file)) continue;
            const content = fs.readFileSync(file, 'utf8');
            const matches = [...content.matchAll(urlPattern)];
            if (matches.length) last = matches[matches.length - 1][0];
        } catch { /* skip */ }
    }
    return last;
}

function setRadioPublicUrl(url) {
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
    fs.writeFileSync(envFile, out.join('\n').endsWith('\n') ? out.join('\n') : `${out.join('\n')}\n`);
    log(`RADIO_PUBLIC_URL -> ${clean}`);
    return clean;
}

async function waitTunnelUrl(maxMs = 120000) {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        const url = readLatestTunnelUrl();
        if (url) {
            try {
                const { data } = await axios.get(`${url}/health`, { timeout: 8000 });
                if (data?.ok) return url;
            } catch { /* tunnel belum siap */ }
        }
        await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('Tunnel belum siap — cek: pm2 logs luxx-tunnel');
}

async function main() {
    log('mulai...');

    await run('pm2', ['restart', 'luxx', '--update-env']).catch(() =>
        run('pm2', ['start', 'ecosystem.config.cjs', '--only', 'luxx', '--update-env'])
    );

    if (!(await waitLocalHealth())) {
        throw new Error('Bot tidak hidup di port 3920');
    }
    log('bot lokal OK');

    await run('pm2', ['start', 'ecosystem.config.cjs', '--only', 'luxx-tunnel', '--update-env']).catch(() =>
        run('pm2', ['restart', 'luxx-tunnel', '--update-env'])
    );
    log('tunnel PM2 distart, menunggu URL...');

    const publicUrl = await waitTunnelUrl();
    setRadioPublicUrl(publicUrl);

    await run('pm2', ['restart', 'luxx', '--update-env']);
    await new Promise((r) => setTimeout(r, 6000));

    const watchUrl = `${publicUrl}/watch/`;
    log(`SELESAI: ${watchUrl}`);
    console.log('');
    console.log('========================================');
    console.log('  Luxx Watch SIAP');
    console.log('========================================');
    console.log(`  ${watchUrl}`);
    console.log('');
    console.log('  pm2 status  -> luxx + luxx-tunnel harus online');
    console.log('  Tes di WA: !watch');
    console.log('========================================');
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});