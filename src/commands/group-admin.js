import { OWNER_NUMBER } from '../config.js';

function getTargetJid(msg, args) {
    const context = msg.message?.extendedTextMessage?.contextInfo;
    if (context?.mentionedJid && context.mentionedJid.length > 0) {
        return context.mentionedJid[0];
    }
    if (context?.participant) {
        return context.participant;
    }
    const rawNumber = (args[0] || '').replace(/[^0-9]/g, '');
    if (rawNumber.length >= 8) {
        return `${rawNumber}@s.whatsapp.net`;
    }
    return null;
}

export async function handleGroupAdminCommand({
    sock,
    from,
    msg,
    sender,
    command,
    args,
    isGroup,
    isAdmin,
    isGroupAdmin
}) {
    if (!isGroup) {
        return await sock.sendMessage(from, {
            text: '⚠️ Perintah ini hanya dapat digunakan di dalam grup!'
        }, { quoted: msg });
    }

    let groupMeta;
    try {
        groupMeta = await sock.groupMetadata(from);
    } catch (e) {
        return await sock.sendMessage(from, {
            text: '❌ Gagal mengambil informasi grup. Pastikan bot berada di dalam grup ini.'
        }, { quoted: msg });
    }

    const botNumber = (sock.user?.id ? sock.user.id.split(':')[0] : '').replace(/[^0-9]/g, '');
    const botJid = `${botNumber}@s.whatsapp.net`;
    const botParticipant = groupMeta.participants.find(p => p.id.split(':')[0].replace(/[^0-9]/g, '') === botNumber);
    const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

    const senderNumber = sender.split('@')[0].replace(/[^0-9]/g, '');
    const isSenderAdmin = isAdmin || isGroupAdmin || groupMeta.participants.some(
        p => p.id.split(':')[0].replace(/[^0-9]/g, '') === senderNumber && (p.admin === 'admin' || p.admin === 'superadmin')
    );

    if (!isSenderAdmin) {
        return await sock.sendMessage(from, {
            text: '⚠️ Fitur ini khusus untuk *Admin Grup*!'
        }, { quoted: msg });
    }

    const cmd = command.toLowerCase();

    // 1. Kick Member
    if (cmd === 'kick' || cmd === 'tendang') {
        if (!isBotAdmin) {
            return await sock.sendMessage(from, {
                text: '❌ Bot harus menjadi *Admin Grup* terlebih dahulu untuk mengeluarkan anggota!'
            }, { quoted: msg });
        }

        const target = getTargetJid(msg, args);
        if (!target) {
            return await sock.sendMessage(from, {
                text: '⚠️ Tag atau reply orang yang ingin dikeluarkan!\nContoh: `!kick @user`'
            }, { quoted: msg });
        }

        const targetNum = target.split('@')[0].replace(/[^0-9]/g, '');
        if (targetNum === botNumber) {
            return await sock.sendMessage(from, { text: '😅 Mana bisa aku mengeluarkan diriku sendiri!' }, { quoted: msg });
        }
        if (OWNER_NUMBER.includes(targetNum)) {
            return await sock.sendMessage(from, { text: '🛡️ Tidak bisa mengeluarkan Owner bot!' }, { quoted: msg });
        }

        try {
            await sock.groupParticipantsUpdate(from, [target], 'remove');
            return await sock.sendMessage(from, {
                text: `👋 Anggota @${targetNum} telah dikeluarkan dari grup.`,
                mentions: [target]
            }, { quoted: msg });
        } catch (e) {
            return await sock.sendMessage(from, {
                text: `❌ Gagal mengeluarkan anggota: ${e.message || 'Izin ditolak'}`
            }, { quoted: msg });
        }
    }

    // 2. Promote Member to Admin
    if (cmd === 'promote' || cmd === 'admin') {
        if (!isBotAdmin) {
            return await sock.sendMessage(from, {
                text: '❌ Bot harus menjadi *Admin Grup* terlebih dahulu!'
            }, { quoted: msg });
        }

        const target = getTargetJid(msg, args);
        if (!target) {
            return await sock.sendMessage(from, {
                text: '⚠️ Tag atau reply anggota yang ingin dijadikan admin!\nContoh: `!promote @user`'
            }, { quoted: msg });
        }

        try {
            await sock.groupParticipantsUpdate(from, [target], 'promote');
            return await sock.sendMessage(from, {
                text: `🎉 Selamat! @${target.split('@')[0]} sekarang adalah Admin Grup.`,
                mentions: [target]
            }, { quoted: msg });
        } catch (e) {
            return await sock.sendMessage(from, {
                text: `❌ Gagal mempromosikan anggota: ${e.message || 'Izin ditolak'}`
            }, { quoted: msg });
        }
    }

    // 3. Demote Admin to Member
    if (cmd === 'demote' || cmd === 'unadmin') {
        if (!isBotAdmin) {
            return await sock.sendMessage(from, {
                text: '❌ Bot harus menjadi *Admin Grup* terlebih dahulu!'
            }, { quoted: msg });
        }

        const target = getTargetJid(msg, args);
        if (!target) {
            return await sock.sendMessage(from, {
                text: '⚠️ Tag atau reply admin yang ingin diturunkan menjadi anggota biasa!\nContoh: `!demote @user`'
            }, { quoted: msg });
        }

        try {
            await sock.groupParticipantsUpdate(from, [target], 'demote');
            return await sock.sendMessage(from, {
                text: `🔻 Jabatan admin untuk @${target.split('@')[0]} telah dicabut.`,
                mentions: [target]
            }, { quoted: msg });
        } catch (e) {
            return await sock.sendMessage(from, {
                text: `❌ Gagal menurunkan admin: ${e.message || 'Izin ditolak'}`
            }, { quoted: msg });
        }
    }

    // 4. Hidetag (Invisible mentions to all participants)
    if (cmd === 'hidetag' || cmd === 'h') {
        const messageText = args.join(' ').trim() || '📢 *Panggilan Admin untuk semua anggota grup!*';
        const participants = groupMeta.participants.map(p => p.id);

        return await sock.sendMessage(from, {
            text: messageText,
            mentions: participants
        });
    }

    // 5. Tagall (Visible mentions list)
    if (cmd === 'tagall') {
        const note = args.join(' ').trim();
        const participants = groupMeta.participants.map(p => p.id);
        let listText = `📣 *TAG ALL - ${groupMeta.subject}*\n`;
        if (note) listText += `📝 *Pesan:* ${note}\n`;
        listText += `👥 *Total:* ${participants.length} anggota\n\n`;

        participants.forEach((p, idx) => {
            listText += `${idx + 1}. @${p.split('@')[0]}\n`;
        });

        return await sock.sendMessage(from, {
            text: listText.trim(),
            mentions: participants
        }, { quoted: msg });
    }

    // 6. Group Invite Link
    if (cmd === 'linkgc' || cmd === 'linkgroup') {
        if (!isBotAdmin) {
            return await sock.sendMessage(from, {
                text: '❌ Bot harus menjadi *Admin Grup* untuk mengambil link grup!'
            }, { quoted: msg });
        }

        try {
            const code = await sock.groupInviteCode(from);
            return await sock.sendMessage(from, {
                text: `🔗 *Link Undangan Grup:* \nhttps://chat.whatsapp.com/${code}`
            }, { quoted: msg });
        } catch (e) {
            return await sock.sendMessage(from, {
                text: `❌ Gagal mengambil tautan grup: ${e.message || 'Izin ditolak'}`
            }, { quoted: msg });
        }
    }

    // 7. Group Open/Close Setting
    if (cmd === 'group' || cmd === 'gc') {
        if (!isBotAdmin) {
            return await sock.sendMessage(from, {
                text: '❌ Bot harus menjadi *Admin Grup* untuk mengubah setelan grup!'
            }, { quoted: msg });
        }

        const action = (args[0] || '').toLowerCase();
        if (action === 'buka' || action === 'open') {
            await sock.groupSettingUpdate(from, 'not_announcement');
            return await sock.sendMessage(from, {
                text: '🔓 *Grup telah dibuka!* Sekarang semua anggota dapat mengirim pesan.'
            }, { quoted: msg });
        } else if (action === 'tutup' || action === 'close') {
            await sock.groupSettingUpdate(from, 'announcement');
            return await sock.sendMessage(from, {
                text: '🔒 *Grup telah ditutup!* Sekarang hanya admin yang dapat mengirim pesan.'
            }, { quoted: msg });
        } else {
            return await sock.sendMessage(from, {
                text: '⚠️ Gunakan opsi `buka` atau `tutup`.\nContoh: `!group buka` atau `!group tutup`'
            }, { quoted: msg });
        }
    }
}
