import fs from 'fs';
import path from 'path';
import { getTierInfo, getUserTier } from './premium-users.js';

const USAGE_DB_PATH = path.join(process.cwd(), 'data', 'usage-tracker.json');

const KNOWN_TIERS = new Set(['free', 'premium', 'vip']);

function readUsageDb() {
    try {
        if (!fs.existsSync(USAGE_DB_PATH)) return { users: {} };
        return JSON.parse(fs.readFileSync(USAGE_DB_PATH, 'utf8'));
    } catch {
        return { users: {} };
    }
}

function writeUsageDb(data) {
    fs.mkdirSync(path.dirname(USAGE_DB_PATH), { recursive: true });
    fs.writeFileSync(USAGE_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getDayKey() {
    return new Date().toISOString().slice(0, 10);
}

function getMonthKey() {
    return new Date().toISOString().slice(0, 7);
}

export function trackUsage(userId, command) {
    const db = readUsageDb();
    if (!db.users[userId]) db.users[userId] = { daily: {}, monthly: {} };
    
    const day = getDayKey();
    const month = getMonthKey();
    
    if (!db.users[userId].daily[day]) db.users[userId].daily[day] = {};
    if (!db.users[userId].monthly[month]) db.users[userId].monthly[month] = {};
    
    db.users[userId].daily[day][command] = (db.users[userId].daily[day][command] || 0) + 1;
    db.users[userId].monthly[month][command] = (db.users[userId].monthly[month][command] || 0) + 1;
    
    writeUsageDb(db);
    return db.users[userId];
}

export function getUserUsage(userId) {
    const db = readUsageDb();
    const day = getDayKey();
    const month = getMonthKey();
    
    const userData = db.users[userId] || { daily: {}, monthly: {} };
    
    const dailyTotal = Object.values(userData.daily[day] || {}).reduce((a, b) => a + b, 0);
    const monthlyTotal = Object.values(userData.monthly[month] || {}).reduce((a, b) => a + b, 0);
    
    return {
        daily: dailyTotal,
        monthly: monthlyTotal,
        dailyCommands: userData.daily[day] || {},
        monthlyCommands: userData.monthly[month] || {}
    };
}

export function checkUsageLimit(userId, tierOrCommand = null) {
    const usage = getUserUsage(userId);
    
    const tierKey = (typeof tierOrCommand === 'string' && KNOWN_TIERS.has(tierOrCommand.toLowerCase()))
        ? tierOrCommand.toLowerCase()
        : (getUserTier ? getUserTier(userId) : 'free');
        
    const tierInfo = getTierInfo(tierKey);
    
    const resetAt = new Date();
    resetAt.setHours(24, 0, 0, 0);
    
    if (usage.daily >= tierInfo.dailyLimit) {
        return {
            allowed: false,
            remaining: 0,
            resetAt,
            reason: `Daily limit reached (${tierInfo.dailyLimit} requests/day)`,
            usage,
            limit: tierInfo.dailyLimit
        };
    }
    
    if (usage.monthly >= tierInfo.monthlyLimit) {
        return {
            allowed: false,
            remaining: 0,
            resetAt,
            reason: `Monthly limit reached (${tierInfo.monthlyLimit} requests/month)`,
            usage,
            limit: tierInfo.monthlyLimit
        };
    }
    
    return {
        allowed: true,
        remaining: Math.max(0, tierInfo.dailyLimit - usage.daily),
        resetAt,
        usage,
        limit: tierInfo.dailyLimit
    };
}
