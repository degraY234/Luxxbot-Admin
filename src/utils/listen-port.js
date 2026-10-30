/** Port HTTP — Render & Railway WAJIB pakai process.env.PORT, bukan 3920 */
export function isRailwayRuntime() {
    return Boolean(
        process.env.RAILWAY_ENVIRONMENT
        || process.env.RAILWAY_PUBLIC_DOMAIN
        || process.env.RAILWAY_STATIC_URL
    );
}

export function isRenderRuntime() {
    return Boolean(
        process.env.RENDER
        || process.env.RENDER_SERVICE_ID
        || process.env.RENDER_EXTERNAL_URL
        || process.env.RENDER_EXTERNAL_HOSTNAME
    );
}

export function isCloudRuntime() {
    return isRailwayRuntime() || isRenderRuntime() || Boolean(process.env.PERSIST_DIR && process.env.PERSIST_DIR.startsWith('/app/persist'));
}

export function getListenPort() {
    if (isRailwayRuntime() || isRenderRuntime()) {
        const p = Number(process.env.PORT);
        if (Number.isFinite(p) && p > 0) return p;
    }
    const custom = Number(process.env.RADIO_PORT || process.env.PORT || 3920);
    return Number.isFinite(custom) && custom > 0 ? custom : 3920;
}