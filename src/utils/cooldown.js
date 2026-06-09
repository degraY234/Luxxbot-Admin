import { cooldowns, userAIContext } from '../state.js';
import { MAX_MEMORY } from '../config.js';

/** Jeda antar perintah ! per user (ms) — chat biasa tidak kena */
export const COMMAND_COOLDOWN_MS = 5000;

const COOLDOWN_PRUNE_INTERVAL = 200;
let cooldownPruneCounter = 0;

export function pruneExpiredCooldowns() {
    const now = Date.now();
    for (const [key, expiresAt] of cooldowns) {
        if (expiresAt <= now) cooldowns.delete(key);
    }
}

export function checkCooldown(userId, scope = 'global', duration = 3000) {
    const key = `${userId}:${scope}`;
    const now = Date.now();
    const expiresAt = cooldowns.get(key) || 0;
    if (expiresAt > now) return false;
    cooldowns.set(key, now + duration);
    if (++cooldownPruneCounter >= COOLDOWN_PRUNE_INTERVAL) {
        cooldownPruneCounter = 0;
        pruneExpiredCooldowns();
    }
    return true;
}

/** Cooldown khusus perintah bot — pakai JID pengirim, bukan ID grup */
export function checkCommandCooldown(senderJid, duration = COMMAND_COOLDOWN_MS) {
    if (!senderJid) return true;
    return checkCooldown(senderJid, 'command', duration);
}

export function getRemainingCooldown(userId, scope = 'global') {
    const key = `${userId}:${scope}`;
    const expiresAt = cooldowns.get(key) || 0;
    const remainingMs = expiresAt - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export function getUserContext(userId) {
    if (!userAIContext.has(userId)) userAIContext.set(userId, []);
    return userAIContext.get(userId);
}

export function addToContext(userId, role, text) {
    const ctx = getUserContext(userId);
    ctx.push({ role, text });
    if (ctx.length > MAX_MEMORY) ctx.shift();
}