import { BOT_NAME } from '../config.js';
import { ABOUT_META } from './aboutlux.js';

export function getGuideText() {
    return (
        `🌸 *PANDUAN ${BOT_NAME.toUpperCase()}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👋 *Baru pertama kali?* Begini cara pakainya:\n\n` +
        `1️⃣ Ketik \`!menu\` → lihat semua perintah\n` +
        `2️⃣ Ketik \`!help <nama>\` → detail satu fitur\n` +
        `3️⃣ Ketik \`!status\` → cek bot & radio online\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔥 *FITUR POPULER*\n\n` +
        `🤖 AI · \`!tanya\` \`!q\` \`!coding\` \`!translate\`\n` +
        `🎵 Musik · \`!play\` \`!nowplaying\` \`!lirik\` \`!discord\`\n` +
        `📰 Info · \`!berita\` \`!cuaca\` \`!changelogs\`\n` +
        `📜 Sastra · \`!sastra cinta\` → pilih negara\n` +
        `🎨 Media · \`!s\` \`!buat\` \`!dl\` \`!sp\`\n` +
        `🎲 Fun · \`!quote\` \`!meme\` \`!voting\` \`!gacha\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 *TIPS*\n` +
        `• Semua perintah diawali \`!\`\n` +
        `• Reply gambar/video untuk \`!s\` (stiker)\n` +
        `• \`!lapor <pesan>\` kalau ada bug\n` +
        `• \`!aboutlux\` → profil & portofolio pembuat\n\n` +
        `👑 Creator: *${ABOUT_META.creator}*\n` +
        `🌐 Portfolio: ${ABOUT_META.portfolio}\n` +
        `📞 Support: @${ABOUT_META.support}`
    );
}

export async function handleGuideCommand({ sock, from, msg }) {
    await sock.sendMessage(from, { text: getGuideText() }, { quoted: msg });
}