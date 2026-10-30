import fs from 'fs';
import path from 'path';

export function getEnvFilePath() {
    return path.join(process.cwd(), '.env');
}

/** Tulis RADIO_PUBLIC_URL ke process.env + file .env (idempotent). */
export function persistRadioPublicUrl(url) {
    const clean = String(url || '').trim().replace(/\/$/, '');
    if (!clean) return { changed: false, url: '' };

    const prev = process.env.RADIO_PUBLIC_URL?.trim().replace(/\/$/, '') || '';
    process.env.RADIO_PUBLIC_URL = clean;

    const envFile = getEnvFilePath();
    if (!fs.existsSync(envFile)) {
        return { changed: clean !== prev, url: clean, fileWritten: false };
    }

    const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
    let found = false;
    const out = lines.map((line) => {
        if (/^\s*RADIO_PUBLIC_URL\s*=/.test(line)) {
            found = true;
            return `RADIO_PUBLIC_URL=${clean}`;
        }
        return line;
    });
    if (!found) out.push(`RADIO_PUBLIC_URL=${clean}`);
    const next = out.join('\n');
    const prevFile = lines.join('\n');
    const fileChanged = next !== prevFile;
    if (fileChanged) {
        fs.writeFileSync(envFile, next.endsWith('\n') ? next : `${next}\n`);
    }

    const changed = clean !== prev || fileChanged;

    return {
        changed,
        url: clean,
        fileWritten: fileChanged
    };
}