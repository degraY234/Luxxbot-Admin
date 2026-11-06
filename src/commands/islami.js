import axios from 'axios';

const SURAH_NAMES = {
    'alfatihah': 1, 'fatihah': 1,
    'albaqarah': 2, 'baqarah': 2,
    'aliimran': 3, 'imran': 3,
    'annisa': 4, 'nisa': 4,
    'almaidah': 5, 'maidah': 5,
    'alanam': 6, 'anam': 6,
    'alaraf': 7, 'araf': 7,
    'alanfal': 8, 'anfal': 8,
    'attaubah': 9, 'taubah': 9,
    'yunus': 10,
    'hud': 11,
    'yusuf': 12,
    'yasin': 36, 'yaseen': 36,
    'alkahfi': 18, 'kahfi': 18,
    'arrahman': 55, 'rahman': 55,
    'alwaqiah': 56, 'waqiah': 56,
    'almulk': 67, 'mulk': 67,
    'alikhlas': 112, 'ikhlas': 112,
    'alfalaq': 113, 'falaq': 113,
    'annas': 114, 'nas': 114
};

export async function handleSholatCommand({ sock, from, msg, args }) {
    const city = args.join(' ').trim() || 'Jakarta';

    await sock.sendMessage(from, {
        text: `🕌 Mencari jadwal sholat untuk kota *${city}*...`
    }, { quoted: msg });

    try {
        // 1. Primary: MyQuran API (Ultra-fast Indonesian Kemenag database)
        try {
            const searchCityRes = await axios.get(
                `https://api.myquran.com/v2/sholat/kota/cari/${encodeURIComponent(city)}`,
                { timeout: 5000 }
            );

            const cities = searchCityRes.data?.data;
            if (Array.isArray(cities) && cities.length > 0) {
                const cityId = cities[0].id;
                const cityName = cities[0].lokasi;
                const now = new Date();
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                const d = String(now.getDate()).padStart(2, '0');

                const jadwalRes = await axios.get(
                    `https://api.myquran.com/v2/sholat/jadwal/${cityId}/${y}/${m}/${d}`,
                    { timeout: 5000 }
                );

                const j = jadwalRes.data?.data?.jadwal;
                if (j) {
                    const reply =
                        `🕌 *JADWAL SHOLAT — ${cityName.toUpperCase()}*\n` +
                        `📅 *Tanggal:* ${j.tanggal}\n` +
                        `────────────────────\n` +
                        `▫️ *Imsak:* ${j.imsak}\n` +
                        `▫️ *Subuh:* ${j.subuh}\n` +
                        `▫️ *Terbit:* ${j.terbit}\n` +
                        `▫️ *Dhuha:* ${j.dhuha}\n` +
                        `▫️ *Dzuhur:* ${j.dzuhur}\n` +
                        `▫️ *Ashar:* ${j.ashar}\n` +
                        `▫️ *Maghrib:* ${j.maghrib}\n` +
                        `▫️ *Isya:* ${j.isya}\n` +
                        `────────────────────\n` +
                        `_Sumber data resmi: Bimas Islam / Kementerian Agama RI_`;

                    return await sock.sendMessage(from, { text: reply }, { quoted: msg });
                }
            }
        } catch (_) {
            // Fallback to Aladhan if MyQuran search fails
        }

        // 2. Fallback: Aladhan API
        const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Indonesia&method=11`;
        const res = await axios.get(url, { timeout: 8000 });
        const data = res.data?.data;

        if (!data || !data.timings) {
            return await sock.sendMessage(from, {
                text: `❌ Kota *${city}* tidak ditemukan. Coba nama kota yang lebih umum (contoh: \`!sholat Bandung\` atau \`!sholat Surabaya\`).`
            }, { quoted: msg });
        }

        const t = data.timings;
        const dateReadable = data.date?.readable || new Date().toLocaleDateString('id-ID');

        const reply =
            `🕌 *JADWAL SHOLAT — ${city.toUpperCase()}*\n` +
            `📅 *Tanggal:* ${dateReadable}\n` +
            `────────────────────\n` +
            `▫️ *Imsak:* ${t.Imsak}\n` +
            `▫️ *Subuh:* ${t.Fajr}\n` +
            `▫️ *Terbit:* ${t.Sunrise}\n` +
            `▫️ *Dzuhur:* ${t.Dhuhr}\n` +
            `▫️ *Ashar:* ${t.Asr}\n` +
            `▫️ *Maghrib:* ${t.Maghrib}\n` +
            `▫️ *Isya:* ${t.Isha}\n` +
            `────────────────────\n` +
            `_Waktu sholat kalkulasi Kemenag RI / Aladhan._`;

        return await sock.sendMessage(from, { text: reply }, { quoted: msg });
    } catch (err) {
        console.error('!sholat error:', err.message);
        return await sock.sendMessage(from, {
            text: `❌ Gagal mengambil jadwal sholat untuk *${city}*. Silakan coba lagi nanti.`
        }, { quoted: msg });
    }
}

