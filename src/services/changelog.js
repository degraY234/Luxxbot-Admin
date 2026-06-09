import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHANGELOG_FILE = path.join(ROOT, 'data', 'changelog.json');
const SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;

let lastSyncAt = 0;
let lastSyncedHead = null;

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

function writeChangelogData(data) {
    fs.mkdirSync(path.dirname(CHANGELOG_FILE), { recursive: true });
    fs.writeFileSync(CHANGELOG_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        return pkg.version || '3.0.0';
    } catch {
        return '3.0.0';
    }
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function getGitHead() {
    try {
        const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: ROOT,
            encoding: 'utf8',
            windowsHide: true,
            timeout: 5000
        });
        if (result.status !== 0) return null;
        return result.stdout?.trim() || null;
    } catch {
        return null;
    }
}

function getGitCommits(max = 8) {
    try {
        const result = spawnSync(
            'git',
            ['log', '-n', String(max), '--pretty=format:%h|%s'],
            { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 5000 }
        );
        if (result.status !== 0 || !result.stdout) return [];
        return result.stdout.trim().split('\n').filter(Boolean).map((line) => {
            const sep = line.indexOf('|');
            if (sep < 0) return line;
            return `${line.slice(sep + 1).trim()} (${line.slice(0, sep)})`;
        });
    } catch {
        return [];
    }
}

function commitToHighlight(line) {
    return String(line || '')
        .replace(/\s+\([a-f0-9]+\)$/i, '')
        .replace(/^(feat|fix|chore|refactor|docs|style|test|perf)(\([^)]+\))?:\s*/i, '')
        .trim();
}

function mergeHighlights(existing = [], commits = [], max = 12) {
    const merged = [];
    const seen = new Set();

    const push = (item) => {
        const text = String(item || '').trim();
        if (!text) return;
        const key = text.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(text);
    };

    for (const line of commits) push(commitToHighlight(line));
    for (const item of existing) push(item);

    return merged.slice(0, max);
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
 * Sinkronkan data/changelog.json dari package.json + git (throttle per HEAD).
 */
export function syncChangelogIfNeeded(force = false) {
    const head = getGitHead();
    const pkgVer = readPackageVersion();
    const data = readChangelogData();
    const today = todayIso();

    const headChanged = head && head !== data.gitHead && head !== lastSyncedHead;
    const versionChanged = data.version !== pkgVer;
    const dateStale = data.updatedAt !== today;
    const throttleOk = force || Date.now() - lastSyncAt >= SYNC_MIN_INTERVAL_MS;

    if (!force && !headChanged && !versionChanged && !dateStale) return data;
    if (!throttleOk && !headChanged && !versionChanged) return data;

    const commits = getGitCommits(10);
    const next = {
        version: pkgVer,
        updatedAt: today,
        gitHead: head || data.gitHead || null,
        highlights: mergeHighlights(data.highlights, commits)
    };

    try {
        writeChangelogData(next);
        lastSyncAt = Date.now();
        lastSyncedHead = head;
        if (headChanged || versionChanged) {
            console.log(`📢 Changelog synced → v${pkgVer} (${today})${head ? ` @ ${head}` : ''}`);
        }
        return next;
    } catch (e) {
        console.log('changelog sync write fail:', e.message);
        return data;
    }
}

/**
 * Build changelog text for WhatsApp — auto-sync data/changelog.json lalu tampilkan
 */
export function buildChangelogText() {
    const data = syncChangelogIfNeeded(true);
    const pkgVer = readPackageVersion();
    const version = data.version || pkgVer;
    const gitLines = getGitCommits(6);
    const recentFiles = getRecentSrcChanges();
    const updated = data.updatedAt || todayIso();
    const head = data.gitHead || getGitHead();

    let text =
        `📢 *${process.env.BOT_NAME || 'LuxxBot'} CHANGELOGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🏷️ *Versi:* v${version} (package v${pkgVer})\n` +
        `📅 *Data update:* ${updated}\n`;
    if (head) text += `🔖 *Git:* ${head}\n`;
    text += '\n';

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

    text += `_Changelog otomatis dari package.json, git commit & file kode terbaru._\n`;
    text += `💖 *LuxxBot Premium — by DoxxBorx*`;
    return text;
}