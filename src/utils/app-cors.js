/** CORS handler untuk web client (admin panel, radio player, watch player). */
export function isLuxxAppOrigin(origin) {
    if (!origin) return true;
    return (
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
        /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(origin)
    );
}

export function applyLuxxAppCors(req, res) {
    const origin = req.headers.origin;
    if (origin && isLuxxAppOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
    } else if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return true;
    }
    return false;
}