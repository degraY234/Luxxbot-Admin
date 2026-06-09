import fs from 'fs';
import path from 'path';
import os from 'os';
import { imageCache, cooldowns, userAIContext, aiQueue } from '../state.js';
import { pruneExpiredCooldowns } from './cooldown.js';
import { getParseCacheStats } from '../services/sastra-api.js';
import { getLyricsCacheStats } from '../services/radio-lyrics.js';
import { getRadioListenUrl } from '../services/radio-server.js';
import { isRailwayRuntime } from './listen-port.js';

const TEMP_DIRS = ['./temp', './temp/dl', './temp/radio', './temp/lyrics-subs'];

function dirStats(dir) {
    const abs = path.resolve(dir);
    if (!fs.existsSync(abs)) return { path: abs, files: 0, bytes: 0, exists: false };
    let files = 0;
    let bytes = 0;
    try {
        for (const name of fs.readdirSync(abs)) {
            const p = path.join(abs, name);
            try {
                const st = fs.statSync(p);
                if (st.isFile()) {
                    files += 1;
                    bytes += st.size;
                }
            } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
    return { path: abs, files, bytes, exists: true };
}

function estimateImageCacheBytes() {
    let bytes = 0;
    for (const entry of imageCache.values()) {
        if (entry?.buffer?.length) bytes += entry.buffer.length;
    }
    return bytes;
}

export function buildSystemDiagnostics() {
    const mem = process.memoryUsage();
    pruneExpiredCooldowns();

    const temp = TEMP_DIRS.map(dirStats);
    const tempBytes = temp.reduce((n, d) => n + d.bytes, 0);
    const tempFiles = temp.reduce((n, d) => n + d.files, 0);

    const globals = {
        playSessions: Object.keys(global.playSession || {}).length,
        spSessions: Object.keys(global.spSession || {}).length,
        sastraSessions: Object.keys(global.sastraSession || {}).length,
        notes: Object.keys(global.notes || {}).length,
        reminders: Object.keys(global.reminders || {}).length,
        activeVotes: Object.keys(global.activeVotes || {}).length
    };

    return {
        node: process.version,
        pid: process.pid,
        platform: `${os.platform()} ${os.arch()}`,
        cpus: os.cpus().length,
        loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
        memory: {
            rssMb: Math.round(mem.rss / 1024 / 1024),
            heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
            externalMb: Math.round(mem.external / 1024 / 1024)
        },
        cache: {
            image: { entries: imageCache.size, max: 50, approxMb: Math.round(estimateImageCacheBytes() / 1024 / 1024 * 10) / 10 },
            cooldowns: { entries: cooldowns.size },
            aiContext: { users: userAIContext.size },
            aiQueue: { pending: aiQueue.length },
            sastra: getParseCacheStats(),
            lyrics: getLyricsCacheStats()
        },
        temp: { dirs: temp, totalFiles: tempFiles, totalMb: Math.round(tempBytes / 1024 / 1024 * 10) / 10 },
        sessions: globals,
        runtime: {
            railway: isRailwayRuntime(),
            radioUrl: getRadioListenUrl() || null
        },
        links: {
            admin: '/admin',
            radio: '/radio',
            watch: '/watch',
            portfolio: '/portfolio',
            pair: '/pair'
        }
    };
}

export function pruneRuntimeCaches() {
    pruneExpiredCooldowns();
    const before = imageCache.size;
    while (imageCache.size > 10) {
        const oldest = imageCache.keys().next().value;
        imageCache.delete(oldest);
    }
    return {
        imageCacheCleared: Math.max(0, before - imageCache.size),
        cooldownsRemaining: cooldowns.size
    };
}