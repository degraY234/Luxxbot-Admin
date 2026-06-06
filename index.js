import fs from 'fs';
import { startRadioServer } from './src/services/radio-server.js';

if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });

// HTTP /health dulu — Railway healthcheck tidak tunggu WA + Discord + messages.js
startRadioServer();

import('./src/bot.js')
    .then(({ startBot }) => startBot())
    .catch((e) => {
        console.error('❌ Gagal start bot:', e);
        process.exit(1);
    });