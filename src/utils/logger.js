const LOG_DIR = './temp/logs';
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function ensureLogDir() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (_) {}
}

export function logInfo(tag, msg, meta = {}) {
    ensureLogDir();
    const line = JSON.stringify({ time: new Date().toISOString(), level: 'info', tag, msg, ...meta }) + '\n';
    appendLog(line);
}

export function logError(tag, err, meta = {}) {
    ensureLogDir();
    const msg = err?.message || String(err);
    const stack = err?.stack ? String(err.stack).slice(0, 2000) : null;
    const line = JSON.stringify({ time: new Date().toISOString(), level: 'error', tag, msg, stack, ...meta }) + '\n';
    appendLog(line);
}

export function logWarn(tag, msg, meta = {}) {
    ensureLogDir();
    const line = JSON.stringify({ time: new Date().toISOString(), level: 'warn', tag, msg, ...meta }) + '\n';
    appendLog(line);
}

function appendLog(line) {
    try {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl'));
        const today = new Date().toISOString().slice(0, 10);
        const target = path.join(LOG_DIR, `luxx-${today}.jsonl`);
        if (fs.existsSync(target) && fs.statSync(target).size > MAX_LOG_BYTES) {
            const rotated = target.replace('.jsonl', `.${Date.now()}.jsonl`);
            fs.renameSync(target, rotated);
        }
        fs.appendFileSync(target, line, 'utf8');
    } catch (_) {}
}
