/**
 * Build artifact GitHub Pages:
 * - Portfolio di root (custom domain)
 * - Admin panel di /admin/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-pages');
const portfolioSrc = path.join(root, 'portfolio');
const adminSrc = path.join(root, 'admin');
const assetsSrc = path.join(root, 'assets', 'aboutlux-creator.jpg');

function rm(dir) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function cpDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) cpDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

rm(dist);
fs.mkdirSync(dist, { recursive: true });

cpDir(portfolioSrc, dist);
cpDir(adminSrc, path.join(dist, 'admin'));

const profileDest = path.join(dist, 'img', 'profile.jpg');
if (!fs.existsSync(profileDest) && fs.existsSync(assetsSrc)) {
    fs.mkdirSync(path.join(dist, 'img'), { recursive: true });
    fs.copyFileSync(assetsSrc, profileDest);
}

const cnameSrc = path.join(portfolioSrc, 'CNAME');
if (fs.existsSync(cnameSrc)) {
    fs.copyFileSync(cnameSrc, path.join(dist, 'CNAME'));
}

console.log('✅ Pages artifact → dist-pages/');
console.log('   · Portfolio → / (root)');
console.log('   · Admin     → /admin/');