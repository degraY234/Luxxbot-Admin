import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let redisClient = null;
let sqliteDb = null;
let sqliteInitDone = false;

const SQLITE_PATH = process.env.SQLITE_PATH || './data/luxxbot.sqlite3';
const SQLITE_DIR = path.dirname(SQLITE_PATH);
const USE_REDIS = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);

async function initRedis() {
    if (redisClient) return redisClient;
    const { createClient } = await import('redis');
    const url = process.env.REDIS_URL || null;
    const opts = url ? { url } : {
        socket: {
            host: process.env.REDIS_HOST || '127.0.0.1',
            port: Number(process.env.REDIS_PORT || 6379)
        },
        password: process.env.REDIS_PASSWORD || undefined
    };
    redisClient = createClient(opts);
    redisClient.on('error', (err) => console.error('Redis error:', err?.message || err));
    await redisClient.connect();
    return redisClient;
}

let sqliteInitPromise = null;

async function initSqlite() {
    if (sqliteDb) return sqliteDb;
    if (sqliteInitPromise) return sqliteInitPromise;
    sqliteInitPromise = (async () => {
        fs.mkdirSync(SQLITE_DIR, { recursive: true });
        const sqliteModule = await import('better-sqlite3');
        const Database = sqliteModule.default || sqliteModule;
        sqliteDb = new Database(SQLITE_PATH, { fileMustExist: false });
        sqliteDb.pragma('journal_mode = WAL');
        sqliteDb.pragma('synchronous = NORMAL');
        sqliteDb.prepare(
            'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
        ).run();
        sqliteInitDone = true;
        return sqliteDb;
    })();
    return sqliteInitPromise;
}

export async function initPersistence() {
    if (USE_REDIS) {
        try { await initRedis(); } catch (e) { console.error('Redis init failed:', e?.message || e); }
        return;
    }
    try { await initSqlite(); } catch (e) { console.error('SQLite init failed:', e?.message || e); }
}

export async function getJson(key, defaultValue = null) {
    if (USE_REDIS) {
        const client = await initRedis();
        const raw = await client.get(key);
        if (!raw) return defaultValue;
        try {
            return JSON.parse(raw);
        } catch {
            return defaultValue;
        }
    }
    const db = await initSqlite();
    const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
    if (!row || !row.value) return defaultValue;
    try {
        return JSON.parse(row.value);
    } catch {
        return defaultValue;
    }
}

export async function setJson(key, value) {
    const serialized = JSON.stringify(value || {});
    if (USE_REDIS) {
        const client = await initRedis();
        await client.set(key, serialized);
        return;
    }
    const db = await initSqlite();
    db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, serialized);
}

export async function deleteKey(key) {
    if (USE_REDIS) {
        const client = await initRedis();
        await client.del(key);
        return;
    }
    const db = await initSqlite();
    db.prepare('DELETE FROM kv_store WHERE key = ?').run(key);
}

export default {
    initPersistence,
    getJson,
    setJson,
    deleteKey
};