import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { publishWaQr } from './services/wa-qr.js';

const BOT_NAME = process.env.BOT_NAME || 'LuxxBot';

let sock = null;
let isStarting = false;
let reconnectTimer = null;
let handlersLoaded = false;

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
    handlersLoaded = true;
    console.log('\x1b[32m📲 WA paired — load handler bot...\x1b[0m');
    await import('./globals.js');
    const [{ registerMessageHandler }, { registerGroupEventHandler }, { startDiscordRadio }, { setDailyFactSocket, startDailyFactScheduler }] = await Promise.all([
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
}

/** Bot ringan — QR cepat, handler penuh setelah connect */
export async function startPairBot() {
    if (isStarting) return;
    isStarting = true;

    try {
        console.log('\x1b[36m⚡ Pair mode: start WhatsApp (tanpa load handler dulu)\x1b[0m');
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
            markOnlineOnConnect: false
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
                console.log('🔄 WA close, reconnect:', shouldReconnect, statusCode ?? '');
                sock = null;
                handlersLoaded = false;
                if (shouldReconnect && !isStarting) {
                    scheduleReconnect(statusCode === DisconnectReason.restartRequired ? 12000 : 4000);
                } else if (!shouldReconnect) {
                    teardownSocket();
                }
            } else if (connection === 'open') {
                console.log(`\x1b[32m✅ ${BOT_NAME} WhatsApp ONLINE\x1b[0m`);
                loadFullHandlers().catch((e) => console.error('❌ Load handler:', e?.message || e));
            }
        });
    } finally {
        isStarting = false;
    }
}