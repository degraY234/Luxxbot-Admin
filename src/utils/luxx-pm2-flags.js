/** Cek flag .env — default mati (manual start saja). */
export function isTruthyEnv(name) {
    const v = String(process.env[name] || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

/** Hidup otomatis saat login Windows (pm2-boot). */
export function isLuxxAutoStartEnabled() {
    return isTruthyEnv('LUXX_AUTO_START');
}

/** luxx boleh nyalakan luxx-tunnel sendiri saat boot. */
export function isLuxxAutoTunnelEnabled() {
    if (isTruthyEnv('LUXX_SKIP_TUNNEL')) return false;
    return isTruthyEnv('LUXX_AUTO_TUNNEL');
}