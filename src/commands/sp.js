import {
    searchSounds,
    fetchTrendingSounds,
    fetchBestSounds,
    downloadSound
} from '../services/sound-api.js';
import { mp3BufferToPttOgg } from '../utils/audio-ptt.js';
import {
    listSounds,
    getSound,
    findLocalSounds,
    saveSoundToLibrary,
    readSoundBuffer,
    bumpPlays,
    deleteSound,
    renameSound,
    toggleFavorite,
    getLibraryStats,
    formatSize,
    slugify
} from '../services/sound-library.js';

const SESSION_TTL_MS = 5 * 60 * 1000;
const SEARCH_LIMIT = 10;

export function getSpHelpText() {
    return (
        `🔊 *SOUND PAD — !sp*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *Cari & kirim sound dari internet*\n` +
        `\`!sp <kata kunci>\` → cari ribuan sound, pilih angka\n` +
        `\`!sp cari <kata>\` → paksa cari di API (bukan library)\n\n` +
        `📚 *Library sound chat ini*\n` +
        `\`!sp\` → daftar sound tersimpan\n` +
        `\`!sp <nama>\` → putar sound dari library\n` +
        `\`!sp ptt <nama>\` → kirim sebagai voice note\n` +
        `\`!sp find <kata>\` → cari di library lokal\n` +
        `\`!sp random\` · \`!sp fav\` · \`!sp trending\` · \`!sp best\`\n\n` +
        `🛠️ *Kelola*\n` +
        `\`!sp rename <lama> <baru>\`\n` +
        `\`!sp del <nama>\` · \`!sp info <nama>\`\n` +
        `\`!sp star <nama>\` → tandai favorit ⭐\n\n` +
        `_Pencarian pintar: kalau nama aneh, bot cari kata yang cocok & kasih pilihan._\n` +
        `_Max 80 sound/chat. Opsional: Pixabay/Freesound via API key di .env_`
    );
}

function setSpSession(from, data) {
    global.spSession = global.spSession || {};
    global.spSession[from] = { ...data, at: Date.now() };
}

function clearSpSession(from) {
    if (global.spSession?.[from]) delete global.spSession[from];
}

export function getSpSession(from) {
    const s = global.spSession?.[from];
    if (!s) return null;
    if (Date.now() - (s.at || 0) > SESSION_TTL_MS) {
        clearSpSession(from);
        return null;
    }
    return s;
}

async function sendSoundBuffer(sock, from, msg, buffer, { title, name, ptt = false, saved = false }) {
    const baseName = name || slugify(title);
    let audio = buffer;
    let mimetype = 'audio/mpeg';
    let fileName = `${baseName}.mp3`;

    if (ptt) {
        audio = await mp3BufferToPttOgg(buffer);
        mimetype = 'audio/ogg; codecs=opus';
        fileName = `${baseName}.ogg`;
    }

    const payload = {
        audio,
        mimetype,
        ptt,
        fileName
    };

    if (!ptt) {
        payload.caption =
            `🔊 *${title}*\n` +
            (name ? `📛 \`${name}\`\n` : '') +
            (saved ? `💾 Tersimpan di library chat ini\n` : '') +
            `_LuxxBot Sound Pad_`;
    }

    await sock.sendMessage(from, payload, { quoted: msg });

    if (ptt) {
        await sock.sendMessage(from, {
            text: `🎙️ Voice note · *${title}*` + (name ? ` (\`${name}\`)` : '')
        }, { quoted: msg });
    }
}

async function playFromLibrary(sock, from, msg, entry, { ptt = false } = {}) {
    const buffer = readSoundBuffer(entry);
    if (ptt) {
        await sock.sendMessage(from, { text: '🎙️ Menyiapkan voice note...' }, { quoted: msg });
    }
    bumpPlays(from, entry.name);
    await sendSoundBuffer(sock, from, msg, buffer, {
        title: entry.title,
        name: entry.name,
        ptt,
        saved: true
    });
}

