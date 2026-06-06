import { runAIQueue } from './ai.js';

let waSock = null;
let lastSentDate = null;
let timer = null;

function getJakartaParts() {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const parts = Object.fromEntries(
        fmt.formatToParts(new Date()).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
    );
    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        hour: parseInt(parts.hour, 10),
        minute: parseInt(parts.minute, 10)
    };
}

function parseGroupJids() {
    const raw = process.env.DAILY_FACT_GROUP_JIDS?.trim();
    if (!raw) return [];
    return raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

function isEnabled() {
    return process.env.DAILY_FACT_ENABLED !== 'false' && parseGroupJids().length > 0;
}

function targetHour() {
    const h = parseInt(process.env.DAILY_FACT_HOUR ?? '7', 10);
    return Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 7;
}

function targetMinute() {
    const m = parseInt(process.env.DAILY_FACT_MINUTE ?? '0', 10);
    return Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0;
}

async function sendDailyFact() {
    if (!waSock) return;
    const groups = parseGroupJids();
    if (!groups.length) return;

    let factText;
    try {
        factText = await runAIQueue(
            'Berikan satu fakta unik, menarik, dan ilmiah yang jarang diketahui. Maksimal 3 kalimat. Bahasa Indonesia. Tanpa emoji berlebihan.',
            'tanya',
            true,
            'daily-fact'
        );
    } catch (e) {
        console.error('❌ Daily fact AI:', e.message);
        factText = 'Tahukah kamu? Otak manusia menggunakan sekitar 20% energi tubuh meski bobotnya hanya ~2% dari berat badan.';
    }

    const message =
        `🌅 *FAKTA PAGI LUXXBOT*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${factText}\n\n` +
        `_Selamat pagi! Semoga harimu menyenangkan ☀️_`;

    for (const jid of groups) {
        try {
            await waSock.sendMessage(jid, { text: message });
            console.log(`\x1b[36m📢 Daily fact terkirim ke ${jid}\x1b[0m`);
        } catch (e) {
            console.error(`❌ Daily fact ke ${jid}:`, e.message);
        }
    }
}

async function tick() {
    if (!isEnabled() || !waSock) return;

    const { dateKey, hour, minute } = getJakartaParts();
    if (lastSentDate === dateKey) return;
    if (hour !== targetHour() || minute !== targetMinute()) return;

    lastSentDate = dateKey;
    await sendDailyFact();
}

export function setDailyFactSocket(sock) {
    waSock = sock;
}

export function startDailyFactScheduler() {
    if (!isEnabled()) {
        console.log('\x1b[33m☀️  Daily fact: nonaktif (set DAILY_FACT_GROUP_JIDS)\x1b[0m');
        return;
    }

    if (timer) clearInterval(timer);
    timer = setInterval(() => {
        tick().catch((e) => console.error('Daily fact tick:', e.message));
    }, 30_000);

    console.log(
        `\x1b[36m☀️  Daily fact: aktif jam ${String(targetHour()).padStart(2, '0')}:` +
        `${String(targetMinute()).padStart(2, '0')} WIB → ${parseGroupJids().length} grup\x1b[0m`
    );

    tick().catch(() => {});
}