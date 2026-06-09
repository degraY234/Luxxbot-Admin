import axios from 'axios';
import * as cheerio from 'cheerio';
import { SASTRA_TOPICS, normalizeSastraTopic } from '../data/sastra-indonesia.js';
import { translateText } from './translate-service.js';

const UA = 'LuxxBot/3.1 (WhatsApp; educational; https://luxxbot)';
const HTTP = { timeout: 20000, headers: { 'User-Agent': UA, Accept: 'application/json' } };

const TOPIC_EN = {
    cinta: 'love', rindu: 'longing', alam: 'nature', hujan: 'rain', malam: 'night',
    hidup: 'life', kematian: 'death', harapan: 'hope', tanahair: 'homeland'
};

const TOPIC_EN_QUERIES = {
    cinta: ['love', 'heart', 'beloved', 'kiss'],
    rindu: ['longing', 'yearning', 'miss', 'absence', 'distance', 'farewell'],
    alam: ['nature', 'mountain', 'forest', 'sea', 'wind'],
    hujan: ['rain', 'storm', 'thunder', 'cloud'],
    malam: ['night', 'dark', 'moon', 'evening', 'dawn'],
    hidup: ['life', 'soul', 'spirit', 'journey'],
    kematian: ['death', 'grave', 'mourning', 'gone'],
    harapan: ['hope', 'dream', 'tomorrow', 'light'],
    tanahair: ['homeland', 'nation', 'freedom', 'land']
};

const ID_SEARCH = {
    cinta: ['Senja di Pelabuhan Kecil', 'cinta Chairil Anwar', 'Amir Hamzah cinta', 'puisi cinta Indonesia'],
    rindu: ['rindu puisi', 'Padang Bulan', 'Amir Hamzah', 'kerinduan Chairil'],
    alam: ['alam puisi Indonesia', 'Sanusi Pane', 'bidadari timur'],
    hujan: ['hujan puisi', 'gerimis', 'Chairil Anwar hujan'],
    malam: ['senja puisi', 'malam Chairil', 'Pada Senja Amir'],
    hidup: ['Aku (Chairil Anwar)', 'Chairil Anwar hidup', 'Doa (Chairil Anwar)'],
    kematian: ['Doa (Chairil Anwar)', 'kematian puisi'],
    harapan: ['harapan puisi Indonesia', 'Chairil Anwar'],
    tanahair: ['Indonesia puisi', 'Sanusi Pane', 'tanah air']
};

/** Judul halaman puisi individual di Wikisource ID (bukan buku/antologi). */
const ID_POEM_PAGES = {
    cinta: ['Senja di Pelabuhan Kecil', 'Pada Jauhnya (Amir Hamzah)', 'Cintaku Jauh di Pulau (Amir Hamzah)', 'Jalan Malam (Chairil Anwar)'],
    rindu: ['Pada Jauhnya (Amir Hamzah)', 'Padang Bulan (Amir Hamzah)', 'Kerinduan (Chairil Anwar)', 'Senja di Pelabuhan Kecil'],
    alam: ['Bidadari Timur (Sanusi Pane)', 'Pantai (Chairil Anwar)', 'Senja di Pelabuhan Kecil'],
    hujan: ['Gerimis (Chairil Anwar)', 'Hujan di Malam Hari (Chairil Anwar)', 'Senja di Pelabuhan Kecil'],
    malam: ['Senja di Pelabuhan Kecil', 'Malam (Chairil Anwar)', 'Pada Senja (Amir Hamzah)'],
    hidup: ['Aku (Chairil Anwar)', 'Doa (Chairil Anwar)', 'Yang Terampas dan Yang Putus (Chairil Anwar)'],
    kematian: ['Doa (Chairil Anwar)', 'Yang Terampas dan Yang Putus (Chairil Anwar)'],
    harapan: ['Doa (Chairil Anwar)', 'Aku (Chairil Anwar)', 'Pantja Sila (Chairil Anwar)'],
    tanahair: ['Indonesia (Chairil Anwar)', 'Bidadari Timur (Sanusi Pane)', 'Pantja Sila (Chairil Anwar)']
};

