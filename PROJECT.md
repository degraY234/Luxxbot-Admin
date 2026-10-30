# Project: Luxx WhatsApp Bot Enhancements & Reliability

## Architecture
- **Runtime**: Node.js 20.20.2 ESM (`type: module`)
- **WhatsApp Gateway**: @whiskeysockets/baileys v6.7.23 with multi-file authentication state
- **Web & Dashboard**: Express 5.2.1 on port 3920 with token-based admin authentication
- **Data Persistence**: SQLite (better-sqlite3) in WAL mode + atomic JSON fallbacks
- **Process Management**: PM2 (`ecosystem.config.cjs`)
- **Command Dispatcher**: `src/handlers/messages.js` with modular routing to `src/commands/*.js`
- **Offline Test Engine**: Native Node 20 `node:test` + `node:assert` mock Baileys harness

## Code Layout
- `src/luxx-bot.js`: Main bot entry point and Baileys socket lifecycle
- `src/handlers/messages.js`: Incoming message parser and command router
- `src/commands/`: Individual command implementations
  - `group-admin.js`: Group moderation commands (`!kick`, `!promote`, `!demote`, `!hidetag`, `!linkgc`)
  - `toimg.js`: Sticker to image converter (`!toimg`)
  - `islami.js`: Islamic utility commands (`!sholat`, `!quran`)
  - `tts.js`: Text-to-speech voice notes (`!tts`)
  - `broadcast.js`: Throttled owner broadcast (`!broadcast`, `!bc`)
  - `darkjokes.js`: Dark humor command handler
  - `pantun.js`: Pantun generator command handler
  - `menu.js`: Command list and menu presentation
- `src/data/command-registry.js`: Catalog of all bot commands and metadata
- `src/services/`: Core bot business services
  - `premium-users.js`: Premium user status and tier management
  - `usage-tracker.js`: User quota and command usage tracking
  - `dl-media.js`: Media download service (yt-dlp, social platforms)
  - `payment-gateway.js`: Payment verification and transaction validation
  - `wa-qr.js`: Web pairing, QR code, and session reset handlers
  - `admin-api.js`: Express REST API for administrative dashboard
- `src/utils/`: Utility modules
  - `persistence.js`: SQLite database connection, PRAGMA config, migrations
  - `audio-ptt.js`: Audio transcoding to Opus WhatsApp PTT format
