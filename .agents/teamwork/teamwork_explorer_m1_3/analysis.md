# Detailed Fix Specification & Strategy: Core Services & Message Handling

**Document Version**: 1.0.0  
**Author**: Explorer M1-3 (`teamwork_explorer`)  
**Workspace**: `C:\Users\DoxxBorx\Project Bot Wa`  
**Target Milestone**: Milestone 1 (M1) Core System & Service Bug Fixes  
**Related Requirements**: R1, R2, R3, PROJECT.md Features 7, 8, 9  

---

## 1. Executive Summary

This specification formulates exact, verified, and testable fix implementations for three critical areas of the Luxx WhatsApp bot codebase:

1. **`src/services/wa-qr.js` (Feature 7)**:
   - **Issue**: Endpoint `POST /pair/reset` (line 242) is completely unauthenticated and accessible to any external caller over the public HTTP port or Cloudflare tunnel, allowing unauthorized parties to delete the bot's credentials and drop WhatsApp connectivity.
   - **Fix Strategy**: Implement token verification helper `verifyAdminToken(req)` checking `ADMIN_API_TOKEN` across `Authorization` headers (`Bearer <token>`), custom header `x-admin-token`, request query parameter `?token=`, and body `{ token }`. Reject unauthorized calls with `401 Unauthorized` (missing token) or `403 Forbidden` (invalid token / token unconfigured). Update the `/pair` waiting web page to prompt the administrator for their `ADMIN_API_TOKEN` before issuing the reset.

2. **`src/utils/persistence.js` (Feature 8)**:
   - **Issue**: SQLite initialization sets WAL mode and normal synchronous writing, but omits `db.pragma('busy_timeout = 5000');`, causing concurrent access or backup operations to immediately throw `SqliteError: database is locked`. Furthermore, when the process receives termination signals (`SIGINT`, `SIGTERM`), the database connection is never closed and the WAL journal is never truncated, risking fragmented WAL journals.
   - **Fix Strategy**: Add `sqliteDb.pragma('busy_timeout = 5000');` during database creation. Implement `closeSqlite()` to execute `sqliteDb.pragma('wal_checkpoint(TRUNCATE)'); sqliteDb.close();`. Register process signal listeners on `SIGINT` and `SIGTERM` with idempotent guard flags, and export `closeSqlite` for automated testing and graceful shutdown hooks.

3. **`src/handlers/messages.js` (Feature 9)**:
   - **Issue**: Message type extraction at line 112 naively inspects `Object.keys(msg.message)[0]`. In WhatsApp chats with disappearing messages enabled (`ephemeralMessage`), or when media is sent as view-once (`viewOnceMessage`, `viewOnceMessageV2`), Baileys wraps the true message payload in wrapper envelopes. `type` resolves to `'ephemeralMessage'` or `'viewOnceMessage'`, which fails all subsequent type checks, leaving `body = ''` and silently dropping the command.
   - **Fix Strategy**: Implement robust unwrapping (`unwrapMessage`) supporting up to 5 layers of recursion for `ephemeralMessage`, `viewOnceMessage`, `viewOnceMessageV2`, `viewOnceMessageV2Extension`, and `documentWithCaptionMessage`. Preserve raw message references by saving `msg.raw` and `msg.rawMessage` before reassigning `msg.message = unwrappedContent;`. Also recursively unwrap `contextInfo.quotedMessage` while preserving `contextInfo.rawQuotedMessage`, ensuring commands like `!sticker`, `!ocr`, `!lihat`, and M2's `!toimg` work seamlessly with quoted view-once media.

---

## 2. Specification: `src/services/wa-qr.js` (Feature 7)

### 2.1 Problem Analysis
In `src/services/wa-qr.js`:
- Lines 242–251 define:
  ```javascript
  app.post('/pair/reset', async (_req, res) => {
      clearWaSession({ includeBackup: true });
      try {
          const { startLuxxBot } = await import('../luxx-bot.js');
          startLuxxBot().catch((e) => console.error('❌ pair/reset:', e?.message || e));
      } catch (e) {
          console.error('❌ pair/reset import:', e?.message || e);
      }
      res.json({ ok: true, message: 'Session dihapus — tunggu QR di /pair' });
  });
  ```
