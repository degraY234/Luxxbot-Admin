/**
 * Lacak pesan berformat bot di grup + basis pengetahuan bot WA populer.
 * Dipakai !tanya / !q saat user bandingkan atau tanya bot lain di grup.
 */

const SNIPPET_MAX = 40;
const SNIPPET_TTL_MS = 45 * 60 * 1000;

/** @type {Map<string, { sender: string, text: string, at: number }[]>} */
const groupSnippets = new Map();

/** Fitur umum bot WA yang sering ada di grup (bukan scan real-time) */
export const KNOWN_WA_BOTS = {
    rose: {
        names: ['rose', 'rose bot', 'miss rose'],
        strengths: ['admin grup, welcome, rules, antiflood, filter', 'stabil & banyak dipakai di grup besar']
    },
    joker: {
        names: ['joker', 'joker bot'],
        strengths: ['hiburan, game, meme, tools ringan', 'cocok buat grup santai']
    },
    wabot: {
        names: ['wabot', 'wa bot', 'wabot pro'],
        strengths: ['download media, stiker, tools dasar', 'sering dipakai komunitas']
    },
    sansekai: {
        names: ['sansekai', 'sans ekai'],
        strengths: ['anime, manga, info otaku', 'niche anime lovers']
    },
    lydia: {
        names: ['lydia', 'lydia bot'],
        strengths: ['chat AI ringan, hiburan', 'conversational bot klasik']
    },
    nobita: {
        names: ['nobita', 'nobita bot'],
        strengths: ['download, quotes, tools hiburan', 'bot lokal populer']
    },
    doraemon: {
        names: ['doraemon', 'doraemon bot'],
        strengths: ['tools & hiburan mirip nobita-style', 'komunitas Indonesia']
    }
};

const BOT_QUERY_RE =
    /bot\s+(lain|apa|di\s*grup|apa\s*aja)|banding|lebih\s+bag(us|us)|keunggulan|fitur\s+bot|siapa\s+(yang\s+)?(lebih|terbaik)|menu\s+bot|bot\s+apa|rose|joker|wabot|sansekai|lydia|nobita|doraemon/i;

const BOT_INTEL_RE = /bot|fitur|menu|help|perintah|command|keunggulan|banding/i;

function prune(list) {
    const cut = Date.now() - SNIPPET_TTL_MS;
    return list.filter((e) => e.at > cut).slice(-SNIPPET_MAX);
}

/**
 * @param {string} groupId
 * @param {string} senderJid
 * @param {string} text
 * @param {string} [selfJid]
 */
export function trackGroupBotActivity(groupId, senderJid, text, selfJid) {
    if (!groupId?.endsWith('@g.us') || !text?.trim()) return;
    if (selfJid && senderJid === selfJid) return;

    const t = text.trim();
    const looksBot =
        t.startsWith('!') ||
        t.startsWith('/') ||
        /^[🤖🎵📋🌸✨━─╔║╚]/.test(t) ||
        (t.length > 120 && /perintah|command|menu|━━|help/i.test(t));

    if (!looksBot) return;

    const sender = String(senderJid || '').split('@')[0] || '?';
    const entry = { sender, text: t.slice(0, 500), at: Date.now() };
    const prev = prune(groupSnippets.get(groupId) || []);
    prev.push(entry);
    groupSnippets.set(groupId, prev);
}

function summarizeSnippets(groupId) {
    const list = prune(groupSnippets.get(groupId) || []);
    if (!list.length) return '';

    const bySender = new Map();
    for (const e of list) {
        if (!bySender.has(e.sender)) bySender.set(e.sender, []);
        bySender.get(e.sender).push(e.text);
    }

    const lines = [];
    for (const [num, texts] of bySender) {
        const cmds = new Set();
        for (const tx of texts) {
            const m = tx.match(/^[!/]([a-z0-9_-]+)/i);
            if (m) cmds.add(m[1].toLowerCase());
        }
        const cmdList = [...cmds].slice(0, 12).join(', ');
        const sample = texts[texts.length - 1].replace(/\s+/g, ' ').slice(0, 100);
        lines.push(
            `• @${num}: ${cmdList ? `perintah terlihat → !${cmdList.replace(/, /g, ', !')}` : 'pesan mirip bot'} · cuplikan: "${sample}..."`
        );
    }
    return lines.join('\n');
}

function knownBotsBlock() {
    return Object.entries(KNOWN_WA_BOTS)
        .map(([, b]) => `• ${b.names[0]}: ${b.strengths.join('; ')}`)
        .join('\n');
}

export function isBotComparisonQuery(query) {
    return BOT_QUERY_RE.test(String(query || ''));
}

function shouldAttachBotIntel(groupId, query) {
    if (!groupId?.endsWith('@g.us')) return false;
    if (isBotComparisonQuery(query)) return true;
    const list = prune(groupSnippets.get(groupId) || []);
    return list.length > 0 && BOT_INTEL_RE.test(String(query || ''));
}

/**
 * @param {string} groupId
 * @param {string} query
 */
export function buildGroupBotIntel(groupId, query) {
    if (!groupId?.endsWith('@g.us')) return '';
    if (!shouldAttachBotIntel(groupId, query)) return '';

    const live = summarizeSnippets(groupId);
    let block =
        `[Intel bot di grup ini — LUXXBOT TIDAK bisa baca kode/memu bot lain secara penuh. ` +
        `Yang tersedia: cuplikan aktivitas terpantau di chat + pengetahuan umum bot WA populer.]\n`;

    if (live) {
        block += `\n*Aktivitas bot terpantau di grup (dari chat terakhir):*\n${live}\n`;
    } else {
        block +=
            '\n*Aktivitas bot di grup:* belum ada cuplikan terpantau. ' +
            'Suruh bot lain kirim menu/help dulu, atau sebut nama botnya di pertanyaan.\n';
    }

    block += `\n*Referensi bot WA populer (umum):*\n${knownBotsBlock()}\n`;
    block +=
        `\nInstruksi: bandingkan jujur — akui kelebihan bot lain, jelaskan keunggulan LuxxBot yang relevan. ` +
        `Jangan klaim sudah scan internal bot lain.`;

    return block;
}