import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { discoverLivePublicBase, getLanIPv4 } from '../src/utils/radio-url.js';
import { getListenPort } from '../src/utils/listen-port.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tunnel = process.env.RADIO_PUBLIC_URL?.trim() || '(kosong)';
const lan = getLanIPv4();
const port = getListenPort();

console.log('');
console.log('=== URL Bot Luxx (untuk Luxx Music) ===');
console.log('Tunnel :', tunnel);
if (lan) console.log('LAN    :', `http://${lan}:${port}`, '(HP harus satu WiFi)');
console.log('App    :', tunnel ? `${tunnel}/app` : '-');
console.log('Health :', tunnel ? `${tunnel}/health` : '-');
console.log('');
const live = await discoverLivePublicBase();
if (live.source === 'tunnel') {
    console.log('Status : tunnel HIDUP ✓');
} else if (live.source === 'stale') {
    console.log('Status : tunnel MATI — jalankan: npm run tunnel:reset');
} else if (live.source === 'lan') {
    console.log('Status : cuma LAN — HP luar WiFi tidak bisa buka link !radio');
} else {
    console.log('Status : bot down atau tunnel belum siap');
}
if (tunnel && live.source !== 'tunnel') {
    try {
        await axios.get(`${tunnel.replace(/\/$/, '')}/health`, { timeout: 5000, validateStatus: () => true });
    } catch (e) {
        console.log('Probe :', e.code || e.message, '→ npm run tunnel:reset');
    }
}
console.log('');
console.log('Cek di browser HP — harus JSON ok:true');
console.log('Kalau error: npm run tunnel:reset');
console.log('Lalu      : npm run discovery:sync');
console.log('');

const manifest = path.join(root, 'portfolio', 'luxx-bot-url.json');
if (fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    console.log('Manifest lokal:', m.publicUrl, '| updated:', m.updatedAt);
}