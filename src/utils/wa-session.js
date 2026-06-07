import fs from 'fs';
import path from 'path';

const SESSION_DIR = path.resolve('./session');
const CREDS_FILE = path.join(SESSION_DIR, 'creds.json');

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

export function logSessionDiagnostics() {
    const persist = process.env.PERSIST_DIR || '(default)';
    let files = [];
    try {
        if (fs.existsSync(SESSION_DIR)) {
            files = fs.readdirSync(SESSION_DIR);
        }
    } catch { /* ignore */ }

    const paired = isWaSessionPaired();
    console.log(`\x1b[36m📂 Session: ${files.length} file | paired=${paired} | persist=${persist}\x1b[0m`);
    if (!paired) {
        console.log('\x1b[33m⚠️  Belum paired — buka /pair di laptop, scan QR sekali. Volume /app/persist wajib!\x1b[0m');
    } else {
        console.log('\x1b[32m✅ Session ada — redeploy tanpa scan QR\x1b[0m');
    }
}