const JUNK_TEXT = /DAFTAR ISI|domain publik|public domain|All rights reserved|Copyright|ROBERTS BROTHERS|University Press|MACMILLAN|ST\. MARTIN|Edited by|SECOND EDITION|price of each|Publishers?|KUMPULAN PUISI|Koleksi Sajak|Oxford Book|Sonnets \(i\)|\|\s*\d+\s*\||Citra Manusia|Halaman:|\.pdf\/|John Wilson and Son|Cambridge,?\s*U\.?\s*S\.?\s*A|LIMITED\s*$/im;
const JUNK_TITLE_ID = /Bab |Daftar |Kajian |Antologi |Konflik:|Kumpulan |Koleksi |Indeks |Lampiran|Citra Manusia|\.pdf|Buku |Praktis |Pelajaran |\/|Halaman:/i;
const JUNK_TITLE_EN = /^(Poems|Poetry)$|Poems:|Third Series|Second Series|First Series|\/Chapter |\/Introduction|\/Notes|Survey of|Devil Stories|Encyclopedia Americana|Short Survey|Anthology of.*Literature$/i;

const WORLD_WS_QUERIES = {
    prancis: ['Baudelaire poem', 'Victor Hugo poem', 'Rimbaud poem'],
    jepang: ['Basho haiku', 'Japanese haiku Basho', 'Issa haiku'],
    india: ['Tagore Stray Birds', 'Rabindranath Tagore Gitanjali poem', 'Tagore Gardener poem'],
    rusia: ['Pushkin poem', 'Akhmatova poem'],
    spanyol: ['Lorca poem', 'Neruda love poem'],
    china: ['Li Po poem', 'Tu Fu poem', 'Chinese poetry'],
    persia: ['Rumi poem', 'Khayyam rubaiyat'],
    arab: ['Gibran prophet', 'Gibran love poem'],
    yunani: ['Sappho poem', 'Homer hymn']
};

/** Halaman puisi teruji — dipakai dulu biar cepat & stabil. */
const WORLD_WS_SEEDS = {
    prancis: ['Poems of Charles Baudelaire/The Owls', 'Poems of Charles Baudelaire/Song', 'Poems and Baudelaire Flowers/Song'],
    jepang: [
        'Anthology of Japanese Literature/Haiku by Bashō and His School',
        'Anthology of Japanese Literature/Conversations with Kyorai',
        'Japanese Literature/Chapter 2',
        'Frog Poem'
    ],
    india: ['Stray Birds', 'Gitanjali/1', 'Gitanjali/3', 'Gitanjali/5'],
    rusia: ['I Loved You (Pushkin)', 'A Little Bird (Pushkin)', 'Winter Morning (Pushkin)'],
    spanyol: ['Twenty Love Poems and a Song of Despair/1', 'Gacela of the Dark Death (Lorca)', 'Lament for Ignacio Sánchez Mejías (Lorca)'],
    china: ['Quiet Night Thought (Li Po)', 'Drinking Alone by Moonlight (Li Po)', 'The Moon at the Fortified Pass (Li Po)'],
    persia: ['The Rubaiyat of Omar Khayyam/1', 'The Rubaiyat of Omar Khayyam/12', 'The Rubaiyat of Omar Khayyam/20'],
    arab: ['Sand and Foam', 'The Prophet (Gibran)/On Love', 'The Madman (Gibran)/On Love'],
    yunani: ['Hymn to Earth (Homer)', 'Poems of Sappho/Fragment 1', 'Poems of Sappho/Fragment 31']
};

const parseCache = new Map();
const CACHE_TTL_MS = 12 * 60 * 1000;
const PARSE_CACHE_MAX = 120;

function pruneParseCache() {
    const now = Date.now();
    for (const [key, entry] of parseCache) {
        if (now - entry.at >= CACHE_TTL_MS) parseCache.delete(key);
    }
    while (parseCache.size > PARSE_CACHE_MAX) {
        const oldest = parseCache.keys().next().value;
        parseCache.delete(oldest);
    }
}

