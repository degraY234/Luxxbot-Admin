import fs from 'fs';
import express from 'express';
import { registerWaQrRoutes } from './src/services/wa-qr.js';
import { startRadioServer } from './src/services/radio-server.js';
import { printPairLinkBanner } from './src/utils/startup-banner.js';

process.on('uncaughtException', (err) => {
    console.error('❌ uncaughtException (server tetap jalan):', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ unhandledRejection (server tetap jalan):', reason);
});

if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });

const PORT = Number(process.env.RADIO_PORT || process.env.PORT || 3920);
const HOST = process.env.RADIO_BIND_HOST || '0.0.0.0';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// /pair didaftarkan paling awal — tidak tunggu WA/Discord/messages.js
registerWaQrRoutes(app);
startRadioServer(app);

const server = app.listen(PORT, HOST, () => {
    console.log(`\x1b[35m🚀 LuxxBot online (port ${PORT})\x1b[0m`);
    printPairLinkBanner();
});

server.on('error', (err) => {
    console.error('❌ HTTP server error:', err?.message || err);
});

import('./src/bot.js')
    .then(({ startBot }) => startBot())
    .catch((e) => {
        console.error('❌ WhatsApp bot error (halaman /pair tetap hidup):', e?.message || e);
    });