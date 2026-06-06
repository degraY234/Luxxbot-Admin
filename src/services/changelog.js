import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHANGELOG_FILE = path.join(ROOT, 'data', 'changelog.json');

function readChangelogData() {
    try {
        if (fs.existsSync(CHANGELOG_FILE)) {
            return JSON.parse(fs.readFileSync(CHANGELOG_FILE, 'utf8'));
        }
    } catch (e) {
        console.log('changelog.json read fail:', e.message);
    }
    return { version: '3.0.0', updatedAt: '', highlights: [] };
}

function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        return pkg.version || '3.0.0';
    } catch {
        return '3.0.0';
    }
}

function getGitCommits(max = 8) {
    try {
        const out = execSync('git log -n ' + max + ' --pretty=format:%s (%h)', {
            cwd: ROOT,
            encoding: 'utf8',
            windowsHide: true,
            timeout: 5000
        });
        return out.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

function getRecentSrcChanges() {
    try {
        const srcDir = path.join(ROOT, 'src');
        const files = [];
        const walk = (dir) => {
            for (const f of fs.readdirSync(dir)) {
                const p = path.join(dir, f);
                const st = fs.statSync(p);
                if (st.isDirectory()) walk(p);
                else if (f.endsWith('.js')) files.push({ p, m: st.mtimeMs });
            }
        };
        walk(srcDir);
        files.sort((a, b) => b.m - a.m);
        return files.slice(0, 5).map((f) => path.relative(ROOT, f.p).replace(/\\/g, '/'));
    } catch {
        return [];
    }
}

/**
 * Build changelog text for WhatsApp — updates when data/changelog.json or git changes
 */
export function buildChangelogText() {
    const data = readChangelogData();
    const pkgVer = readPackageVersion();
    const version = data.version || pkgVer;
    const gitLines = getGitCommits(6);
    const recentFiles = getRecentSrcChanges();
    const updated = data.updatedAt || new Date().toISOString().slice(0, 10);

    let text =
        `📢 *${process.env.BOT_NAME || 'LuxxBot'} CHANGELOGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🏷️ *Versi:* v${version} (package v${pkgVer})\n` +
        `📅 *Data update:* ${updated}\n\n`;

    if (data.highlights?.length) {
        text += `✨ *Highlight fitur:*\n`;
        data.highlights.forEach((h, i) => {
            text += `${i + 1}. ${h}\n`;
        });
        text += '\n';
    }

    if (gitLines.length) {
        text += `🔧 *Commit terbaru (git):*\n`;
        gitLines.forEach((line, i) => {
            text += `${i + 1}. ${line}\n`;
        });
        text += '\n';
    }

    if (recentFiles.length) {
        text += `📂 *File kode terakhir disentuh:*\n`;
        recentFiles.forEach((f) => { text += `• ${f}\n`; });
        text += '\n';
    }

    text += `_Changelog di-generate otomatis. Edit \`data/changelog.json\` tiap update besar._\n`;
    text += `💖 *LuxxBot Premium — by DoxxBorx*`;
    return text;
}