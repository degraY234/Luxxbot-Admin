# Detailed Technical Analysis & Fix Specifications — Explorer M1-2

**Author**: Explorer M1-2 (`teamwork_explorer`)  
**Target Milestone**: Milestone 1 (Core System & Service Bug Fixes)  
**Date**: 2026-10-29  

---

## 1. Issue 1: ReferenceError in `src/services/dl-media.js` (`downloadViaYtDlp`)

### 1.1 Location & Observation
- **Target File**: `src/services/dl-media.js`
- **Function**: `downloadViaYtDlp(url, mode, tmpBase, quality = 'wa')`
- **Lines**: 331–361
- **Direct Code Excerpt**:
  ```javascript
  346:     const out = `${tmpBase}.mp4`;
  347:     const useWa = platform === 'youtube' || platform === 'facebook' || quality === 'wa';
  348:     if (useWa) {
  349:         await downloadVideoForWhatsApp(url, out, { maxHeight: quality === 'hd' ? 1080 : 720 });
  350:     } else {
  351:         await downloadVideoHd(url, out);
  352:     }
  353: 
  354:     return {
  355:         buffer: clampBuffer(buffer, 64 * 1024 * 1024),
  356:         title,
  357:         mimetype: 'video/mp4',
  358:         fileName: `${sanitizeFileName(title)}.mp4`,
  359:         qualityLabel: quality === 'hd' ? 'MP4 1080p' : 'MP4 720p (HP)'
  360:     };
  ```

### 1.2 Root Cause Analysis & Mechanism
1. **Unassigned Identifier**:
   At line 355, `buffer: clampBuffer(buffer, 64 * 1024 * 1024)` is evaluated. The identifier `buffer` has neither been passed as a parameter nor declared anywhere within `downloadViaYtDlp`.
   In JavaScript strict / ESM mode, referencing an undeclared identifier raises `ReferenceError: buffer is not defined`.
2. **Audio vs. Video Implementation Disparity**:
   In the audio branch (lines 335–344), the file downloaded by `downloadAudioToMp3(url, out)` is explicitly read into memory using `fs.readFileSync(out)`:
   ```javascript
   if (mode === 'audio') {
       const out = `${tmpBase}.mp3`;
       await downloadAudioToMp3(url, out);
       return {
           buffer: fs.readFileSync(out),
           ...
       };
   }
   ```
   In the video branch (lines 346–353), `downloadVideoForWhatsApp(url, out, ...)` and `downloadVideoHd(url, out)` save the MP4 video to `out` on disk, but the author forgot to read `fs.readFileSync(out)` before passing `buffer` to `clampBuffer`.
3. **Temporary File Lifecycle Danger**:
   In `downloadMediaFromUrl` (line 377–401):
   ```javascript
   try {
       ...
       return { ...(await downloadViaYtDlp(url, mode, tmpBase, quality)), mode };
   } finally {
       cleanupTmp(tmpBase);
   }
   ```
   Because `cleanupTmp(tmpBase)` unlinks all temporary files matching `${tmpBase}.*` in `finally`, the video file must be read into memory (`Buffer`) *synchronously inside `downloadViaYtDlp` before returning*. If not read before returning, the file would be unlinked and lost.
4. **Impact on Commands**:
   `src/commands/dl.js:28-29` calls `downloadMediaFromUrl(...)` and expects `result.buffer` to be a valid `Buffer` for sending over Baileys socket (`sock.sendMessage(from, { video: buffer, ... })`). Every video download through yt-dlp (YouTube, Facebook, Twitter/X, Instagram fallback) crashes with `ReferenceError`.

### 1.3 Exact Proposed Fix

In `src/services/dl-media.js`, before constructing the return object:
1. Ensure the output file exists with `if (!fs.existsSync(out)) throw new Error('File video tidak ditemukan setelah unduhan');`.
2. Read the file into memory: `const buffer = fs.readFileSync(out);`.
3. Pass `buffer` to `clampBuffer(buffer, 64 * 1024 * 1024)`.
4. For parity and defensive programming, also apply `clampBuffer` to the audio mode branch.

