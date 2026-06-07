import fs from 'fs';
import path from 'path';

const CREDS_FILE = path.resolve('./session/creds.json');

/** Session sudah pernah scan QR? (ada di volume persist) */
export function isWaSessionPaired() {
    try {
        if (!fs.existsSync(CREDS_FILE)) return false;
        const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
        return Boolean(creds?.registered ?? creds?.me?.id ?? creds?.account?.details);
    } catch {
        return false;
    }
}