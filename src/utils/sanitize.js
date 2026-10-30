export function sanitizeInput(str, maxLen = 500) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>]/g, '').slice(0, maxLen);
}

export function sanitizeNumber(input, fallback = 0, min = -1e9, max = 1e9) {
    const n = Number(input);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

export function clampBuffer(buffer, maxBytes = 64 * 1024 * 1024) {
    if (!Buffer.isBuffer(buffer)) return buffer;
    if (buffer.length > maxBytes) {
        throw new Error(`Buffer terlalu besar (${(buffer.length / 1024 / 1024).toFixed(2)}MB, max ${maxBytes / 1024 / 1024}MB)`);
    }
    return buffer;
}
