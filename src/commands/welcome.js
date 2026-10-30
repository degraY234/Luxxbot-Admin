import {
    getGroupSettings,
    setWelcomeEnabled,
    setWelcomeMessage,
    formatWelcomeMessage,
    getWelcomeHelpText
} from '../services/group-welcome.js';

export async function handleWelcomeCommand({ sock, from, msg, args, isGroup, isAdmin }) {
    if (!isGroup) {
        return sock.sendMessage(from, {
            text: '⚠️ Command welcome hanya untuk grup.'
        }, { quoted: msg });
    }
    if (!isAdmin) {
        return sock.sendMessage(from, {
            text: '⛔ Hanya admin grup / owner yang bisa atur welcome.'
        }, { quoted: msg });
    }

    const sub = args[0]?.toLowerCase();
    const rest = args.slice(1).join(' ').trim();

    if (!sub) {
        const cfg = getGroupSettings(from);
        await sock.sendMessage(from, {
            text:
                `${getWelcomeHelpText()}\n\n` +
                `📌 *Status grup ini:* ${cfg.welcome ? '🟢 ON' : '🔴 OFF'}`
        }, { quoted: msg });
        await sock.sendMessage(from, { text: '✅ Done' }, { quoted: msg });
        return;
    }

    if (sub === 'on') {
        setWelcomeEnabled(from, true);
        await sock.sendMessage(from, { text: '✅ Welcome grup *aktif*!' }, { quoted: msg });
        await sock.sendMessage(from, { text: '✅ Done' }, { quoted: msg });
        return;
    }
    if (sub === 'off') {
        setWelcomeEnabled(from, false);
        await sock.sendMessage(from, { text: '🔴 Welcome grup *nonaktif*.' }, { quoted: msg });
        await sock.sendMessage(from, { text: '✅ Done' }, { quoted: msg });
        return;
    }
    if (sub === 'set' && rest) {
        setWelcomeMessage(from, rest);
        await sock.sendMessage(from, {
            text: `✅ Template welcome disimpan!\n\n_${rest.slice(0, 200)}_`
        }, { quoted: msg });
        await sock.sendMessage(from, { text: '✅ Done' }, { quoted: msg });
        return;
    }
    if (sub === 'preview') {
        const cfg = getGroupSettings(from);
        let groupName = 'Grup Luxx';
        try {
            const meta = await sock.groupMetadata(from);
            groupName = meta.subject || groupName;
        } catch (_) {}
        const preview = formatWelcomeMessage(cfg.message, msg.key.participant || from, groupName);
        await sock.sendMessage(from, { text: preview }, { quoted: msg });
        await sock.sendMessage(from, { text: '✅ Done' }, { quoted: msg });
        return;
    }

    await sock.sendMessage(from, { text: getWelcomeHelpText() }, { quoted: msg });
    await sock.sendMessage(from, { text: '✅ Done' }, { quoted: msg });
}