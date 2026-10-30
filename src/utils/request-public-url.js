/** URL publik dari host request (tunnel yang benar-benar dipakai user). */
export function getPublicUrlFromRequest(req) {
    const raw = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim();
    const host = raw.split(':')[0].toLowerCase();
    if (/^[a-z0-9-]+\.trycloudflare\.com$/i.test(host)) {
        return `https://${host}`;
    }
    const configured = process.env.RADIO_PUBLIC_URL?.trim().replace(/\/$/, '') || '';
    if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) {
        return configured;
    }
    return null;
}