export async function fetchAndSendSound(sock, from, msg, item, sender, { customName = '', ptt = false } = {}) {
    await sock.sendMessage(from, {
        text: `⏳ Mengunduh *${item.title}*...`
    }, { quoted: msg });

    const buffer = await downloadSound(item.mp3, item.source);
    const { entry, created } = saveSoundToLibrary(from, {
        title: item.title,
        buffer,
        sourceId: item.id,
        source: item.source,
        mp3Url: item.mp3,
        addedBy: sender.split('@')[0],
        customName
    });

    await sendSoundBuffer(sock, from, msg, buffer, {
        title: entry.title,
        name: entry.name,
        ptt,
        saved: created
    });

    if (created) {
        await sock.sendMessage(from, {
            text: `💾 Disimpan sebagai \`${entry.name}\`\nPanggil lagi: \`!sp ${entry.name}\``
        }, { quoted: msg });
    }
}

function buildSearchListText(query, tracks, { mode = 'exact', keywords = [], sourceLabel = 'Internet' } = {}) {
    let text = '';

    if (mode === 'keyword') {
        text += `🔍 *"${query}"* — tidak ada exact match\n`;
        text += `🧩 Sound yang ada kata: *${keywords.slice(0, 6).join(' · ')}*\n`;
        text += `🌐 Dari: ${sourceLabel}\n\n*Pilih yang paling cocok:*\n\n`;
    } else {
        text += `🔍 *Hasil Sound:* "${query}"\n`;
        text += `🌐 Sumber: ${sourceLabel}\n\nPilih dengan angka:\n\n`;
    }

    tracks.forEach((t, i) => {
        const src = t.source && t.source !== 'myinstants' ? ` _[${t.source}]_` : '';
        text += `*${i + 1}.* ${t.title}${src}\n`;
    });
    text += `\n_Balas angka 1–${tracks.length} untuk kirim & simpan_\n`;
    text += `_Library: \`!sp\` · Bantuan: \`!sp help\`_`;
    return text;
}

function describeSources(tracks) {
    const src = new Set(tracks.map(t => t.source).filter(Boolean));
    const labels = [];
    if ([...src].some(s => s?.startsWith('myinstants'))) labels.push('MyInstants');
    if (src.has('pixabay')) labels.push('Pixabay');
    if (src.has('freesound')) labels.push('Freesound');
    return labels.length ? labels.join(' + ') : 'MyInstants + fallback';
}

function buildLibraryListText(jid) {
    const items = listSounds(jid);
    const stats = getLibraryStats(jid);

    if (!items.length) {
        return (
            `📭 *Library sound kosong.*\n\n` +
            `Cari sound baru:\n\`!sp vine boom\` · \`!sp kicau-mania\`\n` +
            `\`!sp trending\` · \`!sp best\`\n\n` +
            `_Setiap sound yang dikirim otomatis disimpan di sini._`
        );
    }

    let text = `🔊 *LIBRARY SOUND*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📊 ${stats.count}/${stats.max} · ⭐ ${stats.favorites} favorit · 💾 ${formatSize(stats.totalSize)}\n\n`;

    items.slice(0, 25).forEach((s, i) => {
        const star = s.favorite ? '⭐ ' : '';
        const plays = s.plays ? ` · ▶️ ${s.plays}x` : '';
        text += `*${i + 1}.* ${star}\`${s.name}\`\n   _${s.title}_${plays}\n`;
    });

    if (items.length > 25) {
        text += `\n_...dan ${items.length - 25} sound lainnya_\n`;
    }

    text += `\n▶️ Putar: \`!sp <nama>\`\n`;
    text += `🔍 Cari online: \`!sp cari <kata>\`\n`;
    text += `🎲 Acak: \`!sp random\``;
    return text;
}

