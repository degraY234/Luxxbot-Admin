import { extractGroupInviteCode, mapJoinError } from '../utils/group-invite.js';

function getQuotedMessage(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo
        || msg.message?.imageMessage?.contextInfo
        || msg.message?.videoMessage?.contextInfo;
    return ctx?.quotedMessage || null;
}

function getQuotedSender(msg) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo
        || msg.message?.imageMessage?.contextInfo
        || msg.message?.videoMessage?.contextInfo;
    return ctx?.participant || null;
}

function quotedText(quoted) {
    if (!quoted) return '';
    return quoted.conversation
        || quoted.extendedTextMessage?.text
        || quoted.imageMessage?.caption
        || '';
}

export async function handleJoinCommand({ sock, from, msg, args }) {
    await sock.sendPresenceUpdate('composing', from);

    const quoted = getQuotedMessage(msg);

    if (quoted?.groupInviteMessage) {
        try {
            const inv = quoted.groupInviteMessage;
            const senderKey = getQuotedSender(msg) || from;
            const jid = await sock.groupAcceptInviteV4(senderKey, inv);
            const name = inv.groupName || 'grup';
            return sock.sendMessage(from, {
                text: `✅ Berhasil masuk ke *${name}*! 🥷✨${jid ? `\n_${jid}_` : ''}`
            }, { quoted: msg });
        } catch (e) {
            console.error('JOIN V4 ERROR:', e?.message || e);
            return sock.sendMessage(from, { text: `❌ ${mapJoinError(e)}` }, { quoted: msg });
        }
    }

    let sourceText = args.join(' ').trim();
    if (!sourceText) sourceText = quotedText(quoted);

    const code = extractGroupInviteCode(sourceText);
    if (!code) {
        return sock.sendMessage(from, {
            text:
                '⚠️ *Cara pakai !join*\n\n' +
                '`!join https://chat.whatsapp.com/xxxxx`\n\n' +
                'Atau **reply** pesan yang berisi link undangan / kartu invite grup.\n' +
                '_Pastikan link masih aktif dari admin grup._'
        }, { quoted: msg });
    }

    let groupName = '';
    try {
        const info = await sock.groupGetInviteInfo(code);
        groupName = info?.subject || '';
        const participating = await sock.groupFetchAllParticipating();
        if (info?.id && participating[info.id]) {
            return sock.sendMessage(from, {
                text: `ℹ️ Bot sudah ada di grup *${groupName || 'tersebut'}*.`
            }, { quoted: msg });
        }
    } catch (previewErr) {
        const hint = mapJoinError(previewErr);
        if (hint.includes('revoke') || hint.includes('tidak valid') || hint.includes('tidak ditemukan')) {
            return sock.sendMessage(from, { text: `❌ ${hint}` }, { quoted: msg });
        }
        console.log('JOIN preview skip:', previewErr?.message || previewErr);
    }

    try {
        const jid = await sock.groupAcceptInvite(code);
        await sock.sendMessage(from, {
            text:
                `✅ Berhasil masuk${groupName ? ` ke *${groupName}*` : ' ke grup'}! 🥷✨` +
                (jid ? `\n_${jid}_` : '') +
                '\n\n_Kalau grup pakai approval admin, tunggu disetujui dulu._'
        }, { quoted: msg });
    } catch (e) {
        console.error('JOIN ERROR:', e?.message || e);
        await sock.sendMessage(from, { text: `❌ ${mapJoinError(e)}` }, { quoted: msg });
    }
}