#### Before → After (Code Snippet)
```javascript
// BEFORE (src/services/dl-media.js:346-361):
    const out = `${tmpBase}.mp4`;
    const useWa = platform === 'youtube' || platform === 'facebook' || quality === 'wa';
    if (useWa) {
        await downloadVideoForWhatsApp(url, out, { maxHeight: quality === 'hd' ? 1080 : 720 });
    } else {
        await downloadVideoHd(url, out);
    }

    return {
        buffer: clampBuffer(buffer, 64 * 1024 * 1024),
        title,
        mimetype: 'video/mp4',
        fileName: `${sanitizeFileName(title)}.mp4`,
        qualityLabel: quality === 'hd' ? 'MP4 1080p' : 'MP4 720p (HP)'
    };

// AFTER (src/services/dl-media.js:346-366):
    const out = `${tmpBase}.mp4`;
    const useWa = platform === 'youtube' || platform === 'facebook' || quality === 'wa';
    if (useWa) {
        await downloadVideoForWhatsApp(url, out, { maxHeight: quality === 'hd' ? 1080 : 720 });
    } else {
        await downloadVideoHd(url, out);
    }

    if (!fs.existsSync(out)) {
        throw new Error('File video tidak ditemukan setelah unduhan');
    }
    const buffer = fs.readFileSync(out);

    return {
        buffer: clampBuffer(buffer, 64 * 1024 * 1024),
        title,
        mimetype: 'video/mp4',
        fileName: `${sanitizeFileName(title)}.mp4`,
        qualityLabel: quality === 'hd' ? 'MP4 1080p' : 'MP4 720p (HP)'
    };
```

---

## 2. Issue 2: Missing `await` & Process-Crashing Rejections in `src/services/payment-gateway.js`

### 2.1 Location & Observation
- **Target File**: `src/services/payment-gateway.js`
- **Function**: `validatePayment(orderId)`
- **Lines**: 88–104
- **Direct Code Excerpt**:
  ```javascript
  88: export function validatePayment(orderId) {
  89:     if (!MIDTRANS_SERVER_KEY) return { valid: false, status: 'unconfigured' };
  90: 
  91:     try {
  92:         const response = axios.get(
  93:             `${MIDTRANS_BASE_URL}/v2/${orderId}/status`,
  94:             { headers: getMidtransHeaders() }
  95:         );
  96:         return {
  97:             valid: response.data.transaction_status === 'settlement',
  98:             status: response.data.transaction_status,
  99:             orderId
  100:         };
  101:     } catch {
  102:         return { valid: false, status: 'error' };
  103:     }
  104: }
  ```

### 2.2 Root Cause Analysis & Empirical Evidence
1. **Synchronous Execution on Async Call**:
   `validatePayment` was declared as a regular synchronous function (`export function validatePayment(orderId)`).
   Line 92 calls `axios.get(...)` without `await`.
2. **Double Failure Mechanism**:
   - **Failure A (Synchronous TypeError)**:
     `response` is an unfulfilled Promise object. At line 97, `response.data` is `undefined`. Accessing `response.data.transaction_status` throws `TypeError: Cannot read properties of undefined (reading 'transaction_status')`.
     The `catch` block catches this immediate TypeError and synchronously returns `{ valid: false, status: 'error' }`.
   - **Failure B (Fatal Unhandled Promise Rejection)**:
     The underlying `axios.get` HTTP request remains detached and in-flight without any rejection handler (`.catch` or `try/catch` with `await`). When the network responds (e.g., HTTP 401 Unauthorized, HTTP 404 Not Found, or timeout), Node.js triggers:
     ```text
     node:internal/process/promises:391
         triggerUncaughtException(err, true /* fromPromise */);
         ^
     AxiosError: Request failed with status code 401
     ```
     This crashed Node.js with exit code 1 during live reproduction.
3. **Midtrans Response Semantic Handling**:
   Midtrans transaction status codes include:
   - `settlement`: Successfully paid (QRIS / GoPay / Bank Transfer).
   - `capture` + `fraud_status === 'accept'`: Valid credit card charge.
   - `pending`: Awaiting customer action.
   - `deny` / `cancel` / `expire` / `failure`: Terminal non-success statuses.
   The function should recognize `settlement` and accepted `capture` as valid payments, cleanly handle 404 (`not_found`), and handle HTTP errors gracefully without unhandled rejections.

### 2.3 Exact Proposed Fix

