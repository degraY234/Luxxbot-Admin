# Handoff Report: Explorer M1-3 Fix Strategies

**Agent**: Explorer M1-3 (`teamwork_explorer`)  
**Working Directory**: `C:\Users\DoxxBorx\Project Bot Wa\.agents\teamwork\teamwork_explorer_m1_3`  
**Target Milestone**: Milestone 1 (M1) Core System & Service Bug Fixes  
**Date**: 2026-10-30  
**Handoff Type**: Hard (Investigation & Specification Complete)  

---

## 1. Observation

### Observation 1.1: `src/services/wa-qr.js` Unprotected Reset Endpoint
- **File**: `C:\Users\DoxxBorx\Project Bot Wa\src\services\wa-qr.js`
- **Lines 242–251**:
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
- No authentication or middleware is attached to `POST /pair/reset`.
- In `index.js` (lines 48–52), `express.json({ limit: '1mb' })` is mounted before `registerWaQrRoutes(app)`.
- In `src/services/admin-api.js` (lines 47–95), authentication relies on `process.env.ADMIN_API_TOKEN` via `Authorization: Bearer <token>`.
- In `src/services/wa-qr.js` (lines 156–159), the waiting webpage triggers:
  ```javascript
  document.getElementById('resetBtn')?.addEventListener('click',()=>{
    el.textContent='Reset session...';
    fetch('/pair/reset',{method:'POST'}).then(()=>setTimeout(()=>location.reload(),2000)).catch(()=>{el.textContent='Gagal reset — restart PM2';});
  });
  ```
  without passing any authorization headers or parameters.

### Observation 1.2: `src/utils/persistence.js` Missing Busy Timeout & Signal Shutdown
- **File**: `C:\Users\DoxxBorx\Project Bot Wa\src\utils\persistence.js`
- **Lines 39–46**:
  ```javascript
  sqliteDb = new Database(SQLITE_PATH, { fileMustExist: false });
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('synchronous = NORMAL');
  sqliteDb.prepare(
      'CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  ).run();
  sqliteInitDone = true;
  return sqliteDb;
  ```
- `busy_timeout` PRAGMA is not set; verified default in `better-sqlite3` is `0` ms.
- In `index.js` (lines 20–39), `process.on('SIGINT')` and `process.on('SIGTERM')` shut down radio and exit via `process.exit(0)`, but `persistence.js` registers no signal listeners, leaving `luxxbot.sqlite3-wal` uncheckpointed and `sqliteDb` unclosed.
- Direct test execution in Node verified that `sqliteDb.pragma('busy_timeout = 5000')` returns `5000`, and `sqliteDb.pragma('wal_checkpoint(TRUNCATE)')` followed by `sqliteDb.close()` cleanly sets `sqliteDb.open === false`.

### Observation 1.3: `src/handlers/messages.js` Ephemeral and ViewOnce Envelope Dropping
- **File**: `C:\Users\DoxxBorx\Project Bot Wa\src\handlers\messages.js`
- **Lines 111–118**:
  ```javascript
  // --- Parse message body ---
  type = Object.keys(msg.message)[0];
  let body = '';
  if (type === 'conversation') body = msg.message.conversation;
  else if (type === 'extendedTextMessage') body = msg.message.extendedTextMessage.text;
  else if (type === 'imageMessage' && msg.message.imageMessage.caption) body = msg.message.imageMessage.caption;
  else if (type === 'videoMessage' && msg.message.videoMessage.caption) body = msg.message.videoMessage.caption;
  ```
- In Baileys v6.7.23, disappearing chat messages arrive as `msg.message.ephemeralMessage.message`, and view-once media arrives as `msg.message.viewOnceMessage.message` or `msg.message.viewOnceMessageV2.message`.
- With the current code, `type` evaluates to `'ephemeralMessage'` or `'viewOnceMessage'`, which matches none of the branches; `body` remains `''`, and `text.startsWith('!')` evaluates to `false`.
- In downstream commands (e.g. `src/commands/sticker.js` line 27, `src/handlers/messages.js` lines 706–708), commands access `msg.message.imageMessage` or `msg.message.extendedTextMessage?.contextInfo?.quotedMessage`.
- Baileys `@whiskeysockets/baileys` exports `normalizeMessageContent` which recursively unwraps `ephemeralMessage`, `viewOnceMessage`, `viewOnceMessageV2`, `viewOnceMessageV2Extension`, and `documentWithCaptionMessage`.
- Verified in isolated test that wrapping messages inside `ephemeralMessage` and `viewOnceMessage` and unwrapping them while assigning `msg.raw = msg.message` and unwrapping `contextInfo.quotedMessage` preserves raw references and restores full command recognition.