export async function handleSpPick({ sock, from, msg, selectedIndex, sender }) {
    const session = getSpSession(from);
    if (!session?.tracks?.length) return false;

    if (selectedIndex < 0 || selectedIndex >= session.tracks.length) {
        await sock.sendMessage(from, {
            text: `❌ Pilih angka 1–${session.tracks.length} dari daftar !sp terakhir.`
        }, { quoted: msg });
        return true;
    }

    const item = session.tracks[selectedIndex];
    clearSpSession(from);

    try {
        await fetchAndSendSound(sock, from, msg, item, sender, {
            customName: session.customName || ''
        });
    } catch (e) {
        console.error('SP pick error:', e.message);
        await sock.sendMessage(from, {
            text: `❌ Gagal kirim sound.\n_${(e.message || 'error').slice(0, 120)}_`
        }, { quoted: msg });
    }
    return true;
}

async function startSearch(sock, from, msg, query, { customName = '' } = {}) {
    await sock.sendMessage(from, {
        text: '🔍 Mencari sound di internet... _(bisa agak lama kalau nama unik)_'
    }, { quoted: msg });

    const { items: tracks, mode, keywords } = await searchSounds(query, SEARCH_LIMIT);

    if (!tracks.length) {
        const hint = keywords.length
            ? `\n\n💡 Coba kata lebih umum:\n\`!sp ${keywords[0]}\`\natau \`!sp trending\``
            : '\n\n💡 Coba \`!sp trending\` atau kata yang lebih umum';
        return sock.sendMessage(from, {
            text: `❌ Belum ketemu sound untuk "${query}".${hint}`
        }, { quoted: msg });
    }

    setSpSession(from, { tracks, query, customName, mode, keywords });
    return sock.sendMessage(from, {
        text: buildSearchListText(query, tracks, {
            mode,
            keywords,
            sourceLabel: describeSources(tracks)
        })
    }, { quoted: msg });
}

async function startTrending(sock, from, msg, mode = 'trending') {
    await sock.sendMessage(from, {
        text: mode === 'best' ? '🏆 Mengambil sound terbaik...' : '🔥 Mengambil sound trending...'
    }, { quoted: msg });

    const tracks = mode === 'best'
        ? await fetchBestSounds('id', SEARCH_LIMIT)
        : await fetchTrendingSounds('id', SEARCH_LIMIT);

    if (!tracks.length) {
        return sock.sendMessage(from, {
            text: '❌ Gagal ambil daftar. Coba `!sp cari <kata>`'
        }, { quoted: msg });
    }

    const label = mode === 'best' ? 'Terbaik sepanjang masa' : 'Trending Indonesia';
    setSpSession(from, { tracks, query: label });
    return sock.sendMessage(from, {
        text: buildSearchListText(label, tracks, { mode: 'exact', sourceLabel: label })
    }, { quoted: msg });
}