- Any unauthenticated HTTP client can issue `curl -X POST http://<host>:3920/pair/reset`.
- `clearWaSession({ includeBackup: true })` permanently removes credentials from `./session/creds.json` and the backup directory, destroying active WhatsApp credentials and forcing a full QR re-scan.

### 2.2 Existing Authentication Pattern
In `src/services/admin-api.js` (lines 47–95):
- The admin dashboard uses `process.env.ADMIN_API_TOKEN` configured in `.env`.
- It expects an `Authorization: Bearer <ADMIN_API_TOKEN>` header.
- If unset or mismatched, requests are rejected.

### 2.3 Proposed Implementation

#### A. Token Verification Helper `verifyAdminToken(req)`
To ensure flexibility across REST clients, admin curl requests, and browser interactions, `verifyAdminToken(req)` inspects:
1. `req.headers.authorization` (`Bearer <token>` or direct token string)
2. `req.headers['x-admin-token']`
3. `req.query.token` (URL query parameter)
4. `req.body?.token` (JSON body property)

```javascript
/**
 * Verifikasi token admin untuk endpoint sensitif
 * @param {import('express').Request} req
 * @returns {{ ok: boolean, status?: number, error?: string }}
 */
export function verifyAdminToken(req) {
    const adminToken = process.env.ADMIN_API_TOKEN?.trim();
    if (!adminToken) {
        return {
            ok: false,
            status: 403,
            error: 'Admin authentication is disabled — set ADMIN_API_TOKEN in .env'
        };
    }

    let providedToken = '';
    const authHeader = (req.headers?.authorization || '').trim();
    if (authHeader.startsWith('Bearer ')) {
        providedToken = authHeader.slice(7).trim();
    } else if (authHeader) {
        providedToken = authHeader;
    }

    if (!providedToken && req.headers?.['x-admin-token']) {
        providedToken = String(req.headers['x-admin-token']).trim();
    }
    if (!providedToken && req.query?.token) {
        providedToken = String(req.query.token).trim();
    }
    if (!providedToken && req.body?.token) {
        providedToken = String(req.body.token).trim();
    }

    if (!providedToken) {
        return {
            ok: false,
            status: 401,
            error: 'Unauthorized — Admin token required via Authorization header, x-admin-token, query ?token=, or body.token'
        };
    }

    if (providedToken !== adminToken) {
        return {
            ok: false,
            status: 403,
            error: 'Forbidden — Invalid admin token'
        };
    }

    return { ok: true };
}
```

#### B. Secured Endpoint in `registerWaQrRoutes(app)`
Replace lines 242–251 with:
```javascript
    app.post('/pair/reset', async (req, res) => {
        const auth = verifyAdminToken(req);
        if (!auth.ok) {
            return res.status(auth.status).json({ ok: false, error: auth.error });
        }

        clearWaSession({ includeBackup: true });
        try {
            const { startLuxxBot } = await import('../luxx-bot.js');
            startLuxxBot().catch((e) => console.error('❌ pair/reset:', e?.message || e));
        } catch (e) {
            console.error('❌ pair/reset import:', e?.message || e);
        }
        res.json({ ok: true, message: 'Session dihapus — tunggu QR di /pair' });
    });
```

#### C. Web UI Integration (`pairHtmlWaiting`)
In lines 156–159, update the client-side JavaScript of the waiting page so authorized administrators can trigger reset from the browser:
```javascript
document.getElementById('resetBtn')?.addEventListener('click', async () => {
  const token = prompt('Masukkan ADMIN_API_TOKEN untuk reset session WhatsApp:');
  if (!token) return;
  el.textContent = 'Memverifikasi token & mereset...';
  try {
    const res = await fetch('/pair/reset', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token.trim(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: token.trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Gagal reset: Token tidak valid.');
      el.textContent = 'Gagal reset: ' + (data.error || 'Unauthorized');
      return;
    }
    el.textContent = 'Session dihapus — memuat QR baru...';
    setTimeout(() => location.reload(), 2000);
  } catch (err) {
    el.textContent = 'Gagal reset — periksa koneksi atau restart PM2';
  }
});
```

