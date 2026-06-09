import {
    parseTranslateInput,
    translateText,
    formatTranslateResult,
    getTranslateHelpText,
    getTranslateListText
} from '../services/translate-service.js';

export async function handleTranslateCommand({ sock, from, msg, args }) {
    const parsed = parseTranslateInput(args);

    if (parsed.kind === 'empty') {
        return sock.sendMessage(from, { text: getTranslateHelpText() }, { quoted: msg });
    }
    if (parsed.kind === 'help') {
        return sock.sendMessage(from, { text: getTranslateHelpText() }, { quoted: msg });
    }
    if (parsed.kind === 'list') {
        return sock.sendMessage(from, { text: getTranslateListText() }, { quoted: msg });
    }

    if (!parsed.text?.trim()) {
        return sock.sendMessage(from, {
            text: '⚠️ Teksnya mana? Contoh: `!translate id en selamat pagi`'
        }, { quoted: msg });
    }

    await sock.sendMessage(from, {
        text: `🌐 *Menerjemahkan...*\n🔍 Kamus dunia · multi-bahasa\n⏳ Mohon tunggu sebentar...`
    }, { quoted: msg });

    try {
        const result = await translateText(parsed.text, parsed.from, parsed.to);
        await sock.sendMessage(from, { text: formatTranslateResult(result) }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(from, {
            text:
                `❌ *Translate gagal*\n_${(e.message || 'error').slice(0, 160)}_\n\n` +
                `💡 Coba: \`!translate id en <teks>\` atau \`!translate help\``
        }, { quoted: msg });
    }
}