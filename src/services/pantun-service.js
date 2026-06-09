import axios from 'axios';
import * as cheerio from 'cheerio';
import { groqAI } from './ai.js';

const UA = 'LuxxBot/3.1 (WhatsApp; educational)';
const HTTP = { timeout: 18000, headers: { 'User-Agent': UA } };

const TOPIC_LABEL = {
    lucu: 'Lucu & Humor',
    cinta: 'Cinta & Asmara',
    nasihat: 'Nasihat & Bijak',
    semangat: 'Semangat & Motivasi',
    alam: 'Alam & Budaya',
    rindu: 'Rindu & Kerinduan'
};

const TOPIC_SEARCH = {
    lucu: ['pantun lucu', 'pantun lawak melayu', 'pantun jenaka'],
    cinta: ['pantun cinta', 'pantun asmara', 'pantun rindu'],
    nasihat: ['pantun nasihat', 'pantun bijak', 'pantun pepatah'],
    semangat: ['pantun motivasi', 'pantun semangat', 'pantun perjuangan'],
    alam: ['pantun alam', 'pantun budaya melayu', 'pantun nusantara'],
    rindu: ['pantun rindu', 'pantun merindu', 'pantun kangen']
};

const TOPIC_ALIASES = {
    lucu: 'lucu', lawak: 'lucu', humor: 'lucu', funny: 'lucu',
    cinta: 'cinta', love: 'cinta', asmara: 'cinta', sayang: 'cinta',
    nasihat: 'nasihat', bijak: 'nasihat', advice: 'nasihat',
    semangat: 'semangat', motivasi: 'semangat', spirit: 'semangat',
    alam: 'alam', nature: 'alam', budaya: 'alam',
    rindu: 'rindu', kangen: 'rindu', missing: 'rindu'
};

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeTopic(raw) {
    const t = String(raw || 'lucu').toLowerCase().trim();
    return TOPIC_ALIASES[t] || (TOPIC_SEARCH[t] ? t : 'lucu');
}

