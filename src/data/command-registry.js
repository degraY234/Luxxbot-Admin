/** Registry untuk !help <cmd> */
export const COMMAND_HELP = {
    status: {
        title: 'Status Bot',
        usage: '!status',
        desc: 'Tampilkan mode bot, uptime, radio, antrian, Discord.',
        example: '!status'
    },
    help: {
        title: 'Bantuan Perintah',
        usage: '!help <nama>',
        desc: 'Panduan singkat satu perintah.',
        example: '!help dl'
    },
    welcome: {
        title: 'Welcome Grup',
        usage: '!welcome on | off | set <pesan> | preview',
        desc: 'Sambutan otomatis saat member baru masuk. Gunakan @user untuk mention.',
        example: '!welcome set Halo @user! Selamat di grup 🌸'
    },
    tts: {
        title: 'Text to Speech',
        usage: '!tts <teks>',
        desc: 'Ubah teks jadi voice note (max ~200 karakter).',
        example: '!tts Halo semuanya'
    },
    sp: {
        title: 'Sound Pad',
        usage: '!sp | !sp <kata> | !sp <nama-tersimpan>',
        desc: 'Cari sound dari internet (MyInstants + opsional Pixabay/Freesound). Pencarian pintar: nama aneh tetap dapat pilihan sound yang ada kata serupa. Simpan otomatis ke library chat.',
        example: '!sp kicau-mania'
    },
    quote: {
        title: 'Kutipan Dunia Nyata',
        usage: '!quote | !quote <teks> | <penulis> | <asal>',
        desc: 'Kutipan acak (Bahasa Indonesia) + penulis & konteks. Custom tanpa argumen kosong.',
        example: '!quote'
    },
    quotesanime: {
        title: 'Quote Anime',
        usage: '!quotesanime',
        desc: 'Quote anime acak + karakter, judul anime, terjemahan Indonesia.',
        example: '!quotesanime'
    },
    darkjokes: {
        title: 'Dark Humor',
        usage: '!darkjokes',
        desc: 'Dark joke format setup + punchline, filter konten sensitif.',
        example: '!darkjokes'
    },
    aboutlux: {
        title: 'About LuxxBot',
        usage: '!aboutlux',
        desc: 'Profil lengkap LuxxBot, semua fitur, & info pembuat DoxxBorx.',
        example: '!aboutlux'
    },
    cuaca: {
        title: 'Cuaca',
        usage: '!cuaca <kota>',
        desc: 'Laporan cuaca lengkap: realtime, per jam, 7 hari, UV, dan tips praktis.',
        example: '!cuaca Makassar'
    },
    changelogs: {
        title: 'Changelog',
        usage: '!changelogs',
        desc: 'Update terbaru bot (otomatis dari data + git).',
        example: '!changelogs'
    },
    dl: {
        title: 'Download Media',
        usage: '!dl <link> | !dl mp4 <link> | !dl mp4hd <link> | !dl mp3 <link>',
        desc: 'YouTube/IG/TikTok/FB. Video MP4 (720p/1080p, kompatibel HP) atau MP3 kualitas tinggi.',
        example: '!dl mp3 https://youtu.be/...'
    },
    s: {
        title: 'Sticker Premium',
        usage: '!s [tema|teks] — reply gambar/video',
        desc: '16+ tema, teks atas/bawah. Lihat !s help.',
        example: '!s neon|Luxx keren'
    },
    play: {
        title: 'Musik / Radio',
        usage: '!play <judul/url>',
        desc: 'Cari lagu, masuk antrian radio WA + Discord.',
        example: '!play Alan Walker Faded'
    },
    radio: {
        title: 'Link Radio',
        usage: '!radio',
        desc: 'Kirim link dengar radio Luxx.',
        example: '!radio'
    },
    nowplaying: {
        title: 'Now Playing',
        usage: '!nowplaying | !np',
        desc: 'Info lagu yang sedang diputar + requester, tanpa buka link.',
        example: '!nowplaying'
    },
    discord: {
        title: 'Discord',
        usage: '!discord',
        desc: 'Status voice Discord, invite server, dan lagu yang diputar.',
        example: '!discord'
    },
    menu: {
        title: 'Menu',
        usage: '!menu',
        desc: 'Tampilkan menu lengkap.',
        example: '!menu'
    },
    tanya: {
        title: 'AI Tanya',
        usage: '!tanya <pertanyaan>',
        desc: 'Tanya AI (Gemini/Grok/Groq).',
        example: '!tanya apa itu black hole'
    },
    buat: {
        title: 'Gambar AI',
        usage: '!buat <prompt>',
        desc: 'Generate gambar dari teks.',
        example: '!buat kucing astronaut lucu'
    },
    db: {
        title: 'Generator Database',
        usage: '!db <deskripsi proyek>',
        desc: 'Skema database lengkap: tabel, SQL, relasi, contoh API & penjelasan setup.',
        example: '!db perpustakaan lengkap dengan peminjaman buku'
    }
};

export function getCommandHelpText(cmdName) {
    const key = (cmdName || '').toLowerCase().replace(/^!/, '');
    const entry = COMMAND_HELP[key];
    if (!entry) {
        const keys = Object.keys(COMMAND_HELP).sort();
        return (
            `❓ Perintah \`${cmdName}\` tidak ditemukan.\n\n` +
            `📚 *Contoh:* \`!help dl\` · \`!help s\` · \`!help play\`\n\n` +
            `*Terdaftar:* ${keys.join(', ')}`
        );
    }
    return (
        `📖 *BANTUAN: ${entry.title}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *Fungsi:* ${entry.desc}\n` +
        `📝 *Format:* \`${entry.usage}\`\n` +
        `💡 *Contoh:* \`${entry.example}\``
    );
}

export function listAllCommandsBrief() {
    return Object.entries(COMMAND_HELP)
        .map(([k, v]) => `• \`!${k}\` — ${v.title}`)
        .join('\n');
}