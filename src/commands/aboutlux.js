import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BOT_NAME } from '../config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_CREATOR_PHOTO = path.join(ROOT, 'assets', 'aboutlux-creator.jpg');

export const PORTFOLIO_URL =
    process.env.PORTFOLIO_URL?.trim() || 'https://degray234.github.io/PortoDoxxborx/';

export const ABOUT_META = {
    creator: 'DoxxBorx',
    age: 19,
    region: 'Indonesia 🇮🇩',
    education: 'Mahasiswa Teknik Komputer',
    role: 'Developer & Owner LuxxBot',
    tagline: 'Build · Code · Ship',
    support: '6282384961407',
    discord: 'discord.gg/QJQVDfvx',
    portfolio: PORTFOLIO_URL
};

function getVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        return pkg.version || '3.1.0';
    } catch {
        return '3.1.0';
    }
}

function getCreatorPhotoPath() {
    const custom = process.env.ABOUTLUX_PHOTO?.trim();
    if (custom && fs.existsSync(custom)) return path.resolve(custom);
    if (fs.existsSync(DEFAULT_CREATOR_PHOTO)) return DEFAULT_CREATOR_PHOTO;
    return null;
}

function buildPhotoCaption(meta, version) {
    return (
        `🌸 *L U X X B O T* v${version}\n` +
        `👑 *${meta.creator}*\n` +
        `💻 ${meta.education}\n` +
        `📍 ${meta.region} · ${meta.age} tahun\n` +
        `${meta.tagline} ✨\n\n` +
        `☕ Satu cangkir kopi, ribuan baris kode — ` +
        `itu cara ${meta.creator} ngebangun ${BOT_NAME} dari nol.\n` +
        `Santai di depan layar, serius di balik fitur. Gass coding! 💻🔥\n\n` +
        `🌐 *Portofolio:* ${meta.portfolio}`
    );
}

function buildFullText(meta, version) {
    return (
        `🌸 *L U X X B O T* 🌸\n` +
        `*Premium WhatsApp Bot* · v${version}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👑 *PEMBUAT*\n` +
        `├ Nama · *${meta.creator}*\n` +
        `├ Profesi · ${meta.education}\n` +
        `├ Umur · ${meta.age} tahun\n` +
        `├ Base · ${meta.region}\n` +
        `└ Role · ${meta.role}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 *FITUR* _(80+ perintah)_\n\n` +
        `🎮 *Umum*\n` +
        `\`!guide\` \`!halo\` \`!ping\` \`!status\` \`!help\` \`!menu\` \`!berita\` \`!lapor\` \`!notes\` \`!reminder\` \`!welcome\` \`!tagall\` \`!tanggal\` \`!server\`\n\n` +
        `🧠 *AI & Chat*\n` +
        `\`!tanya\` \`!coding\` \`!db\` \`!code\` \`!rangkum\` \`!brainstorm\` \`!translate\` \`!lihat\` \`!q\` \`!fact\` \`!resetai\`\n\n` +
        `🎵 *Musik & Radio*\n` +
        `\`!play\` \`!nowplaying\` \`!discord\` \`!queue\` \`!skip\` \`!lirik\` \`!watch\`\n` +
        `_Luxx Watch — nonton bareng via web_\n\n` +
        `🎌 *Hiburan & Sastra*\n` +
        `\`!sastra\` \`!anime\` \`!football\` \`!character\` \`!waifu\` \`!quotesanime\` \`!darkjokes\` \`!pantun\` \`!cerpen\` \`!meme\`\n\n` +
        `🎨 *Media & Tools*\n` +
        `\`!buat\` \`!sp\` \`!quote\` \`!s\` \`!dl\` \`!ocr\` \`!qr\` \`!kalkulator\` \`!cuaca\` \`!stalk\`\n\n` +
        `🎲 *Fun & Games*\n` +
        `\`!apakah\` \`!gacha\` \`!voting\` \`!pilih\` \`!endvoting\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 *Platform*\n` +
        `WhatsApp · Discord Voice · Web Radio · Luxx Watch · Admin Panel\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🖥️ *PORTOFOLIO ${meta.creator.toUpperCase()}*\n` +
        `Satu orang, satu laptop, satu gelas kopi — semua fitur di atas lahir dari situ. ☕💻\n` +
        `Mau liat proyek, skill, & jejak coding-nya? Cuss mampir:\n` +
        `🔗 ${meta.portfolio}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📞 @${meta.support}\n` +
        `💬 ${meta.discord}\n\n` +
        `_Dibuat dengan kode & kopi oleh ${meta.creator} ☕💻_\n` +
        `_Ketik \`!menu\` · \`!changelogs\` · \`!status\`_`
    );
}

export async function handleAboutLuxCommand({ sock, from, msg }) {
    const version = getVersion();
    const meta = { ...ABOUT_META };
    const fullText = buildFullText(meta, version);
    const photoPath = getCreatorPhotoPath();

    if (!photoPath) {
        return sock.sendMessage(from, {
            text: fullText + `\n\n_📷 Foto pembuat: taruh di assets/aboutlux-creator.jpg_`
        }, { quoted: msg });
    }

    try {
        const image = fs.readFileSync(photoPath);
        await sock.sendMessage(from, {
            image,
            caption: buildPhotoCaption(meta, version)
        }, { quoted: msg });
        await sock.sendMessage(from, { text: fullText }, { quoted: msg });
    } catch (e) {
        console.error('ABOUTLUX ERROR:', e.message);
        await sock.sendMessage(from, {
            text: fullText + `\n\n_⚠️ Gagal kirim foto: ${e.message?.slice(0, 80)}_`
        }, { quoted: msg });
    }
}