In `src/services/payment-gateway.js`:
1. Declare `validatePayment` as `async`: `export async function validatePayment(orderId)`.
2. Await the `axios.get` call.
3. Add a network timeout (e.g., 15000ms).
4. Extract `transaction_status` safely with optional chaining `response.data?.transaction_status`.
5. Support both `settlement` and `capture` with `fraud_status: 'accept'`.
6. Return detailed metadata (`orderId`, `grossAmount`, `paymentType`, `settlementTime`).
7. In `catch (error)`, check `error.response?.status === 404` to return `status: 'not_found'` instead of a generic error, and log the failure safely without crashing.

#### Before → After (Code Snippet)
```javascript
// BEFORE (src/services/payment-gateway.js:88-104):
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

// AFTER (src/services/payment-gateway.js:88-118):
export async function validatePayment(orderId) {
    if (!orderId || typeof orderId !== 'string') {
        return { valid: false, status: 'invalid_order_id' };
    }
    if (!MIDTRANS_SERVER_KEY) {
        return { valid: false, status: 'unconfigured' };
    }

    try {
        const response = await axios.get(
            `${MIDTRANS_BASE_URL}/v2/${orderId}/status`,
            {
                headers: getMidtransHeaders(),
                timeout: 15000
            }
        );

        const status = response.data?.transaction_status;
        const fraudStatus = response.data?.fraud_status;
        const isSettled = status === 'settlement' || (status === 'capture' && fraudStatus === 'accept');

        return {
            valid: Boolean(isSettled),
            status: status || 'unknown',
            orderId,
            grossAmount: response.data?.gross_amount,
            paymentType: response.data?.payment_type,
            settlementTime: response.data?.settlement_time
        };
    } catch (error) {
        console.error('Payment validation failed:', error.response?.data || error.message);
        return {
            valid: false,
            status: error.response?.status === 404 ? 'not_found' : 'error',
            orderId,
            error: error.response?.data?.status_message || error.message
        };
    }
}
```

---

## 3. Issue 3: Inconsistent Success Contract & Express 400 Status in `src/services/admin-api.js`

### 3.1 Location & Observation
- **Target File**: `src/services/admin-api.js`
- **Route**: `POST /admin/api/premium-users` (and `DELETE /admin/api/premium-users`)
- **Lines**: 217–239
- **Direct Code Excerpt**:
  ```javascript
  217:     app.post('/admin/api/premium-users', async (req, res) => {
  218:         const number = String(req.body?.number || '').trim();
  219:         if (!number) {
  220:             return res.status(400).json({ ok: false, error: 'Nomor WA premium wajib diisi.' });
  221:         }
  222:         const result = await addPremiumUser(number);
  223:         if (!result.ok) {
  224:             return res.status(400).json(result);
  225:         }
  226:         res.json(result);
  227:     });
  ```

### 3.2 Root Cause Analysis & Inter-Service Contract Breakage
1. **Underlying Function Contract (`src/services/premium-users.js`)**:
   `addPremiumUser(userId, tier, durationDays)` delegates to `setUserTier(userId, tier, expiresAt)`:
   ```javascript
   export function setUserTier(userId, tier, expiresAt = null) {
       const db = readDb();
       db.users[userId] = {
           tier,
           expiresAt,
           upgradedAt: Date.now(),
           upgradedBy: 'owner'
       };
       writeDb(db);
       return db.users[userId];
   }
   ```
   `setUserTier` returns `db.users[userId]`, which has properties `{ tier, expiresAt, upgradedAt, upgradedBy }`.
   **Notice**: It does NOT have `.ok`! `result.ok` is `undefined`.
2. **False Rejection in `admin-api.js`**:
   Line 223 checks: `if (!result.ok)`.
   Because `!undefined` evaluates to `true`, the condition triggers every single time.
   Express immediately executes `return res.status(400).json(result);`.
   The record was successfully written to `data/premium-users.json`, but Express responds with HTTP 400 Bad Request!
3. **Frontend Dashboard UI Failure (`admin/js/app.js`)**:
   In `admin/js/app.js:199-200`, the frontend client `api(...)` checks:
   ```javascript
   const data = await res.json().catch(() => ({}));
   if (!res.ok) throw new Error(friendlyError({ message: data.error || `HTTP ${res.status}` }, base));
   ```
   When Express returns HTTP 400, the frontend throws:
   `Gagal tambah: HTTP 400`
   Furthermore, lines 1837–1838 of `admin/js/app.js` expect `result.users`:
   ```javascript
   const result = await api('/premium-users', 'POST', { number });
   renderPremiumUsers(result.users || []);
   ```
   If the API does not include `users` in the response, `result.users` is `undefined`, causing the user table to clear to empty (`[]`) until a manual refresh!