export function getParseCacheStats() {
    return { size: parseCache.size, max: PARSE_CACHE_MAX, ttlMin: CACHE_TTL_MS / 60_000 };
}

const WORLD_AUTHORS = {
    inggris: ['Emily Dickinson', 'William Shakespeare', 'Lord Byron', 'Robert Frost', 'Elizabeth Barrett Browning', 'Percy Bysshe Shelley', 'John Keats'],
    prancis: ['Charles Baudelaire', 'Victor Hugo', 'Arthur Rimbaud'],
    jepang: ['Matsuo Basho', 'Kobayashi Issa'],
    india: ['Rabindranath Tagore', 'Sarojini Naidu'],
    rusia: ['Alexander Pushkin', 'Anna Akhmatova'],
    spanyol: ['Pablo Neruda', 'Federico Garcia Lorca'],
    china: ['Li Po', 'Tu Fu'],
    persia: ['Omar Khayyam', 'Rumi'],
    arab: ['Khalil Gibran'],
    yunani: ['Homer', 'Sappho']
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomN(arr, n) {
    const copy = [...arr];
    const out = [];
    while (out.length < n && copy.length) {
        out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    }
    return out;
}

function nowWib() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function cleanPoemText(raw) {
    return String(raw || '')
        .replace(/\[\s*\d+\s*\]/g, '')
        .replace(/\t/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
}

function splitStanzas(text) {
    const blocks = cleanPoemText(text).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    if (blocks.length > 1) return blocks.filter((s) => s.length > 30);
    const lines = cleanPoemText(text).split('\n').map((l) => l.trim()).filter(Boolean);
    const stanzas = [];
    for (let i = 0; i < lines.length; i += 4) {
        const chunk = lines.slice(i, i + 4).join('\n');
        if (chunk.length > 20) stanzas.push(chunk);
    }
    return stanzas;
}

function looksLikePublisherBoilerplate(text) {
    const t = text.toLowerCase();
    const hits = [
        /copyright/.test(t),
        /public domain/.test(t),
        /roberts brothers/.test(t),
        /university press/.test(t),
        /edited by/.test(t),
        /\$\d/.test(t),
        /second edition/.test(t),
        /publishers?/.test(t) && /boston/.test(t),
        /macmillan/.test(t),
        /st\. martin/.test(t)
    ].filter(Boolean).length;
    return hits >= 1 && (hits >= 2 || /macmillan|copyright|roberts brothers/i.test(t));
}

function isHaikuLike(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length >= 2 && lines.length <= 6 && text.length >= 15 && text.length < 150;
}

function isShortVerse(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length >= 2 && lines.length <= 8 && text.length >= 40 && text.length < 250;
}

function isAphorism(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length >= 1 && lines.length <= 2 && text.length >= 35 && text.length < 220;
}

function isValidPoemText(text) {
    const t = cleanPoemText(text);
    if (t.length > 12000) return false;
    if (isHaikuLike(t) || isShortVerse(t) || isAphorism(t)) {
        return !JUNK_TEXT.test(t) && !looksLikePublisherBoilerplate(t);
    }
    if (t.length < 60) return false;
    if (JUNK_TEXT.test(t)) return false;
    if (looksLikePublisherBoilerplate(t)) return false;

    const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 3 || lines.length > 200) return false;

    const tocLines = lines.filter((l) => /^\d+(\.\d+)*\s/.test(l) || /^[IVX]+\.\s/.test(l)).length;
    if (tocLines >= 2) return false;

    const capsLines = lines.filter((l) => l === l.toUpperCase() && l.length > 4 && l.length < 60).length;
    if (capsLines >= 4) return false;

    const avgLen = lines.reduce((s, l) => s + l.length, 0) / lines.length;
    if (avgLen > 110) return false;

    const poetic = lines.filter((l) => /[,;:\-\?]$|--|…/.test(l) || l.length < 70).length;
    const minPoetic = lines.length <= 4 ? 0.15 : 0.22;
    if (poetic < lines.length * minPoetic) return false;

    return true;
}

function isJunkTitle(title, lang = 'id') {
    if (!title) return true;
    if (lang === 'id') return JUNK_TITLE_ID.test(title);
    if (/^Poems of [^/]+\/[^/]+$/i.test(title)) return false;
    if (/Haiku by |Gitanjali\/\d+|Rubaiyat of Omar/i.test(title)) return false;
    if (/^Frog Poem$/i.test(title)) return false;
    if (/^Japanese Literature\/Chapter/i.test(title)) return false;
    if (/^Sand and Foam$/i.test(title)) return false;
    if (/^Stray Birds$/i.test(title)) return false;
    if (/^The Gardener \(Tagore\)$/i.test(title)) return false;
    return JUNK_TITLE_EN.test(title);
}

function isValidPoem(poem, lang = 'id') {
    if (!poem?.text || !poem?.title) return false;
    const checkLang = poem.lang || lang;
    if (isJunkTitle(poem.title, checkLang) || isJunkTitle(poem.pageTitle || '', checkLang)) return false;
    return isValidPoemText(poem.text);
}

function guessWorldAuthor(title, regionKey) {
    if (regionKey === 'india' && /tagore|gitanjali|stray birds|gardener/i.test(title)) return 'Rabindranath Tagore';
    const list = WORLD_AUTHORS[regionKey] || [];
    const lower = title.toLowerCase();
    for (const name of list) {
        const parts = name.toLowerCase().split(/\s+/);
        if (parts.every((p) => lower.includes(p)) || lower.includes(parts[parts.length - 1])) return name;
    }
    const m = title.match(/Poems of ([^/]+)\//i) || title.match(/by ([A-Z][a-z]+ [A-Z][a-z]+)/);
    if (m?.[1]) return m[1].trim();
    return list[0] || 'Penyair Dunia';
}

function pickLongExcerpt(text, minChars = 320) {
    const full = cleanPoemText(text);
    if (full.length <= minChars + 40) return full;
    const lines = full.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return full;

    let best = '';
    for (let start = 0; start < lines.length; start++) {
        for (const size of [20, 16, 12, 10, 8, 6]) {
            if (start + size > lines.length) continue;
            const chunk = lines.slice(start, start + size).join('\n');
            if (chunk.length >= minChars && chunk.length > best.length) best = chunk;
        }
    }
    if (best.length >= minChars) return best;

    const stanzas = splitStanzas(full);
    if (stanzas.length >= 2) {
        const joined = [...stanzas].sort((a, b) => b.length - a.length).slice(0, 2).join('\n\n');
        if (joined.length >= minChars) return joined;
    }
    if (stanzas.length) {
        const longest = [...stanzas].sort((a, b) => b.length - a.length)[0];
        if (longest.length >= minChars) return longest;
    }
    return lines.slice(0, Math.min(lines.length, 16)).join('\n');
}

async function wikiApi(base, params, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const { data } = await axios.get(`${base}/w/api.php`, { ...HTTP, params });
            return data;
        } catch (e) {
            if (e.response?.status === 429 && i < retries - 1) {
                await sleep(1500 * (i + 1));
                continue;
            }
            throw e;
        }
    }
}

