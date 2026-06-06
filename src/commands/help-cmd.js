import { getCommandHelpText, listAllCommandsBrief } from '../data/command-registry.js';

export async function handleHelpCommand({ sock, from, msg, args }) {
    const sub = args[0]?.toLowerCase();
    if (!sub || sub === 'list') {
        const text =
            `📚 *BANTUAN LUXXBOT*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `Ketik \`!help <nama>\` untuk detail.\n` +
            `Contoh: \`!help dl\` · \`!help play\`\n\n` +
            listAllCommandsBrief();
        return sock.sendMessage(from, { text }, { quoted: msg });
    }
    const text = getCommandHelpText(sub);
    await sock.sendMessage(from, { text }, { quoted: msg });
}