/**
 * Bot WhatsApp — startup ringan dulu, fitur berat setelah WA online.
 */
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { publishWaQr } from './services/wa-qr.js';
import { setWaConnection, setWaHandlersReady, waStatus } from './wa-status.js';
import { isWaSessionPaired, logSessionDiagnostics } from './utils/wa-session.js';

const BOT_NAME = process.env.BOT_NAME || 'LuxxBot';

let sock = null;
let isStarting = false;
let reconnectTimer = null;
let servicesLoaded = false;
let handlerWatchdog = null;
let reconnectCount = 0;

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function teardownSocket() {
    if (!sock) return;
    try { sock.end(); } catch { /* ignore */ }
    sock = null;
}

async function loadServicesAndHandlers(activeSock) {
    if (!activeSock) return;
    try {
        await import('./globals.js');
        const [
            { registerMessageHandler },
            { registerGroupEventHandler },
            { startDiscordRadio },
            { setDailyFactSocket, startDailyFactScheduler },
            { getOrCreateRoom }
        ] = await Promise.all([
            import('./handlers/messages.js'),
            import('./handlers/group-events.js'),
            import('./services/discord-radio.js'),
            import('./services/daily-fact.js'),
            import('./services/w2g.js')
        ]);

        if (global.__luxxApp && !global.__luxxRadioMounted) {
            const { startRadioServer } = await import('./services/radio-server.js');
            startRadioServer(global.__luxxApp);
            global.__luxxRadioMounted = true;
            console.log('\x1b[32m✅ Radio / admin / watch aktif\x1b[0m');
        }

        const { state } = await import('./state.js');
        state.isSleeping = false;

        startDiscordRadio();
        registerMessageHandler(activeSock);
        registerGroupEventHandler(activeSock);
        setDailyFactSocket(activeSock);
        startDailyFactScheduler();

        getOrCreateRoom()
            .then((room) => console.log(`\x1b[35m📻 W2G: ${room.url}\x1b[0m`))
            .catch((e) => console.error('❌ W2G:', e.message));

        servicesLoaded = true;
        setWaHandlersReady(true);
        reconnectCount = 0;
        console.log('\x1b[32m✅ WhatsApp ONLINE — !menu !play !radio siap\x1b[0m');
    } catch (e) {
        console.error('❌ Load services:', e?.message || e);
        setWaHandlersReady(false);
        setTimeout(() => loadServicesAndHandlers(activeSock), 8000);
    }
}

function startHandlerWatchdog() {
    if (handlerWatchdog) return;
    handlerWatchdog = setInterval(() => {
        if (sock && waStatus.connection === 'open' && !waStatus.handlersReady) {
            loadServicesAndHandlers(sock).catch(() => {});
        }
    }, 20_000);
}

function scheduleReconnect(delayMs = 5000) {
    if (reconnectTimer) return;
    reconnectCount += 1;
    const wait = Math.min(delayMs + reconnectCount * 2000, 45_000);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startLuxxBot().catch((e) => console.error('❌ reconnect:', e?.message || e));
    }, wait);
}

export async function startLuxxBot() {
    if (isStarting) return;
    isStarting = true;

    try {
        logSessionDiagnostics();
        setWaConnection('connecting');
        setWaHandlersReady(false);

        const paired = isWaSessionPaired();
        console.log(paired
            ? '\x1b[36m🤖 Connect WhatsApp (session tersimpan)\x1b[0m'
            : '\x1b[33m🤖 Tunggu scan QR di /pair — container tetap hidup\x1b[0m');

        clearReconnectTimer();
        teardownSocket();

        const { state: authState, saveCreds } = await useMultiFileAuthState('./session');
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: authState,
            browser: [BOT_NAME, 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            connectTimeoutMs: 60_000,
            keepAliveIntervalMs: 30_000
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr && !isWaSessionPaired()) {
                setWaConnection('qr');
                publishWaQr(qr).catch((e) => console.error('❌ QR:', e.message));
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output.statusCode
                    : null;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log('🔄 WA close → reconnect:', shouldReconnect, statusCode ?? '');
                setWaConnection('close', {
                    error: lastDisconnect?.error?.message,
                    reconnect: shouldReconnect
                });
                sock = null;
                servicesLoaded = false;
                setWaHandlersReady(false);

                if (shouldReconnect && !isStarting) {
                    const pairedNow = isWaSessionPaired();
                    let delay = pairedNow ? 3000 : 15_000;
                    if (statusCode === DisconnectReason.restartRequired) delay = 2000;
                    scheduleReconnect(delay);
                } else if (!shouldReconnect) {
                    teardownSocket();
                    console.error('\x1b[31m❌ WA logout — scan /pair sekali\x1b[0m');
                }
                return;
            }

            if (connection === 'open') {
                setWaConnection('open');
                startHandlerWatchdog();
                loadServicesAndHandlers(sock).catch((e) => console.error('❌ onOpen:', e?.message || e));
                return;
            }

            if (connection) setWaConnection(connection);
        });
    } catch (e) {
        console.error('❌ startLuxxBot:', e?.message || e);
        setWaHandlersReady(false);
        scheduleReconnect(10_000);
    } finally {
        isStarting = false;
    }
}

export async function startBot() {
    return startLuxxBot();
}