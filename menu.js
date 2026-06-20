// File: menu.js — menu per-section + main menu ringkas

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
 * Menu utama — ringkas, tampilkan pilihan section
 */
function buildMenuText(isSelfMode, isSleeping, antiLink, isAdmin, botUptime) {
    let m = '';

    m += `🌸 *L U X X B O T* v${BOT_VERSION} Premium\n`;
    m += DIVIDER + '\n';
    m += `📊 *STATUS*\n`;
    m += `├ Mode   · ${isSelfMode ? '🔒 Self' : '🔓 Public'}\n`;
    m += `├ Bot    · ${isSleeping ? '🛌 Tidur' : '⚡ Online'}\n`;
    m += `├ Anti-Link · ${antiLink ? '🟢 On' : '🔴 Off'}\n`;
    m += `└ Uptime · ${botUptime}\n`;

    m += section('📂 *PILIH KATEGORI MENU*');
    m += `_Ketik perintah di bawah untuk melihat daftar lengkap tiap kategori:_\n\n`;
    m += `🎮 \`!menu umum\`     · Perintah dasar & info\n`;
    if (isAdmin) {
        m += `👑 \`!menu owner\`    · Kontrol bot (owner only)\n`;
    }
    m += `🧠 \`!menu ai\`       · AI, coding & terjemahan\n`;
    m += `🎵 \`!menu musik\`    · Radio, lagu & Discord\n`;
    m += `🎌 \`!menu hiburan\`  · Anime, sastra & fun\n`;
    m += `🎨 \`!menu media\`    · Stiker, download & tools\n`;
    m += `🎲 \`!menu games\`    · Polling, voting & gacha\n`;

    m += `\n${DIVIDER}\n`;
    m += `❓ \`!help [perintah]\` · Detail satu perintah\n`;
    m += `💖 _Made with Love by DoxxBorx_ ✨`;

    return m;
}

/** Section UMUM */
function buildMenuUmum() {
    let m = '';
    m += `🎮 *MENU UMUM*\n`;
    m += `_Perintah dasar, info bot, dan utilitas harian._\n`;
    m += DIVIDER + '\n';
    m += item('!guide', 'Panduan pemula — cara pakai bot', '📖');
    m += item('!halo', 'Sapa bot dengan ramah', '👋');
    m += item('!ping', 'Cek kecepatan respons bot', '🏓');
    m += item('!status', 'Status bot, radio & Discord', '📊');
    m += item('!help', 'Detail satu perintah (!help play)', '❓');
    m += item('!aboutlux', 'Profil bot & info pembuat', '👑');
    m += item('!menu', 'Tampilkan menu utama', '📜');
    m += item('!changelogs', 'Update & fitur terbaru', '📢');
    m += item('!lapor', 'Lapor bug / request fitur', '📮');
    m += item('!berita', 'Berita terkini multi-negara', '📰');
    m += item('!notes', 'Catatan pribadi (add/list/edit)', '📝');
    m += item('!reminder', 'Atur pengingat (30m / 2h / HH:MM)', '⏰');
    m += item('!welcome', 'Pesan sambutan otomatis grup', '👋');
    m += item('!add', 'Tambah member ke grup', '👥');
    m += item('!tagall', 'Tag semua member grup', '📢');
    m += item('!tanggal', 'Waktu & tanggal Indonesia (WIB)', '🗓️');
    m += item('!warna', 'Generate warna acak + kode hex', '🎨');
    m += lastItem('!server', 'Info server & spesifikasi sistem', '🖥️');
    m += `\n${DIVIDER}\n`;
    m += `_Kembali: \`!menu\` · Detail: \`!help [perintah]\`_`;
    return m;
}

