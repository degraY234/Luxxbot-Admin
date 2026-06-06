import { isRailwayRuntime } from './utils/listen-port.js';

process.on('uncaughtException', (err) => {
    console.error('[bot-worker] uncaughtException:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[bot-worker] unhandledRejection:', reason);
});

const run = isRailwayRuntime()
    ? import('./bot-pair.js').then(({ startPairBot }) => startPairBot())
    : import('./bot.js').then(({ startBot }) => startBot());

run.catch((e) => {
    console.error('[bot-worker] start gagal:', e?.message || e);
    process.exit(1);
});