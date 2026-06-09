import { OWNER_NUMBER } from '../config.js';

export function getLaporHelpText() {
    return (
        `📮 *LUXX !lapor — Kirim Feedback*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *Format:* \`!lapor <pesan kamu>\`\n\n` +
        `💡 *Contoh:*\n` +
        `├ \`!lapor !translate error pas terjemah jepang\`\n` +
        `├ \`!lapor request fitur !sholat\`\n` +
        `└ \`!lapor radio lagunya tidak jalan\`\n\n` +
        `_Pesan dikirim langsung ke owner · semua user bisa pakai_`
    );
}

export async function handleLaporCommand({ sock, from, msg, args, sender, isGroup }) {
    const text = args.join(' ').trim();
    if (!text || text.toLowerCase() === 'help') {
        return sock.sendMessage(from, { text: getLaporHelpText() }, { quoted: msg });
    }

    const senderNum = sender.split('@')[0];
    const groupLine = isGroup ? `👥 Grup: ${from}\n` : '💬 Chat: pribadi\n';

    const ownerMsg =
        `📮 *LAPORAN USER*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 Dari: @${senderNum}\n` +
        groupLine +
        `🕐 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n\n` +
        `📝 *Pesan:*\n${text}`;

    let sent = false;
    for (const owner of OWNER_NUMBER) {
        const jid = `${owner}@s.whatsapp.net`;
        try {
            await sock.sendMessage(jid, {
                text: ownerMsg,
                mentions: [`${senderNum}@s.whatsapp.net`]
            });
            sent = true;
        } catch (e) {
            console.log('lapor forward skip:', e.message);
        }
    }

    await sock.sendMessage(from, {
        text: sent
            ? `✅ *Laporan terkirim!*\n\nTerima kasih sudah membantu LuxxBot jadi lebih baik 🌸\n_Owner akan cek secepatnya._`
            : `⚠️ Laporan tersimpan tapi gagal diteruskan ke owner.\nCoba hubungi @6282384961407 langsung.`
    }, { quoted: msg });
}