4. **DELETE Endpoint Parity**:
   Lines 229–239 similarly have `const result = await removePremiumUser(number); if (!result.ok) return res.status(400).json(result);`.
   According to `PROJECT.md:78`, `removePremiumUser(userId)` returns `boolean`. A boolean `true` also has `result.ok === undefined`, which would trigger `!result.ok === true` and return HTTP 400!

### 3.3 Exact Proposed Fix

A robust, two-layer fix strategy ensures total resilience:

#### Layer 1: Fix in `src/services/admin-api.js`
1. Validate `number`.
2. Wrap operations in `try/catch`.
3. In `POST`: check whether `result` exists and did not explicitly fail (`result && result.ok !== false`).
4. Fetch the refreshed user list: `const users = await getPremiumUsers();`.
5. Return HTTP 200 with `{ ok: true, users, ...(typeof result === 'object' ? result : {}) }`.
6. In `DELETE`: check `if (result === false || (result && result.ok === false)) return res.status(400)...`. Then return HTTP 200 with `{ ok: true, users }`.

#### Layer 2: Parity Fix in `src/services/premium-users.js` (`setUserTier`)
Update `setUserTier` to return `{ ok: true, ...db.users[userId] }` so any caller relying on an `.ok` property receives a consistent success status.

#### Before → After (Code Snippets)

**In `src/services/admin-api.js:217-239`**:
```javascript
// BEFORE:
    app.post('/admin/api/premium-users', async (req, res) => {
        const number = String(req.body?.number || '').trim();
        if (!number) {
            return res.status(400).json({ ok: false, error: 'Nomor WA premium wajib diisi.' });
        }
        const result = await addPremiumUser(number);
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json(result);
    });

    app.delete('/admin/api/premium-users', async (req, res) => {
        const number = String(req.body?.number || '').trim();
        if (!number) {
            return res.status(400).json({ ok: false, error: 'Nomor WA premium wajib diisi.' });
        }
        const result = await removePremiumUser(number);
        if (!result.ok) {
            return res.status(400).json(result);
        }
        res.json(result);
    });

// AFTER:
    app.post('/admin/api/premium-users', async (req, res) => {
        const number = String(req.body?.number || '').trim();
        if (!number) {
            return res.status(400).json({ ok: false, error: 'Nomor WA premium wajib diisi.' });
        }
        try {
            const result = await addPremiumUser(number);
            if (!result || (typeof result === 'object' && result.ok === false)) {
                return res.status(400).json({ ok: false, error: 'Gagal menambahkan premium user.', ...result });
            }
            const users = await getPremiumUsers();
            res.json({ ok: true, users, ...(typeof result === 'object' ? result : {}) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message || 'Gagal menambahkan premium user.' });
        }
    });

    app.delete('/admin/api/premium-users', async (req, res) => {
        const number = String(req.body?.number || '').trim();
        if (!number) {
            return res.status(400).json({ ok: false, error: 'Nomor WA premium wajib diisi.' });
        }
        try {
            const result = await removePremiumUser(number);
            if (result === false || (result && result.ok === false)) {
                return res.status(400).json({ ok: false, error: 'Nomor tidak ditemukan dalam daftar premium.' });
            }
            const users = await getPremiumUsers();
            res.json({ ok: true, users, ...(typeof result === 'object' ? result : {}) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message || 'Gagal menghapus premium user.' });
        }
    });
```

**In `src/services/premium-users.js:49-59`**:
```javascript
// BEFORE:
export function setUserTier(userId, tier, expiresAt = null) {
    const db = readDb();
    db.users[userId] = {
        tier,
        expiresAt,
        upgradedAt: Date.now(),
        upgradedBy: 'owner'
    };
    writeDb(db);
    return db.users[userId];
}

// AFTER:
export function setUserTier(userId, tier, expiresAt = null) {
    const db = readDb();
    db.users[userId] = {
        tier,
        expiresAt,
        upgradedAt: Date.now(),
        upgradedBy: 'owner'
    };
    writeDb(db);
    return { ok: true, ...db.users[userId] };
}
```