function cleanText(raw) {
    return String(raw || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^\s*[\-*•]\s*/gm, '')
        .replace(/^\s*\d+[\.)]\s*/gm, '')
        .replace(/\[\s*\d+\s*\]/g, '')
        .replace(/[""]/g, '')
        .replace(/\t/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function toLines(text) {
    return cleanText(text).split('\n').map((l) => l.trim()).filter(Boolean);
}

function extractPantunBlock(text) {
    const lines = toLines(text);
    if (lines.length <= 4) return lines.join('\n');

    const blocks = [];
    for (let i = 0; i <= lines.length - 4; i++) {
        const chunk = lines.slice(i, i + 4);
        if (chunk.every((l) => l.length >= 6 && l.length <= 90)) blocks.push(chunk.join('\n'));
    }
    if (blocks.length) return pickRandom(blocks);

    return lines.slice(0, 4).join('\n');
}

function isValidPantun(text) {
    const lines = toLines(text);
    if (lines.length < 4 || lines.length > 8) return false;
    if (/DAFTAR ISI|copyright|domain publik|Texts =|edited by|Schwarz|Tontemboan|Index of|Kata Pengantar|Minangkabau\/Kata/i.test(text)) return false;
    if (lines.some((l) => l.length < 6 || l.length > 100)) return false;
    if (lines.filter((l) => /^(takilek|takilas|lah tantu|kilat)/i.test(l)).length >= 2) return false;

    const unique = new Set(lines.map((l) => l.toLowerCase()));
    if (unique.size < Math.min(4, lines.length - 1)) return false;

    const avg = lines.reduce((s, l) => s + l.length, 0) / lines.length;
    return avg >= 10 && avg <= 80;
}

async function wikiSearch(lang, query) {
    try {
        const base = lang === 'id' ? 'https://id.wikisource.org' : 'https://en.wikisource.org';
        const { data } = await axios.get(`${base}/w/api.php`, {
            ...HTTP,
            params: { action: 'query', list: 'search', srsearch: query, format: 'json', srlimit: 8 }
        });
        return (data?.query?.search || [])
            .map((s) => s.title)
            .filter((t) => !/Bab |Daftar |Indeks |Buku |Praktis |Kajian |Texts|Tontemboan|Schwarz|Biographical|Encyclop|Kata Pengantar|Sastra Lisan/i.test(t));
    } catch {
        return [];
    }
}

async function wikiParse(lang, page) {
    const base = lang === 'id' ? 'https://id.wikisource.org' : 'https://en.wikisource.org';
    const { data } = await axios.get(`${base}/w/api.php`, {
        ...HTTP,
        params: { action: 'parse', page, format: 'json', prop: 'text' }
    });
    const html = data?.parse?.text?.['*'] || '';
    const $ = cheerio.load(html);
    $('script, style, .noprint, table, nav, .toc').remove();
    const blocks = [];
    $('.poem').each((_, el) => {
        const t = $(el).text().trim();
        if (t.length > 30) blocks.push(extractPantunBlock(cleanText(t)));
    });
    if (!blocks.length) {
        $('.mw-parser-output p').each((_, el) => {
            const t = $(el).text().trim();
            if (t.length > 30 && t.length < 400) blocks.push(extractPantunBlock(cleanText(t)));
        });
    }
    return blocks.filter(isValidPantun);
}

async function fetchFromWikisource(topic) {
    try {
        const queries = TOPIC_SEARCH[topic] || TOPIC_SEARCH.lucu;
        const titles = new Set();
        const q = pickRandom(queries);
        for (const lang of ['id', 'en']) {
            const hits = await wikiSearch(lang, q);
            hits.forEach((t) => titles.add(t));
        }
        const shuffled = [...titles].sort(() => Math.random() - 0.5);
        for (const title of shuffled.slice(0, 5)) {
            for (const lang of ['id', 'en']) {
                try {
                    const blocks = await wikiParse(lang, title);
                    const valid = blocks.filter(isValidPantun);
                    if (valid.length) return { text: pickRandom(valid), source: title };
                } catch { /* next */ }
            }
        }
    } catch { /* rate limit / offline */ }
    return null;
}

async function fetchFromPoetryWorld(topic) {
    const enTopic = { lucu: 'humor', cinta: 'love', nasihat: 'wisdom', semangat: 'hope', alam: 'nature', rindu: 'longing' }[topic] || 'life';
    try {
        const { data } = await axios.get(`https://poetrydb.org/lines/${encodeURIComponent(enTopic)}`, HTTP);
        if (!Array.isArray(data) || !data.length) return null;
        const row = pickRandom(data);
        const { data: full } = await axios.get(
            `https://poetrydb.org/title,author/${encodeURIComponent(row.title)}/${encodeURIComponent(row.author)}`,
            HTTP
        );
        const poem = full?.[0];
        if (!poem?.lines?.length) return null;
        const lines = poem.lines.slice(0, 4).join('\n');
        if (lines.length < 40) return null;
        return { text: lines, source: `${poem.title} · ${poem.author}` };
    } catch {
        return null;
    }
}

async function generatePantunAI(topic, attempt = 1) {
    const label = TOPIC_LABEL[topic] || topic;
    const prompt =
        `Buat SATU pantun Melayu/Indonesia bertema "${label}".\n` +
        `Aturan ketat:\n` +
        `- Tepat 4 baris saja\n` +
        `- Bahasa Indonesia modern yang mudah dibaca\n` +
        `- Irama pantun (a-a-a-a)\n` +
        `- Tanpa judul, tanpa penjelasan, tanpa nomor baris\n` +
        `Hanya tulis 4 baris pantun.`;
    const text = await groqAI(prompt);
    const cleaned = extractPantunBlock(cleanText(text || ''));
    if (!cleaned || cleaned.length < 20) throw new Error('AI tidak merespons');
    if (!isValidPantun(cleaned) && attempt < 3) return generatePantunAI(topic, attempt + 1);
    return { text: cleaned, source: 'generasi live' };
}

export function getPantunHelpText() {
    const topics = Object.keys(TOPIC_LABEL).join(', ');
    return (
        `🎭 *LUXX PANTUN — Live dari Dunia*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 \`!pantun\` atau \`!pantun <tema>\`\n` +
        `🌐 Sumber: Wikisource + puisi dunia + AI (bukan database statis)\n` +
        `🔄 Setiap panggilan = pantun berbeda\n\n` +
        `🎭 *Tema:* ${topics}\n` +
        `_Contoh: \`!pantun cinta\` · \`!pantun lucu\`_`
    );
}

export async function fetchLivePantun(topicInput) {
    const topic = normalizeTopic(topicInput);
    const label = TOPIC_LABEL[topic] || topic;

    const ws = await fetchFromWikisource(topic);
    if (ws?.text && isValidPantun(ws.text)) return { ...ws, topic, label, mode: 'sastra nusantara' };

    for (let i = 0; i < 3; i++) {
        try {
            const ai = await generatePantunAI(topic);
            if (ai?.text) return { ...ai, topic, label, mode: 'generasi live' };
        } catch { /* retry */ }
    }

    const world = await fetchFromPoetryWorld(topic);
    if (world?.text) return { ...world, topic, label, mode: 'puisi dunia' };

    const ai = await generatePantunAI(topic);
    return { ...ai, topic, label, mode: 'generasi live' };
}

export function formatPantunMessage(data) {
    return (
        `╭━━━〔 🎭 PANTUN ${data.label.toUpperCase()} 🎭 〕━━━\n\n` +
        `${data.text}\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📚 _${data.mode === 'sastra nusantara' ? 'Tradisi Melayu/Nusantara' : data.mode === 'puisi dunia' ? 'Inspirasi puisi dunia' : 'Dibuat live'}_\n` +
        (data.source && data.mode !== 'generasi live' ? `✍️ _${data.source}_\n` : '') +
        `_💡 \`!pantun ${data.topic}\` lagi → pantun baru_`
    );
}