# Handoff Report: Commands, Plugins, Routing & High-Impact Feature Survey

## 1. Observation

1. **Codebase Footprint and Routing Core**:
   - `src/handlers/messages.js` contains 1,375 lines of code and serves as the central router for incoming WhatsApp messages (`messages.upsert`).
   - Line 122 checks `text.startsWith('!')`. Command prefix is strictly hardcoded to `'!'`.
   - Lines 58–64 define `COMMAND_ALIASES` (`mrnu: 'menu'`, `halp: 'help'`, `radlo: 'radio'`, `ply: 'play'`, `wath: 'watch'`).
   - Lines 77–79 define `PHRASE_COMMANDS` (`s`, `sticker`, `dl`, `quote`, `lirik`, `lyrics`). For these, arguments are preserved as a single string instead of split by whitespace.
   - Lines 133–140 define numerical reply session interceptors (`spSession`, `playSession`, `sastraSession`) triggered by `text.match(/^(?:!)?(\d{1,2})(?:[.,)\s]|$)/)`.

2. **Roles and Permissions**:
   - Line 246: `isAdmin = OWNER_NUMBER.some(num => senderNumber === num)`.
   - Line 253: `_localGroupAdminFlag = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin' || isAdmin`.
   - Line 281: `const ownerCommands = ['refresh', 'turu', 'bangun', 'pingsan', 'self', 'public', 'join', 'leave', 'block', 'unblock', 'spek', 'grup', 'antilink', 'speedtest', 'broadcast', 'bc', 'systeminfo', 'eval', 'resetroom'];`.
   - Lines 940, 954, 965: `checkPremiumAccess(senderNumber, cmd)` guards `!s`, `!dl`, and `!buat`.

3. **Latent Defects & Disconnected Handlers Observed**:
   - **Missing Broadcast Handler**: `broadcast` and `bc` are listed in `ownerCommands` (`src/handlers/messages.js:281`) and `menu.js:101-102`, but search across `src/` revealed zero implementation blocks for `command === 'broadcast'` or `command === 'bc'`.
   - **Orphaned Dark Jokes Handler**: `src/commands/darkjokes.js` exports `handleDarkJokesCommand`, registered in `src/data/command-registry.js:39` and `menu.js:161`, but is **never imported or routed** in `src/handlers/messages.js`.
   - **Missing Pantun Implementation**: `pantun` is documented in `src/data/command-registry.js:129`, but no handler exists.
   - **Iterable TypeError in Cleanup Loop**: `src/state.js:22` and `src/state.js:30` contain `for (const [jid, notes] of global.notes)` and `for (const [jid, reminders] of global.reminders)`. Both `global.notes` and `global.reminders` are Plain Objects (`{}`), not Maps. Executing `for ... of` throws `TypeError: global.notes is not iterable`, preventing periodic cleanup.
   - **Missing Service Imports & Methods**:
     - `src/services/usage-tracker.js:65` calls `getTierInfo(tier)`, which is not imported in that file.
     - `src/services/premium-users.js:71` calls `removeUser(userId)` and line 75 calls `getAllUsers()`, neither of which is defined in `premium-users.js`.

4. **Plugin Manager**:
   - `src/plugins/plugin-manager.js:55` loads `plugins/*.js`.
   - Currently includes `plugins/sample-plugin.js` defining `!hello`.
   - Hooks support `startup` and `message` events.

5. **Existing Audio & Media Infrastructure**:
   - `src/utils/audio-ptt.js` already provides `mp3BufferToPttOgg(buffer)` using fluent-ffmpeg to transcode audio to 48kHz Opus Ogg with duration clamping.
   - `src/services/media.js` already configures fluent-ffmpeg filters for stickers and videos.

---

## 2. Logic Chain

1. **From Observations 1 & 2 to Routing Architecture Assessment**:
   - Command dispatch is a monolithic `switch`/`if-else` chain inside `src/handlers/messages.js`. While functional, new features must follow the pattern of extracting business logic into `src/commands/<feature>.js` and registering a concise call inside `messages.js` to avoid cluttering the dispatcher.
   - Permission handling clearly delineates `isAdmin` (bot owner) vs `_localGroupAdminFlag` (group admin). Any group moderation additions (`kick`, `promote`, `demote`, `hidetag`, `linkgc`) cleanly map to `_localGroupAdminFlag || isAdmin`.

2. **From Observation 3 to Baseline Fix Requirements**:
   - The user/owner expects advertised commands (`!broadcast`, `!darkjokes`, `!pantun`) to work. Leaving them disconnected or unimplemented degrades user trust.
   - Fixing `state.js` object iteration (`Object.entries(global.notes)`) prevents memory leaks from uncleaned notes/reminders.
   - Supplying missing functions in `premium-users.js` and imports in `usage-tracker.js` resolves Admin API 500 errors.

