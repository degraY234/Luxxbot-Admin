import { spawnSync } from 'child_process';
import { isRailwayRuntime, isRenderRuntime } from './listen-port.js';
import { isLuxxAutoTunnelEnabled } from './luxx-pm2-flags.js';

const PM2_OPTS = {
    windowsHide: true,
    shell: process.platform === 'win32'
};

function pm2Json() {
    try {
        const r = spawnSync('pm2', ['jlist'], {
            encoding: 'utf8',
            ...PM2_OPTS
        });
        if (r.status !== 0 || !r.stdout?.trim()) return [];
        const list = JSON.parse(r.stdout);
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function pm2Run(args) {
    return spawnSync('pm2', args, {
        cwd: process.cwd(),
        stdio: 'ignore',
        ...PM2_OPTS
    });
}

/** Pastikan luxx-tunnel online di PM2 lokal (skip Railway/VPS tanpa tunnel). */
export function ensurePm2Tunnel({ quiet = false, forceStart = false, manual = false } = {}) {
    if (isRailwayRuntime() || isRenderRuntime()) {
        return { ok: true, action: 'skip', reason: 'cloud' };
    }
    if (!manual && !forceStart && !isLuxxAutoTunnelEnabled()) {
        return { ok: true, action: 'skip', reason: 'manual_only' };
    }

    const list = pm2Json();
    const tunnel = list.find((p) => p?.name === 'luxx-tunnel');
    const luxx = list.find((p) => p?.name === 'luxx');
    const status = tunnel?.pm2_env?.status || 'missing';

    if (status === 'online' && !forceStart) {
        return { ok: true, action: 'already_online' };
    }

    if (!tunnel) {
        if (!quiet) console.log('[tunnel] daftarkan luxx-tunnel di PM2...');
        const r = pm2Run(['start', 'ecosystem.config.cjs', '--only', 'luxx-tunnel', '--update-env']);
        return { ok: r.status === 0, action: 'started_new' };
    }

    if (status === 'stopped' || status === 'stopping' || forceStart) {
        if (!quiet) console.log('[tunnel] nyalakan luxx-tunnel...');
        const cmd = status === 'online' ? ['restart', 'luxx-tunnel', '--update-env'] : ['start', 'luxx-tunnel', '--update-env'];
        const r = pm2Run(cmd);
        return { ok: r.status === 0, action: status === 'online' ? 'restarted' : 'started' };
    }

    if (status === 'errored' || status === 'waiting restart') {
        if (!quiet) console.log(`[tunnel] pulihkan luxx-tunnel (${status})...`);
        const r = pm2Run(['restart', 'luxx-tunnel', '--update-env']);
        return { ok: r.status === 0, action: 'recovered' };
    }

    return { ok: true, action: 'noop', status };
}