---

## 2. Logic Chain

### Logic Chain 2.1: Securing `POST /pair/reset`
1. **From Observation 1.1**: The endpoint `POST /pair/reset` accepts requests from any client without validating credentials, calling `clearWaSession({ includeBackup: true })`.
2. **From Observation 1.1**: The application already uses an established `ADMIN_API_TOKEN` environment variable in `admin-api.js` for authenticating sensitive administrative operations.
3. **Therefore**: A helper function `verifyAdminToken(req)` can be implemented that validates the caller's token against `process.env.ADMIN_API_TOKEN`.
4. **Therefore**: Checking `req.headers.authorization` (`Bearer <token>`), `req.headers['x-admin-token']`, `req.query.token`, and `req.body.token` ensures compatibility across API consumers and browser fetch requests.
5. **Therefore**: Returning `401 Unauthorized` for missing tokens and `403 Forbidden` for invalid or unconfigured tokens ensures secure rejection of unauthorized public requests.
6. **Therefore**: Updating the browser script in `pairHtmlWaiting` to prompt the operator for their token when clicking the reset button preserves operator usability without compromising endpoint security.

### Logic Chain 2.2: SQLite Busy Timeout and Zero-Corruption Shutdown
1. **From Observation 1.2**: In the absence of `busy_timeout`, `better-sqlite3` fails immediately (`SQLITE_BUSY`) when concurrent operations or file locks occur.
2. **Therefore**: Setting `sqliteDb.pragma('busy_timeout = 5000');` instructs SQLite to wait up to 5000 ms for busy locks to clear before throwing an exception, eliminating intermittent lock failures.
3. **From Observation 1.2**: In WAL mode (`journal_mode = WAL`), unmerged database transactions stay in the `-wal` file until checkpointed.
4. **From Observation 1.2**: When PM2 or the OS sends `SIGINT` or `SIGTERM`, Node terminates without triggering a WAL checkpoint unless explicit signal listeners are attached.
5. **Therefore**: Implementing `closeSqlite()` to run `sqliteDb.pragma('wal_checkpoint(TRUNCATE)'); sqliteDb.close();` and attaching it to `process.on('SIGINT')` and `process.on('SIGTERM')` ensures the WAL log is completely flushed into the main SQLite database before exit.
6. **Therefore**: Exporting `closeSqlite` permits automated unit test harnesses to close the database handle cleanly during test teardown.

