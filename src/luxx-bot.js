/**
 * Satu jalur bot — sama seperti PM2 lokal.
 * Handler langsung terpasang, reconnect tanpa matikan perintah lama.
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
import { isWaSessionPaired } from './utils/wa-session.js';
import './globals.js';
import { BOT_NAME } from './config.js';
import { state } from './state.js';
import { getOrCreateRoom } from './services/w2g.js';
import { startDiscordRadio } from './services/discord-radio.js';
import { registerMessageHandler } from './handlers/messages.js';
import { registerGroupEventHandler } from './handlers/group-events.js';
import { setDailyFactSocket, startDailyFactScheduler } from './services/daily-fact.js';

let sock = null;
let isStarting = false;
let reconnectTimer = null;
let dailySchedulerStarted = false;
let handlerWatchdog = null;

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

function bindHandlers(activeSock) {
    if (!activeSock) return;
    registerMessageHandler(activeSock);
    registerGroupEventHandler(activeSock);
    setWaHandlersReady(true);
    console.log('\x1b[32m✅ Handler WA aktif — semua perintah !menu !play !radio dll.\x1b[0m');
}

function startHandlerWatchdog() {
    if (handlerWatchdog) return;
    handlerWatchdog = setInterval(() => {
        if (sock && waStatus.connection === 'open' && !waStatus.handlersReady) {
            console.log('\x1b[33m⚠️ Watchdog: pasang ulang handler WA\x1b[0m');
            bindHandlers(sock);
        }
    }, 15_000);
}

function scheduleReconnect(delayMs = 5000) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startLuxxBot().catch((e) => console.error('❌ reconnect:', e?.message || e));
    }, delayMs);
}

export async function startLuxxBot() {
    if (isStarting) return;
    isStarting = true;

    try {
        startDiscordRadio();
        state.isSleeping = false;
        setWaConnection('connecting');

        const paired = isWaSessionPaired();
        console.log(paired
            ? '\x1b[36m🤖 LuxxBot start (session tersimpan)\x1b[0m'
            : '\x1b[36m🤖 LuxxBot start (perlu scan /pair)\x1b[0m');

        clearReconnectTimer();
        teardownSocket();
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
            markOnlineOnConnect: false,
            connectTimeoutMs: 60_000,
            keepAliveIntervalMs: 25_000,
            retryRequestDelayMs: 2500
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                if (paired || isWaSessionPaired()) {
                    console.log('\x1b[33m⏳ QR diabaikan — pakai session tersimpan\x1b[0m');
                } else {
                    setWaConnection('qr');
                    publishWaQr(qr).catch((e) => console.error('❌ QR:', e.message));
                }
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
                setWaHandlersReady(false);

                if (shouldReconnect && !isStarting) {
                    let delay = 5000;
                    if (statusCode === DisconnectReason.restartRequired) delay = 2500;
                    scheduleReconnect(delay);
                } else if (!shouldReconnect) {
                    teardownSocket();
                    console.error('\x1b[31m❌ WA logout — scan /pair sekali\x1b[0m');
                }
                return;
            }

            if (connection === 'open') {
                setWaConnection('open');
                bindHandlers(sock);
                startHandlerWatchdog();
                console.log(`\x1b[32m✅ ${BOT_NAME} WhatsApp ONLINE — perintah aktif\x1b[0m`);

                getOrCreateRoom()
                    .then((room) => console.log(`\x1b[35m📻 W2G: ${room.url}\x1b[0m`))
                    .catch((e) => console.error('❌ W2G:', e.message));

                setDailyFactSocket(sock);
                if (!dailySchedulerStarted) {
                    dailySchedulerStarted = true;
                    startDailyFactScheduler();
                }
                return;
            }

            if (connection) setWaConnection(connection);
        });

        bindHandlers(sock);
    } catch (e) {
        console.error('❌ startLuxxBot:', e?.message || e);
        setWaHandlersReady(false);
        scheduleReconnect(8000);
    } finally {
        isStarting = false;
    }
}

/** @deprecated */
export async function startBot() {
    return startLuxxBot();
}