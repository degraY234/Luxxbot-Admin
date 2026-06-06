import fs from 'fs';
import path from 'path';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import express from 'express';
import { registerWaQrRoutes } from './src/services/wa-qr.js';
import { printPairLinkBanner } from './src/utils/startup-banner.js';
import { getListenPort, isRailwayRuntime } from './src/utils/listen-port.js';

process.on('uncaughtException', (err) => {
    console.error('❌ uncaughtException (server tetap jalan):', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ unhandledRejection (server tetap jalan):', reason);
});

if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });

const PORT = getListenPort();
const HOST = process.env.RADIO_BIND_HOST || '0.0.0.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

registerWaQrRoutes(app);
app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        uptime: Math.floor(process.uptime()),
        railway: isRailwayRuntime(),
        port: PORT
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

let botWorker = null;

function launchBotWorker() {
    const workerFile = path.join(__dirname, 'src/bot-worker.js');
    botWorker = fork(workerFile, [], { stdio: 'inherit', env: process.env });
    botWorker.on('exit', (code, signal) => {
        console.error(`\x1b[33m⚠️ Bot worker stop (${code}/${signal}) — /pair tetap hidup, retry 20s\x1b[0m`);
        botWorker = null;
        setTimeout(launchBotWorker, 20000);
    });
}

function loadRadioAndBotInline() {
    import('./src/services/radio-server.js')
        .then(({ startRadioServer }) => {
            startRadioServer(app);
            console.log('\x1b[32m✅ Radio/admin/watch routes loaded\x1b[0m');
            return import('./src/bot.js');
        })
        .then(({ startBot }) => startBot())
        .catch((e) => {
            console.error('❌ Bot/radio load error (halaman /pair tetap hidup):', e?.message || e);
        });
}

if (isRailwayRuntime()) {
    console.log('\x1b[36m🚂 Railway mode: HTTP utama + bot worker terpisah\x1b[0m');
    launchBotWorker();
    if (process.env.RAILWAY_FULL_SERVICES === 'true') {
        setTimeout(() => {
            import('./src/services/radio-server.js')
                .then(({ startRadioServer }) => {
                    startRadioServer(app);
                    console.log('\x1b[32m✅ Radio/admin/watch loaded (RAILWAY_FULL_SERVICES)\x1b[0m');
                })
                .catch((e) => console.error('❌ Radio load:', e?.message || e));
        }, 45000);
    } else {
        console.log('\x1b[33m📻 Radio/admin/watch ditunda di Railway (fokus pair). Set RAILWAY_FULL_SERVICES=true untuk aktifkan.\x1b[0m');
    }
} else {
    loadRadioAndBotInline();
}