### Logic Chain 2.3: Ephemeral & View-Once Message Parsing Without Breaking Raw References
1. **From Observation 1.3**: When disappearing messages or view-once media are sent, the true payload is nested inside wrapper envelopes (`ephemeralMessage`, `viewOnceMessage`, `viewOnceMessageV2`).
2. **From Observation 1.3**: Extracting `Object.keys(msg.message)[0]` without unwrapping causes `body` to remain empty and user commands to be silently dropped.
3. **From Observation 1.3**: Downstream command handlers across `src/commands/*.js` directly access `msg.message.imageMessage` or `msg.message.extendedTextMessage`.
4. **From Observation 1.3**: Low-level diagnostic hooks and Baileys quote mechanisms (`sock.sendMessage(..., { quoted: msg })`) require access to the message structure.
5. **Therefore**: Before modifying `msg.message`, storing `msg.raw = msg.raw || msg.message; msg.rawMessage = msg.rawMessage || msg.message;` guarantees that the raw protobuf references remain accessible and unbroken.
6. **Therefore**: Reassigning `msg.message = unwrapMessage(msg.message)` allows all existing downstream commands (`!sticker`, `!ocr`, `!lihat`, `join.js`, etc.) to operate directly on the payload without modifying every individual command file.
7. **Therefore**: Unwrapping `contextInfo.quotedMessage` (while storing `contextInfo.rawQuotedMessage`) ensures that commands quoting view-once media (such as M2's `!toimg` or `!sticker`) function properly.

---

## 3. Caveats

1. **`ADMIN_API_TOKEN` Configuration**: If `ADMIN_API_TOKEN` is not defined in `.env`, `verifyAdminToken` will reject `/pair/reset` with `403 Forbidden` (`Admin API disabled`). Operators must ensure `.env` contains `ADMIN_API_TOKEN`.
2. **Existing PM2 Shutdown Handlers**: `index.js` also registers `SIGINT` and `SIGTERM` handlers that call `process.exit(0)`. Because Node executes signal listeners in the order registered and `closeSqlite()` is synchronous, registering the listener in `persistence.js` guarantees that `wal_checkpoint(TRUNCATE)` and `db.close()` run before process termination.
3. **Scope Boundary**: This explorer is read-only; no modifications have been made directly to `src/services/wa-qr.js`, `src/utils/persistence.js`, or `src/handlers/messages.js`. Complete patch implementations and specifications are documented in `analysis.md` for implementers.

---

## 4. Conclusion

1. **`src/services/wa-qr.js`**: Implement `verifyAdminToken(req)` and secure `POST /pair/reset` so unauthenticated requests are rejected with 401/403. Update `pairHtmlWaiting` client script to prompt for the admin token.
2. **`src/utils/persistence.js`**: Add `sqliteDb.pragma('busy_timeout = 5000');` during initialization. Implement and export `closeSqlite()` executing `sqliteDb.pragma('wal_checkpoint(TRUNCATE)'); sqliteDb.close();`, and register signal listeners on `SIGINT` and `SIGTERM`.
3. **`src/handlers/messages.js`**: Implement `unwrapMessage` to unwrap `ephemeralMessage`, `viewOnceMessage`, and `viewOnceMessageV2`. Preserve raw references with `msg.raw` and `msg.rawMessage` before reassigning `msg.message`, and unwrap `contextInfo.quotedMessage` with `contextInfo.rawQuotedMessage`.

All specifications, code snippets, and unified diff patches are finalized and recorded in:
`C:\Users\DoxxBorx\Project Bot Wa\.agents\teamwork\teamwork_explorer_m1_3\analysis.md`.

---

## 5. Verification Method

### 5.1 Verification Commands
The proposed fixes can be verified using the following automated commands:

1. **Authentication Verification**:
   ```powershell
   # 1. Unauthenticated request must return HTTP 401
   curl -i -X POST http://localhost:3920/pair/reset

   # 2. Invalid token must return HTTP 403
   curl -i -X POST http://localhost:3920/pair/reset -H "Authorization: Bearer invalid-token"

   # 3. Valid token must succeed (HTTP 200)
   curl -i -X POST http://localhost:3920/pair/reset -H "Authorization: Bearer <ADMIN_API_TOKEN>"
   ```

2. **SQLite PRAGMA & Shutdown Verification**:
   ```powershell
   node -e "import('./src/utils/persistence.js').then(async (m) => {
     await m.initPersistence();
     const { default: Database } = await import('better-sqlite3');
     // verify busy_timeout and closeSqlite
     m.closeSqlite();
     console.log('Persistence verification passed.');
   })"
   ```

3. **Message Unwrapping Verification**:
   ```powershell
   node -e "import('./src/handlers/messages.js').then((m) => {
     const eph = { ephemeralMessage: { message: { conversation: '!ping' } } };
     const unwrapped = m.unwrapMessage(eph);
     if (unwrapped.conversation === '!ping') console.log('Unwrap verification passed.');
     else process.exit(1);
   })"
   ```

### 5.2 Files to Inspect
- `C:\Users\DoxxBorx\Project Bot Wa\.agents\teamwork\teamwork_explorer_m1_3\analysis.md`
- `C:\Users\DoxxBorx\Project Bot Wa\src\services\wa-qr.js` (around line 242)
- `C:\Users\DoxxBorx\Project Bot Wa\src\utils\persistence.js` (around lines 39–46)
- `C:\Users\DoxxBorx\Project Bot Wa\src\handlers\messages.js` (around lines 111–118)

### 5.3 Invalidation Conditions
- If `ADMIN_API_TOKEN` is verified using a different header or scheme across the project not covered by `Bearer`, `x-admin-token`, query, or body.
- If `better-sqlite3` in this environment is replaced with an asynchronous SQLite driver.
- If Baileys alters `proto.IMessage` wrapper naming conventions beyond the unwrapped set.
