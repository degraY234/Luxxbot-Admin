import { generateBuatImage } from '../services/buat-image.js';

export function getBuatHelpText() {
    return (
        `🎨 *LUXX !buat — Generator Gambar HD*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *Format:* \`!buat <deskripsi gambar>\`\n` +
        `📷 *Default:* fotorealistik, jernih, HD\n` +
        `🖼️ *Resolusi:* hingga 2K\n\n` +
        `💡 *Contoh prompt bagus:*\n` +
        `├ \`!buat kucing persia di taman bunga, sore hari, cahaya lembut\`\n` +
        `├ \`!buat wanita berjalan di kota hujan malam, cinematic, neon\`\n` +
        `├ \`!buat pemandangan gunung dan danau, golden hour, ultra detail\`\n` +
        `└ \`!buat anime girl pedang\` _(kartun hanya kalau diminta)_\n\n` +
        `✏️ *Tips hasil terbaik:*\n` +
        `• Sebut subjek + lokasi + pencahayaan\n` +
        `• Tambah kata: *cinematic, detail, realistis*\n` +
        `• Hindari prompt terlalu pendek (min. 4–5 kata)`
    );
}

export async function handleBuatCommand({ sock, from, msg, args }) {
    const prompt = args.join(' ').trim();
    if (!prompt || prompt.toLowerCase() === 'help') {
        return sock.sendMessage(from, { text: getBuatHelpText() }, { quoted: msg });
    }

    await sock.sendMessage(from, {
        text: `🎨 *Membuat gambar...*\n📝 _${prompt.slice(0, 80)}_\n⏳ Tunggu sebentar ya, sedang digambar...`
    }, { quoted: msg });

    try {
        const result = await generateBuatImage(prompt);
        const caption =
            `✨ *LUXX !buat*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📝 *Prompt:* ${result.userPrompt}\n` +
            `🎨 *Status:* selesai · kualitas HD\n\n` +
            `_💡 \`!buat <deskripsi lain>\` untuk gambar baru_`;

        await sock.sendMessage(from, {
            image: result.buffer,
            caption
        }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(from, {
            text:
                `❌ *Gagal buat gambar*\n_${(e.message || 'error').slice(0, 280)}_\n\n` +
                `💡 Coba prompt lebih spesifik atau ulang 1–2 menit.`
        }, { quoted: msg });
    }
}