import { startLuxxBot } from './luxx-bot.js';

process.on('uncaughtException', (err) => {
    console.error('[bot-worker] uncaughtException:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[bot-worker] unhandledRejection:', reason);
});

startLuxxBot().catch((e) => {
    console.error('[bot-worker] start gagal:', e?.message || e);
    process.exit(1);
});