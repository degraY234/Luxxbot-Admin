/**
 * Push luxx-bot-url.json ke GitHub Pages — JALANKAN MANUAL saja:
 *   npm run discovery:sync
 * (Tidak dipanggil otomatis — hindari CMD spam di Windows.)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.join(root, 'portfolio', 'luxx-bot-url.json');

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

if (!fs.existsSync(manifest)) {
    console.log('[discovery-sync] manifest belum ada, skip');
    process.exit(0);
}

const jobs = [
    {
        name: 'portfolio',
        pagesDir: 'C:/Users/DoxxBorx/PortoDoxxborx',
        remote: 'https://github.com/degraY234/PortoDoxxborx.git'
    },
    {
        name: 'admin',
        pagesDir: 'C:/Users/DoxxBorx/Luxxbot-Admin-pages',
        remote: 'https://github.com/degraY234/Luxxbot-Admin.git'
    }
];

for (const job of jobs) {
    try {
        if (!fs.existsSync(job.pagesDir)) {
            fs.mkdirSync(job.pagesDir, { recursive: true });
            git(['init'], job.pagesDir);
            git(['remote', 'add', 'origin', job.remote], job.pagesDir);
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
        } catch {
            console.log(`[discovery-sync] ${job.name}: tidak ada perubahan`);
            continue;
        }
        git(['push', 'origin', 'main'], job.pagesDir);
        console.log(`[discovery-sync] ${job.name}: pushed`);
    } catch (e) {
        console.warn(`[discovery-sync] ${job.name}: ${e.message || e}`);
    }
}