3. **From Observations 4 & 5 to High-Impact Feature Selection**:
   - **Group Moderation (`!kick`, `!promote`, `!demote`, `!hidetag`, `!linkgc`)**: Requires only native Baileys functions already in use (`groupParticipantsUpdate`, `groupInviteCode`, `sendMessage` with `mentions`). Adds massive utility for group managers with zero new npm packages.
   - **Sticker to Image (`!toimg`)**: WhatsApp stickers are WebP; Baileys downloads the buffer via `downloadContentFromMessage(stickerMessage, 'image')`, and existing fluent-ffmpeg converts WebP to PNG without new dependencies.
   - **Jadwal Sholat & Al-Qur'an (`!sholat`, `!quran`)**: Directly addresses user requests noted in `src/commands/lapor.js`, utilizing existing `axios` to query free public APIs.
   - **Text-to-Speech Voice Notes (`!tts`)**: Uses Google TTS via `axios` and leverages the existing `mp3BufferToPttOgg` Opus pipeline in `src/utils/audio-ptt.js`.
   - **Owner Broadcast (`!broadcast` / `!bc`)**: Implements the promised owner command by iterating `sock.groupFetchAllParticipating()` with a 1500ms safety throttle.

---

## 3. Caveats

1. **Baileys Group Privileges**: The bot cannot kick, promote, or demote participants if the bot itself is not an administrator of the group. Handlers must gracefully catch `403/Forbidden` errors and inform the user.
2. **Rate Limiting on Broadcast**: WhatsApp actively bans accounts that broadcast messages too rapidly. The broadcast implementation must enforce a strict throttle delay (min 1500ms) between group sends.
3. **External API Availability**: APIs for `!sholat` and `!quran` rely on external network access; graceful error fallbacks must be in place.
4. **Read-Only Scope**: This agent operates under read-only exploration rules. No source files have been modified. Implementation is handed off to the implementation phase.

---

## 4. Conclusion

The LuxxBot codebase is stable, feature-rich, and well-structured, but has distinct functional gaps in group moderation, media symmetry, localized daily utility, and several orphaned/unrouted features.

### Recommended Implementation Roadmap:
1. **Fix Baseline Discrepancies**:
   - Connect `!darkjokes` from `src/commands/darkjokes.js`.
   - Implement `!pantun`.
   - Fix `src/state.js` Object iteration bug for notes and reminders.
   - Fix `usage-tracker.js` and `premium-users.js` missing imports/helpers.
2. **Implement Top High-Impact Enhancements**:
   - **P1: Group Moderation Suite** (`!kick`, `!promote`, `!demote`, `!hidetag`, `!linkgc`) in `src/commands/group-admin.js`.
   - **P1: Sticker-to-Image Converter** (`!toimg`) in `src/commands/toimg.js`.
   - **P1: Jadwal Sholat & Qur'an Utility** (`!sholat`, `!quran`) in `src/commands/islami.js`.
   - **P2: Text-to-Speech Voice Notes** (`!tts`) in `src/commands/tts.js`.
   - **P2: Owner Broadcast Suite** (`!broadcast`, `!bc`) in `src/commands/broadcast.js`.
3. **Register All New Commands**:
   - Update `menu.js` and `src/data/command-registry.js`.
   - Update `src/handlers/messages.js`.
4. **Automated Offline Test Script**:
   - Build `scripts/test-commands.mjs` verifying command execution, permission boundaries, and mock response validation without requiring active WhatsApp pairing.

---

## 5. Verification Method

To independently verify the observations and conclusions:
1. **Verify Disconnected Handlers**:
   - Inspect `src/commands/darkjokes.js` — observe complete implementation.
   - Inspect `src/handlers/messages.js` — observe absence of `darkjokes` import or routing.
   - Inspect `src/handlers/messages.js:281` — observe `broadcast` and `bc` in `ownerCommands` list, but absence of execution blocks.
2. **Verify `state.js` Bug**:
   - Inspect `src/state.js:22,30` — observe `for (const [jid, notes] of global.notes)`.
   - Inspect `src/globals.js:4` and `src/utils/global-store.js:17` — observe `global.notes = {}`.
   - In Node.js REPL: `const obj = {}; for (const [k, v] of obj) {}` → verifies `TypeError: obj is not iterable`.
3. **Verify Audio PTT Pipeline**:
   - Inspect `src/utils/audio-ptt.js` — observe `mp3BufferToPttOgg(buffer)` configured with `libopus` and 48kHz frequency.
4. **Smoke Test Execution**:
   - Run `npm run test:smoke` or `node scripts/test-smoke.mjs` to check server baseline health when server is active.
