import axios from 'axios';

const HTTP = {
    timeout: 12000,
    headers: { 'User-Agent': 'LuxxBot/3.1 (WhatsApp)', Accept: 'application/json' }
};

export const LANG_CATALOG = {
    id: { name: 'Bahasa Indonesia', flag: '🇮🇩' },
    en: { name: 'English', flag: '🇬🇧' },
    ms: { name: 'Melayu', flag: '🇲🇾' },
    ja: { name: 'Jepang', flag: '🇯🇵' },
    ko: { name: 'Korea', flag: '🇰🇷' },
    zh: { name: 'Mandarin', flag: '🇨🇳' },
    ar: { name: 'Arab', flag: '🇸🇦' },
    es: { name: 'Spanyol', flag: '🇪🇸' },
    fr: { name: 'Prancis', flag: '🇫🇷' },
    de: { name: 'Jerman', flag: '🇩🇪' },
    pt: { name: 'Portugis', flag: '🇵🇹' },
    ru: { name: 'Rusia', flag: '🇷🇺' },
    hi: { name: 'Hindi', flag: '🇮🇳' },
    th: { name: 'Thailand', flag: '🇹🇭' },
    vi: { name: 'Vietnam', flag: '🇻🇳' },
    tr: { name: 'Turki', flag: '🇹🇷' },
    it: { name: 'Italia', flag: '🇮🇹' },
    nl: { name: 'Belanda', flag: '🇳🇱' },
    fil: { name: 'Filipina', flag: '🇵🇭' }
};

const LINGVA_HOSTS = [
    'https://lingva.ml',
    'https://lingva.garudalinux.org',
    'https://translate.plausibility.cloud'
];

const ID_HINTS = /\b(yang|dan|di|ke|dari|saya|kamu|tidak|ada|ini|itu|untuk|dengan|akan|sudah|juga|bisa|atau|pada|sebagai|karena|tetapi|namun|sangat|lebih|hanya|masih|telah|harus|perlu|semua|mereka|kita|kami|adalah|bahwa|kalau|jika|dong|nih|gak|nggak)\b/i;

function nowWib() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function langLabel(code) {
    const c = LANG_CATALOG[code];
    return c ? `${c.flag} ${c.name} (${code})` : code;
}

function detectScript(text) {
    if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(text)) return /[\u3040-\u30ff]/.test(text) ? 'ja' : 'zh';
    if (/[\uac00-\ud7af]/.test(text)) return 'ko';
    if (/[\u0600-\u06ff]/.test(text)) return 'ar';
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';
    if (/[\u0e00-\u0e7f]/.test(text)) return 'th';
    return null;
}

export function detectSourceLang(text) {
    const script = detectScript(text);
    if (script) return script;
    if (ID_HINTS.test(text)) return 'id';
    return 'en';
}

export function parseTranslateInput(rawArgs) {
    const input = (rawArgs || []).join(' ').trim();
    if (!input) return { kind: 'empty' };
    const lower = input.toLowerCase();
    if (lower === 'help' || lower === 'bantuan' || lower === '?') return { kind: 'help' };
    if (lower === 'list' || lower === 'bahasa' || lower === 'lang') return { kind: 'list' };

    const parts = input.split(/\s+/);
    if (parts.length >= 3 && LANG_CATALOG[parts[0]] && LANG_CATALOG[parts[1]]) {
        return {
            kind: 'translate',
            from: parts[0],
            to: parts[1],
            text: parts.slice(2).join(' ')
        };
    }

    return {
        kind: 'translate',
        from: 'auto',
        to: 'auto',
        text: input
    };
}

async function translateMyMemory(text, from, to) {
    const q = String(text).trim().slice(0, 480);
    const { data } = await axios.get('https://api.mymemory.translated.net/get', {
        params: { q, langpair: `${from}|${to}` },
        timeout: 10000,
        headers: HTTP.headers
    });
    const out = data?.responseData?.translatedText?.trim();
    const quality = data?.responseData?.match || data?.responseData?.quality;
    if (!out || /QUERY LENGTH LIMIT|MYMEMORY WARNING|INVALID/i.test(out)) return null;
    if (out.toUpperCase() === q.toUpperCase() && from !== to) return null;
    return { text: out, provider: 'MyMemory Dictionary', quality };
}