async function wikisourceSearch(lang, query) {
    const base = lang === 'id' ? 'https://id.wikisource.org' : 'https://en.wikisource.org';
    const data = await wikiApi(base, {
        action: 'query', list: 'search', srsearch: query, format: 'json', srlimit: 15
    });
    return (data?.query?.search || [])
        .map((s) => s.title)
        .filter((t) => !isJunkTitle(t, lang))
        .sort((a, b) => scorePoemTitle(b, lang) - scorePoemTitle(a, lang));
}

function scorePoemTitle(title, lang = 'id') {
    let score = 0;
    if (lang === 'id') {
        if (/\([^)]+\)/.test(title)) score += 3;
        if (/Chairil|Amir Hamzah|Sanusi|Sapardi|Rendra|Toer/i.test(title)) score += 2;
        if (/Kumpulan|Koleksi|Indeks|Bab /i.test(title)) score -= 5;
    } else {
        if (/^Poems of [^/]+\/[^/]+$/i.test(title)) score += 5;
        if (/Haiku by /i.test(title)) score += 4;
        if (/Baudelaire|Basho|Gibran|Neruda|Lorca|Tagore|Pushkin|Rumi|Homer|Sappho/i.test(title)) score += 3;
        if (/Anthology of Japanese Literature$/i.test(title)) score -= 4;
    }
    return score;
}

