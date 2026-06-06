// File: menu.js — tampilan dioptimalkan WhatsApp Android (tanpa ubah tema premium)

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━';
const BOT_VERSION = '3.1.0';

function section(title) {
    return `\n${DIVIDER}\n${title}\n`;
}

function item(cmd, desc, emoji = '') {
    const tail = emoji ? ` ${emoji}` : '';
    return `├ \`${cmd}\` · ${desc}${tail}\n`;
}

function lastItem(cmd, desc, emoji = '') {
    const tail = emoji ? ` ${emoji}` : '';
    return `└ \`${cmd}\` · ${desc}${tail}\n`;
}

/**
 * @param {boolean} isSelfMode
 * @param {boolean} isSleeping
 * @param {boolean} antiLink
 * @param {boolean} isAdmin
 * @param {string} botUptime
 * @returns {string}
 */
function buildMenuText(isSelfMode, isSleeping, antiLink, isAdmin, botUptime) {
    let m = '';

    m += `🌸 *L U X X B O T*\n`;
    m += `*PREMIUM MENU* 🌸\n`;
    m += DIVIDER + '\n';

    m += `📊 *STATUS*\n`;
    m += `├ Mode · ${isSelfMode ? '🔒 Self' : '🔓 Public'}\n`;
    m += `├ Bot · ${isSleeping ? '🛌 Tidur' : '⚡ Online'}\n`;
    m += `├ Anti-Link · ${antiLink ? '🟢 On' : '🔴 Off'}\n`;
    m += `└ Uptime · ${botUptime}\n`;

    m += section('🎮 *UMUM*');
    m += item('!halo', 'Sapaan ramah', '👋');
    m += item('!ping', 'Cek respon bot', '🏓');
    m += item('!status', 'Status bot, radio, Discord', '📊');
    m += item('!help', 'Bantuan perintah', '📖');
    m += item('!aboutlux', 'Profil bot & pembuat', '👑');
    m += item('!menu', 'Menu ini', '📜');
    m += item('!loot', 'Alias menu', '✨');
    m += item('!changelogs', 'Update terbaru', '📢');
    m += item('!notes', 'Catatan pribadi', '📝');
    m += item('!reminder', 'Pengingat', '⏰');
    m += item('!welcome', 'Sambutan grup', '👋');
    m += item('!add', 'Tambah member grup', '👥');
    m += item('!tagall', 'Tag semua member', '📢');
    m += item('!tanggal', 'Waktu Indonesia', '🗓️');
    m += item('!warna', 'Warna acak / hex', '🎨');
    m += lastItem('!server', 'Info sistem', '🖥️');

    if (isAdmin) {
        m += section('👑 *OWNER*');
        m += item('!turu', 'Mode tidur', '😴');
        m += item('!bangun', 'Bangunkan bot', '☀️');
        m += item('!pingsan', 'Matikan bot + PM2', '💀');
        m += item('!self', 'Self mode', '🔒');
        m += item('!public', 'Public mode', '🔓');
        m += item('!join', 'Masuk grup via link', '➡️');
        m += item('!leave', 'Keluar grup', '🚪');
        m += item('!block', 'Block kontak', '⛔');
        m += item('!unblock', 'Unblock kontak', '✅');
        m += item('!spek', 'Spesifikasi bot', '📊');
        m += item('!grup', 'Info / atur grup', '👥');
        m += item('!antilink', 'Toggle anti link', '🛡️');
        m += item('!speedtest', 'Cek jaringan', '🌐');
        m += item('!broadcast', 'Broadcast', '📢');
        m += item('!bc', 'Alias broadcast', '📣');
        m += item('!systeminfo', 'Info sistem lengkap', '🧠');
        m += lastItem('!resetroom', 'Reset room W2G', '🔄');
    }

    m += section('🧠 *AI & CHAT*');
    m += item('!tanya', 'Tanya AI', '🤖');
    m += item('!coding', 'Bantuan coding', '💻');
    m += item('!db', 'Generator database + SQL + API', '🗄️');
    m += item('!code', 'Review kode', '🔍');
    m += item('!rangkum', 'Ringkas teks', '📑');
    m += item('!brainstorm', 'Ide kreatif', '💡');
    m += item('!translate', 'Terjemahan', '🌐');
    m += item('!buat', 'Gambar dari teks', '🎨');
    m += item('!lihat', 'Analisa gambar AI', '👁️');
    m += item('!q', 'Chat bebas AI', '🗨️');
    m += item('!resetai', 'Reset memori AI', '♻️');
    m += lastItem('!fact', 'Fakta menarik', '🤯');

    m += section('🎵 *MUSIK & RADIO*');
    m += item('!play', 'Cari & antrian lagu', '🎵');
    m += item('!nowplaying', 'Lagu yang sedang diputar', '🎶');
    m += item('!radio', 'Link dengar radio', '📻');
    m += item('!discord', 'Status Discord + invite', '🎧');
    m += item('!queue', 'Antrian lagu', '📋');
    m += item('!skip', 'Lagu berikutnya', '⏭️');
    m += item('!lirik', 'Lirik lagu', '📝');
    m += lastItem('!watch', 'Nonton bareng (Luxx TV)', '📺');

    m += section('🎌 *HIBURAN*');
    m += item('!simi', 'Chat Simi', '🤖');
    m += item('!anime', 'Info anime', '🎌');
    m += item('!football', 'Jadwal bola (alias !jadwalbola)', '⚽');
    m += item('!character', 'Cari karakter anime', '👤');
    m += item('!waifu', 'Random waifu', '💖');
    m += item('!quotesanime', 'Quote anime ID', '📜');
    m += item('!darkjokes', 'Dark humor', '😈');
    m += item('!pantun', 'Pantun', '🎭');
    m += item('!cerpen', 'Cerpen AI', '📖');
    m += lastItem('!meme', 'Meme random', '😂');

    m += section('🎨 *MEDIA & TOOLS*');
    m += item('!sp', 'Sound pad — cari, simpan & putar ulang', '🔊');
    m += item('!tts', 'Teks → voice note', '🎙️');
    m += item('!quote', 'Kutipan inspiratif', '💬');
    m += item('!s', 'Stiker premium', '🎨');
    m += item('!anomali', 'Sticker aesthetic', '✨');
    m += item('!dl', 'Download video / MP3', '📥');
    m += item('!ocr', 'Baca teks gambar', '🔍');
    m += item('!qr', 'Buat QR code', '📱');
    m += item('!kalkulator', 'Hitung matematika', '🧮');
    m += item('!cuaca', 'Info cuaca', '🌤️');
    m += lastItem('!stalk', 'Profil GitHub', '🐙');

    m += section('🎲 *GAMES & FUN*');
    m += item('!apakah', 'Jawaban acak', '🔮');
    m += item('!gacha', 'Random picker', '🎲');
    m += item('!voting', 'Buat polling', '🗳️');
    m += item('!pilih', 'Pilih opsi vote', '✅');
    m += lastItem('!endvoting', 'Tutup voting', '🛑');

    m += section('💎 *INFO BOT*');
    m += `├ Creator · DoxxBorx 👑\n`;
    m += `├ Versi · v${BOT_VERSION} Premium 🚀\n`;
    m += `├ Fitur · 75+ perintah 📦\n`;
    m += `└ Support · @6282384961407 📞\n`;

    m += `\n${DIVIDER}\n`;
    m += `💖 *Made with Love by DoxxBorx* ✨\n`;
    m += `🎀 _Ketik \`!help nama\` untuk detail perintah_`;

    return m;
}

export { buildMenuText };