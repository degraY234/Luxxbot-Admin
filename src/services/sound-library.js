import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOUNDS_DIR = path.join(ROOT, 'data', 'sounds');
const FILES_DIR = path.join(SOUNDS_DIR, 'files');
const LIBS_DIR = path.join(SOUNDS_DIR, 'libraries');

export const MAX_SOUNDS_PER_CHAT = 80;
export const MAX_SOUND_MB = 16;

function ensureDirs() {
    for (const d of [SOUNDS_DIR, FILES_DIR, LIBS_DIR]) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
}

function chatKey(jid) {
    return crypto.createHash('sha1').update(String(jid || 'global')).digest('hex').slice(0, 16);
}

function libPath(jid) {
    return path.join(LIBS_DIR, `${chatKey(jid)}.json`);
}

function loadLib(jid) {
    ensureDirs();
    const file = libPath(jid);
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {}
    return { sounds: {}, updatedAt: null };
}

function saveLib(jid, data) {
    ensureDirs();
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(libPath(jid), JSON.stringify(data, null, 2));
}

const FILLER_WORDS = new Set([
    'sound', 'sounds', 'sfx', 'effect', 'effects', 'audio', 'meme', 'the', 'a', 'an',
    'and', 'or', 'dj', 'original', 'hd', 'remix', 'version', 'instant', 'button'
]);

/** Normalisasi input user / rename (boleh lebih panjang) */
export function slugify(text, maxLen = 24) {
    return String(text || 'sound')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLen) || 'sound';
}

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/[\s-]+/)
        .map(w => w.trim())
        .filter(w => w && w.length > 1 && !FILLER_WORDS.has(w) && !/^\d+$/.test(w));
}

function dedupeTokens(tokens) {
    const seen = new Set();
    const out = [];
    for (const t of tokens) {
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}

/** Nama pendek otomatis — max 2 kata, ~12 karakter */
export function makeAutoSoundName(title, sourceId = '', maxLen = 12) {
    const idBase = String(sourceId || '')
        .toLowerCase()
        .replace(/-\d{4,}$/, '');

    const fromId = dedupeTokens(tokenize(idBase.replace(/-/g, ' ')));
    const fromTitle = dedupeTokens(tokenize(title));
    const words = fromTitle.length ? fromTitle : fromId;

    if (!words.length) return 'snd';

    // Satu kata cukup kalau sudah jelas (≥5 huruf), else gabung max 2 kata tanpa strip
    let name = words[0].length >= 5
        ? words[0]
        : words.slice(0, 2).join('');

    name = name.replace(/[^a-z0-9]/g, '').slice(0, maxLen);
    return name || 'snd';
}

function uniqueName(lib, title, sourceId = '') {
    const name = makeAutoSoundName(title, sourceId);
    if (!lib.sounds[name]) return name;
    let n = 2;
    while (lib.sounds[`${name}${n}`]) n++;
    return `${name}${n}`;
}

function fileKey(sourceId, source) {
    const raw = `${source}:${sourceId}`;
    return crypto.createHash('md5').update(raw).digest('hex');
}

function resolveFilePath(entry) {
    return path.join(FILES_DIR, entry.file);
}

export function listSounds(jid, { favoritesOnly = false } = {}) {
    const lib = loadLib(jid);
    let items = Object.values(lib.sounds);
    if (favoritesOnly) items = items.filter(s => s.favorite);
    return items.sort((a, b) => (b.plays || 0) - (a.plays || 0) || new Date(b.addedAt) - new Date(a.addedAt));
}

export function getSound(jid, name) {
    const lib = loadLib(jid);
    const key = slugify(name);
    return lib.sounds[key] || null;
}

export function findLocalSounds(jid, query) {
    const q = slugify(query);
    if (!q) return [];
    return listSounds(jid).filter(s =>
        s.name.includes(q)
        || slugify(s.title).includes(q)
        || s.title.toLowerCase().includes(query.toLowerCase())
    );
}

export function saveSoundToLibrary(jid, {
    title,
    buffer,
    sourceId,
    source = 'myinstants',
    mp3Url = '',
    addedBy = '',
    customName = ''
}) {
    const lib = loadLib(jid);
    const count = Object.keys(lib.sounds).length;
    if (count >= MAX_SOUNDS_PER_CHAT) {
        throw new Error(`Library penuh (max ${MAX_SOUNDS_PER_CHAT} sound). Hapus dulu: \`!sp del <nama>\``);
    }

    const name = customName ? slugify(customName, 16) : uniqueName(lib, title, sourceId);
    if (lib.sounds[name]) {
        return { entry: lib.sounds[name], created: false };
    }

    const fkey = fileKey(sourceId || name, source);
    const filename = `${fkey}.mp3`;
    const filePath = path.join(FILES_DIR, filename);

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, buffer);
    }

    const entry = {
        name,
        title: title || name,
        file: filename,
        sourceId: sourceId || name,
        source,
        mp3Url,
        addedBy,
        addedAt: new Date().toISOString(),
        plays: 0,
        favorite: false,
        size: buffer.length
    };

    lib.sounds[name] = entry;
    saveLib(jid, lib);
    return { entry, created: true };
}

