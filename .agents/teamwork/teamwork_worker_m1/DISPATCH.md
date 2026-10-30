## 2026-10-29T17:09:28Z
Your identity: Milestone 1 Worker (teamwork_worker)
Your working directory: C:\Users\DoxxBorx\Project Bot Wa\.agents\teamwork\teamwork_worker_m1
Project workspace: C:\Users\DoxxBorx\Project Bot Wa
Path to ORIGINAL_REQUEST.md: C:\Users\DoxxBorx\Project Bot Wa\.agents\teamwork\ORIGINAL_REQUEST.md
Path to PROJECT.md: C:\Users\DoxxBorx\Project Bot Wa\PROJECT.md

MANDATORY: You MUST read ORIGINAL_REQUEST.md and PROJECT.md before starting your work.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership:
You own exclusively the following files for Milestone 1:
- `src/state.js`
- `src/services/premium-users.js`
- `src/services/usage-tracker.js`
- `src/services/dl-media.js`
- `src/services/payment-gateway.js`
- `src/services/admin-api.js`
- `src/services/wa-qr.js`
- `src/utils/persistence.js`
- `src/handlers/messages.js` (unwrapping message logic around line 112)

Explorer Reports & Specific Guidance:
Read the following handoff and analysis reports for exact code diffs and implementation details:
1. `C:\Users\DoxxBorx\Project Bot Wa\.agents\teamwork\teamwork_explorer_m1_1\handoff.md` (and `analysis.md`):
   - Fix `src/state.js`: Object.entries for `global.notes` and `global.reminders`, isolated try/catch per pruner, export prune functions.
   - Fix `src/services/premium-users.js`: Implement `getAllUsers()`, `getPremiumUsers()`, `removeUser(userId)`, `removePremiumUser(userId)`, and `setUserTier` returning `{ ok: true, ... }`.
   - Fix `src/services/usage-tracker.js`: Import `getTierInfo` and `getUserTier`, support dual-signature `checkUsageLimit(userId, tierOrCommand)` returning `{ allowed, remaining, resetAt }`.
2. `C:\Users\DoxxBorx\Project Bot Wa\.agents\teamwork\teamwork_explorer_m1_2\handoff.md` (and `analysis.md`):
   - Fix `src/services/dl-media.js`: Read `out` (`const buffer = fs.readFileSync(out);`) before cleanup in `downloadViaYtDlp`, wrap with `clampBuffer`.
   - Fix `src/services/payment-gateway.js`: Make `validatePayment` async, await `axios.get` with 15s timeout, parse settlement/capture, structured error handling.
   - Fix `src/services/admin-api.js`: Line 223 handle truthy `result` from `setUserTier`, return HTTP 200 with `{ ok: true, users }`.
3. `C:\Users\DoxxBorx\Project Bot Wa\.agents\teamwork\teamwork_explorer_m1_3\handoff.md` (and `analysis.md`):
   - Fix `src/services/wa-qr.js`: Add `verifyAdminToken(req)` protecting `POST /pair/reset` endpoint, rejecting unauthorized requests with 401/403.
   - Fix `src/utils/persistence.js`: Set `sqliteDb.pragma('busy_timeout = 5000')`, add `closeSqlite()` with `wal_checkpoint(TRUNCATE)` and `db.close()`, register `SIGINT`/`SIGTERM` handlers.
   - Fix `src/handlers/messages.js`: Recursive `unwrapMessage` for `ephemeralMessage`, `viewOnceMessage`, `viewOnceMessageV2`, preserving raw message references.

Verification & Delivery:
- Verify every modified file with `node --check <file>`.
- Run the verification one-liners from Explorer M1-1's handoff (state pruning, premium users, usage tracker).
- Document your changes in `changes.md` and write a structured handoff to `handoff.md`.
- Send a completion message back when done.
