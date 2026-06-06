import fs from 'fs';
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { publishWaQr } from './services/wa-qr.js';
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

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function teardownSocket() {
    if (!sock) return;
    try {
        sock.end();
    } catch (e) {
        console.error('⚠️ Gagal tutup socket WA:', e?.message || e);
    }
    sock = null;
}

function scheduleReconnect(delayMs = 5000) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startBot().catch((e) => console.error('❌ startBot reconnect:', e?.message || e));
    }, delayMs);
}

export async function startBot() {
    if (isStarting) return;
    isStarting = true;

    try {
        startDiscordRadio();
        state.isSleeping = false;

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
                publishWaQr(qr).catch((e) => console.error('❌ Gagal publish QR:', e.message));
            }
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output.statusCode
                    : null;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log('🔄 Koneksi WA terputus, reconnect:', shouldReconnect, statusCode ?? '');
                sock = null;
                if (shouldReconnect && !isStarting) {
                    scheduleReconnect(statusCode === DisconnectReason.restartRequired ? 15000 : 5000);
                } else if (!shouldReconnect) {
                    teardownSocket();
                }
            } else if (connection === 'open') {
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
            }
        });

        registerMessageHandler(sock);
        registerGroupEventHandler(sock);
    } finally {
        isStarting = false;
    }
}