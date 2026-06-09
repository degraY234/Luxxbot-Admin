import fs from 'fs';
import path from 'path';
import { isRailwayRuntime } from './listen-port.js';

const SESSION_DIR = path.resolve('./session');
const CREDS_FILE = path.join(SESSION_DIR, 'creds.json');
const PERSIST_DIR = path.resolve(process.env.PERSIST_DIR || '/app/persist');
const SESSION_BACKUP_DIR = path.join(PERSIST_DIR, 'session-backup');
const CREDS_SNAPSHOT = path.join(PERSIST_DIR, 'data', 'wa-creds.json');

/** Hapus session lokal (+ backup) — dipakai setelah logout 401 agar QR muncul lagi */
export function clearWaSession({ includeBackup = true } = {}) {
    let removed = 0;
    try {
        if (fs.existsSync(SESSION_DIR)) {
            for (const name of fs.readdirSync(SESSION_DIR)) {
                const p = path.join(SESSION_DIR, name);
                try {
                    if (fs.statSync(p).isFile()) {
                        fs.unlinkSync(p);
                        removed += 1;
                    }
                } catch { /* ignore */ }
            }
        }
        if (includeBackup) {
            if (fs.existsSync(SESSION_BACKUP_DIR)) {
                for (const name of fs.readdirSync(SESSION_BACKUP_DIR)) {
                    const p = path.join(SESSION_BACKUP_DIR, name);
                    try {
                        if (fs.statSync(p).isFile()) fs.unlinkSync(p);
                    } catch { /* ignore */ }
                }
            }
            try {
                if (fs.existsSync(CREDS_SNAPSHOT)) fs.unlinkSync(CREDS_SNAPSHOT);
            } catch { /* ignore */ }
        }
        for (const f of [
            path.resolve('./temp/wa-qr.png'),
            path.resolve('./temp/wa-qr-meta.json')
        ]) {
            try {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            } catch { /* ignore */ }
        }
        if (removed > 0) {
            console.log(`\x1b[33m🗑️  Session WA dihapus (${removed} file) — scan QR baru di /pair\x1b[0m`);
        }
        return removed > 0;
    } catch (e) {
        console.error('❌ clearWaSession:', e.message);
        return false;
    }
}

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
        if (mounts.split('\n').some((l) => l.includes(' /app/persist '))) return true;
        const real = fs.realpathSync(PERSIST_DIR);
        if (real !== PERSIST_DIR && mounts.includes(real)) return true;
        return false;
    } catch {
        return null;
    }
}

function copyDirContents(src, dest) {
    if (!fs.existsSync(src)) return 0;
    fs.mkdirSync(dest, { recursive: true });
    let n = 0;
    for (const name of fs.readdirSync(src)) {
        const from = path.join(src, name);
        const to = path.join(dest, name);
        const st = fs.statSync(from);
        if (st.isDirectory()) continue;
        fs.copyFileSync(from, to);
        n += 1;
    }
    return n;
}

/** Backup session ke volume persist (survive redeploy). */
export function backupWaSession() {
    if (!fs.existsSync(SESSION_DIR)) return 0;
    fs.mkdirSync(SESSION_BACKUP_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(CREDS_SNAPSHOT), { recursive: true });
    const n = copyDirContents(SESSION_DIR, SESSION_BACKUP_DIR);
    if (fs.existsSync(CREDS_FILE)) {
        fs.copyFileSync(CREDS_FILE, CREDS_SNAPSHOT);
        fs.copyFileSync(CREDS_FILE, path.join(SESSION_BACKUP_DIR, 'creds.json'));
    }
    return n;
}

/** Restore session dari backup kalau creds hilang setelah redeploy. */
export function restoreSessionFromBackupIfNeeded() {
    if (isWaSessionPaired()) return false;

    fs.mkdirSync(SESSION_DIR, { recursive: true });

    const backupCreds = path.join(SESSION_BACKUP_DIR, 'creds.json');
    if (fs.existsSync(backupCreds)) {
        const n = copyDirContents(SESSION_BACKUP_DIR, SESSION_DIR);
        if (n > 0) {
            console.log(`\x1b[32m♻️  Session dipulihkan dari backup (${n} file)\x1b[0m`);
            return true;
        }
    }

    if (fs.existsSync(CREDS_SNAPSHOT)) {
        fs.copyFileSync(CREDS_SNAPSHOT, CREDS_FILE);
        copyDirContents(SESSION_BACKUP_DIR, SESSION_DIR);
        console.log('\x1b[32m♻️  Session dipulihkan dari wa-creds.json\x1b[0m');
        return true;
    }

    return false;
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
    const onPersistPath = sessionReal.includes('/app/persist') || sessionReal.includes(String(PERSIST_DIR));
    const hasBackup = fs.existsSync(path.join(SESSION_BACKUP_DIR, 'creds.json'))
        || fs.existsSync(CREDS_SNAPSHOT);

    return {
        paired,
        sessionFiles: files.length,
        credsBytes: getCredsSize(),
        sessionDir: SESSION_DIR,
        sessionResolved: sessionReal,
        persistDir: PERSIST_DIR,
        onPersistPath,
        hasBackup,
        volumeMounted: volumeMounted === true || (volumeMounted === false && onPersistPath ? true : volumeMounted),
        needsQr: !paired,
        pairHint: paired
            ? 'Session tersimpan — redeploy tanpa scan QR'
            : hasBackup
                ? 'Session backup ada — bot akan restore otomatis'
                : volumeMounted === false && !onPersistPath
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