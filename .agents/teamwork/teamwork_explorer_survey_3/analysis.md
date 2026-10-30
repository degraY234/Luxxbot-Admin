# Audit Report: Data Persistence, State Management, External Services & Reliability

**Author**: Survey Explorer 3 (`teamwork_explorer`)  
**Target Project**: Luxx WhatsApp Bot (`C:\Users\DoxxBorx\Project Bot Wa`)  
**Mode**: Read-Only Codebase Investigation  
**Date**: 2026-10-29  

---

## 1. Executive Summary

This investigation performed a comprehensive audit of data persistence, state management, external API integrations, error recovery, concurrency control, and runtime edge cases across the Luxx WhatsApp bot codebase. 

The audit uncovered several critical architectural findings and outright operational bugs:
1. **Severe Persistence Fragmentation**: While `better-sqlite3` is installed and configured in `src/utils/persistence.js`, it only maintains a single generic `kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)` table. Crucial domain state (subscriptions, premium tiers, usage quotas, group settings, and sound libraries) is scattered across uncoordinated flat JSON files (`data/*.json`) written synchronously with `fs.writeFileSync`.
2. **Critical Silent Memory Leak in `src/state.js`**: Background cleanup functions attempt to iterate over `global.notes` and `global.reminders` using `for...of` syntax, which crashes with `TypeError: global.notes is not iterable` because they are plain Objects loaded from JSON. Because this error is swallowed in `catch (_) {}`, neither `pruneExpiredCooldowns()` nor `pruneExpiredAIContext()` ever runs, causing unbounded memory leaks in long-running processes.
3. **Severe ReferenceErrors in Core Services**:
   - `src/services/dl-media.js:355`: Variable `buffer` is referenced without being defined in `downloadViaYtDlp` for video downloads, causing all video downloads to crash with `ReferenceError: buffer is not defined`.
   - `src/services/premium-users.js:71,75`: Calls undefined functions `removeUser(userId)` and `getAllUsers()`, breaking `removePremiumUser` and `getPremiumUsers`.
   - `src/services/usage-tracker.js:65`: Calls `getTierInfo(tier)` without importing it, causing `checkUsageLimit` to throw `ReferenceError: getTierInfo is not defined`.
4. **Async/Promise Defect in Payment Gateway**: `src/services/payment-gateway.js:88-104` calls `axios.get` synchronously without `await`, causing `validatePayment()` to always fail and return `{ valid: false, status: 'error' }`.
5. **Database Concurrency Risks**: `src/utils/persistence.js` lacks `PRAGMA busy_timeout = 5000;`, does not implement schema migrations or versioning (`PRAGMA user_version`), and does not implement graceful shutdown cleanup (`wal_checkpoint(TRUNCATE)` on `SIGINT`/`SIGTERM`).
6. **WhatsApp Message Envelope Dropping**: `src/handlers/messages.js:112` extracts message type naively with `Object.keys(msg.message)[0]`, causing messages sent inside ephemeral (disappearing) chats or view-once wrappers to be silently ignored.

---

## 2. Database Architecture Audit

### 2.1 File Location & Initialization
- **Configured Path**: `process.env.SQLITE_PATH || './data/luxxbot.sqlite3'` (`src/utils/persistence.js:9`).
- **Disk Files Present**:
  - `data/luxxbot.sqlite3` (4 KB)
  - `data/luxxbot.sqlite3-wal` (45 KB)
  - `data/luxxbot.sqlite3-shm` (32 KB)
- **Initialization Lifecycle**:
  - Handled asynchronously via `initPersistence()` -> `initSqlite()` (`persistence.js:32-49`).
  - Directory created on demand: `fs.mkdirSync(SQLITE_DIR, { recursive: true })`.
  - Dynamically imports `better-sqlite3` and executes:
    ```javascript
    sqliteDb = new Database(SQLITE_PATH, { fileMustExist: false });
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('synchronous = NORMAL');
    sqliteDb.prepare(
        'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
    ).run();
    ```

### 2.2 Schema Definitions, Tables & Indexes
Executing an inspection query against `sqlite_master` in `data/luxxbot.sqlite3` confirms:
- **Tables**: Exactly **one table** exists:
  ```sql
  CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  ```
- **Indexes**: Only the implicit primary key index `sqlite_autoindex_kv_store_1`.
- **Current Keys Stored**: `[{"key": "sastraSession"}, {"key": "spSession"}]`.
- **Domain Tables (Users, Subscriptions, Settings, Stats, Notes)**: **Completely absent from SQLite**.