async function wikisourceParse(lang, pageTitle) {
    pruneParseCache();
    const cacheKey = `${lang}:${pageTitle}`;
    const cached = parseCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

    const base = lang === 'id' ? 'https://id.wikisource.org' : 'https://en.wikisource.org';
    await sleep(200);
    const data = await wikiApi(base, {
        action: 'parse', page: pageTitle, format: 'json', prop: 'text|categories|wikitext'
    });
    const html = data?.parse?.text?.['*'] || '';
    const $ = cheerio.load(html);
    $('script, style, .noprint, .ws-noexport, table, .header-mainblock, .mw-editsection, .toc, nav').remove();
    const poems = [];
    $('.poem').each((_, el) => {
        const block = $(el).text().trim();
        if (block.length > 30 && !JUNK_TEXT.test(block)) poems.push(block);
    });
    let text = '';
    if (poems.length > 1) {
        text = pickRandom(poems);
    } else {
        text = poems.join('\n\n');
    }
    if (!text || text.length < 20) {
        const blocks = [];
        $('blockquote, pre').each((_, el) => {
            const block = $(el).text().trim();
            if (block.length > 30 && !JUNK_TEXT.test(block)) blocks.push(block);
        });
        if (!blocks.length) {
            $('.mw-parser-output p').each((_, el) => {
                const block = $(el).text().trim();
                if (block.length > 25 && block.length < 220
                    && !JUNK_TEXT.test(block)
                    && !looksLikePublisherBoilerplate(block)
                    && !/MACMILLAN|FRONTISPIECE|Translated by the original/i.test(block)
                    && block !== block.toUpperCase()) blocks.push(block);
            });
        }
        if (blocks.length) text = pickRandom(blocks);
    }
    text = cleanPoemText(text);

    const authorMatch = pageTitle.match(/\(([^)]+)\)/);
    const categories = (data?.parse?.categories || []).map((c) => c['*'] || '').join(' ');
    const wikitext = data?.parse?.wikitext?.['*'] || '';
    const author = authorMatch
        ? authorMatch[1].trim()
        : extractAuthorFromWikitext(wikitext)
            || extractAuthorFromCategories(data?.parse?.categories || [])
            || guessAuthorFromTitle(pageTitle + ' ' + categories);

    const result = {
        title: (data?.parse?.title || pageTitle).replace(/\s*\([^)]+\)\s*$/, '').trim() || pageTitle,
        author: resolveAuthorName(author, pageTitle),
        pageTitle,
        text,
        source: `${base}/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`
    };
    parseCache.set(cacheKey, { at: Date.now(), data: result });
    return result;
}

function guessAuthorFromTitle(title) {
    if (/Chairil/i.test(title)) return 'Chairil Anwar';
    if (/Amir Hamzah/i.test(title)) return 'Amir Hamzah';
    if (/Sanusi/i.test(title)) return 'Sanusi Pane';
    if (/Sapardi/i.test(title)) return 'Sapardi Djoko Damono';
    if (/Rendra/i.test(title)) return 'W.S. Rendra';
    if (/Hamka/i.test(title)) return 'Hamka';
    if (/Iwan/i.test(title)) return 'Iwan Simatupang';
    return null;
}

