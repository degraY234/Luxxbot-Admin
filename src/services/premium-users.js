import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'premium-users.json');

function readDb() {
    try {
        if (!fs.existsSync(DB_PATH)) return { users: {} };
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch {
        return { users: {} };
    }
}

function writeDb(data) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const TIERS = {
    free: { name: 'Free', dailyLimit: 10, monthlyLimit: 100 },
    premium: { name: 'Premium', dailyLimit: 500, monthlyLimit: 5000 },
    vip: { name: 'VIP', dailyLimit: 9999, monthlyLimit: 99999 }
};

export function getTierInfo(tier) {
    return TIERS[tier] || TIERS.free;
}

export function getUserTier(userId) {
    const db = readDb();
    const user = db.users[userId];
    if (!user) return 'free';
    if (user.tier === 'premium' && user.expiresAt && Date.now() > user.expiresAt) {
        user.tier = 'free';
        user.expiresAt = null;
        writeDb(db);
        return 'free';
    }
    if (user.tier === 'vip' && user.expiresAt && Date.now() > user.expiresAt) {
        user.tier = 'free';
        user.expiresAt = null;
        writeDb(db);
        return 'free';
    }
    return user.tier || 'free';
}

export function setUserTier(userId, tier, expiresAt = null) {
    const db = readDb();
    if (!db.users) db.users = {};
    db.users[userId] = {
        tier,
        expiresAt,
        upgradedAt: Date.now(),
        upgradedBy: 'owner'
    };
    writeDb(db);
    return { ok: true, ...db.users[userId] };
}

export function isPremiumUser(userId) {
    const tier = getUserTier(userId);
    return tier === 'premium' || tier === 'vip';
}

export function addPremiumUser(userId, tier = 'premium', durationDays = 30) {
    return setUserTier(userId, tier, Date.now() + (durationDays * 24 * 60 * 60 * 1000));
}

export function removeUser(userId) {
    const db = readDb();
    if (!db.users || !db.users[userId]) {
        return false;
    }
    delete db.users[userId];
    writeDb(db);
    return true;
}

export function removePremiumUser(userId) {
    return removeUser(userId);
}

export function getAllUsers() {
    const db = readDb();
    return Object.keys(db.users || {});
}

export function getPremiumUsers() {
    const db = readDb();
    return Object.keys(db.users || {}).filter(userId => isPremiumUser(userId));
}

export function getPremiumStats() {
    const db = readDb();
    const users = Object.values(db.users || {});
    return {
        total: users.length,
        premium: users.filter(u => u.tier === 'premium').length,
        vip: users.filter(u => u.tier === 'vip').length,
        free: users.filter(u => !u.tier || u.tier === 'free').length
    };
}
