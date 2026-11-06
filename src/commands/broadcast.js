export async function handleBroadcastCommand({ sock, from, msg, args, isAdmin }) {
    if (!isAdmin) {
        return await sock.sendMessage(from, {
            text: '🛡️ Perintah ini khusus untuk *Owner Bot*!'
        }, { quoted: msg });
    }

    const broadcastMessage = args.join(' ').trim();
    if (!broadcastMessage) {
        return await sock.sendMessage(from, {
            text: '⚠️ Masukkan pesan yang ingin disiarkan!\nContoh: `!bc Pengumuman penting: bot sedang dalam pemeliharaan.`'
        }, { quoted: msg });
    }

    await sock.sendMessage(from, {
        text: '📢 Memulai pengiriman siaran ke semua grup...'
    }, { quoted: msg });

    let groups = [];
    try {
        const participating = await sock.groupFetchAllParticipating();
        groups = Object.keys(participating);
    } catch (e) {
        return await sock.sendMessage(from, {
            text: `❌ Gagal memuat daftar grup: ${e.message}`
        }, { quoted: msg });
    }

    if (groups.length === 0) {
        return await sock.sendMessage(from, {
            text: 'ℹ️ Bot belum bergabung di grup manapun.'
        }, { quoted: msg });
    }

    let successCount = 0;
    let failCount = 0;
    const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    const formattedBroadcast =
        `📢 *LUXX BOT BROADCAST*\n` +
        `📅 _${nowStr} WIB_\n` +
        `────────────────────\n\n` +
        `${broadcastMessage}\n\n` +
        `────────────────────\n` +
        `_Pesan resmi dari Developer / Owner Bot._`;

    for (const groupJid of groups) {
        try {
            await sock.sendMessage(groupJid, { text: formattedBroadcast });
            successCount++;
        } catch (_) {
            failCount++;
        }
        // Throttled delay: 1500ms antar grup untuk proteksi anti-ban
        await new Promise((r) => setTimeout(r, 1500));
    }

    return await sock.sendMessage(from, {
        text:
            `✅ *Siaran Selesai!*\n\n` +
            `• Berhasil terkirim: *${successCount}* grup\n` +
            `• Gagal: *${failCount}* grup\n` +
            `• Total grup: *${groups.length}*`
    }, { quoted: msg });
}
