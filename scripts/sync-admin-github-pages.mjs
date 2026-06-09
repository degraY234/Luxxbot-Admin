/**
 * Sinkronkan admin/ → branch main (GitHub Pages Luxxbot-Admin).
 * Struktur Pages: index.html, css/, js/ di root — BUKAN folder admin/.
 *
 * Usage: node scripts/sync-admin-github-pages.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminSrc = path.join(root, 'admin');
const pagesDir = path.resolve('C:/Users/DoxxBorx/Luxxbot-Admin-pages');
const REMOTE = 'https://github.com/degraY234/Luxxbot-Admin.git';

function run(cmd, cwd = pagesDir) {
    console.log(`> ${cmd}`);
    execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function cpFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

function cpDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        const s = path.join(src, e.name);
        const d = path.join(dest, e.name);
        if (e.isDirectory()) cpDir(s, d);
        else cpFile(s, d);
    }
}

function wipeExceptGit(dir) {
    for (const name of fs.readdirSync(dir)) {
        if (name === '.git') continue;
        const p = path.join(dir, name);
        fs.rmSync(p, { recursive: true, force: true });
    }
}

if (!fs.existsSync(adminSrc)) {
    console.error('Folder admin/ tidak ditemukan.');
    process.exit(1);
}

if (!fs.existsSync(pagesDir)) {
    fs.mkdirSync(pagesDir, { recursive: true });
    run('git init', pagesDir);
    run('git remote add origin ' + REMOTE, pagesDir);
}

try {
    run('git fetch origin main');
    run('git checkout -B main origin/main');
} catch {
    run('git checkout -B main');
}

wipeExceptGit(pagesDir);

cpFile(path.join(adminSrc, 'index.html'), path.join(pagesDir, 'index.html'));
cpDir(path.join(adminSrc, 'css'), path.join(pagesDir, 'css'));
cpDir(path.join(adminSrc, 'js'), path.join(pagesDir, 'js'));

const nojekyll = path.join(adminSrc, '.nojekyll');
if (fs.existsSync(nojekyll)) {
    cpFile(nojekyll, path.join(pagesDir, '.nojekyll'));
} else {
    fs.writeFileSync(path.join(pagesDir, '.nojekyll'), '');
}

run('git add -A');
try {
    run('git commit -m "sync: update LuxxBot Admin panel dari admin/"');
} catch {
    console.log('Tidak ada perubahan baru untuk di-commit.');
}
run('git push origin main');

console.log('');
console.log('LuxxBot Admin live: https://degray234.github.io/Luxxbot-Admin/');
console.log('Repo main: https://github.com/degraY234/Luxxbot-Admin/tree/main');