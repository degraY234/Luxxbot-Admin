export const state = {
    isSelfMode: false,
    isSleeping: false,
    antiLink: false,
    isProcessingQueue: false
};

export const cooldowns = new Map();
export const userAIContext = new Map();
export const imageCache = new Map();
export const aiQueue = [];

const MAX_NOTES_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_REMINDERS_AGE_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

let cleanupStarted = false;

export function pruneExpiredNotes() {
    if (!global.notes || typeof global.notes !== 'object') return;
    const now = Date.now();
    for (const [jid, notes] of Object.entries(global.notes)) {
        if (!Array.isArray(notes)) continue;
        global.notes[jid] = notes.filter(n => n && n.updated && (now - new Date(n.updated).getTime() < MAX_NOTES_AGE_MS));
    }
}

export function pruneExpiredReminders() {
    if (!global.reminders || typeof global.reminders !== 'object') return;
    const now = Date.now();
    for (const [jid, reminders] of Object.entries(global.reminders)) {
        if (!Array.isArray(reminders)) continue;
        global.reminders[jid] = reminders.filter(r => r && typeof r.time === 'number' && r.time > now);
    }
}

export function pruneExpiredCooldowns() {
    const now = Date.now();
    for (const [key, expiresAt] of cooldowns) {
        if (expiresAt <= now) cooldowns.delete(key);
    }
}

export function pruneExpiredAIContext() {
    const maxAge = 48 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [key, ctx] of userAIContext) {
        if (!Array.isArray(ctx) || ctx.length === 0) {
            userAIContext.delete(key);
            continue;
        }
        const lastEntry = ctx[ctx.length - 1];
        if (lastEntry && now - new Date(lastEntry.timestamp || 0).getTime() > maxAge) {
            userAIContext.delete(key);
        }
    }
}

export function startGlobalCleanup() {
    if (cleanupStarted) return;
    cleanupStarted = true;
    setInterval(() => {
        try { pruneExpiredNotes(); } catch (err) { console.error('Prune notes error:', err); }
        try { pruneExpiredReminders(); } catch (err) { console.error('Prune reminders error:', err); }
        try { pruneExpiredCooldowns(); } catch (err) { console.error('Prune cooldowns error:', err); }
        try { pruneExpiredAIContext(); } catch (err) { console.error('Prune AI context error:', err); }
    }, CLEANUP_INTERVAL_MS);
}