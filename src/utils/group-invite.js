/**
 * Ambil kode invite grup WA dari URL atau teks mentah.
 * @param {string} input
 * @returns {string|null}
 */
export function extractGroupInviteCode(input = '') {
    const text = String(input).trim();
    if (!text) return null;

    const urlPatterns = [
        /chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i,
        /whatsapp\.com\/invite\/([A-Za-z0-9_-]+)/i
    ];
    for (const re of urlPatterns) {
        const m = text.match(re);
        if (m?.[1]) return sanitizeInviteCode(m[1]);
    }

    const raw = text.replace(/\s/g, '');
    if (/^[A-Za-z0-9_-]{18,32}$/.test(raw)) return raw;
    return null;
}

function sanitizeInviteCode(code = '') {
    return String(code).replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function mapJoinError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    const status = err?.output?.statusCode || err?.status || err?.data?.status;

    if (msg.includes('already') || msg.includes('participant') || status === 409) {
        return 'Bot sudah ada di grup itu.';
    }
    if (status === 410 || msg.includes('gone') || msg.includes('revoke') || msg.includes('expired')) {
        return 'Link undangan sudah tidak valid atau di-revoke admin.';
    }
    if (status === 403 || msg.includes('forbidden') || msg.includes('not-authorized')) {
        return 'Tidak diizinkan masuk — grup butuh persetujuan admin atau invite dibatasi.';
    }
    if (status === 400 || msg.includes('bad-request') || msg.includes('invalid') || msg.includes('not found')) {
        return 'Kode invite salah. Kirim link lengkap `https://chat.whatsapp.com/xxxxx`';
    }
    if (msg.includes('item-not-found')) {
        return 'Link undangan tidak ditemukan. Minta admin kirim link baru.';
    }
    const short = String(err?.message || 'error tidak diketahui').slice(0, 120);
    return `Gagal masuk grup: ${short}`;
}