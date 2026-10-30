import fs from 'fs';
import path from 'path';
import { extractTunnelUrlsFromLogs, getLanIPv4 } from './radio-url.js';
import { scheduleDiscoveryGithubPush } from './discovery-github-sync.js';
import { getListenPort } from './listen-port.js';

let lastPayload = '';

function writeJson(filePath, payload) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

/** Tulis manifest URL tunnel (+ LAN) untuk APK discovery. */
export function publishBotDiscovery(publicUrl, { recentUrls } = {}) {
    const clean = String(publicUrl || '').trim().replace(/\/$/, '');
    if (!clean || /localhost|127\.0\.0\.1/i.test(clean)) return false;

    const recent = recentUrls?.length
        ? recentUrls
        : extractTunnelUrlsFromLogs()
            .map((u) => u.replace(/\/$/, ''))
            .filter((u) => u && !/localhost|127\.0\.0\.1/i.test(u))
            .slice(0, 10);

    const lan = getLanIPv4();
    const port = getListenPort();
    const lanUrl = lan ? `http://${lan}:${port}` : null;

    const payload = {
        publicUrl: clean,
        lanUrl,
        recentUrls: [...new Set([clean, ...recent])].slice(0, 10),
        updatedAt: new Date().toISOString()
    };

    const key = JSON.stringify(payload);
    if (key === lastPayload) return false;
    lastPayload = key;

    const root = process.cwd();
    for (const rel of ['portfolio/luxx-bot-url.json', 'admin/luxx-bot-url.json', 'temp/bot-config.json']) {
        try {
            writeJson(path.join(root, rel), payload);
        } catch { /* ignore */ }
    }

    scheduleDiscoveryGithubPush();
    return true;
}