async function translateLingva(text, from, to) {
    const encoded = encodeURIComponent(text.slice(0, 400));
    for (const host of LINGVA_HOSTS) {
        try {
            const { data } = await axios.get(`${host}/api/v1/${from}/${to}/${encoded}`, {
                timeout: 10000,
                headers: HTTP.headers
            });
            const out = data?.translation?.trim();
            if (out) return { text: out, provider: 'Lingva Translate' };
        } catch {
            /* next host */
        }
    }
    return null;
}

async function translateLibre(text, from, to) {
    try {
        const { data } = await axios.post(
            'https://translate.argosopentech.com/translate',
            { q: text.slice(0, 480), source: from, target: to, format: 'text' },
            { timeout: 12000, headers: { 'Content-Type': 'application/json', ...HTTP.headers } }
        );
        const out = data?.translatedText?.trim();
        if (out) return { text: out, provider: 'LibreTranslate' };
    } catch {
        /* skip */
    }
    return null;
}

export async function translateText(text, from = 'auto', to = 'auto') {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('Teks kosong');

    let src = from === 'auto' ? detectSourceLang(raw) : from;
    let dst = to === 'auto' ? (src === 'id' ? 'en' : 'id') : to;
    if (src === dst) dst = src === 'id' ? 'en' : 'id';

    const attempts = [
        () => translateLingva(raw, src, dst),
        () => translateMyMemory(raw, src, dst),
        () => translateLibre(raw, src, dst)
    ];

    let result = null;
    for (const fn of attempts) {
        try {
            const tryResult = await fn();
            if (!tryResult?.text) continue;
            const q = Number(tryResult.quality);
            if (tryResult.provider?.includes('MyMemory') && q > 0 && q < 40) continue;
            result = tryResult;
            break;
        } catch (e) {
            console.log('translate skip:', e.message);
        }
    }

    if (!result?.text) throw new Error('Layanan kamus sedang sibuk. Coba lagi sebentar.');

    return {
        input: raw,
        output: result.text,
        from: src,
        to: dst,
        provider: result.provider,
        quality: result.quality,
        autoDetected: from === 'auto'
    };
}

export function getTranslateHelpText() {
    return (
        `🌐 *LUXX TRANSLATE — Kamus Dunia*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *Cara pakai:*\n` +
        `├ \`!translate <teks>\` → auto detect → terjemah\n` +
        `├ \`!translate id en selamat pagi\` → Indo → Inggris\n` +
        `├ \`!translate en id good morning\` → Inggris → Indo\n` +
        `├ \`!translate ja id こんにちは\` → Jepang → Indo\n` +
        `├ \`!translate list\` → daftar bahasa\n` +
        `└ \`!translate help\` → panduan ini\n\n` +
        `💡 *Tips:*\n` +
        `• Tanpa kode bahasa → bot deteksi otomatis\n` +
        `• Teks Indonesia → diterjemah ke Inggris\n` +
        `• Teks asing → diterjemah ke Indonesia\n` +
        `• Sumber: MyMemory + Lingva + LibreTranslate\n\n` +
        `🌍 *Bahasa populer:* id · en · ja · ko · zh · ar · es · fr · de · pt · ru · th · vi`
    );
}

export function getTranslateListText() {
    const lines = Object.entries(LANG_CATALOG).map(([code, v]) => `├ ${v.flag} \`${code}\` — ${v.name}`);
    return (
        `🗣️ *BAHASA TERSEDIA*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        lines.join('\n') +
        `\n\n_Format: \`!translate <dari> <ke> <teks>\`_`
    );
}

export function formatTranslateResult(result) {
    const qualityNote = result.quality
        ? `\n📊 *Akurasi kamus:* ~${Math.round(Number(result.quality))}%`
        : '';
    const detectNote = result.autoDetected
        ? `\n🔍 *Deteksi:* otomatis → ${langLabel(result.from)}`
        : '';

    return (
        `🌐 *LUXX TRANSLATE*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📝 *Asal:* ${langLabel(result.from)}\n` +
        `🎯 *Tujuan:* ${langLabel(result.to)}${detectNote}\n\n` +
        `🔤 *Teks asli:*\n` +
        `> ${result.input}\n\n` +
        `✨ *Hasil terjemahan:*\n` +
        `_${result.output}_\n\n` +
        `📚 *Sumber:* ${result.provider}${qualityNote}\n` +
        `🕐 *Diproses:* ${nowWib()} WIB\n\n` +
        `_💡 \`!translate help\` · \`!translate list\` · \`!translate id en <teks>\`_`
    );
}