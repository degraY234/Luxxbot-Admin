import axios from 'axios';

/**
 * Pembersih HTML tag pada sinopsis (AniList mengembalikan tag <br>, <i>, dll.)
 */
function cleanSynopsis(html) {
    if (!html) return 'Tidak ada sinopsis tersedia.';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[^>]+(>|$)/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&')
        .trim()
        .slice(0, 450) + (html.length > 450 ? '...' : '');
}

/**
 * Fetch anime data via AniList GraphQL (Sangat cepat & tanpa rate limit ketat)
 * dengan fallback ke Jikan REST API v4
 */
async function fetchAnimeData(query = '') {
    const isTrending = !query || query.toLowerCase() === 'popular' || query.toLowerCase() === 'trending';

    // 1. Coba AniList GraphQL
    try {
        if (isTrending) {
            const gql = `
                query {
                    Page(page: 1, perPage: 15) {
                        media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
                            id
                            title { romaji english native }
                            description
                            episodes
                            averageScore
                            status
                            genres
                            seasonYear
                            format
                            coverImage { extraLarge large }
                        }
                    }
                }
            `;
            const res = await axios.post('https://graphql.anilist.co', { query: gql }, { timeout: 8000 });
            const list = res.data?.data?.Page?.media || [];
            if (list.length > 0) {
                const pick = list[Math.floor(Math.random() * list.length)];
                return {
                    title: pick.title?.romaji || pick.title?.english || 'Anime',
                    nativeTitle: pick.title?.native || '',
                    score: pick.averageScore ? `${pick.averageScore}%` : '-',
                    genres: pick.genres?.join(', ') || '-',
                    year: pick.seasonYear || '-',
                    episodes: pick.episodes || '?',
                    status: pick.status || 'UNKNOWN',
                    format: pick.format || 'TV',
                    synopsis: cleanSynopsis(pick.description),
                    imageUrl: pick.coverImage?.extraLarge || pick.coverImage?.large || null
                };
            }
        } else {
            const gql = `
                query ($s: String) {
                    Media(search: $s, type: ANIME, isAdult: false) {
                        id
                        title { romaji english native }
                        description
                        episodes
                        averageScore
                        status
                        genres
                        seasonYear
                        format
                        coverImage { extraLarge large }
                    }
                }
            `;
            const res = await axios.post('https://graphql.anilist.co', { query: gql, variables: { s: query } }, { timeout: 8000 });
            const anime = res.data?.data?.Media;
            if (anime) {
                return {
                    title: anime.title?.romaji || anime.title?.english || query,
                    nativeTitle: anime.title?.native || '',
                    score: anime.averageScore ? `${anime.averageScore}%` : '-',
                    genres: anime.genres?.join(', ') || '-',
                    year: anime.seasonYear || '-',
                    episodes: anime.episodes || '?',
                    status: anime.status || 'UNKNOWN',
                    format: anime.format || 'TV',
                    synopsis: cleanSynopsis(anime.description),
                    imageUrl: anime.coverImage?.extraLarge || anime.coverImage?.large || null
                };
            }
        }
    } catch (e) {
        console.warn('AniList query notice:', e.message);
    }

    // 2. Fallback: Jikan API v4
    try {
        const jikanUrl = isTrending
            ? 'https://api.jikan.moe/v4/top/anime?limit=15'
            : `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`;

        const res = await axios.get(jikanUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 8000
        });

        const list = res.data?.data;
        const item = Array.isArray(list) ? (isTrending ? list[Math.floor(Math.random() * list.length)] : list[0]) : list;
        if (item) {
            return {
                title: item.title || item.title_english || query,
                nativeTitle: item.title_japanese || '',
                score: item.score ? `${item.score} / 10` : '-',
                genres: item.genres?.map(v => v.name).join(', ') || '-',
                year: item.year || item.aired?.prop?.from?.year || '-',
                episodes: item.episodes || '?',
                status: item.status || 'UNKNOWN',
                format: item.type || 'TV',
                synopsis: cleanSynopsis(item.synopsis),
                imageUrl: item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || null
            };
        }
    } catch (err) {
        console.error('Jikan fallback error:', err.message);
    }

    return null;
}

/**
 * Handler utama perintah !anime
 */
export async function handleAnimeCommand({ sock, from, msg, args }) {
    const query = args.join(' ').trim();

    await sock.sendMessage(from, {
        text: query ? `🎌 *Mencari anime:* _${query}_...` : '🎌 *Mengambil anime populer/trending...*'
    }, { quoted: msg });

    try {
        const anime = await fetchAnimeData(query);

        if (!anime) {
            return await sock.sendMessage(from, {
                text: `❌ *Anime tidak ditemukan!*\n\nCoba cari dengan judul lain (contoh: \`!anime naruto\`, \`!anime one piece\`, \`!anime jujutsu kaisen\`).`
            }, { quoted: msg });
        }

        const caption =
            `╭━━━〔 🎌 *ANIME INFO* 🎌 〕━━━\n\n` +
            `📺 *Judul* : ${anime.title}${anime.nativeTitle ? ` (${anime.nativeTitle})` : ''}\n` +
            `⭐ *Rating* : ${anime.score}\n` +
            `🎭 *Genre* : ${anime.genres}\n` +
            `📅 *Tahun* : ${anime.year} • ${anime.format}\n` +
            `🎬 *Status* : ${anime.status} (${anime.episodes} Episode)\n\n` +
            `📝 *Sinopsis*:\n${anime.synopsis}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━`;

        if (anime.imageUrl) {
            try {
                await sock.sendMessage(from, {
                    image: { url: anime.imageUrl },
                    caption
                }, { quoted: msg });
                return;
            } catch (imgErr) {
                console.warn('Gagal kirim gambar anime, kirim teks:', imgErr.message);
            }
        }

        // Fallback teks jika gambar gagal load
        await sock.sendMessage(from, { text: caption }, { quoted: msg });
    } catch (err) {
        console.error('!anime error:', err);
        await sock.sendMessage(from, {
            text: `❌ *Gagal mengambil info anime.*\n_${(err.message || 'Server timeout').slice(0, 100)}_`
        }, { quoted: msg });
    }
}
