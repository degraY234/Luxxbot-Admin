/**
 * Frasa sehari-hari, label topik, dan narasi per topik.
 * Karya sastra diambil live — bukan database statis.
 */

export const SASTRA_TOPICS = {
    cinta: {
        label: 'Cinta & Kasih',
        pengantar: 'Cinta di chat atau percakapan biasanya singkat — langsung, lugas, tanpa banyak kiasan.',
        refleksi: 'Dalam sastra, cinta dirangkai panjang lewat metafora, irama, dan gambaran yang membentang. Perasaan yang sama, tetapi cara mengungkapkannya jauh lebih dalam dan berlapis.',
        seharihari: [
            'Kangen kamu',
            'Aku sayang kamu',
            'Kamu tampan sekali',
            'Kamu cantik deh',
            'Aku nggak bisa move on',
            'Rindu banget sama kamu',
            'Kamu manis deh',
            'Aku cinta kamu'
        ]
    },
    rindu: {
        label: 'Rindu & Kerinduan',
        pengantar: 'Rindu sehari-hari diucapkan ringkas — "kangen", "kapan pulang?", "kapan ketemu lagi?"',
        refleksi: 'Sastra merangkai kerinduan dalam bait panjang: jarak, waktu, alam, dan kenangan saling bertaut. Bukan sekadar bilang kangen, melainkan menggambarkan betapa beratnya hati yang menanti.',
        seharihari: [
            'Kangen banget',
            'Kapan kita ketemu lagi?',
            'Aku kangen kamu',
            'Kangennya luar biasa',
            'Rindu nih sama kamu',
            'Kapan kamu pulang?'
        ]
    },
    alam: {
        label: 'Alam & Alam Semesta',
        pengantar: 'Alam sehari-hari cukup diakui dengan kata sederhana — bagus, sejuk, indah.',
        refleksi: 'Penyair mengajak kita melihat alam sebagai cermin jiwa: gunung, laut, angin, dan cahaya bukan sekadar pemandangan, melainkan bahasa untuk merasakan hidup.',
        seharihari: ['Pemandangannya bagus banget', 'Udaranya sejuk', 'Langitnya biru', 'Hutannya hijau', 'Pantainya keren']
    },
    hujan: {
        label: 'Hujan & Musim',
        pengantar: 'Hujan di percakapan biasa hanya soal cuaca — deras, gerimis, basah kuyup.',
        refleksi: 'Dalam puisi, hujan sering jadi simbol perasaan: kesepian, penantian, atau kesegaran setelah duka. Titik-titik air menjadi bahasa hati.',
        seharihari: ['Hujannya deras', 'Bawa payung ya', 'Cuacanya gerimis', 'Basah kuyup deh', 'Hujan terus nih']
    },
    malam: {
        label: 'Malam & Senja',
        pengantar: 'Malam dan senja biasanya hanya komentar singkat — gelap, indah, atau sepi.',
        refleksi: 'Sastra menjadikan senja dan malam sebagai ruang bercerita: perpisahan, kerinduan, atau keheningan yang penuh makna di balik kata-kata panjang.',
        seharihari: ['Malam ini indah', 'Langit sudah gelap', 'Senja ya', 'Bintangnya banyak', 'Malam ini sepi']
    },
    hidup: {
        label: 'Kehidupan & Jiwa',
        pengantar: 'Hidup sehari-hari diomongkan langsung — susah, capek, semangat, jangan menyerah.',
        refleksi: 'Sastra merenungkan hidup lewat pertanyaan besar tentang jiwa, nasib, dan arti. Bukan slogan singkat, melainkan perenungan yang mendalam.',
        seharihari: ['Hidup itu susah', 'Semangat ya!', 'Jangan menyerah', 'Hidupmu bagaimana?', 'Aku capek hidup']
    },
    kematian: {
        label: 'Kematian & Kepergian',
        pengantar: 'Kepergian dan duka diucapkan singkat — belasungkawa, sedih, semoga tenang.',
        refleksi: 'Dalam sastra, kematian dan kehilangan diungkap perlahan lewat doa, kenangan, dan gambaran yang menyentuh. Bahasa sastra memberi ruang untuk meratapi.',
        seharihari: ['Dia sudah meninggal', 'Turut berduka ya', 'Semoga tenang di sana', 'Sedih banget', 'Dia sudah pergi']
    },
    harapan: {
        label: 'Harapan & Cita-cita',
        pengantar: 'Harapan sehari-hari terdengar ringan — semoga berhasil, jangan putus asa, doain ya.',
        refleksi: 'Penyair menulis harapan sebagai api yang menembus kegelapan: bukan kalimat motivasi cepat, melainkan keyakinan yang dibangun dalam irama panjang.',
        seharihari: ['Semoga berhasil ya', 'Jangan putus asa', 'Pasti bisa kok', 'Doain aku ya', 'Semoga rezekinya lancar']
    },
    tanahair: {
        label: 'Tanah Air & Bangsa',
        pengantar: 'Cinta tanah air sehari-hari — bangga, keren, merdeka — singkat dan lugas.',
        refleksi: 'Sastra bangsa merangkai tanah air dalam gambaran luas: sejarah, rakyat, dan jiwa negeri. Bukan sekadar seruan, melainkan puisi yang mengakar pada identitas.',
        seharihari: ['Indonesia keren', 'Cinta Indonesia', 'Bangga jadi orang Indonesia', 'Tanah airku', 'Merdeka!']
    }
};

const TOPIC_ALIASES = {
    cinta: 'cinta', kasih: 'cinta', love: 'cinta', romantis: 'cinta', sayang: 'cinta',
    rindu: 'rindu', kangen: 'rindu', merindu: 'rindu', missing: 'rindu',
    alam: 'alam', nature: 'alam', gunung: 'alam', laut: 'alam', pantai: 'alam',
    hujan: 'hujan', rain: 'hujan', gerimis: 'hujan',
    malam: 'malam', night: 'malam', senja: 'malam', sunset: 'malam', fajar: 'malam',
    hidup: 'hidup', life: 'hidup', jiwa: 'hidup', soul: 'hidup',
    mati: 'kematian', kematian: 'kematian', death: 'kematian', duka: 'kematian',
    harapan: 'harapan', hope: 'harapan', asa: 'harapan', mimpi: 'harapan',
    tanahair: 'tanahair', indonesia: 'tanahair', bangsa: 'tanahair', negeri: 'tanahair',
    kemerdekaan: 'tanahair', merdeka: 'tanahair'
};

export function normalizeSastraTopic(raw) {
    const t = String(raw || 'cinta').toLowerCase().trim();
    return TOPIC_ALIASES[t] || (SASTRA_TOPICS[t] ? t : 'cinta');
}