---

## 3. Specification: `src/utils/persistence.js` (Feature 8)

### 3.1 Problem Analysis
In `src/utils/persistence.js`:
- Lines 39–44:
  ```javascript
  sqliteDb = new Database(SQLITE_PATH, { fileMustExist: false });
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('synchronous = NORMAL');
  sqliteDb.prepare(
      'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  ).run();
  ```
- **Concurrency & Busy Locking**: By default in `better-sqlite3`, `busy_timeout` is 0 ms. If a background process, backup script, or concurrent connection accesses the database, any write immediately throws `SqliteError: database is locked`.
- **Shutdown Resilience**: In WAL mode, changes are written to `luxxbot.sqlite3-wal`. Unless a checkpoint is performed before shutdown, uncommitted/unmerged frames accumulate.
- **Process Signals**: When PM2 executes `pm2 stop` or container runtimes terminate, `SIGINT` or `SIGTERM` signals are sent. Without explicit handlers closing SQLite, the database handle is killed abruptly.

### 3.2 Proposed Implementation

#### A. PRAGMA Configuration
In `initSqlite()`, immediately after initializing `sqliteDb`:
```javascript
sqliteDb = new Database(SQLITE_PATH, { fileMustExist: false });
sqliteDb.pragma('journal_mode = WAL');
sqliteDb.pragma('synchronous = NORMAL');
sqliteDb.pragma('busy_timeout = 5000');
```

#### B. Graceful Shutdown Helper `closeSqlite()`
```javascript
/**
 * Checkpoint WAL and close SQLite database cleanly
 * @returns {boolean}
 */
export function closeSqlite() {
    if (sqliteDb && sqliteDb.open) {
        try {
            sqliteDb.pragma('wal_checkpoint(TRUNCATE)');
            sqliteDb.close();
            sqliteDb = null;
            sqliteInitDone = false;
            sqliteInitPromise = null;
            console.log('✅ SQLite WAL checkpointed and closed cleanly.');
            return true;
        } catch (err) {
            console.error('❌ Error during SQLite shutdown:', err?.message || err);
            return false;
        }
    }
    return false;
}
```

#### C. Signal Listener Registration
Register listeners within `persistence.js` guarded by an initialization flag:
```javascript
let shutdownListenersRegistered = false;

function registerSqliteShutdownHooks() {
    if (shutdownListenersRegistered) return;
    shutdownListenersRegistered = true;

    const onProcessSignal = () => {
        closeSqlite();
    };

    process.on('SIGINT', onProcessSignal);
    process.on('SIGTERM', onProcessSignal);
}
```
Invoke `registerSqliteShutdownHooks();` inside `initSqlite()` right after the PRAGMAs are set.

#### D. Full Updated `initSqlite` Function
```javascript
async function initSqlite() {
    if (sqliteDb && sqliteDb.open) return sqliteDb;
    if (sqliteInitPromise) return sqliteInitPromise;
    sqliteInitPromise = (async () => {
        fs.mkdirSync(SQLITE_DIR, { recursive: true });
        const sqliteModule = await import('better-sqlite3');
        const Database = sqliteModule.default || sqliteModule;
        sqliteDb = new Database(SQLITE_PATH, { fileMustExist: false });
        sqliteDb.pragma('journal_mode = WAL');
        sqliteDb.pragma('synchronous = NORMAL');
        sqliteDb.pragma('busy_timeout = 5000');
        sqliteDb.prepare(
            'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
        ).run();
        registerSqliteShutdownHooks();
        sqliteInitDone = true;
        return sqliteDb;
    })();
    return sqliteInitPromise;
}
```

And update the default export to include `closeSqlite`:
```javascript
export default {
    initPersistence,
    getJson,
    setJson,
    deleteKey,
    closeSqlite
};
```

---

## 4. Specification: `src/handlers/messages.js` (Feature 9)

