import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import { registerWaQrRoutes } from './src/services/wa-qr.js';
import { printPairLinkBanner } from './src/utils/startup-banner.js';
import { getListenPort, isRailwayRuntime, isRenderRuntime } from './src/utils/listen-port.js';
import { getWaHealth } from './src/wa-status.js';
import { getSessionDiagnostics } from './src/utils/wa-session.js';
import { getYoutubeCookiesStatus } from './src/utils/youtube-cookies.js';
import { getPairLink } from './src/utils/startup-banner.js';
import { applyLuxxAppCors } from './src/utils/app-cors.js';
import { getPublicUrlFromRequest } from './src/utils/request-public-url.js';
import { isHfConfigured, pullFromHfOnStartup, flushHfBeforeShutdown } from './src/utils/hf-storage.js';

process.on('uncaughtException', (err) => {
    console.error('❌ uncaughtException (server tetap jalan):', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ unhandledRejection (server tetap jalan):', reason);
});
process.on('SIGINT', async () => {
    console.log('\x1b[31m🛑 Graceful shutdown...\x1b[0m');
    try {
        const { clearRadioQueue } = await import('./src/services/radio-server.js');
        clearRadioQueue();
    } catch (_) {}
    try {
        const { stopDiscordRadio } = await import('./src/services/discord-radio.js');
        stopDiscordRadio?.();
    } catch (_) {}
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('\x1b[31m🛑 SIGTERM received...\x1b[0m');
    try {
        const { clearRadioQueue } = await import('./src/services/radio-server.js');
        clearRadioQueue();
    } catch (_) {}
    // Flush HF push terakhir sebelum container mati
    await flushHfBeforeShutdown();
    process.exit(0);
});

if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });

// ─── Hugging Face: pull session di startup (hanya kalau env var di-set) ─────
// Catatan: docker-entrypoint.sh juga sudah pull, ini sebagai fallback
// kalau bot dijalankan langsung (bukan via Docker)
if (isHfConfigured()) {
    pullFromHfOnStartup().catch(e => {
        console.warn('[hf] startup pull gagal (non-fatal):', e.message);
    });
}

const PORT = getListenPort();
const HOST = process.env.RADIO_BIND_HOST || '0.0.0.0';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
global.__luxxApp = app;
global.__luxxRadioMounted = false;

registerWaQrRoutes(app);

// CORS middleware for health
app.use((req, res, next) => {
    if (req.path !== '/health') return next();
    if (applyLuxxAppCors(req, res)) return;
    next();
});

app.get('/health', async (req, res) => {
    let radio = null;
    let publicUrl = getPublicUrlFromRequest(req);
    if (publicUrl) {
        try {
            if (/localhost|127\.0\.0\.1/i.test(new URL(publicUrl).hostname)) publicUrl = null;
        } catch {
            publicUrl = null;
        }
    }
    const localBase = `http://localhost:${PORT}`;
    try {
        if (global.__luxxRadioMounted) {
            const { radio: r } = await import('./src/services/radio-server.js');
            radio = {
                current: r.current?.title || null,
                queue: r.queue.length,
                isPreparing: r.isPreparing,
                sessionActive: r.sessionActive,
                lastPrepareError: r.lastPrepareError?.message || null
            };
        }
    } catch { /* radio belum load */ }
    const wa = getWaHealth();
    const session = getSessionDiagnostics();
    const httpUp = true;
    res.json({
        ok: httpUp,
        waOk: wa.connected && wa.handlersReady,
        uptime: Math.floor(process.uptime()),
        railway: isRailwayRuntime(),
        render: isRenderRuntime(),
        hfStorage: isHfConfigured(),
        hfRepo: isHfConfigured() ? process.env.HF_REPO : null,
        port: PORT,
        publicUrl,
        adminUrl: publicUrl ? `${publicUrl}/admin` : `${localBase}/admin`,
        localAdminUrl: `${localBase}/admin`,
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
    const rail = isRenderRuntime()
        ? ` · Render PORT=${process.env.PORT || PORT}`
        : isRailwayRuntime()
            ? ` · Railway PORT=${process.env.PORT}`
            : '';
    console.log(`\x1b[35m🚀 LuxxBot online (listen ${PORT}${rail})\x1b[0m`);
    if (isRailwayRuntime() && process.env.PORT && PORT !== Number(process.env.PORT)) {
        console.error('\x1b[31m❌ PORT SALAH: hapus RADIO_PORT=3920 di Railway Variables!\x1b[0m');
    }
    printPairLinkBanner();
    bootRadioAndDiscord();
    bootWaOnly();
    if (!isRailwayRuntime() && !isRenderRuntime()) {
        setTimeout(() => {
            import('./src/utils/ensure-pm2-tunnel.js')
                .then(({ ensurePm2Tunnel }) => ensurePm2Tunnel({ quiet: true }))
                .catch(() => {});
        }, 5000);
    }
});

server.on('error', (err) => {
    console.error('❌ HTTP server error:', err?.message || err);
});

let publicUrlSyncTimer = null;

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
        const { syncPublicUrl } = await import('./src/utils/radio-url.js');
        syncPublicUrl({ persist: true, quiet: false }).catch(() => {});
        if (!publicUrlSyncTimer) {
            publicUrlSyncTimer = setInterval(() => {
                syncPublicUrl({ persist: true, quiet: true }).catch(() => {});
            }, 120_000);
        }
        import('./src/utils/ytdlp-download.js')
            .then((m) => {
                const ytdlp = m.checkYtDlpAvailable?.();
                if (ytdlp && !ytdlp.ok) {
                    console.warn(`\x1b[33m⚠️ yt-dlp tidak ditemukan — radio !play gagal unduh. ${ytdlp.hint}\x1b[0m`);
                } else if (ytdlp?.ok) {
                    console.log(`\x1b[32m✅ yt-dlp: ${ytdlp.path}\x1b[0m`);
                }
            })
            .catch(() => {});
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