function extractAuthorFromWikitext(wt) {
    const patterns = [
        /\|\s*penulis\s*=\s*([^\n|]+)/i,
        /\|\s*author\s*=\s*([^\n|]+)/i,
        /\{\{[^|]*Penyair\|([^}|]+)/i,
        /\{\{Karya\s*\|[^|]*\|[^|]*\|([^}|]+)/i
    ];
    for (const re of patterns) {
        const m = wt.match(re);
        if (m?.[1]) {
            const name = m[1].replace(/\[\[|\]\]/g, '').split('|').pop().trim();
            if (name.length > 2 && !/redaksi|anonim/i.test(name)) return name;
        }
    }
    return null;
}

function extractAuthorFromCategories(categories) {
    const known = ['Chairil Anwar', 'Amir Hamzah', 'Sanusi Pane', 'Sapardi Djoko Damono', 'W.S. Rendra', 'Hamka'];
    for (const cat of categories) {
        const name = String(cat['*'] || '').replace(/_/g, ' ');
        const hit = known.find((k) => name.includes(k) || k.replace(/\s/g, '').toLowerCase() === name.replace(/\s/g, '').toLowerCase());
        if (hit) return hit;
    }
    return null;
}

function resolveAuthorName(author, pageTitle) {
    const bad = !author || /^(penyair|puisi|sajak|anonim|unknown|penulis)$/i.test(author.trim());
    if (!bad) return author.trim();
    return guessAuthorFromTitle(pageTitle) || 'Penyair';
}

async function wikipediaExtract(lang, title) {
    const base = lang === 'id' ? 'https://id.wikipedia.org' : 'https://en.wikipedia.org';
    try {
        const data = await wikiApi(base, {
            action: 'query', titles: title, prop: 'extracts', explaintext: true, format: 'json'
        });
        const page = Object.values(data?.query?.pages || {})[0];
        return page?.extract?.trim() || '';
    } catch {
        return '';
    }
}

async function poetryDbFullPoem(title, author) {
    if (!title || !author) return null;
    try {
        const { data } = await axios.get(
            `https://poetrydb.org/title,author/${encodeURIComponent(title)}/${encodeURIComponent(author)}`,
            HTTP
        );
        if (Array.isArray(data) && data.length) return poemFromPoetryDb(data[0]);
    } catch { /* skip */ }
    return null;
}

function authorMatchesRegion(author, regionKey) {
    const list = WORLD_AUTHORS[regionKey] || [];
    const a = String(author || '').toLowerCase();
    return list.some((name) => {
        const parts = name.toLowerCase().split(/\s+/).filter((p) => p.length > 3);
        return parts.some((p) => a.includes(p));
    });
}

async function poetryDbLinesForTopic(topic, regionKey = null) {
    const key = normalizeSastraTopic(topic);
    const queries = TOPIC_EN_QUERIES[key] || [TOPIC_EN[key] || 'love'];
    const hits = [];
    const seen = new Set();

    const lang = regionKey === 'inggris' ? 'en' : 'id';
    for (const q of pickRandomN(queries, 2)) {
        try {
            const { data } = await axios.get(`https://poetrydb.org/lines/${encodeURIComponent(q)}`, HTTP);
            if (!Array.isArray(data) || !data.length) continue;

            const shuffled = [...data].sort(() => Math.random() - 0.5);
            for (const row of shuffled.slice(0, 6)) {
                if (regionKey && !authorMatchesRegion(row.author, regionKey)) continue;
                const cacheKey = `${row.title}|${row.author}`;
                if (seen.has(cacheKey)) continue;
                seen.add(cacheKey);

                let poem = poemFromPoetryDb(row);
                if (!isValidPoem(poem, lang)) {
                    const full = await poetryDbFullPoem(row.title, row.author);
                    if (full) poem = full;
                }
                if (isValidPoem(poem, lang)) hits.push(poem);
                if (hits.length >= 5) return hits;
            }
        } catch { /* next */ }
    }
    return hits;
}

async function poetryDbAuthor(author) {
    try {
        const { data } = await axios.get(`https://poetrydb.org/author/${encodeURIComponent(author)}`, HTTP);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

async function poetryDbRandom(count = 5) {
    try {
        const { data } = await axios.get(`https://poetrydb.org/random/${count}`, HTTP);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function poemFromPoetryDb(row) {
    const lines = Array.isArray(row.lines) ? row.lines.join('\n') : String(row.lines || '');
    return {
        title: row.title || 'Tanpa Judul',
        author: row.author || 'Anonim',
        text: cleanPoemText(lines),
        source: `https://poetrydb.org/author/${encodeURIComponent(row.author || '')}`
    };
}

function getTopicData(topic) {
    const key = normalizeSastraTopic(topic);
    return SASTRA_TOPICS[key] || SASTRA_TOPICS.cinta;
}

function getDailyPhrase(topic) {
    return pickRandom(getTopicData(topic).seharihari);
}

async function tryParsePoem(lang, title, regionKey = null) {
    if (isJunkTitle(title, lang)) return null;
    try {
        const p = await wikisourceParse(lang, title);
        p.lang = lang;
        if (regionKey && lang === 'en') {
            p.author = guessWorldAuthor(title, regionKey);
        }
        if (p.title.includes('/')) {
            p.title = p.title.split('/').pop().trim() || p.title;
        }
        if (!isValidPoem(p, lang)) return null;
        return p;
    } catch (e) {
        console.log('wikisource parse skip:', title, e.message);
        return null;
    }
}

async function fetchIndonesiaPoem(topic) {
    const key = normalizeSastraTopic(topic);
    const seeds = pickRandomN(ID_POEM_PAGES[key] || ID_POEM_PAGES.cinta, 4);
    for (const title of seeds) {
        const p = await tryParsePoem('id', title);
        if (p) return p;
    }
    const query = pickRandom(ID_SEARCH[key] || ID_SEARCH.cinta);
    const searchHits = await wikisourceSearch('id', query);
    for (const title of searchHits.slice(0, 4)) {
        const p = await tryParsePoem('id', title);
        if (p) return p;
    }
    throw new Error('Gagal memuat karya sastra. Coba lagi.');
}

async function fetchEnglishPoem(topic) {
    const regionKey = 'inggris';
    const authorOrder = pickRandomN(WORLD_AUTHORS[regionKey], 3);

    for (const author of authorOrder) {
        const authorPoems = await poetryDbAuthor(author);
        const mapped = authorPoems
            .map((r) => poemFromPoetryDb(r))
            .filter((p) => p.text.length > 80 && !looksLikePublisherBoilerplate(p.text));
        const valid = mapped.filter((p) => isValidPoem(p, 'en'));
        if (valid.length) return pickRandom(valid);
        if (mapped.length) return pickRandom(mapped);
    }

    const topicHits = await poetryDbLinesForTopic(topic, regionKey);
    if (topicHits.length) return pickRandom(topicHits);

    const random = await poetryDbRandom(6);
    for (const r of random) {
        const poem = poemFromPoetryDb(r);
        if (isValidPoem(poem, 'en') && authorMatchesRegion(poem.author, regionKey)) return poem;
    }
    throw new Error('Gagal memuat karya sastra. Coba lagi.');
}

async function fetchWikisourceWorldPoem(topic, regionKey) {
    const seeds = [...(WORLD_WS_SEEDS[regionKey] || [])].sort(() => Math.random() - 0.5);
    for (const title of seeds) {
        const p = await tryParsePoem('en', title, regionKey);
        if (p) return p;
    }

    const key = normalizeSastraTopic(topic);
    const topicEn = TOPIC_EN[key] || 'love';
    const queries = WORLD_WS_QUERIES[regionKey] || [`${WORLD_AUTHORS[regionKey]?.[0]} poem`];
    for (const q of pickRandomN(queries, 2)) {
        const hits = await wikisourceSearch('en', `${q} ${topicEn}`);
        for (const title of hits.slice(0, 5)) {
            const p = await tryParsePoem('en', title, regionKey);
            if (p) return p;
        }
    }
    throw new Error('Gagal memuat karya sastra. Coba lagi.');
}

async function fetchWorldPoem(topic, regionKey) {
    if (regionKey === 'inggris') return fetchEnglishPoem(topic);
    return fetchWikisourceWorldPoem(topic, regionKey);
}

async function fetchOnePoem(topic, region) {
    if (region.key === 'indonesia') {
        const poem = await fetchIndonesiaPoem(topic);
        const authorName = resolveAuthorName(poem.author, poem.pageTitle);
        poem.author = authorName;
        return { poem, lang: 'id', authorName };
    }
    if (region.key === 'random') {
        const useIndo = Math.random() > 0.5;
        if (useIndo) return fetchOnePoem(topic, { key: 'indonesia' });
        return fetchOnePoem(topic, { key: pickRandom(Object.keys(WORLD_AUTHORS)) });
    }
    const poem = await fetchWorldPoem(topic, region.key);
    return { poem, lang: 'en', authorName: poem.author };
}

function buildTopicReflection(topic, daily, main) {
    const td = getTopicData(topic);
    return (
        `${td.refleksi}\n\n` +
        `Karya *${main.title}* karya *${main.author}* mengangkat tema *${td.label}*. ` +
        `Bandingkan ungkapan sehari-hari *"${daily}"* dengan kutipan di atas — ` +
        `sastra membentang lebih panjang, dalam, dan penuh kiasan.`
    );
}

export function formatSastraMessage(payload) {
    const { region, topic, poem, daily, bio, translation, isForeign } = payload;
    const td = getTopicData(topic);
    const fullText = cleanPoemText(poem.text);
    const lineCount = fullText.split('\n').filter(Boolean).length;
    const displayText = fullText.length > 2400 ? fullText.slice(0, 2400) + '\n\n[...]' : fullText;

    let msg =
        `📜 *SASTRA ${region.flag} ${region.name.toUpperCase()}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🎭 *Topik:* ${td.label}\n` +
        `_${td.pengantar}_\n\n` +
        `📚 *BAHASA SEHARI-HARI → SASTRA*\n\n` +
        `💬 *Sehari-hari:* "${daily}"\n\n` +
        `✨ *Dalam sastra* — _${poem.title}_ · ${poem.author} · _${lineCount} baris_\n` +
        `_${displayText}_`;

    if (isForeign && translation) {
        msg += `\n\n🌏 *Arti dalam bahasa Indonesia:*\n_${translation}_`;
    }

    msg +=
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 *Tentang ${poem.author}*\n` +
        (bio ? `${bio.slice(0, 400)}…\n\n` : '') +
        `📝 *Refleksi tema ${td.label}*\n` +
        `${buildTopicReflection(topic, daily, poem)}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🕐 ${nowWib()} WIB\n` +
        `_💡 \`!sastra ${topic}\` lagi → karya lain, selalu berbeda_`;

    return msg;
}

function isValidExcerpt(text, fullText = text) {
    const minLen = fullText.length < 400 ? 40 : 180;
    return text.length >= minLen && isValidPoemText(text) && !looksLikePublisherBoilerplate(text);
}

export async function fetchLiveSastra(topic, region) {
    const daily = getDailyPhrase(topic);
    const isForeign = region.key !== 'indonesia';

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const { poem, lang, authorName } = await fetchOnePoem(topic, region);
            if (!poem?.text || looksLikePublisherBoilerplate(poem.text)) continue;

            const body = cleanPoemText(poem.text);
            if (!body || looksLikePublisherBoilerplate(body)) continue;

            const foreign = isForeign && lang !== 'id';
            const bioP = (authorName && !/penyair/i.test(authorName))
                ? wikipediaExtract(lang, authorName).catch(() => '')
                : Promise.resolve('');
            const trP = foreign
                ? translateText(body.slice(0, 500), 'en', 'id').catch(() => null)
                : Promise.resolve(null);

            const [bio, tr] = await Promise.all([bioP, trP]);
            const translation = tr?.output && !looksLikePublisherBoilerplate(tr.output) ? tr.output : '';

            return formatSastraMessage({
                region, topic, poem, daily, bio, translation,
                isForeign: foreign
            });
        } catch { /* coba lagi */ }
    }
    throw new Error('Gagal memuat karya sastra. Coba lagi.');
}