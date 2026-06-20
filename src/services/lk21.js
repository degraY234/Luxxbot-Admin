import https from 'https';
import axios from 'axios';
import * as cheerio from 'cheerio';

const DEFAULT_BASES = [
    process.env.LK21_BASE_URL?.trim(),
    'https://lk21.lat',
    'https://lk21.us',
    'https://lk21.one',
    'https://www.lk21.mom',
    'https://lk21.world',
    'https://lk21.film',
    'https://lk21.dev',
    'https://lk21.my.id',
    'https://lk21.diy'
].filter(Boolean);

const REBAHIN_BASES = [
    process.env.REBAHIN_BASE_URL?.trim(),
    'https://rebahin.lol',
    'https://rebahin.life',
    'https://rebahin.space',
    'https://rebahin.uno'
].filter(Boolean);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const lk21Https = new https.Agent({ rejectUnauthorized: false });
const lk21CookieJar = new Map();

function getLk21Headers(extra = {}) {
    return {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        ...extra
    };
}

function getLk21Cookies(hostname) {
    const cookies = [];
    for (const [domain, entries] of lk21CookieJar.entries()) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            for (const [name, value] of entries.entries()) {
                cookies.push(`${name}=${value}`);
            }
        }
    }
    return cookies.join('; ');
}

function setLk21Cookie(hostname, name, value) {
    if (!lk21CookieJar.has(hostname)) lk21CookieJar.set(hostname, new Map());
    lk21CookieJar.get(hostname).set(name, value);
}

const AD_IFRAME_RE = /a-ads|coinserom|acceptable\.a-ads|ads\.|doubleclick|googlesyndication/i;
const EMBED_LOW_PRIORITY = /gdriveplayer|googleusercontent|docs\.google/i;
const EMBED_PRIORITY = [
    /vidplayer\.live/i,       // 0 - resolvable to direct stream
    /\/embed\//i,             // 1 - traditional iframe embeds
    /minochinos/i,            // 2 - reliable iframe embed
    /abyssplayer/i,           // 3 - reliable iframe embed
    /\/v\/[a-z0-9]+/i,       // 4 - direct video paths
    /\/e\/[a-z0-9]+/i,       // 5 - path-based embeds (SPA-ish)
    /bysesayeveum/i,          // 6 - React SPA (less reliable in iframe)
    /vidsrc/i,                // 7
    /chillx\.top/i,           // 8
    /playerx\.stream/i,       // 9
    /dood(?:stream|watch)?/i, // 10
    /filemoon/i,              // 11
    /streamtape/i,            // 12
    /mixdrop/i,               // 13
    /upstream/i,              // 14
    /supervideo/i,            // 15
    /streamlare/i,            // 16
    /embed/i,                 // 17 - generic
    /player/i                 // 18 - generic
];

function getBase() {
    return DEFAULT_BASES[0] || 'https://lk21.us';
}

function absUrl(base, href = '') {
    if (!href) return '';
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return `https:${href}`;
    return `${base.replace(/\/$/, '')}${href.startsWith('/') ? '' : '/'}${href}`;
}

function isBlockedMirror(html) {
    const h = String(html || '').slice(0, 8000).toLowerCase();
    return h.includes('safesurf') || h.includes('biznetnetworks') || h.includes('we are sorry');
}

async function fetchHtml(url) {
    const u = new URL(url);
    const hostname = u.hostname;
    const cookieStr = getLk21Cookies(hostname);
    const base = getBase().replace(/\/$/, '');
    
    const headers = getLk21Headers({
        Referer: `${base}/`,
        Cookie: cookieStr || undefined
    });

    const { data, headers: respHeaders } = await axios.get(url, {
        timeout: 22000,
        httpsAgent: lk21Https,
        headers,
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 400
    });

    // Save cookies from response
    const setCookie = respHeaders['set-cookie'];
    if (setCookie) {
        for (const sc of setCookie) {
            const parts = sc.split(';')[0].split('=');
            if (parts.length >= 2) {
                setLk21Cookie(hostname, parts[0].trim(), parts.slice(1).join('=').trim());
            }
        }
    }

    if (isBlockedMirror(data)) throw new Error('Mirror diblokir ISP');
    return data;
}