/** Section OWNER */
function buildMenuOwner() {
    let m = '';
    m += `👑 *MENU OWNER*\n`;
    m += `_Kontrol penuh bot — khusus owner terdaftar._\n`;
    m += DIVIDER + '\n';
    m += item('!turu', 'Aktifkan mode tidur bot', '😴');
    m += item('!bangun', 'Bangunkan bot dari mode tidur', '☀️');
    m += item('!pingsan', 'Matikan bot + shutdown PM2', '💀');
    m += item('!self', 'Ganti ke mode self (owner only)', '🔒');
    m += item('!public', 'Ganti ke mode public (semua bisa)', '🔓');
    m += item('!join', 'Bot masuk grup via link invite', '➡️');
    m += item('!leave', 'Bot keluar dari grup ini', '🚪');
    m += item('!block', 'Block kontak tertentu', '⛔');
    m += item('!unblock', 'Unblock kontak', '✅');
    m += item('!spek', 'Spesifikasi lengkap bot & server', '📊');
    m += item('!grup', 'Info & atur pengaturan grup', '👥');
    m += item('!antilink', 'Toggle anti-link grup on/off', '🛡️');
    m += item('!speedtest', 'Tes kecepatan koneksi server', '🌐');
    m += item('!broadcast', 'Kirim pesan ke semua kontak/grup', '📢');
    m += item('!bc', 'Alias dari !broadcast', '📣');
    m += item('!systeminfo', 'Info sistem lengkap (CPU/RAM/disk)', '🧠');
    m += lastItem('!resetroom', 'Reset room Watch2Gether', '🔄');
    m += `\n${DIVIDER}\n`;
    m += `_Kembali: \`!menu\` · Detail: \`!help [perintah]\`_`;
    return m;
}

/** Section AI */
function buildMenuAi() {
    let m = '';
    m += `🧠 *MENU AI & CHAT*\n`;
    m += `_Kecerdasan buatan untuk coding, terjemahan & analisis._\n`;
    m += DIVIDER + '\n';
    m += item('!tanya', 'Tanya AI apapun yang kamu mau', '🤖');
    m += item('!q', 'Chat bebas tanpa prefix panjang', '🗨️');
    m += item('!coding', 'Minta bantuan coding & debugging', '💻');
    m += item('!code', 'Review & analisis kode program', '🔍');
    m += item('!db', 'Generate database, SQL, dan REST API', '🗄️');
    m += item('!rangkum', 'Ringkas teks panjang jadi singkat', '📑');
    m += item('!brainstorm', 'Ide kreatif untuk topik apapun', '💡');
    m += item('!translate', 'Terjemahan multi-bahasa dunia', '🌐');
    m += item('!lihat', 'Analisis & deskripsikan gambar AI', '👁️');
    m += item('!resetai', 'Reset memori percakapan AI', '♻️');
    m += lastItem('!fact', 'Fakta menarik & unik acak', '🤯');
    m += `\n${DIVIDER}\n`;
    m += `_Kembali: \`!menu\` · Detail: \`!help [perintah]\`_`;
    return m;
}

/** Section MUSIK */
function buildMenuMusik() {
    let m = '';
    m += `🎵 *MENU MUSIK & RADIO*\n`;
    m += `_Putar lagu, kelola antrian & integrasi Discord._\n`;
    m += DIVIDER + '\n';
    m += item('!play', 'Cari lagu & masukkan ke antrian radio', '🎵');
    m += item('!nowplaying', 'Lihat lagu yang sedang diputar', '🎶');
    m += item('!queue', 'Lihat seluruh antrian lagu', '📋');
    m += item('!skip', 'Lewati ke lagu berikutnya', '⏭️');
    m += item('!lirik', 'Cari lirik lagu apapun', '📝');
    m += item('!discord', 'Status Discord bot + link invite', '🎧');
    m += lastItem('!watch', 'Buat/buka sesi nonton bareng Luxx TV', '📺');
    m += `\n${DIVIDER}\n`;
    m += `_Discord: \`/join\` \`/play\` \`/queue\` \`/lirik\` \`/leave\` \`/stop\`_\n`;
    m += `_Kembali: \`!menu\` · Detail: \`!help [perintah]\`_`;
    return m;
}

