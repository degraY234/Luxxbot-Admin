import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

let syncTimer = null;
let syncing = false;

function findGit() {
    if (process.platform !== 'win32') return 'git';
    for (const p of [
        'C:\\Program Files\\Git\\cmd\\git.exe',
        'C:\\Program Files (x86)\\Git\\cmd\\git.exe'
    ]) {
        if (fs.existsSync(p)) return p;
    }
    return 'git';
}

const GIT = findGit();

function git(args, cwd) {
    execFileSync(GIT, args, { cwd, stdio: 'pipe', windowsHide: true });
}

/** Push luxx-bot-url.json ke GitHub Pages — tanpa CMD window (execFileSync). */
export function scheduleDiscoveryGithubPush() {
    if (process.env.DISCOVERY_AUTO_PUSH === '0') return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncTimer = null;
        pushDiscoveryGithub().catch(() => {});
    }, 5_000);
}

async function pushDiscoveryGithub() {
    if (syncing) return;
    syncing = true;
    const root = process.cwd();
    const manifest = path.join(root, 'portfolio', 'luxx-bot-url.json');
    if (!fs.existsSync(manifest)) {
        syncing = false;
        return;
    }

    const jobs = [
        { name: 'portfolio', pagesDir: 'C:/Users/DoxxBorx/PortoDoxxborx', remote: 'https://github.com/degraY234/PortoDoxxborx.git' },
        { name: 'admin', pagesDir: 'C:/Users/DoxxBorx/Luxxbot-Admin-pages', remote: 'https://github.com/degraY234/Luxxbot-Admin.git' }
    ];

    for (const job of jobs) {
        try {
            if (!fs.existsSync(job.pagesDir)) {
                fs.mkdirSync(job.pagesDir, { recursive: true });
                git(['init'], job.pagesDir);
                try { git(['remote', 'add', 'origin', job.remote], job.pagesDir); } catch { /* exists */ }
            }
            try {
                git(['fetch', 'origin', 'main'], job.pagesDir);
                git(['checkout', '-B', 'main', 'origin/main'], job.pagesDir);
            } catch {
                git(['checkout', '-B', 'main'], job.pagesDir);
            }
            fs.copyFileSync(manifest, path.join(job.pagesDir, 'luxx-bot-url.json'));
            git(['add', 'luxx-bot-url.json'], job.pagesDir);
            try {
                git(['commit', '-m', 'chore: update luxx bot tunnel URL'], job.pagesDir);
                git(['push', 'origin', 'main'], job.pagesDir);
                console.log(`\x1b[32m📡 Discovery manifest pushed (${job.name})\x1b[0m`);
            } catch { /* no changes */ }
        } catch (e) {
            console.warn(`📡 Discovery push ${job.name}:`, e.message || e);
        }
    }
    syncing = false;
}