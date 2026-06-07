import fs from 'fs';
import express from 'express';
import { registerWaQrRoutes } from './src/services/wa-qr.js';
import { printPairLinkBanner } from './src/utils/startup-banner.js';
import { getListenPort, isRailwayRuntime } from './src/utils/listen-port.js';
import { getWaHealth } from './src/wa-status.js';

process.on('uncaughtException', (err) => {
    console.error('❌ uncaughtException (server tetap jalan):', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ unhandledRejection (server tetap jalan):', reason);
});

if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });

const PORT = getListenPort();
const HOST = process.env.RADIO_BIND_HOST || '0.0.0.0';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

registerWaQrRoutes(app);
app.get('/health', async (_req, res) => {
    let radio = null;
    try {
        const { radio: r } = await import('./src/services/radio-server.js');
        radio = {
            current: r.current?.title || null,
            queue: r.queue.length,
            isPreparing: r.isPreparing
        };
    } catch { /* radio belum load */ }
    const wa = getWaHealth();
    res.json({
        ok: true,
        uptime: Math.floor(process.uptime()),
        railway: isRailwayRuntime(),
        port: PORT,
        wa,
        radio
    });
});

const server = app.listen(PORT, HOST, () => {
    const rail = isRailwayRuntime() ? ` · Railway PORT=${process.env.PORT}` : '';
    console.log(`\x1b[35m🚀 LuxxBot online (listen ${PORT}${rail})\x1b[0m`);
    if (isRailwayRuntime() && process.env.PORT && PORT !== Number(process.env.PORT)) {
        console.error('\x1b[31m❌ PORT SALAH: hapus RADIO_PORT=3920 di Railway Variables!\x1b[0m');
    }
    printPairLinkBanner();
});

server.on('error', (err) => {
    console.error('❌ HTTP server error:', err?.message || err);
});

function startFullStack({ usePairBot = false } = {}) {
    import('./src/services/radio-server.js')
        .then(({ startRadioServer }) => {
            startRadioServer(app);
            console.log('\x1b[32m✅ Radio / admin / watch / portfolio aktif\x1b[0m');
            if (usePairBot) return import('./src/bot-pair.js').then((m) => m.startPairBot());
            return import('./src/bot.js').then((m) => m.startBot());
        })
        .catch((e) => {
            console.error('❌ Startup error (HTTP /pair tetap hidup):', e?.message || e);
        });
}

if (isRailwayRuntime()) {
    console.log('\x1b[36m🚂 Railway: semua fitur aktif (satu proses)\x1b[0m');
    setTimeout(() => startFullStack({ usePairBot: true }), 1500);
} else {
    startFullStack({ usePairBot: false });
}