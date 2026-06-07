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
let handlersBound = false;

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
    handlersBound = false;
    setWaHandlersReady(false);
}

function scheduleReconnect(delayMs = 5000) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startBot().catch((e) => console.error('❌ startBot reconnect:', e?.message || e));
    }, delayMs);
}

function bindHandlers() {
    if (!sock || handlersBound) return;
    registerMessageHandler(sock);
    registerGroupEventHandler(sock);
    handlersBound = true;
    setWaHandlersReady(true);
}

export async function startBot() {
    if (isStarting) return;
    isStarting = true;

    try {
        startDiscordRadio();
        state.isSleeping = false;
        setWaConnection('connecting');

        clearReconnectTimer();
        teardownSocket();

        const { state: authState, saveCreds } = await useMultiFileAuthState('./session');
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: authState,
            browser: [BOT_NAME, 'Chrome', '1.0.0']
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
                console.log('🔄 Koneksi WA terputus, reconnect:', shouldReconnect, statusCode ?? '');
                setWaConnection('close', {
                    error: lastDisconnect?.error?.message,
                    reconnect: shouldReconnect
                });
                sock = null;
                handlersBound = false;
                setWaHandlersReady(false);
                if (shouldReconnect && !isStarting) {
                    scheduleReconnect(statusCode === DisconnectReason.restartRequired ? 15000 : 5000);
                } else if (!shouldReconnect) {
                    teardownSocket();
                    console.error('\x1b[31m❌ WA logout — scan QR di /pair\x1b[0m');
                }
            } else if (connection === 'open') {
                setWaConnection('open');
                bindHandlers();
                console.log('\x1b[36m%s\x1b[0m', `
            ╔════════════════════════════════════════════════════╗
            ║  🚀 ${BOT_NAME} MULTI-DEVICE IS SUCCESSFULLY ONLINE! 🤖 ║
            ╚════════════════════════════════════════════════════╝
            `);
                console.log(`\x1b[32m🌸 ✨ Yeayy! ${BOT_NAME} Berhasil Online! 🎀💖\x1b[0m\n`);

                getOrCreateRoom()
                    .then(room => console.log(`\x1b[35m📻 Room W2G siap: ${room.url}\x1b[0m`))
                    .catch(e => console.error('❌ Gagal init room W2G:', e.message));

                setDailyFactSocket(sock);
                if (!dailySchedulerStarted) {
                    dailySchedulerStarted = true;
                    startDailyFactScheduler();
                }
            } else if (connection) {
                setWaConnection(connection);
            }
        });

        bindHandlers();
    } finally {
        isStarting = false;
    }
}