export function readSoundBuffer(entry) {
    const fp = resolveFilePath(entry);
    if (!fs.existsSync(fp)) throw new Error(`File sound "${entry.name}" hilang dari disk`);
    return fs.readFileSync(fp);
}

export function bumpPlays(jid, name) {
    const lib = loadLib(jid);
    const key = slugify(name);
    const entry = lib.sounds[key];
    if (!entry) return null;
    entry.plays = (entry.plays || 0) + 1;
    entry.lastPlayedAt = new Date().toISOString();
    saveLib(jid, lib);
    return entry;
}

export function deleteSound(jid, name) {
    const lib = loadLib(jid);
    const key = slugify(name);
    const entry = lib.sounds[key];
    if (!entry) return null;

    delete lib.sounds[key];
    saveLib(jid, lib);

    // Check if file used by other chats
    const fp = resolveFilePath(entry);
    let usedElsewhere = false;
    if (fs.existsSync(LIBS_DIR)) {
        for (const f of fs.readdirSync(LIBS_DIR)) {
            if (!f.endsWith('.json')) continue;
            try {
                const other = JSON.parse(fs.readFileSync(path.join(LIBS_DIR, f), 'utf8'));
                if (Object.values(other.sounds || {}).some(s => s.file === entry.file)) {
                    usedElsewhere = true;
                    break;
                }
            } catch (_) {}
        }
    }
    if (!usedElsewhere && fs.existsSync(fp)) {
        try { fs.unlinkSync(fp); } catch (_) {}
    }
    return entry;
}

export function renameSound(jid, oldName, newName) {
    const lib = loadLib(jid);
    const oldKey = slugify(oldName);
    const newKey = slugify(newName);
    const entry = lib.sounds[oldKey];
    if (!entry) return null;
    if (lib.sounds[newKey] && newKey !== oldKey) {
        throw new Error(`Nama "${newKey}" sudah dipakai sound lain`);
    }
    delete lib.sounds[oldKey];
    entry.name = newKey;
    lib.sounds[newKey] = entry;
    saveLib(jid, lib);
    return entry;
}

export function toggleFavorite(jid, name) {
    const lib = loadLib(jid);
    const key = slugify(name);
    const entry = lib.sounds[key];
    if (!entry) return null;
    entry.favorite = !entry.favorite;
    saveLib(jid, lib);
    return entry;
}

export function getLibraryStats(jid) {
    const items = listSounds(jid);
    const totalSize = items.reduce((n, s) => n + (s.size || 0), 0);
    return {
        count: items.length,
        favorites: items.filter(s => s.favorite).length,
        totalSize,
        max: MAX_SOUNDS_PER_CHAT
    };
}

export function formatSize(bytes = 0) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}