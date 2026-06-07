import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { publishWaQr } from './services/wa-qr.js';
import { setWaConnection, setWaHandlersReady } from './wa-status.js';

const BOT_NAME = process.env.BOT_NAME || 'LuxxBot';

let sock = null;
let isStarting = false;
let reconnectTimer = null;
let handlersLoaded = false;
let handlerLoadAttempt = 0;

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

function scheduleReconnect(delayMs = 5000) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startPairBot().catch((e) => console.error('❌ pair reconnect:', e?.message || e));
    }, delayMs);
}

async function loadFullHandlers() {
    if (handlersLoaded || !sock) return;
    handlerLoadAttempt += 1;
    console.log(`\x1b[32m📲 WA paired — load handler bot (coba ${handlerLoadAttempt})...\x1b[0m`);
    try {
        await import('./globals.js');
        const [
            { registerMessageHandler },
            { registerGroupEventHandler },
            { startDiscordRadio },
            { setDailyFactSocket, startDailyFactScheduler }
        ] = await Promise.all([
            import('./handlers/messages.js'),
            import('./handlers/group-events.js'),
            import('./services/discord-radio.js'),
            import('./services/daily-fact.js')
        ]);
        startDiscordRadio();
        registerMessageHandler(sock);
        registerGroupEventHandler(sock);
        setDailyFactSocket(sock);
        startDailyFactScheduler();
        handlersLoaded = true;
        setWaHandlersReady(true);
        console.log('\x1b[32m✅ Handler WA siap — !menu !play !radio aktif\x1b[0m');
    } catch (e) {
        console.error('❌ Load handler gagal:', e?.message || e);
        setWaHandlersReady(false);
        if (handlerLoadAttempt < 6) {
            setTimeout(() => loadFullHandlers(), 4000 * handlerLoadAttempt);
        }
    }
}

/** Bot stabil Railway — QR cepat, handler penuh setelah connect */
export async function startPairBot() {
    if (isStarting) return;
    isStarting = true;

    try {
        console.log('\x1b[36m⚡ Start WhatsApp...\x1b[0m');
        setWaConnection('connecting');
        clearReconnectTimer();
        teardownSocket();
        handlersLoaded = false;
        handlerLoadAttempt = 0;
        setWaHandlersReady(false);

        const { state: authState, saveCreds } = await useMultiFileAuthState('./session');
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: authState,
            browser: [BOT_NAME, 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                setWaConnection('qr');
                publishWaQr(qr).catch((e) => console.error('❌ Gagal publish QR:', e.message));
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output.statusCode
                    : null;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                const errMsg = lastDisconnect?.error?.message || statusCode;
                console.log('🔄 WA close, reconnect:', shouldReconnect, statusCode ?? '', errMsg);
                setWaConnection('close', { error: errMsg, reconnect: shouldReconnect });
                sock = null;
                handlersLoaded = false;
                setWaHandlersReady(false);
                if (shouldReconnect && !isStarting) {
                    scheduleReconnect(statusCode === DisconnectReason.restartRequired ? 12000 : 4000);
                } else if (!shouldReconnect) {
                    teardownSocket();
                    console.error('\x1b[31m❌ WA logout — scan QR ulang di /pair\x1b[0m');
                }
            } else if (connection === 'open') {
                setWaConnection('open');
                console.log(`\x1b[32m✅ ${BOT_NAME} WhatsApp ONLINE\x1b[0m`);
                loadFullHandlers().catch((e) => console.error('❌ Load handler:', e?.message || e));
            } else if (connection) {
                setWaConnection(connection);
            }
        });
    } finally {
        isStarting = false;
    }
}