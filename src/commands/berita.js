import { buildBeritaText } from '../services/news-service.js';

export async function handleBeritaCommand({ sock, from, msg, args }) {
    const query = args.join(' ').trim();

    await sock.sendMessage(from, {
        text: `📰 *Mengambil berita...*\n🌍 Multi-negara · update real-time\n⏳ Mohon tunggu...`
    }, { quoted: msg });

    try {
        const text = await buildBeritaText(query);
        await sock.sendMessage(from, { text }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(from, {
            text:
                `❌ *Berita gagal dimuat*\n_${(e.message || 'error').slice(0, 160)}_\n\n` +
                `💡 Coba \`!berita indonesia\` atau \`!berita help\``
        }, { quoted: msg });
    }
}