import { getJson, setJson } from './persistence.js';

const PERSIST_KEYS = [
    'activeVotes',
    'playSession',
    'spSession',
    'sastraSession',
    'notes',
    'reminders'
];

export async function initGlobalStore() {
    global.activeVotes = await getJson('activeVotes', {}) || {};
    global.playSession = await getJson('playSession', {}) || {};
    global.spSession = await getJson('spSession', {}) || {};
    global.sastraSession = await getJson('sastraSession', {}) || {};
    global.notes = await getJson('notes', {}) || {};
    global.reminders = await getJson('reminders', {}) || {};
}

export async function saveGlobalMap(name, sanitizer = (value) => value) {
    const raw = global[name] || {};
    const cleaned = {};
    for (const key of Object.keys(raw)) {
        cleaned[key] = sanitizer(raw[key]);
    }
    await setJson(name, cleaned);
}

export async function deleteGlobalMapKey(name, key) {
    if (!global[name] || !(key in global[name])) return;
    delete global[name][key];
    await saveGlobalMap(name);
}

export async function saveGlobalState() {
    await saveGlobalMap('activeVotes', (value) => {
        const cleaned = { ...value };
        delete cleaned.timeoutId;
        return cleaned;
    });
}

export default {
    initGlobalStore,
    saveGlobalMap,
    deleteGlobalMapKey,
    saveGlobalState
};