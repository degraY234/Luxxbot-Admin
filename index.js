import fs from 'fs';
import express from 'express';
import { registerWaQrRoutes } from './src/services/wa-qr.js';
import { printPairLinkBanner } from './src/utils/startup-banner.js';
import { getListenPort, isRailwayRuntime } from './src/utils/listen-port.js';
import { getWaHealth } from './src/wa-status.js';
import { getSessionDiagnostics } from './src/utils/wa-session.js';
import { getYoutubeCookiesStatus } from './src/utils/youtube-cookies.js';
import { getPairLink } from './src/utils/startup-banner.js';

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
global.__luxxApp = app;
global.__luxxRadioMounted = false;

registerWaQrRoutes(app);
app.get('/health', async (_req, res) => {
    let radio = null;
    try {
        if (global.__luxxRadioMounted) {
            const { radio: r } = await import('./src/services/radio-server.js');
            radio = {
                current: r.current?.title || null,
                queue: r.queue.length,
                isPreparing: r.isPreparing,
                lastPrepareError: r.lastPrepareError?.message || null
            };
        }
    } catch { /* radio belum load */ }
    const wa = getWaHealth();
    const session = getSessionDiagnostics();
    res.json({
        ok: wa.connected && wa.handlersReady,
        uptime: Math.floor(process.uptime()),
        railway: isRailwayRuntime(),
        port: PORT,
        pairUrl: getPairLink(),
        wa,
        session,
        youtubeCookies: getYoutubeCookiesStatus(),
        radio,
        radioMounted: Boolean(global.__luxxRadioMounted),
        hint: !session.paired
            ? 'Scan QR di pairUrl — perintah WA tidak balas sebelum paired+connected'
            : !wa.connected
                ? 'Session ada tapi WA belum connect — tunggu reconnect'
                : !wa.handlersReady
                    ? 'WA connect, handler loading...'
                    : 'Bot siap'
    });
});

const server = app.listen(PORT, HOST, () => {
    const rail = isRailwayRuntime() ? ` · Railway PORT=${process.env.PORT}` : '';
    console.log(`\x1b[35m🚀 LuxxBot online (listen ${PORT}${rail})\x1b[0m`);
    if (isRailwayRuntime() && process.env.PORT && PORT !== Number(process.env.PORT)) {
        console.error('\x1b[31m❌ PORT SALAH: hapus RADIO_PORT=3920 di Railway Variables!\x1b[0m');
    }
    printPairLinkBanner();
    bootRadioAndDiscord();
    bootWaOnly();
});

server.on('error', (err) => {
    console.error('❌ HTTP server error:', err?.message || err);
});

async function bootRadioAndDiscord() {
    try {
        if (!global.__luxxRadioMounted) {
            const { startRadioServer, onRadioTrackChange, radio } = await import('./src/services/radio-server.js');
            startRadioServer(global.__luxxApp);
            const { bindRadioLyricsWatcher, prefetchQueueLyrics } = await import('./src/services/radio-lyrics.js');
            bindRadioLyricsWatcher(onRadioTrackChange);
            prefetchQueueLyrics(radio.queue, radio.current);
            global.__luxxRadioMounted = true;
            console.log('\x1b[32m✅ Radio / admin / watch aktif\x1b[0m');
        }
        const { startDiscordRadio } = await import('./src/services/discord-radio.js');
        startDiscordRadio();
    } catch (e) {
        console.error('❌ Boot radio/discord:', e?.message || e);
        setTimeout(bootRadioAndDiscord, 10_000);
    }
}

async function bootWaOnly() {
    try {
        const { startLuxxBot } = await import('./src/luxx-bot.js');
        await startLuxxBot();
    } catch (e) {
        console.error('❌ Boot WA error:', e?.message || e);
        setTimeout(bootWaOnly, 12_000);
    }
}