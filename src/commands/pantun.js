import { fetchLivePantun, formatPantunMessage, getPantunHelpText } from '../services/pantun-service.js';

export async function handlePantunCommand({ sock, from, msg, args }) {
    const tema = args[0] || 'lucu';
    if (tema.toLowerCase() === 'help' || tema.toLowerCase() === 'bantuan') {
        return sock.sendMessage(from, { text: getPantunHelpText() }, { quoted: msg });
    }

    await sock.sendMessage(from, {
        text: `🎭 *Mencari pantun...*\n🌐 Tema: *${tema}*\n⏳ Menggali dari sumber dunia...`
    }, { quoted: msg });

    try {
        const data = await fetchLivePantun(tema);
        await sock.sendMessage(from, { text: formatPantunMessage(data) }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(from, {
            text: `❌ Gagal memuat pantun.\n_${(e.message || 'error').slice(0, 120)}_\n_💡 Coba \`!pantun lucu\` lagi_`
        }, { quoted: msg });
    }
}