export async function handleQuranCommand({ sock, from, msg, args }) {
    if (!args || args.length === 0) {
        return await sock.sendMessage(from, {
            text:
                `📖 *PENCARIAN AL-QUR'AN*\n\n` +
                `Format penggunaan:\n` +
                `• \`!quran <nomor surah> <nomor ayat>\`\n` +
                `• \`!quran <nama surah> <nomor ayat>\`\n\n` +
                `Contoh:\n` +
                `• \`!quran 2 255\` (Ayat Kursi)\n` +
                `• \`!quran alfatihah 1\`\n` +
                `• \`!quran 112 1\` (Surah Al-Ikhlas ayat 1)`
        }, { quoted: msg });
    }

    let surahInput = args[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    let surah = parseInt(surahInput, 10);
    if (isNaN(surah)) {
        surah = SURAH_NAMES[surahInput] || null;
    }

    if (!surah || surah < 1 || surah > 114) {
        return await sock.sendMessage(from, {
            text: '❌ Surah tidak valid! Masukkan nomor surah antara 1–114 atau nama surah umum.'
        }, { quoted: msg });
    }

    const ayat = parseInt(args[1], 10) || 1;

    try {
        // 1. Primary: MyQuran Quran API (Ultra-fast, Indonesian translation + Latin)
        try {
            const res = await axios.get(`https://api.myquran.com/v2/quran/ayat/${surah}/${ayat}`, { timeout: 5000 });
            const list = res.data?.data;
            if (Array.isArray(list) && list.length > 0) {
                const item = list[0];
                const reply =
                    `📖 *AL-QUR'AN — Surah ${surah} : Ayat ${ayat}*\n` +
                    `📌 *Juz ${item.juz} · Halaman ${item.page}*\n` +
                    `────────────────────\n\n` +
                    `${item.arab}\n\n` +
                    `*Latin:*\n_${item.latin.trim()}_\n\n` +
                    `*Artinya:*\n"${item.text}"\n\n` +
                    `────────────────────\n` +
                    `_Gunakan \`!quran ${surah} ${ayat + 1}\` untuk ayat berikutnya._`;

                return await sock.sendMessage(from, { text: reply }, { quoted: msg });
            }
        } catch (_) {
            // Fallback to Al-Quran Cloud
        }

        // 2. Fallback: Al-Quran Cloud
        const url = `https://api.alquran.cloud/v1/ayah/${surah}:${ayat}/editions/quran-uthmani,id.indonesian`;
        const res = await axios.get(url, { timeout: 8000 });
        const data = res.data?.data;

        if (!data || data.length < 2) {
            return await sock.sendMessage(from, {
                text: `❌ Ayat *${ayat}* tidak ditemukan di Surah ke-${surah}.`
            }, { quoted: msg });
        }

        const arabic = data[0].text;
        const indo = data[1].text;
        const surahData = data[0].surah;

        const reply =
            `📖 *AL-QUR'AN — ${surahData.englishName} (${surahData.name})*\n` +
            `📌 *Surah ke-${surahData.number} : Ayat ${ayat}* (Juz ${data[0].juz})\n` +
            `────────────────────\n\n` +
            `${arabic}\n\n` +
            `*Artinya:*\n` +
            `"${indo}"\n\n` +
            `────────────────────\n` +
            `_Gunakan \`!quran ${surah} ${ayat + 1}\` untuk ayat berikutnya._`;

        return await sock.sendMessage(from, { text: reply }, { quoted: msg });
    } catch (err) {
        console.error('!quran error:', err.message);
        return await sock.sendMessage(from, {
            text: `❌ Gagal mengambil ayat Al-Qur'an (${surah}:${ayat}). Pastikan nomor ayat benar.`
        }, { quoted: msg });
    }
}