### 4.1 Problem Analysis
In `src/handlers/messages.js`:
- Lines 111–118:
  ```javascript
  // --- Parse message body ---
  type = Object.keys(msg.message)[0];
  let body = '';
  if (type === 'conversation') body = msg.message.conversation;
  else if (type === 'extendedTextMessage') body = msg.message.extendedTextMessage.text;
  else if (type === 'imageMessage' && msg.message.imageMessage.caption) body = msg.message.imageMessage.caption;
  else if (type === 'videoMessage' && msg.message.videoMessage.caption) body = msg.message.videoMessage.caption;
  ```
- WhatsApp/Baileys wraps messages inside:
  - `msg.message.ephemeralMessage.message` (disappearing chats)
  - `msg.message.viewOnceMessage.message` (view once v1)
  - `msg.message.viewOnceMessageV2.message` (view once v2)
  - `msg.message.viewOnceMessageV2Extension.message`
  - `msg.message.documentWithCaptionMessage.message`
  - Nested combinations: e.g. `ephemeralMessage.message.viewOnceMessage.message`
- When wrapped, `type` is evaluated as `'ephemeralMessage'` or `'viewOnceMessage'`.
- All `if` conditions evaluate to `false`, `body` is empty, `text` is empty, and the bot completely ignores user commands in any group or DM with disappearing messages or view-once media.

### 4.2 Preservation of Raw References
- **Requirement**: Unwrapping must yield the true underlying message content **without breaking raw references**.
- **Rationale**: 
  - Other modules, plugins (`dispatchHook('message')`), or diagnostic loggers may need the original untampered protobuf envelope (e.g. to determine if a message was ephemeral, or inspect envelope timestamps).
  - Quoting a message via `sock.sendMessage(from, { text: ... }, { quoted: msg })` calls `generateWAMessage` internally, which expects `msg.key` and `msg.message`.
  - Commands across `src/commands/*.js` (such as `sticker.js`, `join.js`, and inline `lihat`, `ocr`) look directly into `msg.message.imageMessage` or `msg.message.extendedTextMessage`.
- **Solution**:
  1. Store the untouched protobuf object on `msg.raw` and `msg.rawMessage` before any transformation.
  2. Normalize `msg.message` to the innermost message object.
  3. Recursively unwrap `contextInfo.quotedMessage` while storing `contextInfo.rawQuotedMessage`.

### 4.3 Proposed Implementation

#### A. Unwrapping Utility Function
Add at file level in `src/handlers/messages.js` (or import from a helper):
```javascript
/**
 * Recursively unwraps ephemeral, viewOnce, and document envelopes to access true inner message
 * @param {import('@whiskeysockets/baileys').proto.IMessage|null|undefined} msgContent
 * @returns {import('@whiskeysockets/baileys').proto.IMessage|null|undefined}
 */
export function unwrapMessage(msgContent) {
    if (!msgContent || typeof msgContent !== 'object') return msgContent;
    let content = msgContent;
    for (let i = 0; i < 5; i++) {
        if (!content || typeof content !== 'object') break;
        const inner =
            content.ephemeralMessage?.message ||
            content.viewOnceMessage?.message ||
            content.viewOnceMessageV2?.message ||
            content.viewOnceMessageV2Extension?.message ||
            content.documentWithCaptionMessage?.message ||
            content.editedMessage?.message?.protocolMessage?.editedMessage ||
            content.editedMessage?.message;
        if (!inner) break;
        content = inner;
    }
    return content;
}
```

