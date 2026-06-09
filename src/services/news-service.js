import axios from 'axios';
import * as cheerio from 'cheerio';

const HTTP = {
    timeout: 15000,
    headers: { 'User-Agent': 'LuxxBot/3.1 (WhatsApp)', Accept: 'application/rss+xml, application/xml, text/xml' }
};

export const NEWS_REGIONS = {
    indonesia: {
        key: 'indonesia', name: 'Indonesia', flag: '🇮🇩',
        feeds: ['https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id']
    },
    amerika: {
        key: 'amerika', name: 'Amerika Serikat', flag: '🇺🇸',
        feeds: ['https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en']
    },
    inggris: {
        key: 'inggris', name: 'Inggris', flag: '🇬🇧',
        feeds: ['https://news.google.com/rss?hl=en-GB&gl=GB&ceid=GB:en']
    },
    jepang: {
        key: 'jepang', name: 'Jepang', flag: '🇯🇵',
        feeds: ['https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja']
    },
    korea: {
        key: 'korea', name: 'Korea Selatan', flag: '🇰🇷',
        feeds: ['https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko']
    },
    india: {
        key: 'india', name: 'India', flag: '🇮🇳',
        feeds: ['https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en']
    },
    jerman: {
        key: 'jerman', name: 'Jerman', flag: '🇩🇪',
        feeds: ['https://news.google.com/rss?hl=de&gl=DE&ceid=DE:de']
    },
    prancis: {
        key: 'prancis', name: 'Prancis', flag: '🇫🇷',
        feeds: ['https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr']
    },
    arab: {
        key: 'arab', name: 'Timur Tengah', flag: '🇸🇦',
        feeds: ['https://news.google.com/rss?hl=ar&gl=AE&ceid=AE:ar']
    },
    brazil: {
        key: 'brazil', name: 'Brasil', flag: '🇧🇷',
        feeds: ['https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419']
    },
    australia: {
        key: 'australia', name: 'Australia', flag: '🇦🇺',
        feeds: ['https://news.google.com/rss?hl=en-AU&gl=AU&ceid=AU:en']
    },
    internasional: {
        key: 'internasional', name: 'Internasional', flag: '🌍',
        feeds: [
            'https://feeds.bbci.co.uk/news/world/rss.xml',
            'https://www.aljazeera.com/xml/rss/all.xml'
        ]
    }
};

const REGION_ALIASES = {
    id: 'indonesia', indo: 'indonesia', ri: 'indonesia',
    us: 'amerika', usa: 'amerika', america: 'amerika',
    uk: 'inggris', gb: 'inggris', england: 'inggris',
    jp: 'jepang', japan: 'jepang',
    kr: 'korea', korsel: 'korea',
    in: 'india',
    de: 'jerman', germany: 'jerman',
    fr: 'prancis', france: 'prancis',
    sa: 'arab', uae: 'arab', middleeast: 'arab',
    br: 'brazil', brasil: 'brazil',
    au: 'australia',
    world: 'internasional', dunia: 'internasional', global: 'internasional', all: 'dunia'
};

function stripHtml(html) {
    return String(html || '')
        .replace(/<!\[CDATA\[/g, '')
        .replace(/\]\]>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function parseRssXml(xml, limit = 5) {
    const items = [];
    const $ = cheerio.load(xml, { xmlMode: true });
    $('item').each((_, el) => {
        if (items.length >= limit) return false;
        const title = stripHtml($(el).find('title').text());
        const description = stripHtml($(el).find('description').text());
        const pubDate = $(el).find('pubDate').text().trim();
        const link = $(el).find('link').text().trim();
        const source = $(el).find('source').text().trim();
        if (!title) return;
        items.push({
            title: title.slice(0, 200),
            summary: description.slice(0, 320) || 'Berita terkini dari sumber media terpercaya.',
            pubDate: pubDate || '',
            link,
            source: source || ''
        });
    });
    return items;
}

async function fetchFeed(url, limit = 4) {
    const { data } = await axios.get(url, HTTP);
    return parseRssXml(data, limit);
}

function formatDate(pubDate) {
    if (!pubDate) return 'Baru saja';
    try {
        return new Date(pubDate).toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        });
    } catch {
        return pubDate.slice(0, 20);
    }
}

