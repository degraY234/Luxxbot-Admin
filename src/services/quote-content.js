/** Format caption — tanpa nama API / domain */

function waktuDibuat() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function formatDarkJokeCaption(joke) {
    return (
        `😈 *DARK HUMOR*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${joke.setup}\n\n` +
        `💀 *${joke.punch}*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🏷️ _${joke.tag || 'humor gelap'}_ · untuk dewasa\n` +
        `🕐 *Dibuat:* ${waktuDibuat()} WIB\n` +
        `⚠️ Bukan untuk anak · hindari konten sensitif\n` +
        `🎭 *LuxxBot* — \`!darkjokes\` lagi`
    );
}

export function formatWisdomCaption(entry, custom = false) {
    const header = custom ? '💬 *KUTIPAN KAMU*' : '✨ *KUTIPAN HARI INI*';
    const lines = [
        `${header}`,
        `━━━━━━━━━━━━━━━━━━━━━━━`,
        '',
        `_"${entry.text}"_`,
        '',
        `👤 *— ${entry.author}*`
    ];

    if (entry.origin) {
        lines.push(`📜 *Konteks:* ${entry.origin}`);
    }

    lines.push(
        '',
        `━━━━━━━━━━━━━━━━━━━━━━━`,
        `🕐 *Dikirim:* ${waktuDibuat()} WIB`,
        `🌸 *LuxxBot* · \`!quote\` · \`!quotesanime\``
    );

    return lines.join('\n');
}

export function formatAnimeQuoteCaption(data) {
    return (
        `🎌 *QUOTE ANIME*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `_"${data.quote}"_\n\n` +
        `👤 *Karakter:* ${data.character}\n` +
        `📺 *Anime:* ${data.anime}\n` +
        `📜 *Konteks:* Dialog / kutipan karakter\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🕐 *Dikirim:* ${waktuDibuat()} WIB\n` +
        `🇮🇩 Bahasa Indonesia\n` +
        `🌸 *LuxxBot* · \`!quote\` untuk kutipan dunia nyata`
    );
}

export function parseCustomQuote(raw) {
    const parts = raw.split('|').map((s) => s.trim());
    if (!parts[0]) return null;
    return {
        text: parts[0],
        author: parts[1] || 'Anonim',
        origin: parts[2] || 'Kutipan pribadi'
    };
}