- `src/state.js`: Global state management and periodic pruning interval
- `scripts/`: Offline test suites and verification scripts
  - `test-harness.mjs`: Mock Baileys socket and message fixtures
  - `test-services.mjs`: Unit tests for services and database persistence
  - `test-commands.mjs`: Unit tests for command handlers and permissions
  - `test-all.mjs`: Unified test suite runner for CI / local validation

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Memory Leak & State Pruning Fix | Fix `for...of` iteration on plain objects `global.notes` and `global.reminders` in `src/state.js` | M1 | Survey (E1, E2, E3) |
| 2 | Premium Users Service Fix | Implement missing `removeUser` and `getAllUsers` functions in `src/services/premium-users.js` | M1 | Survey (E1, E3) |
| 3 | Usage Tracker Service Fix | Import `getTierInfo` in `src/services/usage-tracker.js` | M1 | Survey (E2, E3) |
| 4 | Admin API Result Validation Fix | Fix `!result.ok` check in `src/services/admin-api.js` for `setUserTier` | M1 | Survey (E3) |
| 5 | Media Downloader Crash Fix | Declare and assign `buffer` in `downloadViaYtDlp` in `src/services/dl-media.js` | M1 | Survey (E3) |
| 6 | Payment Gateway Async Fix | Add missing `await` to `axios.get` in `src/services/payment-gateway.js` | M1 | Survey (E3) |
| 7 | Secure Session Reset Endpoint | Require admin token authentication for `POST /pair/reset` in `src/services/wa-qr.js` | M1 | Survey (E1) |
| 8 | SQLite Resilience & PRAGMA Tuning | Add `PRAGMA busy_timeout = 5000` and graceful DB shutdown on SIGINT/SIGTERM in `src/utils/persistence.js` | M1 | Survey (E3) |
| 9 | Ephemeral & ViewOnce Message Parsing | Unwrap ephemeralMessage and viewOnceMessage in `src/handlers/messages.js` | M1 | Survey (E3) |
| 10 | Group Moderation Suite | Add `!kick`, `!promote`, `!demote`, `!hidetag`, `!linkgc` in `src/commands/group-admin.js` | M2 | Survey (E2) |
| 11 | Sticker to Image Converter | Add `!toimg` command converting quoted sticker to PNG in `src/commands/toimg.js` | M2 | Survey (E2) |
| 12 | Islamic Utilities | Add `!sholat` (prayer times) and `!quran` (verses) in `src/commands/islami.js` | M2 | Survey (E2) |
| 13 | Text-to-Speech Voice Notes | Add `!tts` converting text to WhatsApp PTT Opus audio in `src/commands/tts.js` | M2 | Survey (E2) |
| 14 | Throttled Owner Broadcast | Add `!broadcast` / `!bc` with safety throttle across groups in `src/commands/broadcast.js` | M2 | Survey (E2) |
| 15 | Unorphan Dark Jokes & Pantun | Route `!darkjokes` in `messages.js` and implement `!pantun` in `src/commands/pantun.js` | M2 | Survey (E2) |
| 16 | Command Registry & Menu Sync | Register all new commands in `command-registry.js` and display in `menu.js` | M2 | Survey (E2) |
| 17 | Mock Baileys Offline Test Harness | Create reusable mock Baileys socket and mock message factory in `scripts/test-harness.mjs` | M3 (E2E) | Survey (E1) & R3 |
| 18 | Automated Services & Persistence Tests | Create offline unit tests verifying all services, fixes, and SQLite queries in `scripts/test-services.mjs` | M3 (E2E) | Requirement R3 |
| 19 | Automated Commands & Handlers Tests | Create offline tests verifying all new & modified commands and permissions in `scripts/test-commands.mjs` | M3 (E2E) | Requirement R3 |
| 20 | Unified Test Runner & Startup Check | Unified runner `scripts/test-all.mjs`, `npm test` script, and PM2/syntax verification | M3 (E2E) | Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core System & Service Bug Fixes | Fix state.js, premium-users.js, usage-tracker.js, dl-media.js, payment-gateway.js, wa-qr.js, persistence.js | none | IN_PROGRESS |
| M2 | High-Impact Commands & Integrations | Implement group-admin, toimg, islami, tts, broadcast, darkjokes, pantun, and menu sync | M1 (Interface Contracts) | PLANNED |
| M3 | Final Acceptance & Adversarial Hardening | Pass 100% of offline test suite (Tiers 1-4) and adversarial coverage hardening (Tier 5) | M1, M2, E2E Track | PLANNED |

## Interface Contracts

### M1 ↔ M2 (Services to Commands)
- `src/services/premium-users.js`:
  - `getPremiumUsers()`: returns Array of user numbers
  - `removePremiumUser(userId)`: returns boolean
- `src/services/usage-tracker.js`:
  - `checkUsageLimit(userId, command)`: returns `{ allowed: boolean, remaining: number, resetAt: Date }`
- `src/utils/audio-ptt.js`:
  - `mp3BufferToPttOgg(mp3Buffer)`: returns `Promise<Buffer>` (Opus encoded)

### M2 Command Handlers Contract
Every command handler in `src/commands/*.js` adheres to:
```javascript
export async function handle<CommandName>Command({ sock, msg, sender, args, isGroup, isAdmin, isGroupAdmin, prefix }) {
    // Returns Promise<boolean|void>, throws no unhandled exceptions
}
```
- Must catch external API or network errors gracefully and send a polite error message.
- Must verify permissions (admin / group admin) before executing sensitive actions.
- Must not block the event loop.

### M3 Test Harness Contract
`scripts/test-harness.mjs`:
- `createMockSocket()`: Returns object simulating Baileys WASocket with spies on `sendMessage`, `groupParticipantsUpdate`, `groupInviteCode`, `groupFetchAllParticipating`.
- `createMockMessage({ text, sender, isGroup, isGroupAdmin, quoted })`: Returns Baileys `proto.IWebMessageInfo` structure.
