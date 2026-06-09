import { SASTRA_TOPICS, normalizeSastraTopic } from '../data/sastra-indonesia.js';
import { fetchLiveSastra } from './sastra-api.js';

export const SASTRA_REGIONS = [
    { id: 1, key: 'indonesia', name: 'Indonesia', flag: '🇮🇩', era: 'Chairil Anwar · Amir Hamzah · Sanusi Pane' },
    { id: 2, key: 'inggris', name: 'Inggris & Amerika', flag: '🇬🇧', era: 'Shakespeare · Dickinson · Frost' },
    { id: 3, key: 'prancis', name: 'Prancis', flag: '🇫🇷', era: 'Baudelaire · Hugo · Rimbaud' },
    { id: 4, key: 'jepang', name: 'Jepang', flag: '🇯🇵', era: 'Bashō · Issa · haiku klasik' },
    { id: 5, key: 'arab', name: 'Arab', flag: '🇸🇦', era: 'Gibran · puisi klasik Timur' },
    { id: 6, key: 'india', name: 'India', flag: '🇮🇳', era: 'Tagore · Naidu · puisi Sanskrit' },
    { id: 7, key: 'yunani', name: 'Yunani Kuno', flag: '🏛️', era: 'Homer · Sappho · epik klasik' },
    { id: 8, key: 'rusia', name: 'Rusia', flag: '🇷🇺', era: 'Pushkin · Akhmatova' },
    { id: 9, key: 'spanyol', name: 'Spanyol & Latin', flag: '🇪🇸', era: 'Neruda · Lorca' },
    { id: 10, key: 'china', name: 'Tiongkok', flag: '🇨🇳', era: 'Li Po · Tu Fu' },
    { id: 11, key: 'persia', name: 'Persia', flag: '🇮🇷', era: 'Rumi · Khayyam' },
    { id: 12, key: 'random', name: 'Acak dari Seluruh Dunia', flag: '🌍', era: 'Negara berbeda setiap kali' }
];

function findRegion(input) {
    const raw = String(input || '').toLowerCase().trim();
    if (!raw) return null;
    const num = parseInt(raw, 10);
    if (!Number.isNaN(num)) return SASTRA_REGIONS.find((r) => r.id === num) || null;
    return SASTRA_REGIONS.find((r) =>
        r.key === raw || r.name.toLowerCase().includes(raw) || raw.includes(r.key)
    ) || null;
}

export function getSastraHelpText() {
    const topics = Object.values(SASTRA_TOPICS).map((t) => t.label).join(', ');
    return (
        `📜 *LUXX SASTRA DUNIA*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Jelajahi perbedaan bahasa sehari-hari dan bahasa sastra dari berbagai negara.\n` +
        `Setiap panggilan menampilkan *satu karya* yang selalu berbeda.\n\n` +
        `📌 *Cara pakai:*\n` +
        `├ \`!sastra cinta\` → pilih negara\n` +
        `├ Balas angka \`1\`–\`12\`\n` +
        `└ Panggil lagi → karya baru\n\n` +
        `📚 *Contoh perbandingan:*\n` +
        `💬 "Kangen kamu" _(sehari-hari)_\n` +
        `✨ → kutipan panjang asli dari karya penyair\n\n` +
        `🎭 *Topik:* ${topics}\n` +
        `_Contoh: \`!sastra rindu\` lalu balas \`1\`_`
    );
}

export function buildSastraPickerText(topic) {
    const key = normalizeSastraTopic(topic);
    const topicData = SASTRA_TOPICS[key];
    const daily = topicData?.seharihari?.[0] || 'kangen kamu';

    const lines = SASTRA_REGIONS.map((r) =>
        `${r.id}. ${r.flag} *${r.name}*\n   _${r.era}_`
    );

    return (
        `📜 *SASTRA DUNIA — PILIH NEGARA*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🎭 *Topik:* ${topicData?.label || topic}\n` +
        `_${topicData?.pengantar || ''}_\n\n` +
        `💡 *Satu karya per panggilan:*\n` +
        `• Bandingkan "${daily}" dengan kutipan sastra asli\n` +
        `• Teks karya lengkap + refleksi tema *${topicData?.label}*\n` +
        `• _Selalu berbeda setiap kali_\n\n` +
        `Pilih negara (balas 1–12):\n\n` +
        lines.join('\n\n') +
        `\n\n_🇮🇩 Balas \`1\` untuk sastra Indonesia_`
    );
}

export function buildSastraLoadingText(topic, region) {
    const topicData = getTopicData(topic);
    return (
        `📜 *Menggali sastra ${region.flag} ${region.name}...*\n` +
        `🎭 Topik: *${topicData.label}*\n` +
        `⏳ Mencari satu karya bertema ${topicData.label.toLowerCase()}...`
    );
}

function getTopicData(topic) {
    const key = normalizeSastraTopic(topic);
    return SASTRA_TOPICS[key] || SASTRA_TOPICS.cinta;
}

export async function fetchSastraWork(topic, regionInput) {
    const region = findRegion(regionInput);
    if (!region) throw new Error('Negara tidak dikenal. Pilih 1–12.');
    return fetchLiveSastra(topic, region);
}

export { findRegion as findSastraRegion };