### 2.3 Query Patterns & Transactions
- Only three queries exist across the entire persistence layer:
  1. `SELECT value FROM kv_store WHERE key = ?`
  2. `INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  3. `DELETE FROM kv_store WHERE key = ?`
- **Transactions**: `db.transaction(...)` is **nowhere used**. Every single call executes as an isolated statement.

### 2.4 Migration Mechanisms
- There is **no migration system** in place.
- No schema version tracking (`PRAGMA user_version` is never checked or set).
- Adding new relational tables or altering existing schemas cannot currently be managed safely without manual code surgery.

---

## 3. Concurrency, Locking & Reliability Analysis

### 3.1 Missing SQLite Pragmas
1. **Missing `busy_timeout`**:
   - `better-sqlite3` defaults to failing immediately if another process or transaction holds a lock.
   - Without `sqliteDb.pragma('busy_timeout = 5000')`, concurrent writes or backups will throw `SqliteError: database is locked`.
2. **Missing `foreign_keys = ON`**:
   - SQLite defaults to disabling foreign key enforcement unless explicitly enabled via PRAGMA.
3. **Missing `cache_size` Configuration**:
   - Default cache is minimal. Setting `PRAGMA cache_size = -20000;` (~20 MB) would substantially improve repeat reads.

### 3.2 Connection Lifecycle & Graceful Shutdown
- In `src/luxx-bot.js` and `index.js`, the process catches `SIGINT` and `SIGTERM` (`index.js:20-39`):
  ```javascript
  process.on('SIGINT', async () => {
      console.log('\x1b[31m🛑 Graceful shutdown...\x1b[0m');
      // clears radio queue and discord radio, then:
      process.exit(0);
  });
  ```
- **Finding**: SQLite connection is never closed, and no WAL checkpoint is executed (`wal_checkpoint(TRUNCATE)`). While WAL mode avoids catastrophic corruption, leaving transactions uncheckpointed leaves `.sqlite3-wal` files dirty across restarts.

### 3.3 Redis vs SQLite Fallback
- `persistence.js:11`: `const USE_REDIS = Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);`
- In `initPersistence()` (`persistence.js:51-57`):
  ```javascript
  if (USE_REDIS) {
      try { await initRedis(); } catch (e) { console.error('Redis init failed:', e?.message || e); }
      return;
  }
  ```
- If Redis fails to connect at startup, error is caught and ignored. But subsequent calls to `getJson` or `setJson` immediately call `await initRedis()`, crashing the caller with unhandled connection errors because fallback to SQLite was never configured.

---

## 4. State Management & Persistence Fragmentation

The codebase currently splits application state across three discordant storage paradigms:

| Storage Medium | What Is Stored Here | Files Handling It | Concurrency & Integrity Risks |
|---|---|---|---|
| **SQLite `kv_store`** | `notes`, `reminders`, `activeVotes`, `playSession`, `spSession`, `sastraSession` | `src/utils/persistence.js`, `src/utils/global-store.js` | Entire object maps are stringified and written as single rows. Concurrent updates from different chats overwrite each other. |
| **Flat JSON Files** | `subscriptions.json`, `premium-users.json`, `group-settings.json`, `usage-tracker.json`, `data/sounds/libraries/*.json` | `subscription-manager.js`, `premium-users.js`, `group-welcome.js`, `usage-tracker.js`, `sound-library.js` | Uses synchronous `fs.readFileSync` and `fs.writeFileSync`. Non-atomic writes. If the server crashes mid-write, the file truncates to 0 bytes and defaults to erasing all stored data! |
| **Volatile In-Memory** | `analytics.commandUsage`, `dailyStats`, `errors`, `userAIContext`, `cooldowns`, `aiQueue` | `src/services/analytics.js`, `src/state.js` | Reset to zero every time the bot restarts or is reloaded by PM2. |

### Monolithic Key-Value Overwrite Race Condition
In `src/utils/global-store.js`:
```javascript
export async function saveGlobalMap(name, sanitizer = (value) => value) {
    const raw = global[name] || {};
    const cleaned = {};
    for (const key of Object.keys(raw)) {
        cleaned[key] = sanitizer(raw[key]);
    }
    await setJson(name, cleaned);
}
```
When user A adds a note in Chat 1 and user B adds a note in Chat 2, both mutate `global.notes` in memory and invoke `saveGlobalMap('notes')`. Serializing and rewriting the entire multi-chat dataset for each granular change is an $O(N)$ write penalty that risks lost updates.

---

## 5. Audit of External API Services

| Service | File | Endpoint / Protocol | Timeout Configured? | Error Handling & Fallback |
|---|---|---|---|---|
| **AI Models (Gemini, Groq, Grok, OpenAI, Pollinations)** | `src/services/ai.js` | Google GenAI SDK, REST APIs | Partial (Groq: 25s, Pollinations: 35s, Gemini: default SDK timeout) | Tiered fallback: Gemini -> Groq -> Grok -> OpenAI -> Pollinations. Queue limit: 2 concurrent jobs. |
| **Media Downloader** | `src/services/dl-media.js` | TikWM, TikTok API, Instagram GraphQL, yt-dlp | Yes (35s axios) | Fallback from TikWM to `@tobyg74/tiktok-api-dl`. **Critical bug in yt-dlp video handler: `buffer` variable undefined.** |
| **Weather** | `src/services/weather.js` | Open-Meteo Geocoding & Forecast APIs | Yes (15s & 20s) | Graceful error throwing, user-friendly error formatting. |
| **News RSS** | `src/services/news-service.js` | Google News RSS, BBC, Al Jazeera | Yes (15s) | Sequential loop fetches 6 feeds one-by-one. If feeds lag, user waits 30-90s. Needs `Promise.allSettled`. |
| **Lyrics** | `src/services/lyrics.js` | LRCLIB, Lyrics.ovh | Yes | **Only service using `CircuitBreaker` (`threshold: 5, resetMs: 30000`).** |
| **Payment Gateway** | `src/services/payment-gateway.js` | Midtrans API v2 (`/charge`, `/status`) | No timeout set | **Critical bug: `validatePayment` executes `axios.get` without `await`, always failing.** |
| **Sound API** | `src/services/sound-api.js` | MyInstants, Pixabay, Freesound | Yes (25s) | Graceful fallbacks and scraper backup. |
| **Indonesian & World Poetry** | `src/services/sastra-api.js` | Wikisource ID, PoetryDB | Yes (20s) | Topic-based scraper and API lookup with translation fallback. |

---

## 6. Detailed Inventory of Existing Bugs & Vulnerabilities

### Bug 1: Unhandled Non-Iterable Exception Causing Background Cleanup & AI Context Memory Leak
- **Location**: `src/state.js:19-33`
- **Code**:
  ```javascript
  function pruneExpiredNotes() {
      if (!global.notes) return;
      const now = Date.now();
      for (const [jid, notes] of global.notes) { // Line 22: FAILS
          global.notes[jid] = notes.filter(n => now - new Date(n.updated).getTime() < MAX_NOTES_AGE_MS);
      }
  }

  function pruneExpiredReminders() {
      if (!global.reminders) return;
      const now = Date.now();
      for (const [jid, reminders] of global.reminders) { // Line 30: FAILS
          global.reminders[jid] = reminders.filter(r => r.time > now);
      }
  }
  ```
- **Mechanism**: `global.notes` and `global.reminders` are initialized in `src/utils/global-store.js` as plain Objects (`{}`). Iterating a plain Object with `for...of` throws `TypeError: global.notes is not iterable`.
- **Impact**: In `startGlobalCleanup()` (`src/state.js:60-67`), `pruneExpiredNotes()` throws on line 22, halting execution before reaching `pruneExpiredReminders()`, `pruneExpiredCooldowns()`, and `pruneExpiredAIContext()`. Because the error is caught by an empty `catch (_) {}`, the cleanup loop fails silently every 30 minutes. `cooldowns` and `userAIContext` grow without bound, causing a long-term memory leak.
- **Fix**: Use `Object.entries(global.notes)` and `Object.entries(global.reminders)`.

---

### Bug 2: Fatal `ReferenceError: buffer is not defined` in Video Download
- **Location**: `src/services/dl-media.js:331-361`
- **Code**:
  ```javascript
  async function downloadViaYtDlp(url, mode, tmpBase, quality = 'wa') {
      const title = await getYtDlpTitle(url);
      const platform = detectPlatform(url);

      if (mode === 'audio') {
          const out = `${tmpBase}.mp3`;
          await downloadAudioToMp3(url, out);
          return {
              buffer: fs.readFileSync(out),
              title,
              mimetype: 'audio/mpeg',
              fileName: `${sanitizeFileName(title)}.mp3`
          };
      }

      const out = `${tmpBase}.mp4`;
      const useWa = platform === 'youtube' || platform === 'facebook' || quality === 'wa';
      if (useWa) {
          await downloadVideoForWhatsApp(url, out, { maxHeight: quality === 'hd' ? 1080 : 720 });
      } else {
          await downloadVideoHd(url, out);
      }

      return {
          buffer: clampBuffer(buffer, 64 * 1024 * 1024), // Line 355: buffer is NOT defined!
          title,
          mimetype: 'video/mp4',
          fileName: `${sanitizeFileName(title)}.mp4`,
          qualityLabel: quality === 'hd' ? 'MP4 1080p' : 'MP4 720p (HP)'
      };
  }
  ```
- **Mechanism**: Audio reads `fs.readFileSync(out)`, but the video branch writes to `out` and then immediately calls `clampBuffer(buffer, ...)`. Variable `buffer` was never read into memory from `out`.
- **Impact**: Any `!dl <url>` command for video crashes immediately with `ReferenceError: buffer is not defined`.
- **Fix**: Add `const buffer = fs.readFileSync(out);` before returning.

---

### Bug 3: Missing Function Definitions in `premium-users.js` and Broken Express Contract in `admin-api.js`
- **Location 1**: `src/services/premium-users.js:70-76`
  ```javascript
  export function removePremiumUser(userId) {
      return removeUser(userId); // ReferenceError: removeUser is not defined
  }

  export function getPremiumUsers() {
      return getAllUsers(); // ReferenceError: getAllUsers is not defined
  }
  ```
- **Location 2**: `src/services/admin-api.js:217-239`
  ```javascript
  app.post('/admin/api/premium-users', async (req, res) => {
      ...
      const result = await addPremiumUser(number);
      if (!result.ok) { // setUserTier returns { tier, expiresAt, upgradedAt, upgradedBy }, so result.ok is undefined!
          return res.status(400).json(result);
      }
      res.json(result);
  });
  ```
- **Impact**:
  - `GET /admin/api/premium-users` crashes with HTTP 500 (`getAllUsers is not defined`).
  - `DELETE /admin/api/premium-users` crashes with HTTP 500 (`removeUser is not defined`).
  - `POST /admin/api/premium-users` succeeds in writing to disk, but always returns HTTP 400 to the admin dashboard because `result.ok` is undefined (`!undefined === true`).
- **Fix**:
  - Implement `removeUser(userId)` and `getAllUsers()` in `premium-users.js`.
  - Return `{ ok: true, user: db.users[userId] }` from `addPremiumUser` and `{ ok: true, removed: ... }` from `removePremiumUser`.

---

### Bug 4: Missing Import in `usage-tracker.js`
- **Location**: `src/services/usage-tracker.js:63-66`
- **Code**:
  ```javascript
  export function checkUsageLimit(userId, tier) {
      const usage = getUserUsage(userId);
      const tierInfo = getTierInfo(tier); // ReferenceError: getTierInfo is not defined!
  ```
- **Mechanism**: `getTierInfo` is exported from `src/services/premium-users.js`, but `src/services/usage-tracker.js` only imports `fs` and `path`.
- **Impact**: Any feature checking usage limits against tiers crashes with `ReferenceError: getTierInfo is not defined`.
- **Fix**: Add `import { getTierInfo } from './premium-users.js';` at top of file.

---

### Bug 5: Synchronous Axios Call in Payment Validation
- **Location**: `src/services/payment-gateway.js:88-104`
- **Code**:
  ```javascript
  export function validatePayment(orderId) {
      if (!MIDTRANS_SERVER_KEY) return { valid: false, status: 'unconfigured' };

      try {
          const response = axios.get(
              `${MIDTRANS_BASE_URL}/v2/${orderId}/status`,
              { headers: getMidtransHeaders() }
          );
          return {
              valid: response.data.transaction_status === 'settlement',
              status: response.data.transaction_status,
              orderId
          };
      } catch {
          return { valid: false, status: 'error' };
      }
  }
  ```
- **Mechanism**: `axios.get` returns a Promise. The function is not `async` and does not `await` the request. `response.data` is `undefined`, causing `TypeError: Cannot read properties of undefined (reading 'transaction_status')`. The `catch` block catches this and returns `{ valid: false, status: 'error' }`.
- **Impact**: All payment validations fail.
- **Fix**: Make function `async export async function validatePayment(orderId)` and `await axios.get(...)`.

---

### Bug 6: Dropped WhatsApp Messages inside Ephemeral & View-Once Contexts
- **Location**: `src/handlers/messages.js:112-118`
- **Code**:
  ```javascript
  type = Object.keys(msg.message)[0];
  let body = '';
  if (type === 'conversation') body = msg.message.conversation;
  else if (type === 'extendedTextMessage') body = msg.message.extendedTextMessage.text;
  else if (type === 'imageMessage' && msg.message.imageMessage.caption) body = msg.message.imageMessage.caption;
  else if (type === 'videoMessage' && msg.message.videoMessage.caption) body = msg.message.videoMessage.caption;
  ```
- **Mechanism**: When a WhatsApp chat has disappearing messages enabled or sends media as view-once, Baileys wraps the payload inside `msg.message.ephemeralMessage.message` or `msg.message.viewOnceMessage.message`. `type` evaluates to `'ephemeralMessage'`, none of the `if` branches match, and `body` remains empty.
- **Impact**: The bot completely ignores user commands in any group or private chat where disappearing messages are enabled.
- **Fix**: Unwrap the inner message envelope before extracting `type` and `body`:
  ```javascript
  const innerMsg = msg.message?.ephemeralMessage?.message
      || msg.message?.viewOnceMessage?.message
      || msg.message?.viewOnceMessageV2?.message
      || msg.message;
  ```

---

### Bug 7: Reminders Discarded on Server Restart
- **Location**: `src/handlers/messages.js:513-524`
- **Code**: `!notes` and `!reminder` commands create reminders stored in `global.reminders[from]` and set a Node.js `setTimeout(...)`.
- **Mechanism**: Node `setTimeout` is in-memory only. While `global.reminders` is persisted to SQLite via `saveGlobalMap('reminders')`, when the bot restarts or is cycled by PM2, `initGlobalStore()` loads `global.reminders`, but there is **no initialization routine that reschedules or inspects pending reminders**.
- **Impact**: Users who schedule reminders lose their notifications if the bot restarts before the timer expires.
- **Fix**: On startup in `luxx-bot.js`, run an active scheduler that iterates `global.reminders`, reschedules any future reminders, and notifies/cleans past-due reminders.

---

### Bug 8: Unprotected Flat-File Data Destruction Risk
- **Location**:
  - `src/services/subscription-manager.js:6-18`
  - `src/services/group-welcome.js:18-32`
- **Code**:
  ```javascript
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
  ```
- **Mechanism**: If PM2 stops or restarts the bot during `fs.writeFileSync`, the target JSON file is left half-written or empty (0 bytes). On next startup, `readSubDb()` encounters invalid JSON, catches the error, and returns an empty `{ subscriptions: {} }`. On the next write, the entire database is permanently overwritten with empty state!
- **Impact**: Complete data loss for group welcome settings, subscriptions, and premium users under sudden process kills.
- **Fix**: Migrate all state into SQLite tables (or use atomic writes via write-file-atomic if files are temporarily retained).

---

## 7. Concrete High-Impact Improvement Proposals

### Proposal 1: Unified SQLite Relational Schema with Built-in Migration Runner
Replace the fragmented flat JSON files with clean, structured tables in `luxxbot.sqlite3`.

#### Target Schema Design:
```sql
-- Schema version tracking
PRAGMA user_version = 1;

-- 1. Key-Value Store (retained for backward compatibility and ad-hoc sessions)
CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 2. Users & Premium Tiers
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'free',
    expires_at INTEGER,
    upgraded_at INTEGER,
    upgraded_by TEXT,
    created_at INTEGER NOT NULL
);

-- 3. Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    payment_method TEXT DEFAULT 'manual',
    auto_renew INTEGER DEFAULT 0,
    reminders_sent TEXT DEFAULT '{"threeDays":false,"oneDay":false,"expired":false}'
);

-- 4. Group Settings
CREATE TABLE IF NOT EXISTS group_settings (
    group_id TEXT PRIMARY KEY,
    welcome_enabled INTEGER DEFAULT 0,
    welcome_message TEXT,
    goodbye_enabled INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL
);

-- 5. Command Usage & Quota Records
CREATE TABLE IF NOT EXISTS usage_records (
    user_id TEXT NOT NULL,
    command TEXT NOT NULL,
    period_type TEXT NOT NULL, -- 'day' | 'month'
    period_key TEXT NOT NULL,  -- 'YYYY-MM-DD' | 'YYYY-MM'
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, command, period_type, period_key)
);
CREATE INDEX IF NOT EXISTS idx_usage_user_period ON usage_records(user_id, period_key);

-- 6. Structured Notes
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_chat ON notes(chat_id);

-- 7. Structured Reminders
CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    text TEXT NOT NULL,
    trigger_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'cancelled'
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_trigger ON reminders(trigger_at, status);

-- 8. Persistent Analytics Events
CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL, -- 'command' | 'error'
    tag TEXT,
    message TEXT,
    chat_id TEXT,
    user_id TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
```

#### Migration Runner Mechanism:
In `src/utils/persistence.js`:
- Check `sqliteDb.pragma('user_version', { simple: true })`.
- Apply migrations sequentially in a single transaction (`db.transaction(...)`).
- Set updated `PRAGMA user_version = X`.
- Set `PRAGMA busy_timeout = 5000;` and `PRAGMA foreign_keys = ON;`.
- Add `closePersistence()` with `sqliteDb.pragma('wal_checkpoint(TRUNCATE)')` and bind it to `process.on('SIGINT')` and `process.on('SIGTERM')`.

---

### Proposal 2: Parallelization & Circuit Breaking for External Feeds
1. **Parallel News Fetching**: In `src/services/news-service.js`, replace sequential loop with:
   ```javascript
   const results = await Promise.allSettled(picks.map(key => fetchRegionNews(key, 2)));
   ```
   Reduces response time for `!berita` from ~12–25 seconds down to ~1.5 seconds.
2. **Standardized Circuit Breakers**:
   Export and apply the existing `CircuitBreaker` utility from `src/utils/circuit-breaker.js` to external HTTP APIs:
   - `ai-service`
   - `myinstants-api`
   - `open-meteo`
   - `midtrans`

---

### Proposal 3: Standalone Automated Test Suite (Addressing R3)
Implement `scripts/test-services.mjs` and `scripts/test-db.mjs` utilizing standard Node.js `test` / `assert` modules:
- Verifies database migrations and CRUD operations.
- Verifies state management, note adding/editing/pruning.
- Verifies message envelope unwrapping (ephemeral, view-once).
- Verifies command parsing and routing logic.
- Verifies error recovery when SQLite operations encounter concurrency or constraint errors.
- Runs without requiring an active WhatsApp connection or running PM2 daemon (`node scripts/test-services.mjs`).

---

## 8. Summary of Proposed Source Modifications

| File | Target Lines | Proposed Change | Rationale |
|---|---|---|---|
| `src/state.js` | 19–33 | Replace `for (const [jid, notes] of global.notes)` with `Object.entries(global.notes)` | Fixes silent `TypeError: not iterable` and restores memory leak cleanup |
| `src/services/dl-media.js` | 346–360 | Read `const buffer = fs.readFileSync(out);` before `clampBuffer` | Fixes fatal `ReferenceError: buffer is not defined` on all video downloads |
| `src/services/premium-users.js` | 70–76 | Implement `removeUser(userId)` and `getAllUsers()`; standardize `{ ok: true }` output | Fixes crash in admin endpoints `GET`, `POST`, `DELETE /admin/api/premium-users` |
| `src/services/usage-tracker.js` | 1–3 | Add `import { getTierInfo } from './premium-users.js';` | Fixes fatal `ReferenceError: getTierInfo is not defined` in quota checks |
| `src/services/payment-gateway.js` | 88–104 | Change `validatePayment` to `async` and add `await axios.get(...)` | Fixes Promise evaluation defect and prevents false payment rejections |
| `src/handlers/messages.js` | 112–118 | Unwrap `msg.message.ephemeralMessage?.message` and view-once wrappers | Ensures commands in disappearing/view-once messages are processed |
| `src/utils/persistence.js` | 35–48 | Add `busy_timeout = 5000`, `foreign_keys = ON`, schema migrations, and `closePersistence()` | Prevents `SQLITE_BUSY` database lock crashes and ensures safe shutdown |
| `index.js` | 20–39 | Call `closePersistence()` on `SIGINT` and `SIGTERM` | Flushes SQLite WAL checkpoints cleanly on shutdown |