function cleanTitle(raw = '') {
    return String(raw)
        .replace(/^Permalink to:\s*/i, '')
        .replace(/\s*\|\s*LK21.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function titleFromSlug(url = '') {
    // Try /sinopsis/{slug} pattern first
    let m = String(url).match(/\/sinopsis\/([^/]+)\/?$/i);
    // Try direct /{slug} pattern (muvipro theme)
    if (!m) {
        m = String(url).match(/(?:https?:\/\/[^\/]+)\/([a-z0-9][a-z0-9-]+)\/?$/i);
    }
    if (!m) return '';
    return m[1]
        .replace(/-/g, ' ')
        .replace(/\b(sub indo|subindo|film)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function pushResult(results, seen, item) {
    if (!item?.url || item.url.includes('/author/') || item.url.includes('/category/')) return;
    if (!item.title || item.title.length < 2) {
        item.title = titleFromSlug(item.url);
    }
    if (!item?.title || item.title.length < 2) return;
    if (seen.has(item.url)) return;
    seen.add(item.url);
    results.push(item);
}

function parseFilmNode(node, $, base, seen, results) {
    let a = node.find('a[href*="sinopsis"]').first();
    let href = a.attr('href') || '';
    
    // If no sinopsis link found, try any post/page link (muvipro theme uses direct /slug/ URLs)
    if (!href || href === '#' || href.startsWith('javascript') || href.includes('/category/') || href.includes('/author/')) {
        const allLinks = node.find('a[href^="http"]').filter((_, el) => {
            const h = $(el).attr('href') || '';
            const u = h.toLowerCase();
            return u.includes(base.replace(/\/$/, '').toLowerCase() + '/') 
                && !u.includes('/category/') && !u.includes('/author/') && !u.includes('/tag/')
                && !u.includes('/page/') && !u.includes('.css') && !u.includes('.js')
                && !u.includes('.png') && !u.includes('.jpg') && !u.includes('.webp')
                && !u.includes('/wp-') && !u.includes('/feed') && !u.includes('/cdn-')
                && !u.includes('/quality/') && !u.includes('/year/')
                && !u.match(/\/(best-rating|order-by|index-movie|country)\//);
        });
        if (allLinks.length > 0) {
            a = $(allLinks[0]);
            href = a.attr('href') || '';
        }
    }
    
    if (!href || href === '#' || href.startsWith('javascript')) return;
    if (href.includes('/author/') || href.includes('/category/')) return;

    let title = cleanTitle(node.find('h2, h3, .tt, .entry-title, .idmuvi-rp-title').first().text());
    if (!title) title = cleanTitle(a.attr('title') || '');
    if (!title) title = cleanTitle(a.text());
    if (!title) title = cleanTitle(node.find('img').first().attr('alt') || '');
    // Fallback: use the whole article title text
    if (!title || title.length < 2) {
        title = cleanTitle(node.find('.gmr-box-content h2, .gmr-box-content h3').first().text());
    }
    if (!title || title.length < 2) {
        title = cleanTitle(node.text().split('\n').map(s => s.trim()).filter(s => s.length > 3)[0] || '');
    }

    const poster = node.find('img').first().attr('src')
        || node.find('img').first().attr('data-src')
        || node.find('img').first().attr('data-lazy-src') || '';
    const year = (node.find('.year, .yt, span.year').first().text() || '').trim();

    pushResult(results, seen, {
        title: title.slice(0, 120),
        year,
        poster: poster.startsWith('http') || poster.startsWith('//') ? absUrl(base, poster) : absUrl(base, poster),
        url: absUrl(base, href),
        source: 'lk21'
    });
}

function parseSearchHtml(html, base, limit = 48) {
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();

    $('article, .film-list .film-item, .search-item, .bsx, .gmr-grid .item, .idmuvi-rp li').each((_, el) => {
        parseFilmNode($(el), $, base, seen, results);
    });

    if (!results.length) {
        $('h2.entry-title a, h3.entry-title a, .content-thumbnail a[href*="sinopsis"]').each((_, el) => {
            const a = $(el);
            const href = a.attr('href') || '';
            if (!href.includes('/sinopsis/') || href.includes('/category/')) return;
            const title = cleanTitle(a.text() || a.attr('title'));
            const poster = a.find('img').attr('src') || a.closest('article').find('img').first().attr('src') || '';
            pushResult(results, seen, {
                title: title.slice(0, 120),
                year: '',
                poster: absUrl(base, poster),
                url: absUrl(base, href),
                source: 'lk21'
            });
        });
    }

    return results.slice(0, limit);
}

function isAdIframe(src = '') {
    return AD_IFRAME_RE.test(src);
}

function normalizeMediaUrl(raw, base) {
    let url = String(raw || '').trim();
    if (!url) return '';
    if (url.startsWith('//')) url = `https:${url}`;
    if (!url.startsWith('http')) {
        if (/^[\w.-]+\.[a-z]{2,}/i.test(url)) url = `https://${url}`;
        else url = absUrl(base, url);
    }
    return url;
}

function scoreEmbed(url = '') {
    const u = String(url);
    if (EMBED_LOW_PRIORITY.test(u)) return EMBED_PRIORITY.length + 50;
    for (let i = 0; i < EMBED_PRIORITY.length; i++) {
        if (EMBED_PRIORITY[i].test(u)) return i;
    }
    return EMBED_PRIORITY.length + 10;
}

function isLikelyPlayerIframe(src = '') {
    const url = String(src);
    if (!url || isAdIframe(url)) return false;
    if (!/^https?:\/\//i.test(url) && !url.startsWith('//')) return false;
    if (/facebook|twitter|instagram|youtube\.com\/(?!embed)/i.test(url)) return false;
    if (/vidplayer\.live\/?$/i.test(url) && !/#[a-z0-9]+/i.test(url)) return false;
    if (EMBED_LOW_PRIORITY.test(url)) return true;
    return scoreEmbed(url) < EMBED_PRIORITY.length + 10 || /\/v\//i.test(url) || /#[a-z0-9]+$/i.test(url);
}

function collectEmbedCandidates($, html, base) {
    const found = new Set();

    $('iframe[src]').each((_, el) => {
        const src = normalizeMediaUrl($(el).attr('src'), base);
        if (src && isLikelyPlayerIframe(src)) found.add(src);
    });

    const patterns = [
        /https?:\/\/[^\s"'<>]*vidplayer\.live[^\s"'<>#]*/gi,
        /https?:\/\/[^\s"'<>]*vidplayer\.live#[^\s"'<>]*/gi,
        /https?:\/\/[^\s"'<>]*(?:vidsrc|chillx|playerx)[^\s"'<>]*/gi,
        /https?:\/\/[^\s"'<>]*(?:dood|filemoon|streamtape|mixdrop|p2p)[^\s"'<>]*/gi
    ];
    for (const re of patterns) {
        for (const m of html.matchAll(re)) {
            const url = normalizeMediaUrl(m[0], base);
            if (url && !url.includes('oembed') && !url.includes('wp-json') && isLikelyPlayerIframe(url)) {
                found.add(url);
            }
        }
    }

    const ld = html.match(/"embedUrl"\s*:\s*"([^"]+)"/);
    if (ld) {
        const url = normalizeMediaUrl(ld[1].replace(/\\u002F/g, '/'), base);
        if (url && !url.includes('oembed')) found.add(url);
    }

    return [...found].sort((a, b) => scoreEmbed(a) - scoreEmbed(b));
}

function collectVideoCandidates($, html, base) {
    const found = new Set();
    $('a.button[href], a.button-shadow[href], .gmr-server-wrap a[href], a[href*=".mp4"]').each((_, el) => {
        const href = normalizeMediaUrl($(el).attr('href'), base);
        if (href && /\.mp4(?:\?|$)/i.test(href)) found.add(href);
    });
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi)) {
        const url = normalizeMediaUrl(m[0], base);
        if (url) found.add(url);
    }
    return [...found];
}

async function probeVideoUrl(url) {
    const base = getBase().replace(/\/$/, '');
    const referers = [`${base}/`, 'https://lk21.us/', 'https://www.lk21.us/', ''];
    for (const referer of referers) {
        try {
            const headers = { 'User-Agent': UA, Accept: '*/*', Range: 'bytes=0-1' };
            if (referer) headers.Referer = referer;
            const res = await axios.get(url, {
                httpsAgent: lk21Https,
                headers,
                timeout: 12000,
                maxRedirects: 5,
                validateStatus: (s) => s >= 200 && s < 400
            });
            const type = String(res.headers['content-type'] || '');
            if (type.includes('video') || type.includes('octet-stream') || res.status === 206) {
                return true;
            }
        } catch (_) {}
    }
    return false;
}

function extractMaxPage(html) {
    let maxPage = 1;
    for (const m of String(html).matchAll(/\/page\/(\d+)\//gi)) {
        const n = parseInt(m[1], 10);
        if (n > maxPage) maxPage = n;
    }
    return maxPage;
}

function effectivePage(page, totalPages, sort) {
    const p = Math.max(1, Math.min(Number(page) || 1, totalPages || 1));
    if (sort === 'oldest') return Math.max(1, (totalPages || 1) - p + 1);
    return p;
}

const META_FIELD_RULES = [
    { key: 'genres', labels: ['genre'] },
    { key: 'year', labels: ['tahun', 'year'] },
    { key: 'country', labels: ['negara', 'country'] },
    { key: 'duration', labels: ['durasi', 'duration'] },
    { key: 'directors', labels: ['sutradara', 'director', 'directors'] },
    { key: 'cast', labels: ['pemeran', 'actor', 'actors', 'cast', 'bintang'] },
    { key: 'quality', labels: ['quality', 'kualitas'] }
];

function cleanSynopsisText(raw = '') {
    return String(raw)
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^(Nonton|Download|Streaming|Rebahin|Link)\b[^–-]*[–-]?\s*/i, '')
        .trim()
        .slice(0, 480);
}

function yearFromTitle(title = '') {
    const m = String(title).match(/\((\d{4})\)/);
    return m?.[1] || '';
}

function extractLabelFields($) {
    const found = {};
    $('article *').each((_, el) => {
        const label = $(el).clone().children().remove().end().text().replace(/\s+/g, ' ').trim().replace(/:$/, '');
        if (!label) return;
        for (const rule of META_FIELD_RULES) {
            if (found[rule.key]) continue;
            if (!rule.labels.some((l) => label.toLowerCase() === l)) continue;
            const block = $(el).closest('p, li, tr, div').text().replace(/\s+/g, ' ').trim();
            const val = block.replace(new RegExp(`^${label}\\s*:?\\s*`, 'i'), '').trim();
            if (val) found[rule.key] = val.slice(0, 280);
        }
    });
    return found;
}

function extractSynopsis($, title = '') {
    const paragraphs = [];
    $('.entry-content p, article .content p, .sinopsis p, .gmr-single-post p').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        if (t.length > 50) paragraphs.push(t);
    });

    for (const t of paragraphs) {
        const dash = t.match(/(?:Subtitle Indonesia|HD\s+Bluray|HD\s+CAM|Bluray)[^–-]*[–-]\s*(.+)$/i);
        if (dash?.[1] && dash[1].length > 35) return cleanSynopsisText(dash[1]);
    }

    const titleBit = String(title).replace(/\s*\(\d{4}\)\s*$/, '').trim();
    for (const t of paragraphs) {
        if (titleBit && t.includes(titleBit.slice(0, Math.min(18, titleBit.length)))) {
            const afterYear = t.match(/\(\d{4}\)\s*(.+)$/);
            if (afterYear?.[1] && afterYear[1].length > 35) return cleanSynopsisText(afterYear[1]);
        }
    }

    for (const t of paragraphs) {
        if (/^(Genre|Tahun|Negara|Durasi|Sutradara|Directors|Pemeran|Actors|Quality):/i.test(t)) continue;
        if (/^(Nonton|Download|Streaming|Rebahin|Link Streaming)/i.test(t) && t.length < 120) continue;
        if (t.length > 80) return cleanSynopsisText(t);
    }

    return '';
}

function extractFilmDetails($, html, title = '') {
    const fields = extractLabelFields($);
    const synopsis = extractSynopsis($, title);
    const year = fields.year || yearFromTitle(title);

    let genres = fields.genres || '';
    if (genres && fields.country) {
        genres = genres
            .split(',')
            .map((g) => g.trim())
            .filter((g) => g && g.toLowerCase() !== fields.country.toLowerCase())
            .join(', ');
    }

    const duration = fields.duration && /\d/.test(fields.duration) ? fields.duration.slice(0, 40) : '';

    const details = {
        synopsis,
        year,
        country: fields.country || '',
        duration,
        genres,
        directors: fields.directors || '',
        cast: fields.cast || '',
        quality: fields.quality || ''
    };

    const hasData = Object.values(details).some((v) => String(v || '').trim());
    return hasData ? details : null;
}

async function resolveEmbed(pageUrl, base) {
    const baseClean = base.replace(/\/$/, '');
    let html = await fetchHtml(pageUrl);
    const $ = cheerio.load(html);
    let embedCandidates = collectEmbedCandidates($, html, base);
    const videoCandidates = collectVideoCandidates($, html, base);

    // Try alternate servers (?player=2, ?player=3, etc.) to get more embed options
    const serverUrls = [];
    $('.muvipro-player-tabs a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const fullUrl = absUrl(baseClean, href);
        if (fullUrl && fullUrl !== pageUrl && !serverUrls.includes(fullUrl)) {
            serverUrls.push(fullUrl);
        }
    });

    for (const srvUrl of serverUrls.slice(0, 4)) {
        try {
            const srvHtml = await fetchHtml(srvUrl);
            const srv$ = cheerio.load(srvHtml);
            const srvEmbeds = collectEmbedCandidates(srv$, srvHtml, base);
            for (const u of srvEmbeds) {
                if (!embedCandidates.includes(u)) embedCandidates.push(u);
            }
        } catch (_) {}
    }

    // Deduplicate and score
    const uniqueEmbeds = [...new Set(embedCandidates)];
    const scored = uniqueEmbeds.map(u => ({ url: u, score: scoreEmbed(u) }));
    scored.sort((a, b) => a.score - b.score);

    // Prefer vidplayer.live as PRIMARY when present: it can be resolved server-side to direct HLS stream
    // (this avoids the "try server 1/2/3" problem for users)
    let embedUrl = scored.find(s => /vidplayer\.live/i.test(s.url))?.url
                || scored[0]?.url || '';
    let videoUrl = '';

    const nonVid = scored.filter(s => !/vidplayer\.live/i.test(s.url)).map(s => s.url);
    const orderedFallbacks = [
        ...scored.map(s => s.url).filter(u => u !== embedUrl)
    ].slice(0, 8);

    if (!embedUrl && videoCandidates.length) {
        for (const candidate of videoCandidates) {
            if (await probeVideoUrl(candidate)) {
                videoUrl = candidate;
                break;
            }
        }
        if (!videoUrl) videoUrl = videoCandidates[0];
    }

    const poster = $('meta[property="og:image"]').attr('content')
        || $('figure img.wp-post-image').first().attr('src')
        || $('.poster img, .thumb img').first().attr('src') || '';
    const title = cleanTitle(
        $('meta[property="og:title"]').attr('content')
        || $('h1.entry-title').first().text()
        || $('h1').first().text() || 'Film'
    );

    return {
        title: title.slice(0, 140),
        embedUrl,
        videoUrl: embedUrl ? '' : videoUrl,
        embedFallbacks: orderedFallbacks.slice(0, 6),
        pageUrl,
        poster: poster.startsWith('http') || poster.startsWith('//') ? absUrl(base, poster) : absUrl(base, poster),
        details: extractFilmDetails($, html, title)
    };
}

export async function getLk21HomeMeta() {
    const base = getBase();
    const html = await fetchHtml(`${base.replace(/\/$/, '')}/`);
    return { base, totalPages: extractMaxPage(html) };
}

export async function getLk21GenreMeta(slug) {
    const base = getBase();
    const slugClean = String(slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const urls = [
        `${base.replace(/\/$/, '')}/category/${slugClean}/`,
        `${base.replace(/\/$/, '')}/sinopsis/category/${slugClean}/`
    ];
    let lastErr = null;
    for (const url of urls) {
        try {
            const html = await fetchHtml(url);
            return { base, slug: slugClean, totalPages: Math.max(1, extractMaxPage(html)) };
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error(`Genre ${slugClean} tidak ditemukan`);
}

export async function browseLk21({ page = 1, sort = 'newest', genre = '' } = {}) {
    const base = getBase();
    const slug = String(genre || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

    if (slug) {
        const meta = await getLk21GenreMeta(slug);
        const pg = effectivePage(page, meta.totalPages, sort);
        const urls = pg <= 1
            ? [
                `${base.replace(/\/$/, '')}/category/${slug}/`,
                `${base.replace(/\/$/, '')}/sinopsis/category/${slug}/`
              ]
            : [
                `${base.replace(/\/$/, '')}/category/${slug}/page/${pg}/`,
                `${base.replace(/\/$/, '')}/sinopsis/category/${slug}/page/${pg}/`
              ];
        let lastErr = null;
        for (const pageUrl of urls) {
            try {
                const html = await fetchHtml(pageUrl);
                return {
                    results: parseSearchHtml(html, base, 24),
                    page: Math.max(1, Number(page) || 1),
                    totalPages: meta.totalPages,
                    sort,
                    genre: slug,
                    sourcePage: pg
                };
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr || new Error(`Genre ${slug} halaman ${pg} tidak ditemukan`);
    }

    const meta = await getLk21HomeMeta();
    const pg = effectivePage(page, meta.totalPages, sort);
    const pageUrl = pg <= 1 ? `${base.replace(/\/$/, '')}/` : `${base.replace(/\/$/, '')}/page/${pg}/`;
    const html = await fetchHtml(pageUrl);
    return {
        results: parseSearchHtml(html, base, 24),
        page: Math.max(1, Number(page) || 1),
        totalPages: meta.totalPages,
        sort,
        genre: '',
        sourcePage: pg
    };
}

export async function fetchLk21Genres() {
    const base = getBase();
    const seen = new Set();
    const genres = [];

    try {
        const html = await fetchHtml(`${base.replace(/\/$/, '')}/genre/`);
        const $ = cheerio.load(html);
        $('a[href*="/category/"], a[href*="/sinopsis/category/"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const name = ($(el).text() || '').trim();
            const m = href.match(/\/category\/([^/]+)\/?$/i);
            if (!m || !name || name.length > 28) return;
            const slug = m[1].toLowerCase();
            if (seen.has(slug) || slug === 'uncategorized') return;
            seen.add(slug);
            genres.push({ name, slug, url: absUrl(base, href) });
        });
    } catch (e) {
        console.log('LK21 genres skip:', e.message);
    }

    if (!genres.length) {
        return [
            { name: '🔥 Terbaru', slug: '' },
            { name: 'Action', slug: 'action' },
            { name: 'Adventure', slug: 'adventure' },
            { name: 'Animation', slug: 'animation' },
            { name: 'Biography', slug: 'biography' },
            { name: 'Comedy', slug: 'comedy' },
            { name: 'Crime', slug: 'crime' },
            { name: 'Documentary', slug: 'documentary' },
            { name: 'Drama', slug: 'drama' },
            { name: 'Family', slug: 'family' },
            { name: 'Fantasy', slug: 'fantasy' },
            { name: 'History', slug: 'history' },
            { name: 'Horror', slug: 'horror' },
            { name: 'Kids', slug: 'kids' },
            { name: 'Korea', slug: 'korea' },
            { name: 'Music', slug: 'music' },
            { name: 'Mystery', slug: 'mystery' },
            { name: 'Philippines', slug: 'philippines' },
            { name: 'Romance', slug: 'romance' },
            { name: 'Science Fiction', slug: 'science-fiction' },
            { name: 'Semi Jepang', slug: 'semi-jepang' },
            { name: 'Thriller', slug: 'thriller' },
            { name: 'TV Series', slug: 'tv-series' },
            { name: 'War', slug: 'war' },
            { name: 'Western', slug: 'western' }
        ];
    }
    return genres;
}

export async function browseLk21Genre(slug, page = 1, sort = 'newest') {
    const data = await browseLk21({ page, sort, genre: slug });
    return data.results;
}

// ─── Rebahin scraper ─────────────────────────────────────────────────────────

function getRebahinBase() {
    return REBAHIN_BASES[0] || 'https://rebahin.uno';
}

function parseRebahinHtml(html, base, limit = 36) {
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();

    // Rebahin uses article.item and .ml-item structures
    $('article.item, .ml-item, .item, div.itemsr').each((_, el) => {
        const a = $(el).find('a[href]').first();
        let href = a.attr('href') || '';
        if (!href || href === '#') return;
        if (!href.startsWith('http')) href = absUrl(base, href);
        // Skip category/page links
        if (/\/(genre|category|page)\//i.test(href)) return;

        const title = cleanTitle(
            $(el).find('h2, h3, .tt, .titles, .entry-title').first().text()
            || a.attr('title') || ''
        );
        if (!title || title.length < 2) return;

        const poster = $(el).find('img').first().attr('src')
            || $(el).find('img').first().attr('data-src') || '';
        const year = ($(el).find('.year, .timekk, span.year').first().text() || '').trim();

        if (seen.has(href)) return;
        seen.add(href);
        results.push({
            title: title.slice(0, 120),
            year,
            poster: poster ? absUrl(base, poster) : '',
            url: href,
            source: 'rebahin'
        });
    });

    return results.slice(0, limit);
}

async function fetchLatestRebahin(limit = 36) {
    const base = getRebahinBase();
    const results = [];
    const seen = new Set();

    for (const rb of REBAHIN_BASES) {
        if (results.length >= limit) break;
        try {
            const html = await fetchHtml(`${rb.replace(/\/$/, '')}/`);
            for (const item of parseRebahinHtml(html, rb, limit)) {
                if (!seen.has(item.url)) {
                    seen.add(item.url);
                    results.push(item);
                }
            }
        } catch (e) {
            console.log(`Rebahin latest skip ${rb}:`, e.message);
        }
    }
    return results.slice(0, limit);
}

async function searchRebahin(query, limit = 24) {
    const q = String(query || '').trim();
    if (!q) return [];
    const results = [];
    const seen = new Set();

    for (const rb of REBAHIN_BASES) {
        if (results.length >= limit) break;
        try {
            const url = `${rb.replace(/\/$/, '')}/?s=${encodeURIComponent(q)}`;
            const html = await fetchHtml(url);
            for (const item of parseRebahinHtml(html, rb, limit)) {
                if (!seen.has(item.url)) {
                    seen.add(item.url);
                    results.push(item);
                }
            }
        } catch (e) {
            console.log(`Rebahin search skip ${rb}:`, e.message);
        }
    }
    return results.slice(0, limit);
}

// ─── Rebahin detail resolver (for !watch playback) ────────────────────────────
async function resolveRebahinEmbed(pageUrl) {
    const base = (() => {
        try { return new URL(pageUrl).origin; } catch { return getRebahinBase(); }
    })();

    let html;
    try {
        html = await fetchHtml(pageUrl);
    } catch (e) {
        throw new Error('Gagal membuka halaman Rebahin: ' + e.message);
    }
    const $ = cheerio.load(html);

    // Reuse the generic collectors (iframes + known player patterns)
    let embedCandidates = collectEmbedCandidates($, html, base);

    // Rebahin-specific containers that are common on their templates
    const extraSel = [
        'iframe[src]', '.player iframe', '#player iframe', '.embed-player iframe',
        '.video-player iframe', '.ml-item iframe', '[data-src]', '.server-item iframe'
    ];
    extraSel.forEach((sel) => {
        $(sel).each((_, el) => {
            const src = $(el).attr('src') || $(el).attr('data-src') || '';
            if (src) {
                const u = normalizeMediaUrl(src, base);
                if (u && isLikelyPlayerIframe(u)) embedCandidates.push(u);
            }
        });
    });

    // Try to find any player switch / server links on rebahin detail page
    $('a[href*="player="], a[data-player], .player-tabs a, .servers a[href]').each((_, el) => {
        const h = $(el).attr('href') || '';
        if (h && !/^(#|javascript)/i.test(h)) {
            const full = absUrl(base, h);
            // We don't deep-fetch all to keep it fast; collector regex often catches from html anyway
            if (/https?:\/\//i.test(full) && isLikelyPlayerIframe(full)) {
                embedCandidates.push(full);
            }
        }
    });

    const uniqueEmbeds = [...new Set(embedCandidates)];
    const scored = uniqueEmbeds.map(u => ({ url: u, score: scoreEmbed(u) }));
    scored.sort((a, b) => a.score - b.score);

    // Prefer vidplayer when present (resolves to direct stream)
    let embedUrl = scored.find(s => /vidplayer\.live/i.test(s.url))?.url || scored[0]?.url || '';
    let videoUrl = '';

    const videoCandidates = collectVideoCandidates($, html, base);
    if (!embedUrl && videoCandidates.length) {
        for (const candidate of videoCandidates) {
            if (await probeVideoUrl(candidate)) {
                videoUrl = candidate;
                break;
            }
        }
        if (!videoUrl) videoUrl = videoCandidates[0];
    }

    const title = cleanTitle(
        $('meta[property="og:title"]').attr('content')
        || $('h1.entry-title, h1, .entry-title').first().text()
        || titleFromSlug(pageUrl)
    );

    const poster = $('meta[property="og:image"]').attr('content')
        || $('figure img, .poster img, .thumb img').first().attr('src') || '';

    return {
        title: title.slice(0, 140),
        embedUrl,
        videoUrl: embedUrl ? '' : videoUrl,
        embedFallbacks: scored.map(s => s.url).filter(u => u !== embedUrl).slice(0, 6),
        pageUrl,
        poster: poster ? (poster.startsWith('http') ? poster : absUrl(base, poster)) : '',
        source: 'rebahin',
        details: null
    };
}

export async function fetchLatestLk21(limit = 36) {
    const data = await browseLk21({ page: 1, sort: 'newest' });
    const merged = [...data.results];
    const seen = new Set(merged.map((r) => r.url));

    // Try additional LK21 mirrors
    if (merged.length < limit) {
        for (const base of DEFAULT_BASES) {
            if (base === getBase()) continue;
            try {
                const html = await fetchHtml(`${base.replace(/\/$/, '')}/`);
                for (const item of parseSearchHtml(html, base, limit)) {
                    pushResult(merged, seen, item);
                }
            } catch (e) {
                console.log(`LK21 latest skip ${base}:`, e.message);
            }
        }
    }

    // Merge Rebahin results as second source
    try {
        const rebahinResults = await fetchLatestRebahin(limit);
        for (const item of rebahinResults) {
            pushResult(merged, seen, item);
        }
    } catch (e) {
        console.log('Rebahin latest merge skip:', e.message);
    }

    return merged.slice(0, limit * 2);
}

export async function searchLk21(query, page = 1) {
    const q = String(query || '').trim();
    if (!q) return (await browseLk21({ page, sort: 'newest' })).results;

    const base = getBase();
    const merged = [];
    const seen = new Set();
    const pg = Math.max(1, Number(page) || 1);

    const searchUrls = pg <= 1
        ? [
            `${base.replace(/\/$/, '')}/?s=${encodeURIComponent(q)}`,
            `${base.replace(/\/$/, '')}/search?s=${encodeURIComponent(q)}`
        ]
        : [
            `${base.replace(/\/$/, '')}/page/${pg}/?s=${encodeURIComponent(q)}`,
            `${base.replace(/\/$/, '')}/?s=${encodeURIComponent(q)}&paged=${pg}`
        ];

    for (const url of searchUrls) {
        try {
            const html = await fetchHtml(url);
            for (const item of parseSearchHtml(html, base, 48)) {
                pushResult(merged, seen, item);
            }
            if (merged.length >= 12) break;
        } catch (e) {
            console.log(`LK21 search skip ${url}:`, e.message);
        }
    }

    // Try other LK21 mirrors
    for (const alt of DEFAULT_BASES) {
        if (alt === base || merged.length >= 48) break;
        try {
            const html = await fetchHtml(`${alt.replace(/\/$/, '')}/?s=${encodeURIComponent(q)}`);
            for (const item of parseSearchHtml(html, alt, 48)) {
                pushResult(merged, seen, item);
            }
        } catch (_) {}
    }

    // Merge Rebahin search results
    if (pg <= 1) {
        try {
            const rebahinResults = await searchRebahin(q, 24);
            for (const item of rebahinResults) {
                pushResult(merged, seen, item);
            }
        } catch (e) {
            console.log('Rebahin search merge skip:', e.message);
        }
    }

    return merged.slice(0, 60);
}

function normalizeFilmPageUrl(url) {
    try {
        const u = new URL(url);
        if (u.pathname.includes('/sinopsis/')) return u.href;
    } catch (_) {}
    return url;
}

function slugFromPageUrl(url = '') {
    const m = String(url).match(/\/sinopsis\/([^/]+)\/?$/i);
    return m?.[1] || '';
}

function mirrorPageUrl(pageUrl, base) {
    try {
        const src = new URL(pageUrl);
        const dst = new URL(base.endsWith('/') ? base : `${base}/`);
        src.protocol = dst.protocol;
        src.host = dst.host;
        return src.href;
    } catch (_) {
        return pageUrl;
    }
}

function finalizeFilmRecord(film, pageUrl, source = 'lk21') {
    let embedUrl = film.embedUrl || '';
    let videoUrl = film.videoUrl || '';

    if (!embedUrl && film.embedFallbacks?.length) {
        embedUrl = film.embedFallbacks[0];
    }

    if (!embedUrl && !videoUrl) {
        throw new Error('player kosong');
    }

    return {
        title: film.title,
        embedUrl,
        videoUrl: embedUrl ? '' : videoUrl,
        embedFallbacks: film.embedFallbacks || [],
        pageUrl: film.pageUrl || pageUrl,
        poster: film.poster,
        source,
        details: film.details || null
    };
}

async function resolveFilmFromPage(pageUrl, base) {
    const targets = [...new Set([pageUrl, mirrorPageUrl(pageUrl, base)].filter(Boolean))];
    let lastErr = null;

    for (const target of targets) {
        try {
            const film = await resolveEmbed(target, base);
            return finalizeFilmRecord(film, pageUrl, 'lk21');
        } catch (e) {
            lastErr = e;
        }
    }

    throw lastErr || new Error('player kosong');
}

async function resolveRebahinFilmFromPage(pageUrl) {
    const targets = [pageUrl];
    // try a couple rebahin mirrors
    for (const b of REBAHIN_BASES.slice(0, 3)) {
        try {
            targets.push(mirrorPageUrl(pageUrl, b));
        } catch (_) {}
    }
    let lastErr = null;
    for (const target of [...new Set(targets)].filter(Boolean)) {
        try {
            const film = await resolveRebahinEmbed(target);
            return finalizeFilmRecord(film, pageUrl, 'rebahin');
        } catch (e) {
            lastErr = e;
            console.log('rebahin film skip:', e.message);
        }
    }
    throw lastErr || new Error('player Rebahin tidak ditemukan');
}

export async function getLk21Film(url, { title = '', depth = 0 } = {}) {
    // Public entry — now dispatches to LK21 or Rebahin based on URL so both sources work in !watch
    return getFilmDetail(url, { title, depth });
}

export async function getFilmDetail(url, { title = '', depth = 0 } = {}) {
    const pageUrl = normalizeFilmPageUrl(url);
    const isRebahinUrl = /rebahin\./i.test(pageUrl);

    if (isRebahinUrl) {
        try {
            return await resolveRebahinFilmFromPage(pageUrl);
        } catch (e) {
            console.log('Rebahin direct resolve fail, will try search fallback:', e.message);
        }
        // Fallback: search Rebahin and recurse to a matching result
        const searchQ = String(title || '').trim() || titleFromSlug(pageUrl);
        if (depth < 1 && searchQ.length >= 2) {
            try {
                const rbs = await searchRebahin(searchQ, 12);
                let match = rbs.find((r) => r.url === pageUrl) || rbs[0];
                if (match?.url && match.url !== pageUrl) {
                    return getFilmDetail(match.url, { title: match.title || title, depth: depth + 1 });
                }
            } catch (e) {
                console.log('Rebahin search fallback skip:', e.message);
            }
        }
        throw new Error('Player Rebahin tidak ditemukan untuk film ini. Coba film LK21 lain.');
    }

    // === LK21 path (original) ===
    const errors = [];
    const bases = [...new Set([
        ...DEFAULT_BASES,
        (() => { try { return new URL(pageUrl).origin; } catch { return null; } })()
    ].filter(Boolean))];

    for (const base of bases) {
        try {
            return await resolveFilmFromPage(pageUrl, base);
        } catch (e) {
            errors.push(`${base}: ${e.message}`);
            console.log(`LK21 film skip ${base}:`, e.message);
        }
    }

    const slug = slugFromPageUrl(pageUrl);
    const searchQ = String(title || '').trim() || titleFromSlug(pageUrl);
    if (depth < 1 && searchQ.length >= 2) {
        try {
            const results = await searchLk21(searchQ, 1);
            let match = results[0];
            if (slug) {
                match = results.find((r) => r.url.includes(`/sinopsis/${slug}`) || r.url.endsWith(`/${slug}/`));
            }
            if (!match) match = results[0];
            if (match?.url && match.url !== pageUrl) {
                return getFilmDetail(match.url, { title: match.title || title, depth: depth + 1 });
            }
        } catch (e) {
            errors.push(`search: ${e.message}`);
        }
    }

    throw new Error(errors[0] || 'Player tidak ditemukan. Coba film lain dari katalog.');
}