import fs from 'fs';
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import './globals.js';
import { BOT_NAME } from './config.js';
import { state } from './state.js';
import { getOrCreateRoom } from './services/w2g.js';
import { startRadioServer } from './services/radio-server.js';
import { startDiscordRadio } from './services/discord-radio.js';
import { registerMessageHandler } from './handlers/messages.js';
import { registerGroupEventHandler } from './handlers/group-events.js';
import { setDailyFactSocket, startDailyFactScheduler } from './services/daily-fact.js';

if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });
startRadioServer();
startDiscordRadio();

export async function startBot() {
    state.isSleeping = false;
    const { state: authState, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: authState,
        browser: [BOT_NAME, 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\n\x1b[35m🎀 ============================================== 🎀\x1b[0m');
            console.log('\x1b[36m✨ SILAKAN SCAN QR CODE DI BAWAH UNTUK MENYALAKAN BOT ✨\x1b[0m');
            console.log('\x1b[35m🎀 ============================================== 🎀\x1b[0m\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                : true;
            console.log('🔄 Koneksi terputus, mencoba ulang:', shouldReconnect);
            if (shouldReconnect) startBot();
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
            startDailyFactScheduler();
        }
    });

    registerMessageHandler(sock);
    registerGroupEventHandler(sock);
}