export async function handleSpCommand({ sock, from, msg, args, sender }) {
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);
    const fullQuery = args.join(' ').trim();

    if (!args.length) {
        return sock.sendMessage(from, {
            text: buildLibraryListText(from)
        }, { quoted: msg });
    }

    if (sub === 'help' || sub === 'bantuan') {
        return sock.sendMessage(from, { text: getSpHelpText() }, { quoted: msg });
    }

    if (sub === 'cari' || sub === 'search') {
        const q = rest.join(' ').trim();
        if (!q) {
            return sock.sendMessage(from, {
                text: '⚠️ Format: `!sp cari <kata kunci>`'
            }, { quoted: msg });
        }
        return startSearch(sock, from, msg, q);
    }

    if (sub === 'trending' || sub === 'hot') {
        return startTrending(sock, from, msg, 'trending');
    }

    if (sub === 'best' || sub === 'top') {
        return startTrending(sock, from, msg, 'best');
    }

    if (sub === 'random' || sub === 'acak') {
        const items = listSounds(from);
        if (!items.length) {
            return sock.sendMessage(from, {
                text: '📭 Library kosong. Cari dulu: `!sp vine boom`'
            }, { quoted: msg });
        }
        const pick = items[Math.floor(Math.random() * items.length)];
        try {
            await playFromLibrary(sock, from, msg, pick);
        } catch (e) {
            await sock.sendMessage(from, { text: `❌ ${e.message}` }, { quoted: msg });
        }
        return;
    }

    if (sub === 'fav' || sub === 'favorit' || sub === 'star') {
        const name = rest[0];
        if (!name) {
            const favs = listSounds(from, { favoritesOnly: true });
            if (!favs.length) {
                return sock.sendMessage(from, {
                    text: '⭐ Belum ada favorit.\nTandai: `!sp star <nama>`'
                }, { quoted: msg });
            }
            let text = `⭐ *FAVORIT SOUND*\n\n`;
            favs.forEach((s, i) => {
                text += `${i + 1}. \`${s.name}\` — _${s.title}_\n`;
            });
            return sock.sendMessage(from, { text }, { quoted: msg });
        }
        const entry = toggleFavorite(from, name);
        if (!entry) {
            return sock.sendMessage(from, {
                text: `❌ Sound \`${slugify(name)}\` tidak ada di library.`
            }, { quoted: msg });
        }
        return sock.sendMessage(from, {
            text: entry.favorite
                ? `⭐ \`${entry.name}\` ditandai favorit!`
                : `☆ \`${entry.name}\` dihapus dari favorit.`
        }, { quoted: msg });
    }

    if (sub === 'find' || sub === 'cari-lokal') {
        const q = rest.join(' ').trim();
        if (!q) {
            return sock.sendMessage(from, {
                text: '⚠️ Format: `!sp find <kata>`'
            }, { quoted: msg });
        }
        const hits = findLocalSounds(from, q);
        if (!hits.length) {
            return sock.sendMessage(from, {
                text: `📭 Tidak ada sound lokal untuk "${q}".\nCoba: \`!sp cari ${q}\``
            }, { quoted: msg });
        }
        let text = `🔎 *Library — "${q}"*\n\n`;
        hits.slice(0, 15).forEach((s, i) => {
            text += `${i + 1}. \`${s.name}\` — _${s.title}_\n`;
        });
        text += `\n▶️ \`!sp <nama>\``;
        return sock.sendMessage(from, { text }, { quoted: msg });
    }

    if (sub === 'del' || sub === 'hapus' || sub === 'delete') {
        const name = rest.join(' ').trim();
        if (!name) {
            return sock.sendMessage(from, {
                text: '⚠️ Format: `!sp del <nama>`'
            }, { quoted: msg });
        }
        const removed = deleteSound(from, name);
        if (!removed) {
            return sock.sendMessage(from, {
                text: `❌ Sound \`${slugify(name)}\` tidak ditemukan.`
            }, { quoted: msg });
        }
        return sock.sendMessage(from, {
            text: `🗑️ Sound \`${removed.name}\` dihapus dari library.`
        }, { quoted: msg });
    }

    if (sub === 'rename' || sub === 'ganti') {
        if (rest.length < 2) {
            return sock.sendMessage(from, {
                text: '⚠️ Format: `!sp rename <nama-lama> <nama-baru>`'
            }, { quoted: msg });
        }
        const newName = rest.pop();
        const oldName = rest.join(' ');
        try {
            const entry = renameSound(from, oldName, newName);
            if (!entry) {
                return sock.sendMessage(from, {
                    text: `❌ Sound \`${slugify(oldName)}\` tidak ditemukan.`
                }, { quoted: msg });
            }
            return sock.sendMessage(from, {
                text: `✏️ Direname: \`${slugify(oldName)}\` → \`${entry.name}\``
            }, { quoted: msg });
        } catch (e) {
            return sock.sendMessage(from, { text: `❌ ${e.message}` }, { quoted: msg });
        }
    }

    if (sub === 'info') {
        const name = rest.join(' ').trim();
        if (!name) {
            return sock.sendMessage(from, {
                text: '⚠️ Format: `!sp info <nama>`'
            }, { quoted: msg });
        }
        const entry = getSound(from, name);
        if (!entry) {
            return sock.sendMessage(from, {
                text: `❌ Sound \`${slugify(name)}\` tidak ditemukan.`
            }, { quoted: msg });
        }
        const text =
            `ℹ️ *INFO SOUND*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `📛 Nama: \`${entry.name}\`\n` +
            `🎵 Judul: ${entry.title}\n` +
            `💾 Ukuran: ${formatSize(entry.size)}\n` +
            `▶️ Diputar: ${entry.plays || 0}x\n` +
            `⭐ Favorit: ${entry.favorite ? 'Ya' : 'Tidak'}\n` +
            `👤 Ditambah: @${entry.addedBy || '?'}\n` +
            `📅 ${new Date(entry.addedAt).toLocaleString('id-ID')}\n` +
            `🌐 Sumber: ${entry.source}`;
        return sock.sendMessage(from, {
            text,
            mentions: entry.addedBy ? [`${entry.addedBy}@s.whatsapp.net`] : undefined
        }, { quoted: msg });
    }

    if (sub === 'ptt' || sub === 'vn') {
        const name = rest.join(' ').trim();
        if (!name) {
            return sock.sendMessage(from, {
                text: '⚠️ Format: `!sp ptt <nama>`'
            }, { quoted: msg });
        }
        const entry = getSound(from, name);
        if (!entry) {
            return sock.sendMessage(from, {
                text: `❌ Sound \`${slugify(name)}\` tidak ada. Cari: \`!sp cari ${name}\``
            }, { quoted: msg });
        }
        try {
            await playFromLibrary(sock, from, msg, entry, { ptt: true });
        } catch (e) {
            await sock.sendMessage(from, { text: `❌ ${e.message}` }, { quoted: msg });
        }
        return;
    }

    // Nama custom saat cari: !sp cari-as nama query... → handled via "as" suffix
    const asIdx = args.findIndex(a => a.toLowerCase() === 'as');
    if (asIdx >= 0 && asIdx < args.length - 1) {
        const customName = args[asIdx + 1];
        const query = [...args.slice(0, asIdx), ...args.slice(asIdx + 2)].join(' ').trim();
        if (!query) {
            return sock.sendMessage(from, {
                text: '⚠️ Format: `!sp <kata> as <nama-simpan>`'
            }, { quoted: msg });
        }
        const local = getSound(from, customName) || getSound(from, query);
        if (local && slugify(query) === local.name) {
            try {
                await playFromLibrary(sock, from, msg, local);
            } catch (e) {
                await sock.sendMessage(from, { text: `❌ ${e.message}` }, { quoted: msg });
            }
            return;
        }
        return startSearch(sock, from, msg, query, { customName });
    }

    // Cek library dulu (exact match)
    const localExact = getSound(from, fullQuery);
    if (localExact) {
        try {
            await playFromLibrary(sock, from, msg, localExact);
        } catch (e) {
            await sock.sendMessage(from, { text: `❌ ${e.message}` }, { quoted: msg });
        }
        return;
    }

    // Partial match lokal — kalau cuma 1 hasil, langsung putar
    const localHits = findLocalSounds(from, fullQuery);
    if (localHits.length === 1) {
        try {
            await playFromLibrary(sock, from, msg, localHits[0]);
        } catch (e) {
            await sock.sendMessage(from, { text: `❌ ${e.message}` }, { quoted: msg });
        }
        return;
    }
    if (localHits.length > 1) {
        let text = `🔎 Beberapa sound cocok "${fullQuery}":\n\n`;
        localHits.slice(0, 8).forEach((s, i) => {
            text += `${i + 1}. \`${s.name}\` — _${s.title}_\n`;
        });
        text += `\n▶️ \`!sp <nama>\` untuk putar`;
        return sock.sendMessage(from, { text }, { quoted: msg });
    }

    // Default: cari di API
    return startSearch(sock, from, msg, fullQuery);
}