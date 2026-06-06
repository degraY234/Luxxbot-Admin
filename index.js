import fs from 'fs';
import express from 'express';
import { registerWaQrRoutes, getPairPageUrl } from './src/services/wa-qr.js';
import { startRadioServer } from './src/services/radio-server.js';

if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });

const PORT = Number(process.env.RADIO_PORT || process.env.PORT || 3920);
const HOST = process.env.RADIO_BIND_HOST || '0.0.0.0';

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// /pair didaftarkan paling awal — tidak tunggu WA/Discord/messages.js
registerWaQrRoutes(app);
startRadioServer(app);

app.listen(PORT, HOST, () => {
    console.log(`\x1b[35m🚀 LuxxBot HTTP :${PORT} (${HOST})\x1b[0m`);
    console.log(`\x1b[32m📱 Pair WA     : ${getPairPageUrl()}\x1b[0m`);
    console.log(`\x1b[36m💚 Health      : http://127.0.0.1:${PORT}/health\x1b[0m`);
});

import('./src/bot.js')
    .then(({ startBot }) => startBot())
    .catch((e) => {
        console.error('❌ Gagal start bot:', e);
        process.exit(1);
    });