function resolveRegion(query) {
    const q = String(query || '').toLowerCase().trim();
    if (!q || q === 'dunia' || q === 'world' || q === 'all' || q === 'global') return 'dunia';
    if (NEWS_REGIONS[q]) return q;
    if (REGION_ALIASES[q]) return REGION_ALIASES[q];
    return null;
}

export function getBeritaHelpText() {
    const regions = Object.values(NEWS_REGIONS)
        .map((r) => `${r.flag} \`${r.key}\``)
        .join(' · ');
    return (
        `📰 *LUXX BERITA — Update Dunia Nyata*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *Cara pakai:*\n` +
        `├ \`!berita\` → headline multi-negara (dunia)\n` +
        `├ \`!berita indonesia\` → berita Indonesia\n` +
        `├ \`!berita amerika\` → berita AS\n` +
        `├ \`!berita jepang\` → berita Jepang\n` +
        `└ \`!berita help\` → panduan ini\n\n` +
        `🌍 *Negara tersedia:*\n${regions}\n\n` +
        `_Sumber: Google News RSS + BBC + Al Jazeera · update real-time_`
    );
}

export function getBeritaRegionListText() {
    const lines = Object.values(NEWS_REGIONS).map((r) => `├ ${r.flag} \`!berita ${r.key}\` — ${r.name}`);
    return `🗺️ *REGION BERITA*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${lines.join('\n')}\n\n└ \`!berita\` tanpa argumen = ringkasan dunia`;
}

function formatNewsItem(item, index, region) {
    const when = formatDate(item.pubDate);
    const src = item.source ? ` · _${item.source}_` : '';
    return (
        `*${index}. ${region.flag} ${item.title}*\n` +
        `📋 ${item.summary}\n` +
        `🕐 ${when}${src}`
    );
}

async function fetchRegionNews(regionKey, perFeed = 3) {
    const region = NEWS_REGIONS[regionKey];
    if (!region) return [];
    const all = [];
    for (const feed of region.feeds) {
        try {
            const items = await fetchFeed(feed, perFeed);
            for (const item of items) {
                all.push({ ...item, region });
            }
        } catch (e) {
            console.log(`berita feed skip ${regionKey}:`, e.message);
        }
    }
    return all;
}

export async function buildBeritaText(query = '') {
    const q = String(query || '').toLowerCase().trim();
    if (q === 'help' || q === 'bantuan' || q === '?') return getBeritaHelpText();
    if (q === 'list' || q === 'negara') return getBeritaRegionListText();

    const regionKey = resolveRegion(q);

    if (regionKey === 'dunia') {
        const picks = ['indonesia', 'amerika', 'inggris', 'jepang', 'internasional', 'prancis'];
        const blocks = [];
        for (const key of picks) {
            const items = await fetchRegionNews(key, 2);
            if (!items.length) continue;
            const region = NEWS_REGIONS[key];
            blocks.push({
                region,
                items: items.slice(0, 2)
            });
        }
        if (!blocks.length) throw new Error('Berita tidak tersedia saat ini. Coba lagi sebentar.');

        let text =
            `📰 *BERITA DUNIA — LIVE UPDATE*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🌍 Headline dari ${blocks.length} negara · ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n`;

        let n = 1;
        for (const block of blocks) {
            text += `${block.region.flag} *${block.region.name.toUpperCase()}*\n`;
            for (const item of block.items) {
                text += formatNewsItem(item, n, block.region) + '\n\n';
                n += 1;
            }
        }
        text += `_💡 \`!berita indonesia\` · \`!berita amerika\` · \`!berita list\`_`;
        return text;
    }

    const resolved = regionKey || 'indonesia';
    const region = NEWS_REGIONS[resolved];
    if (!region) {
        return getBeritaHelpText() + `\n\n❌ Region \`${query}\` tidak dikenal. Ketik \`!berita list\`.`;
    }

    const items = await fetchRegionNews(resolved, 5);
    if (!items.length) throw new Error(`Berita ${region.name} tidak tersedia. Coba lagi.`);

    let text =
        `📰 *BERITA ${region.name.toUpperCase()}* ${region.flag}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🕐 Update: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n`;

    items.slice(0, 5).forEach((item, i) => {
        text += formatNewsItem(item, i + 1, region) + '\n\n';
    });

    text += `_Sumber media terpercaya · \`!berita\` untuk dunia · \`!berita list\`_`;
    return text;
}