#### B. Parsing Section Update (lines 111–118)
Replace lines 111–118 with:
```javascript
            // --- Parse message body & unwrap envelopes (ephemeral / viewOnce) ---
            // Preserve raw references before unwrapping
            msg.raw = msg.raw || msg.message;
            msg.rawMessage = msg.rawMessage || msg.message;

            const normalizedContent = unwrapMessage(msg.message) || {};
            msg.message = normalizedContent;

            // Also unwrap quotedMessage if present, while preserving rawQuotedMessage
            const contextInfo = normalizedContent.extendedTextMessage?.contextInfo
                || normalizedContent.imageMessage?.contextInfo
                || normalizedContent.videoMessage?.contextInfo;
            if (contextInfo?.quotedMessage) {
                contextInfo.rawQuotedMessage = contextInfo.rawQuotedMessage || contextInfo.quotedMessage;
                contextInfo.quotedMessage = unwrapMessage(contextInfo.quotedMessage);
            }

            type = Object.keys(normalizedContent)[0] || null;
            let body = '';
            if (type === 'conversation') body = normalizedContent.conversation || '';
            else if (type === 'extendedTextMessage') body = normalizedContent.extendedTextMessage?.text || '';
            else if (type === 'imageMessage' && normalizedContent.imageMessage?.caption) body = normalizedContent.imageMessage.caption;
            else if (type === 'videoMessage' && normalizedContent.videoMessage?.caption) body = normalizedContent.videoMessage.caption;
```

### 4.4 Comprehensive Impact Analysis
| Message Type | Before Fix | After Fix |
|---|---|---|
| Plain `!ping` in standard chat | Handled | Handled (`msg.raw` matches `msg.message`) |
| `!ping` in 24h Disappearing Chat | Ignored (`type: 'ephemeralMessage'`) | Handled (`type: 'conversation'`, `msg.raw` holds `ephemeralMessage`) |
| ViewOnce Photo with caption `!sticker` | Ignored (`type: 'viewOnceMessage'`) | Handled (`type: 'imageMessage'`, `msg.message.imageMessage` accessible) |
| Reply with `!toimg` to ViewOnce sticker | Quoted media undefined | Handled (`quotedMessage` unwrapped to target sticker/image) |
| Replying with `{ quoted: msg }` | Handled | Handled (compatible with Baileys `generateWAMessage`) |

---

## 5. Unified Patch Specifications

### 5.1 Patch for `src/services/wa-qr.js`
```diff
--- a/src/services/wa-qr.js
+++ b/src/services/wa-qr.js
@@ -156,8 +156,23 @@ function pairHtmlWaiting({ staleSession = false } = {}) {
 let s=0;
 const el=document.getElementById('waitSec');
 setInterval(()=>{s++;el.textContent='Menunggu '+s+' detik...';},1000);
-document.getElementById('resetBtn')?.addEventListener('click',()=>{
-  el.textContent='Reset session...';
-  fetch('/pair/reset',{method:'POST'}).then(()=>setTimeout(()=>location.reload(),2000)).catch(()=>{el.textContent='Gagal reset — restart PM2';});
+document.getElementById('resetBtn')?.addEventListener('click', async () => {
+  const token = prompt('Masukkan ADMIN_API_TOKEN untuk reset session:');
+  if (!token) return;
+  el.textContent = 'Memverifikasi token & reset...';
+  try {
+    const res = await fetch('/pair/reset', {
+      method: 'POST',
+      headers: { 'Authorization': 'Bearer ' + token.trim(), 'Content-Type': 'application/json' },
+      body: JSON.stringify({ token: token.trim() })
+    });
+    const data = await res.json().catch(() => ({}));
+    if (!res.ok) {
+      alert(data.error || 'Gagal reset: Unauthorized');
+      el.textContent = 'Gagal reset (unauthorized)';
+      return;
+    }
+    setTimeout(() => location.reload(), 2000);
+  } catch (err) {
+    el.textContent = 'Gagal reset — periksa koneksi';
+  }
 });
@@ -210,6 +225,39 @@ export async function publishWaQr(qrString) {
     }
 }
 
+export function verifyAdminToken(req) {
+    const adminToken = process.env.ADMIN_API_TOKEN?.trim();
+    if (!adminToken) {
+        return { ok: false, status: 403, error: 'Admin API disabled — set ADMIN_API_TOKEN di .env' };
+    }
+    let token = '';
+    const authHeader = (req.headers?.authorization || '').trim();
+    if (authHeader.startsWith('Bearer ')) {
+        token = authHeader.slice(7).trim();
+    } else if (authHeader) {
+        token = authHeader;
+    }
+    if (!token && req.headers?.['x-admin-token']) {
+        token = String(req.headers['x-admin-token']).trim();
+    }
+    if (!token && req.query?.token) {
+        token = String(req.query.token).trim();
+    }
+    if (!token && req.body?.token) {
+        token = String(req.body.token).trim();
+    }
+    if (!token) {
+        return { ok: false, status: 401, error: 'Unauthorized — token admin diperlukan' };
+    }
+    if (token !== adminToken) {
+        return { ok: false, status: 403, error: 'Forbidden — token tidak cocok dengan ADMIN_API_TOKEN' };
+    }
+    return { ok: true };
+}
+
 export function registerWaQrRoutes(app) {
@@ -241,7 +289,11 @@ export function registerWaQrRoutes(app) {
     });
 
-    app.post('/pair/reset', async (_req, res) => {
+    app.post('/pair/reset', async (req, res) => {
+        const auth = verifyAdminToken(req);
+        if (!auth.ok) {
+            return res.status(auth.status).json({ ok: false, error: auth.error });
+        }
         clearWaSession({ includeBackup: true });
```

