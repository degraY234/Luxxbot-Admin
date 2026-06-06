import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SETTINGS_FILE = path.join(ROOT, 'data', 'group-settings.json');

const DEFAULT_WELCOME =
    `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
    `│  🌸 *SELAMAT DATANG!* 🌸  │\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `Halo @user! 👋\n` +
    `Kamu resmi jadi bagian dari *{grup}* ✨\n\n` +
    `Ketik \`!menu\` untuk lihat fitur LuxxBot\n` +
    `Ketik \`!aboutlux\` untuk kenal bot 💖\n\n` +
    `_Enjoy & jaga ketertiban grup ya~_`;

function loadAll() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch (_) {}
    return {};
}

function saveAll(data) {
    if (!fs.existsSync(path.dirname(SETTINGS_FILE))) {
        fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

export function getGroupSettings(groupId) {
    const all = loadAll();
    return all[groupId] || { welcome: false, message: DEFAULT_WELCOME, goodbye: false };
}

export function setWelcomeEnabled(groupId, enabled) {
    const all = loadAll();
    all[groupId] = { ...getGroupSettings(groupId), welcome: enabled };
    saveAll(all);
    return all[groupId];
}

export function setWelcomeMessage(groupId, message) {
    const all = loadAll();
    all[groupId] = { ...getGroupSettings(groupId), welcome: true, message: message || DEFAULT_WELCOME };
    saveAll(all);
    return all[groupId];
}

export function formatWelcomeMessage(template, participantId, groupName) {
    const tag = `@${participantId.split('@')[0]}`;
    return template
        .replace(/@user/gi, tag)
        .replace(/\{grup\}/gi, groupName || 'grup ini');
}

export function getWelcomeHelpText() {
    return (
        `👋 *WELCOME GRUP*\n\n` +
        `\`!welcome on\` — aktifkan sambutan\n` +
        `\`!welcome off\` — matikan\n` +
        `\`!welcome set <pesan>\` — custom (pakai @user & {grup})\n` +
        `\`!welcome preview\` — lihat contoh\n` +
        `\`!welcome\` — status grup ini`
    );
}