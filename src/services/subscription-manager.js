import fs from 'fs';
import path from 'path';

const SUB_DB_PATH = path.join(process.cwd(), 'data', 'subscriptions.json');

function readSubDb() {
    try {
        if (!fs.existsSync(SUB_DB_PATH)) return { subscriptions: {} };
        return JSON.parse(fs.readFileSync(SUB_DB_PATH, 'utf8'));
    } catch {
        return { subscriptions: {} };
    }
}

function writeSubDb(data) {
    fs.mkdirSync(path.dirname(SUB_DB_PATH), { recursive: true });
    fs.writeFileSync(SUB_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function createSubscription(userId, tier, durationDays, paymentMethod = 'manual') {
    const db = readSubDb();
    const now = Date.now();
    const expiresAt = now + (durationDays * 24 * 60 * 60 * 1000);
    
    db.subscriptions[userId] = {
        tier,
        startedAt: now,
        expiresAt,
        paymentMethod,
        autoRenew: false,
        remindersSent: {
            threeDays: false,
            oneDay: false,
            expired: false
        }
    };
    
    writeSubDb(db);
    return db.subscriptions[userId];
}

export function getSubscription(userId) {
    const db = readSubDb();
    const sub = db.subscriptions[userId];
    if (!sub) return null;
    
    if (Date.now() > sub.expiresAt) {
        return { ...sub, expired: true };
    }
    
    return { ...sub, expired: false };
}

export function extendSubscription(userId, tier, durationDays) {
    const db = readSubDb();
    const existing = db.subscriptions[userId];
    
    if (existing && !existing.expired) {
        const newExpiresAt = existing.expiresAt + (durationDays * 24 * 60 * 60 * 1000);
        existing.expiresAt = newExpiresAt;
        existing.tier = tier;
        existing.remindersSent = { threeDays: false, oneDay: false, expired: false };
    } else {
        const now = Date.now();
        const expiresAt = now + (durationDays * 24 * 60 * 60 * 1000);
        db.subscriptions[userId] = {
            tier,
            startedAt: now,
            expiresAt,
            paymentMethod: 'manual',
            autoRenew: false,
            remindersSent: { threeDays: false, oneDay: false, expired: false }
        };
    }
    
    writeSubDb(db);
    return db.subscriptions[userId];
}

export function cancelSubscription(userId) {
    const db = readSubDb();
    delete db.subscriptions[userId];
    writeSubDb(db);
    return true;
}

export function getAllActiveSubscriptions() {
    const db = readSubDb();
    const now = Date.now();
    
    return Object.entries(db.subscriptions)
        .filter(([_, sub]) => sub.expiresAt > now)
        .map(([userId, sub]) => ({
            userId,
            ...sub,
            daysRemaining: Math.ceil((sub.expiresAt - now) / (24 * 60 * 60 * 1000))
        }));
}

export function getExpiredSubscriptions() {
    const db = readSubDb();
    const now = Date.now();
    
    return Object.entries(db.subscriptions)
        .filter(([_, sub]) => sub.expiresAt <= now)
        .map(([userId, sub]) => ({
            userId,
            ...sub,
            daysExpired: Math.ceil((now - sub.expiresAt) / (24 * 60 * 60 * 1000))
        }));
}

export function checkAndSendReminders() {
    const db = readSubDb();
    const now = Date.now();
    const reminders = [];
    
    for (const [userId, sub] of Object.entries(db.subscriptions)) {
        if (sub.expired) continue;
        
        const daysRemaining = Math.ceil((sub.expiresAt - now) / (24 * 60 * 60 * 1000));
        
        if (daysRemaining <= 3 && !sub.remindersSent.threeDays) {
            reminders.push({
                userId,
                type: 'threeDays',
                message: `⚠️ Subscription anda ${sub.tier} akan berakhir dalam 3 hari.`,
                daysRemaining
            });
            sub.remindersSent.threeDays = true;
        }
        
        if (daysRemaining <= 1 && !sub.remindersSent.oneDay) {
            reminders.push({
                userId,
                type: 'oneDay',
                message: `🚨 Subscription ${sub.tier} berakhir BESOK!`,
                daysRemaining
            });
            sub.remindersSent.oneDay = true;
        }
        
        if (daysRemaining <= 0 && !sub.remindersSent.expired) {
            reminders.push({
                userId,
                type: 'expired',
                message: `❌ Subscription ${sub.tier} sudah berakhir.`,
                daysRemaining
            });
            sub.remindersSent.expired = true;
            sub.expired = true;
        }
    }
    
    writeSubDb(db);
    return reminders;
}

export function getSubscriptionStats() {
    const db = readSubDb();
    const now = Date.now();
    
    const subs = Object.values(db.subscriptions);
    const active = subs.filter(s => s.expiresAt > now);
    const expired = subs.filter(s => s.expiresAt <= now);
    
    const tierBreakdown = {
        free: subs.filter(s => s.tier === 'free').length,
        premium: subs.filter(s => s.tier === 'premium').length,
        vip: subs.filter(s => s.tier === 'vip').length
    };
    
    return {
        total: subs.length,
        active: active.length,
        expired: expired.length,
        tierBreakdown,
        revenue: {
            premium: tierBreakdown.premium * 25000,
            vip: tierBreakdown.vip * 100000
        }
    };
}
