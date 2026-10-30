#!/usr/bin/env node
import { ensurePm2Tunnel } from '../src/utils/ensure-pm2-tunnel.js';

const r = ensurePm2Tunnel({ quiet: false, manual: true });
if (!r.ok) {
    console.error('[tunnel] gagal memastikan luxx-tunnel online');
    process.exit(1);
}
console.log(`[tunnel] ${r.action}${r.reason ? ` (${r.reason})` : ''}`);