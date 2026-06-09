/**
 * Sinkronkan portfolio/ → repo PortoDoxxborx lokal + push GitHub.
 * Usage: node scripts/sync-portfolio-repo.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'portfolio');
const out = path.resolve('C:/Users/DoxxBorx/PortoDoxxborx');
const photoSrc = path.join(root, 'assets', 'aboutlux-creator.jpg');
const REMOTE = 'https://github.com/degraY234/PortoDoxxborx.git';

function cpDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const s = path.join(from, e.name);
        const d = path.join(to, e.name);
        if (e.isDirectory()) cpDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

function run(cmd) {
    console.log(`> ${cmd}`);
    execSync(cmd, { cwd: out, stdio: 'inherit', shell: true });
}

if (!fs.existsSync(out)) {
    fs.mkdirSync(out, { recursive: true });
}

cpDir(src, out);

// Hapus CNAME invalid (URL git, http, kosong)
const cname = path.join(out, 'CNAME');
if (fs.existsSync(cname)) {
    const text = fs.readFileSync(cname, 'utf8').trim();
    if (!text || text.includes('github.com') || text.startsWith('http')) {
        fs.unlinkSync(cname);
        console.log('🗑️  CNAME invalid dihapus');
    }
}

const profile = path.join(out, 'img', 'profile.jpg');
if ((!fs.existsSync(profile) || fs.statSync(profile).size < 512) && fs.existsSync(photoSrc)) {
    fs.mkdirSync(path.join(out, 'img'), { recursive: true });
    fs.copyFileSync(photoSrc, profile);
}

if (!fs.existsSync(path.join(out, '.git'))) {
    run('git init');
    run('git branch -M main');
    run(`git remote add origin ${REMOTE}`);
} else {
    try {
        execSync('git remote get-url origin', { cwd: out, stdio: 'pipe' });
    } catch {
        run(`git remote add origin ${REMOTE}`);
    }
}

run('git add .');
try {
    run('git commit -m "sync: update portfolio dari LuxxBot"');
} catch {
    console.log('ℹ️  Tidak ada perubahan baru untuk di-commit.');
}
run('git push -u origin main');

console.log('');
console.log('✅ Portfolio live: https://degray234.github.io/PortoDoxxborx/');
console.log('   Repo: https://github.com/degraY234/PortoDoxxborx');