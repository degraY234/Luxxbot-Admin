#!/usr/bin/env node
/** Smoke test untuk LuxxBot — health, radio config, search, admin ops. */
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.SMOKE_BASE_URL || process.env.RADIO_PUBLIC_URL || 'http://localhost:3920').replace(/\/$/, '');
const TIMEOUT_MS = 30_000;

const results = [];

function pass(name, detail = '') {
    results.push({ name, ok: true, detail });
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
    results.push({ name, ok: false, detail });
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function fetchJson(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || TIMEOUT_MS);
    try {
        const res = await fetch(url, { ...opts, signal: ctrl.signal });
        const data = await res.json().catch(() => ({}));
        return { res, data };
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    console.log(`\n=== LuxxBot Smoke Test ===`);
    console.log(`Base: ${BASE}\n`);

    try {
        const { res, data } = await fetchJson(`${BASE}/health`, { timeout: 12_000 });
        if (res.ok && data.ok) pass('health', data.publicUrl || BASE);
        else fail('health', `HTTP ${res.status}`);
    } catch (e) {
        fail('health', e.message);
        console.log('\nBot offline — jalankan: npm run pm2:start:all atau npm start\n');
        process.exit(1);
    }

    try {
        const { res, data } = await fetchJson(`${BASE}/radio/api/config`, { timeout: 12_000 });
        if (res.ok && data.ok) pass('radio config', data.lanUrl || data.publicUrl || 'ok');
        else fail('radio config');
    } catch (e) {
        fail('radio config', e.message);
    }

    try {
        const { res, data } = await fetchJson(`${BASE}/radio/api/search?q=lofi`, { timeout: TIMEOUT_MS });
        const n = data?.results?.length || 0;
        if (res.ok && n >= 1) pass('youtube search', `${n} hasil`);
        else fail('youtube search');
    } catch (e) {
        fail('youtube search', e.message);
    }

    try {
        const { res, data } = await fetchJson(`${BASE}/admin/api/ops`, {
            timeout: 12_000,
            headers: { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN || ''}` }
        });
        if (res.ok && data.ok) pass('admin ops', `runtime: ${data.deploy?.railway ? 'Railway' : 'PM2'}`);
        else if (res.status === 401) pass('admin ops', 'butuh token (skip)');
        else fail('admin ops', `HTTP ${res.status}`);
    } catch (e) {
        fail('admin ops', e.message);
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== ${failed.length ? 'GAGAL' : 'LULUS'}: ${results.length - failed.length}/${results.length} ===\n`);
    process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});