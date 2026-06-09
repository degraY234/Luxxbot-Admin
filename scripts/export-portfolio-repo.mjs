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

const force = process.argv.includes('--force');
const extraArgs = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const resolvedOut = path.resolve(extraArgs[0] || path.join(root, '..', 'doxxborx-portfolio'));

if (fs.existsSync(resolvedOut) && !force) {
    console.error(`❌ Folder sudah ada: ${resolvedOut}`);
    console.error('   Pakai: npm run sync:portfolio  (update PortoDoxxborx)');
    console.error('   Atau:  node scripts/export-portfolio-repo.mjs --force [folder]');
    process.exit(1);
}

const out = resolvedOut;

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
console.log('⚠️  JANGAN git init di folder "Project Bot Wa" — itu repo LuxxBot!');
console.log('');
console.log('PowerShell (jalankan di folder export di atas):');
console.log('  cd "' + out + '"');
console.log('  git init');
console.log('  git add .');
console.log('  git commit -m "init portfolio"');
console.log('  git remote add origin https://github.com/degraY234/PortoDoxxborx.git');
console.log('  git branch -M main');
console.log('  git push -u origin main');
console.log('');
console.log('Atau dari Project Bot Wa cukup:  npm run sync:portfolio');
console.log('');