### 5.2 Patch for `src/utils/persistence.js`
```diff
--- a/src/utils/persistence.js
+++ b/src/utils/persistence.js
@@ -31,6 +31,31 @@ let sqliteInitPromise = null;
+let shutdownListenersRegistered = false;
+
+export function closeSqlite() {
+    if (sqliteDb && sqliteDb.open) {
+        try {
+            sqliteDb.pragma('wal_checkpoint(TRUNCATE)');
+            sqliteDb.close();
+            sqliteDb = null;
+            sqliteInitDone = false;
+            sqliteInitPromise = null;
+            console.log('✅ SQLite WAL checkpointed and closed cleanly.');
+            return true;
+        } catch (err) {
+            console.error('❌ Error during SQLite shutdown:', err?.message || err);
+            return false;
+        }
+    }
+    return false;
+}
+
+function registerSqliteShutdownHooks() {
+    if (shutdownListenersRegistered) return;
+    shutdownListenersRegistered = true;
+    const handleShutdown = () => closeSqlite();
+    process.on('SIGINT', handleShutdown);
+    process.on('SIGTERM', handleShutdown);
+}
+
 async function initSqlite() {
-    if (sqliteDb) return sqliteDb;
+    if (sqliteDb && sqliteDb.open) return sqliteDb;
     if (sqliteInitPromise) return sqliteInitPromise;
     sqliteInitPromise = (async () => {
         fs.mkdirSync(SQLITE_DIR, { recursive: true });
         const sqliteModule = await import('better-sqlite3');
         const Database = sqliteModule.default || sqliteModule;
         sqliteDb = new Database(SQLITE_PATH, { fileMustExist: false });
         sqliteDb.pragma('journal_mode = WAL');
         sqliteDb.pragma('synchronous = NORMAL');
+        sqliteDb.pragma('busy_timeout = 5000');
         sqliteDb.prepare(
             'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
         ).run();
+        registerSqliteShutdownHooks();
         sqliteInitDone = true;
         return sqliteDb;
     })();
@@ -101,6 +126,7 @@ export async function deleteKey(key) {
 export default {
     initPersistence,
     getJson,
     setJson,
-    deleteKey
+    deleteKey,
+    closeSqlite
 };
```

