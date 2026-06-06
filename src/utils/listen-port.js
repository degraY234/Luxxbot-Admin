/** Port HTTP — Railway WAJIB pakai process.env.PORT, bukan 3920 */
export function isRailwayRuntime() {
    return Boolean(
        process.env.RAILWAY_ENVIRONMENT
        || process.env.RAILWAY_PUBLIC_DOMAIN
        || process.env.RAILWAY_STATIC_URL
    );
}

export function getListenPort() {
    if (isRailwayRuntime()) {
        const p = Number(process.env.PORT);
        if (Number.isFinite(p) && p > 0) return p;
    }
    const custom = Number(process.env.RADIO_PORT || process.env.PORT || 3920);
    return Number.isFinite(custom) && custom > 0 ? custom : 3920;
}