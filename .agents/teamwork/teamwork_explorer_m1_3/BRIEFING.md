# BRIEFING — 2026-10-30T00:08:00Z

## Mission
Formulate exact, verified fix strategies for wa-qr.js authentication, persistence.js SQLite pragmas & shutdown hooks, and messages.js ephemeral/viewOnce unwrapping.

## 🔒 My Identity
- Archetype: explorer
- Roles: teamwork_explorer
- Working directory: C:\Users\DoxxBorx\Project Bot Wa\.agents\teamwork\teamwork_explorer_m1_3
- Original parent: d0273e76-7c9c-48e5-aa5f-ba84abc777de
- Milestone: Milestone 1

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Scope boundaries: Read-only exploration. DO NOT modify any source code files directly.
- Write detailed fix specification to analysis.md and structured handoff to handoff.md.

## Current Parent
- Conversation ID: d0273e76-7c9c-48e5-aa5f-ba84abc777de
- Updated: 2026-10-30T00:08:00Z

## Investigation State
- **Explored paths**:
  - `src/services/wa-qr.js` (lines 140–264)
  - `src/services/admin-api.js` (lines 40–150)
  - `src/utils/persistence.js` (lines 1–106)
  - `src/handlers/messages.js` (lines 90–135, 695–740, 1025–1090)
  - `index.js` (lines 20–55)
  - Baileys message parsing and quote mechanisms (`normalizeMessageContent`, `getContentType`, `generateWAMessage`)
- **Key findings**:
  - `POST /pair/reset` in `wa-qr.js` lacks authentication, allowing unauthenticated session wipes. Fix: implement `verifyAdminToken(req)` supporting `Authorization: Bearer <token>`, `x-admin-token`, `?token=`, and `body.token`, rejecting with 401/403.
  - SQLite in `persistence.js` lacks `busy_timeout = 5000` and process signal listeners on `SIGINT`/`SIGTERM`. Fix: add PRAGMA and register shutdown listener running `wal_checkpoint(TRUNCATE)` and `db.close()`, exporting `closeSqlite()`.
  - In `messages.js`, naive extraction `type = Object.keys(msg.message)[0]` fails on `ephemeralMessage`, `viewOnceMessage`, and `viewOnceMessageV2`. Fix: recursively unwrap up to 5 layers, while preserving raw references on `msg.raw` and `msg.rawMessage` and unwrapping `contextInfo.quotedMessage` with `contextInfo.rawQuotedMessage`.
- **Unexplored areas**:
  - None within Explorer M1-3 assigned scope.

## Key Decisions Made
- Verified all three fix algorithms using isolated Node test executions.
- Designed `verifyAdminToken` to reject with 401 for missing tokens and 403 for mismatched or unconfigured tokens.
- Designed `closeSqlite` to be safely idempotent and callable both from process signal listeners and unit test teardowns.
- Designed message unwrapping to preserve `msg.raw` and `msg.rawMessage` so low-level Baileys quoting and plugins have access to unmodified envelopes.

## Artifact Index
- analysis.md — Detailed fix specification for wa-qr.js, persistence.js, and messages.js
- handoff.md — 5-component handoff report
- DISPATCH.md — Dispatch log
- progress.md — Liveness heartbeat