### 5.3 Patch for `src/handlers/messages.js`
```diff
--- a/src/handlers/messages.js
+++ b/src/handlers/messages.js
@@ -24,6 +24,23 @@ import { trackCommand, trackError } from '../services/analytics.js';
+export function unwrapMessage(msgContent) {
+    if (!msgContent || typeof msgContent !== 'object') return msgContent;
+    let content = msgContent;
+    for (let i = 0; i < 5; i++) {
+        if (!content || typeof content !== 'object') break;
+        const inner =
+            content.ephemeralMessage?.message ||
+            content.viewOnceMessage?.message ||
+            content.viewOnceMessageV2?.message ||
+            content.viewOnceMessageV2Extension?.message ||
+            content.documentWithCaptionMessage?.message ||
+            content.editedMessage?.message?.protocolMessage?.editedMessage ||
+            content.editedMessage?.message;
+        if (!inner) break;
+        content = inner;
+    }
+    return content;
+}
+
 // --- Command Handlers ---
@@ -111,8 +128,21 @@
-            // --- Parse message body ---
-            type = Object.keys(msg.message)[0];
-            let body = '';
-            if (type === 'conversation') body = msg.message.conversation;
-            else if (type === 'extendedTextMessage') body = msg.message.extendedTextMessage.text;
-            else if (type === 'imageMessage' && msg.message.imageMessage.caption) body = msg.message.imageMessage.caption;
-            else if (type === 'videoMessage' && msg.message.videoMessage.caption) body = msg.message.videoMessage.caption;
+            // --- Parse message body & unwrap envelopes (ephemeral / viewOnce) ---
+            msg.raw = msg.raw || msg.message;
+            msg.rawMessage = msg.rawMessage || msg.message;
+
+            const normalizedContent = unwrapMessage(msg.message) || {};
+            msg.message = normalizedContent;
+
+            const contextInfo = normalizedContent.extendedTextMessage?.contextInfo
+                || normalizedContent.imageMessage?.contextInfo
+                || normalizedContent.videoMessage?.contextInfo;
+            if (contextInfo?.quotedMessage) {
+                contextInfo.rawQuotedMessage = contextInfo.rawQuotedMessage || contextInfo.quotedMessage;
+                contextInfo.quotedMessage = unwrapMessage(contextInfo.quotedMessage);
+            }
+
+            type = Object.keys(normalizedContent)[0] || null;
+            let body = '';
+            if (type === 'conversation') body = normalizedContent.conversation || '';
+            else if (type === 'extendedTextMessage') body = normalizedContent.extendedTextMessage?.text || '';
+            else if (type === 'imageMessage' && normalizedContent.imageMessage?.caption) body = normalizedContent.imageMessage.caption;
+            else if (type === 'videoMessage' && normalizedContent.videoMessage?.caption) body = normalizedContent.videoMessage.caption;
```

---

## 6. Verification and Acceptance Matrix

| Item | Test Target | Test Command / Script | Expected Outcome |
|---|---|---|---|
| **1. wa-qr.js Auth** | Unauthorized `POST /pair/reset` | `curl -i -X POST http://localhost:3920/pair/reset` | Returns HTTP 401 Unauthorized |
| **1. wa-qr.js Auth** | Invalid token `POST /pair/reset` | `curl -i -X POST http://localhost:3920/pair/reset -H "Authorization: Bearer bad"` | Returns HTTP 403 Forbidden |
| **1. wa-qr.js Auth** | Valid token `POST /pair/reset` | `curl -i -X POST http://localhost:3920/pair/reset -H "Authorization: Bearer $ADMIN_API_TOKEN"` | Returns HTTP 200 `{ ok: true, message: ... }` |
| **2. persistence.js** | Busy timeout check | Inspect `db.pragma('busy_timeout', { simple: true })` | Returns `5000` |
| **2. persistence.js** | WAL Checkpoint & Close | Invoke `closeSqlite()` or trigger `SIGINT` | Executes `wal_checkpoint(TRUNCATE)` without errors, sets `db.open === false` |
| **3. messages.js** | Ephemeral `!ping` parsing | Pass `{ ephemeralMessage: { message: { conversation: '!ping' } } }` | `command === 'ping'`, `msg.raw` preserved, `msg.message.conversation === '!ping'` |
| **3. messages.js** | View-Once `!sticker` parsing | Pass `{ viewOnceMessageV2: { message: { imageMessage: { caption: '!sticker' } } } }` | `command === 'sticker'`, `type === 'imageMessage'`, `msg.raw` preserved |
| **3. messages.js** | Quoted View-Once Media | Pass `{ extendedTextMessage: { contextInfo: { quotedMessage: { viewOnceMessage: { message: { imageMessage: {} } } } } } }` | `ctx.quotedMessage.imageMessage` defined, `ctx.rawQuotedMessage` preserved |
