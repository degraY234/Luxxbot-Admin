import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_CREATOR_PHOTO = path.join(ROOT, 'assets', 'aboutlux-creator.jpg');

export const ABOUT_META = {
    creator: 'DoxxBorx',
    age: 19,
    region: 'Indonesia 🇮🇩',
    role: 'Developer & Owner LuxxBot',
    support: '6282384961407',
    discord: 'discord.gg/QJQVDfvx'
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

function buildCaption(meta, version) {
    return (
        `🌸 *L U X X B O T* 🌸\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `👑 *Pembuat:* ${meta.creator}\n` +
        `🎂 *Umur:* ${meta.age} tahun\n` +
        `📍 *Wilayah:* ${meta.region}\n` +
        `💼 *Peran:* ${meta.role}\n` +
        `📦 *Versi:* v${version}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🤖 WhatsApp · 📻 Radio · 🎮 Discord\n` +
        `🧠 AI · 🎨 Sticker · 📥 Download\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📞 @${meta.support}\n` +
        `💬 ${meta.discord}\n\n` +
        `_Dibuat dengan dedikasi oleh DoxxBorx 💖_\n` +
        `_!menu · !changelogs · !status_`
    );
}

export async function handleAboutLuxCommand({ sock, from, msg }) {
    const version = getVersion();
    const meta = { ...ABOUT_META, version };
    const photoPath = getCreatorPhotoPath();

    if (!photoPath) {
        return sock.sendMessage(from, {
            text:
                `🌸 *L U X X B O T*\n\n` +
                `👑 Pembuat: *${meta.creator}* (${meta.age} th)\n` +
                `📍 ${meta.region}\n` +
                `📦 v${version}\n\n` +
                `_Foto pembuat belum ada di assets/aboutlux-creator.jpg_`
        }, { quoted: msg });
    }

    try {
        const image = fs.readFileSync(photoPath);
        await sock.sendMessage(from, {
            image,
            caption: buildCaption(meta, version)
        }, { quoted: msg });
    } catch (e) {
        console.error('ABOUTLUX ERROR:', e.message);
        await sock.sendMessage(from, {
            text: buildCaption(meta, version) + `\n\n_⚠️ Gagal kirim foto: ${e.message?.slice(0, 80)}_`
        }, { quoted: msg });
    }
}