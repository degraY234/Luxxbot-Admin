import fs from 'fs';
import path from 'path';
import { isRailwayRuntime } from './listen-port.js';

const SESSION_DIR = path.resolve('./session');
const CREDS_FILE = path.join(SESSION_DIR, 'creds.json');
const PERSIST_DIR = path.resolve(process.env.PERSIST_DIR || '/app/persist');

/** Session sudah pernah scan QR? */
export function isWaSessionPaired() {
    try {
        if (!fs.existsSync(CREDS_FILE)) return false;
        const raw = fs.readFileSync(CREDS_FILE, 'utf8');
        if (raw.length < 20) return false;
        const creds = JSON.parse(raw);
        if (creds?.me?.id || creds?.me?.lid) return true;
        if (creds?.registered) return true;
        if (creds?.account) return true;
        if (creds?.signedIdentityKey && creds?.registrationId) return true;
        return false;
    } catch {
        return false;
    }
}

function isPersistVolumeMounted() {
    if (!isRailwayRuntime()) return null;
    try {
        const mounts = fs.readFileSync('/proc/self/mounts', 'utf8');
        return /\/app\/persist\s/.test(mounts) || mounts.split('\n').some((l) => l.includes(' /app/persist '));
    } catch {
        return null;
    }
}

function getCredsSize() {
    try {
        return fs.existsSync(CREDS_FILE) ? fs.statSync(CREDS_FILE).size : 0;
    } catch {
        return 0;
    }
}

export function getSessionDiagnostics() {
    let files = [];
    try {
        if (fs.existsSync(SESSION_DIR)) files = fs.readdirSync(SESSION_DIR);
    } catch { /* ignore */ }

    const paired = isWaSessionPaired();
    const volumeMounted = isPersistVolumeMounted();
    const sessionReal = fs.existsSync(SESSION_DIR)
        ? (fs.realpathSync?.(SESSION_DIR) || SESSION_DIR)
        : SESSION_DIR;

    return {
        paired,
        sessionFiles: files.length,
        credsBytes: getCredsSize(),
        sessionDir: SESSION_DIR,
        sessionResolved: sessionReal,
        persistDir: PERSIST_DIR,
        volumeMounted,
        needsQr: !paired,
        pairHint: paired
            ? 'Session tersimpan — redeploy tanpa scan QR'
            : volumeMounted === false
                ? 'WAJIB: Railway → Volume mount /app/persist lalu scan /pair sekali'
                : 'Buka /pair di laptop → scan QR sekali (session belum ada)'
    };
}

export function logSessionDiagnostics() {
    const d = getSessionDiagnostics();
    console.log(`\x1b[36m📂 Session: ${d.sessionFiles} file | paired=${d.paired} | creds=${d.credsBytes}B\x1b[0m`);
    console.log(`\x1b[36m   persist=${d.persistDir} | resolved=${d.sessionResolved}\x1b[0m`);

    if (d.volumeMounted === false) {
        console.log('\x1b[31m❌ Volume /app/persist TIDAK ter-mount — session hilang tiap redeploy!\x1b[0m');
        console.log('\x1b[33m   Railway → Service → Volumes → Mount path: /app/persist\x1b[0m');
    } else if (d.volumeMounted === true) {
        console.log('\x1b[32m✅ Volume /app/persist ter-mount\x1b[0m');
    }

    if (!d.paired) {
        console.log(`\x1b[33m⚠️  ${d.pairHint}\x1b[0m`);
    } else {
        console.log('\x1b[32m✅ Session ada — redeploy tanpa scan QR\x1b[0m');
    }
}