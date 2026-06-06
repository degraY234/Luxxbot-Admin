/**
 * Export folder portfolio/ siap push ke repo GitHub baru.
 * Usage: node scripts/export-portfolio-repo.mjs [output-dir]
 * Default output: ../doxxborx-portfolio
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'portfolio');
const out = path.resolve(process.argv[2] || path.join(root, '..', 'doxxborx-portfolio'));
const photoSrc = path.join(root, 'assets', 'aboutlux-creator.jpg');

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

if (fs.existsSync(out)) {
    console.error(`❌ Folder sudah ada: ${out}`);
    console.error('   Hapus dulu atau tentukan path lain.');
    process.exit(1);
}

cpDir(src, out);

const imgDir = path.join(out, 'img');
const profile = path.join(imgDir, 'profile.jpg');
if (!fs.existsSync(profile) && fs.existsSync(photoSrc)) {
    fs.mkdirSync(imgDir, { recursive: true });
    fs.copyFileSync(photoSrc, profile);
    console.log('📸 Foto default disalin → img/profile.jpg');
}

console.log('');
console.log('✅ Portfolio siap di folder:');
console.log(`   ${out}`);
console.log('');
console.log('Langkah berikutnya:');
console.log('  1. Buat repo baru di GitHub (public)');
console.log('  2. cd ke folder di atas');
console.log('  3. git init && git add . && git commit -m "init portfolio"');
console.log('  4. git remote add origin https://github.com/USER/REPO.git');
console.log('  5. git branch -M main && git push -u origin main');
console.log('  6. GitHub → Settings → Pages → Source: GitHub Actions');
console.log('  7. Edit CNAME kalau domain kamu beda dari doxxborx.dev');
console.log('');