import { cooldowns, userAIContext } from '../state.js';
import { MAX_MEMORY } from '../config.js';

export function checkCooldown(userId, scope = 'global', duration = 3000) {
    const key = `${userId}:${scope}`;
    const now = Date.now();
    const expiresAt = cooldowns.get(key) || 0;
    if (expiresAt > now) return false;
    cooldowns.set(key, now + duration);
    return true;
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