---

## 4. Unified Patch Specification

```patch
diff --git a/src/services/dl-media.js b/src/services/dl-media.js
--- a/src/services/dl-media.js
+++ b/src/services/dl-media.js
@@ -351,6 +351,10 @@ async function downloadViaYtDlp(url, mode, tmpBase, quality = 'wa') {
         await downloadVideoHd(url, out);
     }
 
+    if (!fs.existsSync(out)) {
+        throw new Error('File video tidak ditemukan setelah unduhan');
+    }
+    const buffer = fs.readFileSync(out);
     return {
         buffer: clampBuffer(buffer, 64 * 1024 * 1024),
         title,

diff --git a/src/services/payment-gateway.js b/src/services/payment-gateway.js
--- a/src/services/payment-gateway.js
+++ b/src/services/payment-gateway.js
@@ -88,18 +88,29 @@ export function formatPaymentMessage(result, tier) {
-export function validatePayment(orderId) {
+export async function validatePayment(orderId) {
+    if (!orderId || typeof orderId !== 'string') return { valid: false, status: 'invalid_order_id' };
     if (!MIDTRANS_SERVER_KEY) return { valid: false, status: 'unconfigured' };
 
     try {
-        const response = axios.get(
+        const response = await axios.get(
             `${MIDTRANS_BASE_URL}/v2/${orderId}/status`,
-            { headers: getMidtransHeaders() }
+            { headers: getMidtransHeaders(), timeout: 15000 }
         );
+        const status = response.data?.transaction_status;
+        const fraudStatus = response.data?.fraud_status;
+        const isSettled = status === 'settlement' || (status === 'capture' && fraudStatus === 'accept');
         return {
-            valid: response.data.transaction_status === 'settlement',
-            status: response.data.transaction_status,
-            orderId
+            valid: Boolean(isSettled),
+            status: status || 'unknown',
+            orderId,
+            grossAmount: response.data?.gross_amount,
+            paymentType: response.data?.payment_type,
+            settlementTime: response.data?.settlement_time
         };
-    } catch {
-        return { valid: false, status: 'error' };
+    } catch (error) {
+        console.error('Payment validation failed:', error.response?.data || error.message);
+        return {
+            valid: false,
+            status: error.response?.status === 404 ? 'not_found' : 'error',
+            orderId,
+            error: error.response?.data?.status_message || error.message
+        };
     }
 }

diff --git a/src/services/admin-api.js b/src/services/admin-api.js
--- a/src/services/admin-api.js
+++ b/src/services/admin-api.js
@@ -221,11 +221,16 @@ export function registerAdminApi(app) {
         if (!number) {
             return res.status(400).json({ ok: false, error: 'Nomor WA premium wajib diisi.' });
         }
-        const result = await addPremiumUser(number);
-        if (!result.ok) {
-            return res.status(400).json(result);
+        try {
+            const result = await addPremiumUser(number);
+            if (!result || (typeof result === 'object' && result.ok === false)) {
+                return res.status(400).json({ ok: false, error: 'Gagal menambahkan premium user.', ...result });
+            }
+            const users = await getPremiumUsers();
+            res.json({ ok: true, users, ...(typeof result === 'object' ? result : {}) });
+        } catch (e) {
+            res.status(500).json({ ok: false, error: e.message || 'Gagal menambahkan premium user.' });
         }
-        res.json(result);
     });
 
     app.delete('/admin/api/premium-users', async (req, res) => {
@@ -233,11 +238,16 @@ export function registerAdminApi(app) {
         if (!number) {
             return res.status(400).json({ ok: false, error: 'Nomor WA premium wajib diisi.' });
         }
-        const result = await removePremiumUser(number);
-        if (!result.ok) {
-            return res.status(400).json(result);
+        try {
+            const result = await removePremiumUser(number);
+            if (result === false || (result && result.ok === false)) {
+                return res.status(400).json({ ok: false, error: 'Nomor tidak ditemukan dalam daftar premium.' });
+            }
+            const users = await getPremiumUsers();
+            res.json({ ok: true, users, ...(typeof result === 'object' ? result : {}) });
+        } catch (e) {
+            res.status(500).json({ ok: false, error: e.message || 'Gagal menghapus premium user.' });
         }
-        res.json(result);
     });
```