/** Section HIBURAN */
function buildMenuHiburan() {
    let m = '';
    m += `🎌 *MENU HIBURAN & SASTRA*\n`;
    m += `_Anime, puisi, humor & konten hiburan dari seluruh dunia._\n`;
    m += DIVIDER + '\n';
    m += item('!sastra', 'Puisi dari berbagai negara dunia', '📜');
    m += item('!anime', 'Info & detail anime favorit', '🎌');
    m += item('!football', 'Jadwal pertandingan bola terkini', '⚽');
    m += item('!character', 'Cari karakter anime apapun', '👤');
    m += item('!waifu', 'Random waifu anime', '💖');
    m += item('!quotesanime', 'Quote inspiratif dari anime', '📜');
    m += item('!darkjokes', 'Dark humor & lelucon gelap', '😈');
    m += item('!pantun', 'Pantun live dari berbagai daerah', '🎭');
    m += item('!cerpen', 'Cerpen pendek AI', '📖');
    m += lastItem('!meme', 'Meme random lucu', '😂');
    m += `\n${DIVIDER}\n`;
    m += `_Alias: \`!jadwalbola\` = \`!football\`_\n`;
    m += `_Kembali: \`!menu\` · Detail: \`!help [perintah]\`_`;
    return m;
}

/** Section MEDIA */
function buildMenuMedia() {
    let m = '';
    m += `🎨 *MENU MEDIA & TOOLS*\n`;
    m += `_Buat konten, download media & berbagai alat bantu._\n`;
    m += DIVIDER + '\n';
    m += item('!buat', 'Generate gambar AI HD fotorealistik', '🖼️');
    m += item('!s', 'Buat stiker premium dari foto/video', '🎨');
    m += item('!dl', 'Download video/audio dari YouTube & TikTok', '📥');
    m += item('!sp', 'Sound pad — cari, simpan & putar efek suara', '🔊');
    m += item('!quote', 'Kutipan inspiratif acak', '💬');
    m += item('!ocr', 'Baca & ekstrak teks dari gambar', '🔍');
    m += item('!qr', 'Buat QR code dari teks/link', '📱');
    m += item('!kalkulator', 'Kalkulator ekspresi matematika', '🧮');
    m += item('!cuaca', 'Info cuaca kota manapun', '🌤️');
    m += lastItem('!stalk', 'Lihat profil & repo GitHub', '🐙');
    m += `\n${DIVIDER}\n`;
    m += `_Kembali: \`!menu\` · Detail: \`!help [perintah]\`_`;
    return m;
}

/** Section GAMES */
function buildMenuGames() {
    let m = '';
    m += `🎲 *MENU GAMES & FUN*\n`;
    m += `_Polling, gacha & mini-game seru bareng grup._\n`;
    m += DIVIDER + '\n';
    m += item('!apakah', 'Jawaban acak untuk pertanyaan ya/tidak', '🔮');
    m += item('!gacha', 'Random picker dari daftar pilihanmu', '🎲');
    m += item('!voting', 'Buat sesi polling/voting grup', '🗳️');
    m += item('!pilih', 'Pilih opsi dalam voting aktif', '✅');
    m += lastItem('!endvoting', 'Tutup & tampilkan hasil voting', '🛑');
    m += `\n${DIVIDER}\n`;
    m += `_Kembali: \`!menu\` · Detail: \`!help [perintah]\`_`;
    return m;
}

/**
 * Routing menu per section
 * @param {string} sectionArg - argumen section yang diminta
 * @param {boolean} isAdmin
 * @returns {string|null} - teks menu atau null jika section tidak dikenal
 */
function buildSectionMenu(sectionArg, isAdmin) {
    const s = sectionArg.toLowerCase().trim();
    if (s === 'umum' || s === 'general' || s === 'u') return buildMenuUmum();
    if ((s === 'owner' || s === 'admin' || s === 'o') && isAdmin) return buildMenuOwner();
    if (s === 'ai' || s === 'chat' || s === 'a') return buildMenuAi();
    if (s === 'musik' || s === 'music' || s === 'radio' || s === 'm') return buildMenuMusik();
    if (s === 'hiburan' || s === 'entertainment' || s === 'h') return buildMenuHiburan();
    if (s === 'media' || s === 'tools' || s === 't') return buildMenuMedia();
    if (s === 'games' || s === 'game' || s === 'fun' || s === 'g') return buildMenuGames();
    return null;
}

export { buildMenuText, buildSectionMenu };
