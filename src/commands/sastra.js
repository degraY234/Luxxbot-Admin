import {
    getSastraHelpText,
    buildSastraPickerText,
    buildSastraLoadingText,
    fetchSastraWork,
    findSastraRegion
} from '../services/sastra-service.js';

const SESSION_TTL_MS = 5 * 60 * 1000;

function setSession(from, data) {
    global.sastraSession = global.sastraSession || {};
    global.sastraSession[from] = { ...data, at: Date.now() };
}

function clearSession(from) {
    if (global.sastraSession?.[from]) delete global.sastraSession[from];
}

export function getSastraSession(from) {
    const s = global.sastraSession?.[from];
    if (!s) return null;
    if (Date.now() - (s.at || 0) > SESSION_TTL_MS) {
        clearSession(from);
        return null;
    }
    return s;
}

export async function handleSastraPick({ sock, from, msg, pick }) {
    const session = getSastraSession(from);
    if (!session) return false;

    const region = findSastraRegion(String(pick));
    if (!region) {
        await sock.sendMessage(from, {
            text: `❌ Pilih angka 1–12 dari daftar negara.\n_💡 \`!sastra ${session.topic}\` untuk ulang_`
        }, { quoted: msg });
        return true;
    }

    clearSession(from);
    await sock.sendMessage(from, {
        text: buildSastraLoadingText(session.topic, region)
    }, { quoted: msg });

    try {
        const result = await fetchSastraWork(session.topic, region.id);
        await sock.sendMessage(from, { text: result });
    } catch (e) {
        await sock.sendMessage(from, {
            text: `❌ Gagal memuat sastra.\n_${(e.message || 'error').slice(0, 140)}_`
        }, { quoted: msg });
    }
    return true;
}

export async function handleSastraCommand({ sock, from, msg, args }) {
    const raw = args.join(' ').trim();
    const lower = raw.toLowerCase();

    if (!raw || lower === 'help' || lower === 'bantuan') {
        return sock.sendMessage(from, { text: getSastraHelpText() }, { quoted: msg });
    }

    if (lower.startsWith('pilih ')) {
        const pick = raw.slice(6).trim();
        const session = getSastraSession(from) || { topic: 'cinta' };
        const region = findSastraRegion(pick);
        if (!region) {
            return sock.sendMessage(from, {
                text: '⚠️ Negara tidak dikenal. Contoh: `!sastra pilih indonesia` atau balas angka 1–12.'
            }, { quoted: msg });
        }
        clearSession(from);
        await sock.sendMessage(from, {
            text: buildSastraLoadingText(session.topic, region)
        }, { quoted: msg });
        try {
            const result = await fetchSastraWork(session.topic, region.id);
            await sock.sendMessage(from, { text: result });
        } catch (e) {
            await sock.sendMessage(from, { text: `❌ ${e.message}` }, { quoted: msg });
        }
        return;
    }

    const topic = raw;
    setSession(from, { topic });
    await sock.sendMessage(from, {
        text: buildSastraPickerText(topic)
    }, { quoted: msg });
}