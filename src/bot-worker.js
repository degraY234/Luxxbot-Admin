import { startBot } from './bot.js';

process.on('uncaughtException', (err) => {
    console.error('[bot-worker] uncaughtException:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[bot-worker] unhandledRejection:', reason);
});

startBot().catch((e) => {
    console.error('[bot-worker] startBot gagal:', e?.message || e);
    process.exit(1);
});