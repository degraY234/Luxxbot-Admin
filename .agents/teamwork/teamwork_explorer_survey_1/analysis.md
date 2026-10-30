# Luxx WhatsApp Bot — Architectural Survey & System Diagnosis

**Target System**: LuxxBot Premium (v3.2.0)  
**Workspace**: `C:\Users\DoxxBorx\Project Bot Wa`  
**Runtime**: Node.js v20.20.2 (ESM) · Windows NT 10.0  
**Core Technologies**: Baileys v6.7.23, Express 5.2.1 (Port 3920), PM2, SQLite (`better-sqlite3` 8.4.0), Discord.js 14.26.4, fluent-ffmpeg, Google GenAI, OpenAI.

---

## 1. Executive Summary

LuxxBot is a hybrid, multi-service WhatsApp bot and media streaming server built on Node.js ESM. Beyond typical WhatsApp auto-response capabilities, it hosts a full HTTP radio streaming server, an admin management dashboard, watch party capabilities (Luxx Watch with LK21 scraper), Discord voice bridge, and multi-provider AI text/image generation.

### Primary Strengths
- **Resilient WhatsApp Auth & Reconnect Loop**: Automated credential backup/restore mechanisms in `src/utils/wa-session.js` and dual watchdogs (`handlerWatchdog`, `connectionWatchdog`) prevent persistent dropped states.
- **Rich Multi-Service Integration**: Unified Express server integrates WhatsApp QR pairing, internet radio with lyrics prefetching, YouTube audio downloading, Discord voice streaming, and an admin REST API.
- **Extensible Plugin Hooking**: Lightweight plugin system (`src/plugins/plugin-manager.js`) supporting startup and message hooks.

### Critical Vulnerabilities & Architectural Bottlenecks Discovered
1. **Broken Admin API Endpoints (`ReferenceError`)**: `src/services/premium-users.js` references `getAllUsers()` and `removeUser()`, neither of which are defined or imported in the file. Calling `GET /admin/api/premium-users` or `DELETE /admin/api/premium-users` throws unhandled 500 exceptions.
2. **Silent Failure in State Cleanup (`TypeError: global.notes is not iterable`)**: In `src/state.js`, `pruneExpiredNotes()` and `pruneExpiredReminders()` attempt `for (const [jid, notes] of global.notes)`, but `global.notes` and `global.reminders` are plain JavaScript objects (`{}`), not `Map` instances. The resulting `TypeError` is swallowed silently by `catch (_) {}`, completely disabling cleanup.
3. **Monolithic Message Handler (`src/handlers/messages.js` — 1,375 lines)**: Core commands like notes CRUD, timers, polling, games, and developer tools are deeply coupled in the single upsert listener instead of modular command files.
4. **Ephemeral Timers Lost on Restart**: Voting timers and `!reminder` notifications rely on in-memory `setTimeout` handles. Any PM2 restart or container restart permanently drops pending reminders and active vote terminations.
5. **Security Hole on Pairing Endpoint**: `POST /pair/reset` is completely unauthenticated and accessible publicly, allowing any external actor to wipe WhatsApp credentials and sever bot connection.
6. **Zero Automated Unit/Integration Tests**: No test runner (Jest, Mocha, Vitest, or Node test) is configured. Only an end-to-end HTTP smoke test (`scripts/test-smoke.mjs`) requiring a live internet connection and running bot exists.

---

## 2. Project Structure & Dependency Map

### 2.1 File System Organization

```
Project Bot Wa/
├── index.js                     # Main entry point: initializes Express, mounts services, boots WA
├── menu.js                      # Menu builders (section-based UI for WhatsApp)
├── ecosystem.config.cjs         # PM2 configuration (luxx and luxx-tunnel apps)
├── package.json                 # Project dependencies, scripts, engines (Node 20.x, type: module)
├── .env / .env.example          # Environment secrets, model keys, ports, tokens
│
├── admin/                       # Frontend web dashboard (static HTML/CSS/JS)
│   ├── index.html               # Admin control panel UI
│   ├── css/ & js/               # Static styling and dashboard scripts
│   └── luxx-bot-url.json        # Resolved tunnel and LAN URLs
│
├── portfolio/                   # Portfolio web assets and web radio player
│   ├── index.html               # Creator portfolio
│   └── radio.html               # Web radio audio player
│
├── watch/                       # Luxx Watch frontend
│   └── index.html               # Movie player & sync UI
│
├── data/                        # Persistent local data
│   ├── luxxbot.sqlite3          # SQLite database (WAL mode, kv_store table)
│   ├── changelog.json           # Bot version changelog
│   └── group-settings.json      # Group welcome message configurations
│
├── session/                     # Baileys multi-file authentication state
│   ├── creds.json               # WhatsApp credentials and device identity
│   └── pre-key-*.json           # E2EE session keys
│
├── plugins/                     # External plugin extensions
│   └── sample-plugin.js         # Example plugin template
│
├── scripts/                     # Automation, deploy, and operational utilities
│   ├── test-smoke.mjs           # HTTP smoke test against running server
│   ├── test-discord-voice.mjs   # Discord voice Opus pipeline verification
│   ├── pm2-start-all.mjs        # Production startup orchestration
│   ├── radio-tunnel-daemon.mjs  # Cloudflare quick tunnel supervisor
│   └── ensure-pm2-tunnel.mjs    # Tunnel validation script
│
└── src/                         # Core source code
    ├── config.js                # Environment config, AI SDK initializers
    ├── globals.js               # Global state defaults (activeVotes, playSession, etc.)
    ├── luxx-bot.js              # Baileys socket initialization & connection lifecycle
    ├── state.js                 # In-memory bot modes, cooldowns, AI context
    ├── wa-status.js             # WhatsApp health telemetry object
    ├── commands/                # Individual modular command handlers (22 files)
    │   ├── music.js, dl.js, sticker.js, anime.js, status.js, help-cmd.js, etc.
    ├── handlers/                # Baileys event dispatchers
    │   ├── messages.js          # Core message event listener (1,375 lines)
    │   └── group-events.js      # Group participant updates (welcome message)
    ├── services/                # Business logic and subsystems (43 files)
    │   ├── radio-server.js      # Express radio routes, audio queue, playback loop
    │   ├── admin-api.js         # Authenticated admin REST API
    │   ├── discord-radio.js     # Discord client, voice channel bot, Opus piping
    │   ├── ai.js / ai-context.js# LLM cascade (Gemini -> Groq -> Grok -> OpenAI)
    │   ├── lk21.js              # LK21 scraping and stream resolver
    │   ├── guardian.js          # Background health & config file watcher
    │   ├── premium-users.js     # User subscription limits & tiers (contains runtime bugs)
    │   └── wa-qr.js             # Web pair page generation and QR PNG publisher
    └── utils/                   # Shared utilities (31 files)
        ├── persistence.js       # SQLite / Redis KV abstraction
        ├── global-store.js      # Synchronization between globals and persistence
        ├── ytdlp-download.js    # yt-dlp execution & audio extraction
        ├── listen-port.js       # Port resolution (3920 vs Railway PORT)
        └── wa-session.js        # Session health checks, backups, and restores
```

### 2.2 Key Dependencies & Runtime Scripts

- **Runtime Engine**: Node 20.x, `"type": "module"`.
- **Primary Dependencies**:
  - WhatsApp: `@whiskeysockets/baileys` (^6.7.23), `@hapi/boom` (^10.0.1), `qrcode`, `qrcode-terminal`
  - Storage: `better-sqlite3` (^8.4.0), `redis` (^4.6.7)
  - Web Server: `express` (^5.2.1), `axios` (^1.17.0), `cheerio` (^1.2.0)
  - Media & Audio: `ffmpeg-static` (^5.3.0), `fluent-ffmpeg` (^2.1.3), `wa-sticker-formatter` (^4.4.4), `yt-search` (^2.13.1), `@distube/ytdl-core` (^4.16.12)
  - Discord Voice: `discord.js` (^14.26.4), `@discordjs/voice` (^0.19.2), `@discordjs/opus` (^0.10.0), `sodium-native` (^5.1.0)
  - Artificial Intelligence: `@google/genai` (^2.8.0), `openai` (^4.104.0)
- **NPM Scripts**:
  - `npm start`: `node index.js`
  - `npm run pm2:start:all`: `node scripts/pm2-start-all.mjs`
  - `npm run pm2:restart:all`: `pm2 restart ecosystem.config.cjs --update-env`
  - `npm run test:smoke`: `node scripts/test-smoke.mjs`

---

## 3. Baileys v6.7.23 Connection & Event Architecture

### 3.1 Socket Initialization
Socket configuration resides in `src/luxx-bot.js` (`startLuxxBot`):
```javascript
sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: authState, // useMultiFileAuthState('./session')
    browser: [BOT_NAME, 'Chrome', '1.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 30_000
});
```

### 3.2 State Machine & Reconnect Logic
1. **Creds Update (`creds.update`)**: Calls `flushCreds()` which writes to `./session/creds.json` and creates a redundant copy in `./backup/` or `/app/persist/session-backup/` via `backupWaSession()`.
2. **Connection Update (`connection.update`)**:
   - `qr`: Generates QR buffer via `qrcode`, writes to `temp/wa-qr.png` and `temp/wa-qr-meta.json`, updating `/pair` web page.
   - `connection === 'open'`:
     - Resets `reconnectCount = 0`.
     - Flushes credentials and logs session diagnostics.
     - Starts `handlerWatchdog` (polls every 20s if handlers fail to mount).
     - Starts `connectionWatchdog` (polls every 25s if session is paired but connection is closed).
     - Calls `loadServicesAndHandlers(sock)` dynamically.
   - `connection === 'close'`:
     - Evaluates `lastDisconnect.error?.output?.statusCode`.
     - If `statusCode === DisconnectReason.loggedOut` (401): Tears down socket, calls `clearWaSession({ includeBackup: true })`, and schedules clean QR pairing restart after 3000ms.
     - If `statusCode === DisconnectReason.restartRequired` (515, pairing transition): Flushes credentials immediately and reconnects after 1500ms.
     - For network dropouts: Applies incremental backoff `Math.min(delayMs + reconnectCount * 2000, 45_000)`.

### 3.3 Event Registration & Dispatch Flow
- **Registration**: Once connection is open, `loadServicesAndHandlers(sock)` calls `registerMessageHandler(sock)` in `src/handlers/messages.js` and `registerGroupEventHandler(sock)` in `src/handlers/group-events.js`.
- **Listener Deduplication**: Both handlers store `boundMessageSock` and remove previous listeners via `sock.ev.removeAllListeners('messages.upsert')` to prevent memory leaks across reconnects.
- **Message Parsing Flow**:
  1. Filter non-notify message events (`chatUpdate.type !== 'notify'`).
  2. Discard self-messages (`msg.key.fromMe`) and system stubs (`msg.messageStubType`).
  3. Extract body across `conversation`, `extendedTextMessage`, `imageMessage.caption`, `videoMessage.caption`.
  4. Detect active interactive session picks (`isSpPick`, `isPlayPick`, `isSastraPick`) before prefix checks.
  5. Check group Anti-Link rule (`chat.whatsapp.com` regex match); kick non-admin violators if bot has admin rights.
  6. Command extraction: Prefix `!`, normalized against `COMMAND_ALIASES` (`mrnu` -> `menu`, `radlo` -> `radio`, `ply` -> `play`, etc.).
  7. Per-user cooldown check (5 seconds default via `checkCommandCooldown(sender)`).
  8. Admin authorization check: verifies sender number against `OWNER_NUMBER` array in `src/config.js`.
  9. Plugin hook dispatch: `dispatchHook('message', ...)` executed before command resolution.
  10. Dispatch to command handler: matches command and routes to command function or executes inline handler.

---

## 4. Express Server & Dashboard (Port 3920)

### 4.1 Server Startup & Port Binding
- Defined in `index.js` (lines 43-48) and `src/utils/listen-port.js`.
- Port resolution priority:
  1. If running under Railway (`RAILWAY_ENVIRONMENT` set), uses `process.env.PORT`.
  2. Otherwise, uses `process.env.RADIO_PORT || process.env.PORT || 3920`.
- Binds to `0.0.0.0` (configurable via `RADIO_BIND_HOST`).
- Middleware applied: `express.json({ limit: '1mb' })`, `trust proxy: true`, CORS handler (`src/utils/app-cors.js`).

### 4.2 Endpoint & Route Mapping

| Route | Method | Auth | Description |
|---|---|---|---|
| `/health` | GET | Public | Health diagnostic JSON (WA status, uptime, radio status, session state) |
| `/pair` | GET | Public | Interactive pairing web page (laptop screen / mobile scanner) |
| `/pair/status` | GET | Public | Polling endpoint for pairing page status |
| `/pair/qr.png` | GET | Public | Serves active QR image buffer |
| `/pair/reset` | POST | **None (VULNERABILITY)** | Wipes session credentials and restarts Baileys |
| `/admin` | GET | Public | Serves static `admin/index.html` dashboard UI |
| `/admin/api/status` | GET | Bearer Token | System status, RAM, CPU, radio, Discord diagnostics |
| `/admin/api/ops` | GET | Bearer Token | Cloudflare tunnel status, LAN URL, PM2 status |
| `/admin/api/system` | GET | Bearer Token | Detailed OS, disk, and Node diagnostics |
| `/admin/api/guardian` | GET | Bearer Token | Alerts from health checker & config watcher |
| `/admin/api/guardian/ack`| POST | Bearer Token | Acknowledge active guardian alert |
| `/admin/api/premium-users` | GET/POST/DEL | Bearer Token | Manage premium numbers (**Currently broken with ReferenceError**) |
| `/admin/api/cache/prune` | POST | Bearer Token | Force clear temporary buffers and garbage collection |
| `/admin/api/queue` | GET | Bearer Token | Current radio playback and queue list |
| `/admin/api/play`, `/pause`, `/resume`, `/skip`, `/clear` | POST | Bearer Token | Radio playback controls |
| `/admin/api/restart` | POST | Bearer Token | Spawns `pm2 restart luxx --update-env` |
| `/radio/api/config` | GET | Public | Audio configuration, LAN URL, public tunnel URL |
| `/radio/api/now` | GET | Public | Real-time playing track, duration, queue, cached lyrics |
| `/radio/api/search` | GET | Public | YouTube track search via `yt-search` |
| `/radio/api/queue/add` | POST | Public | Enqueue audio track via URL |
| `/radio/api/queue/bulk-add` | POST | Public | Enqueue multiple tracks (e.g. playlist) |
| `/watch/*` | GET/POST | Public | Luxx Watch UI, room management, LK21 video proxy streaming |
| `/portfolio/*` | GET | Public | Static portfolio page and web radio UI |

### 4.3 Security & Auth Analysis
- **Admin Auth Mechanism**: `requireAdmin` in `src/services/admin-api.js` validates `Authorization: Bearer <ADMIN_API_TOKEN>`. If `ADMIN_API_TOKEN` is unset in `.env`, the admin API returns `503 Service Unavailable`.
- **Critical Exposure**: `/pair/reset` permits unauthenticated `POST` requests. A malicious actor scanning the public port or tunnel can wipe active bot sessions at will.
- **Unrestricted Radio Controls**: Public `/radio/api/queue/add` and bulk-add endpoints lack rate-limiting or anti-abuse protection, making them susceptible to queue flooding.

---

## 5. Process Lifecycle & Environment Management

### 5.1 PM2 Configuration (`ecosystem.config.cjs`)
```javascript
module.exports = {
    apps: [
        {
            name: 'luxx',
            script: 'index.js',
            cwd: __dirname,
            interpreter: 'node',
            windowsHide: true,
            autorestart: true,
            max_restarts: 100,
            min_uptime: '10s',
            restart_delay: 4000,
            watch: false,
            exp_backoff_restart_delay: 2000,
            env: {
                NODE_ENV: 'production',
                PM2_APP_NAME: 'luxx',
                NODE_OPTIONS: '--max-old-space-size=4096'
            }
        },
        {
            name: 'luxx-tunnel',
            script: 'scripts/radio-tunnel-daemon.mjs',
            cwd: __dirname,
            interpreter: 'node',
            windowsHide: true,
            autorestart: true,
            max_restarts: 50,
            min_uptime: '15s',
            restart_delay: 8000,
            watch: false,
            env: { NODE_ENV: 'production' }
        }
    ]
};
```

### 5.2 Error Handling & Graceful Shutdown
- **Global Handlers** (`index.js:14-19`):
  - `process.on('uncaughtException')`: Logs error to console without terminating process (`server tetap jalan`).
  - `process.on('unhandledRejection')`: Logs reason without exiting.
- **Process Signals** (`index.js:20-39`):
  - `SIGINT` / `SIGTERM`: Clears radio queue, invokes `stopDiscordRadio()`, and terminates cleanly (`process.exit(0)`).
- **Environment Flags**:
  - `NODE_OPTIONS: '--max-old-space-size=4096'`: Allocates 4GB heap space to accommodate media buffering, Canvas operations, and Discord voice Opus encoding.
  - `LUXX_AUTO_START` & `LUXX_AUTO_TUNNEL`: Flags controlling background child process behavior.

---

## 6. Test Infrastructure Audit & Offline Verification Strategy

### 6.1 Current Test Audit
- **Unit Tests**: None.
- **Integration Tests**: None.
- **Mock Frameworks**: None installed.
- **Existing Scripts**:
  - `scripts/test-smoke.mjs`: Live integration test requiring an actively listening server (checks `/health`, `/radio/api/config`, `/radio/api/search`, `/admin/api/ops`).
  - `scripts/test-discord-voice.mjs`: Audio pipeline test verifying `ffmpeg` can pipe Opus frames to stdout from an existing MP3 file in `temp/radio`.

### 6.2 Offline Test Feasibility (Node 20 Built-in Test Runner)
Because the project runs on **Node.js v20.20.2**, external test dependencies (Jest/Mocha/Vitest) are not required. The built-in `node:test` and `node:assert/strict` modules provide complete native ESM testing capabilities.

### 6.3 Mock Architecture for Baileys & Services
To verify command handlers and business logic without an active WhatsApp connection:

```javascript
// Example Mock Socket Structure
export function createMockBaileysSocket() {
    const sent = [];
    return {
        user: { id: '6282384961407:1@s.whatsapp.net' },
        sendMessage: async (jid, content, options = {}) => {
            sent.push({ jid, content, options, timestamp: Date.now() });
            return { key: { id: 'mock-msg-' + Date.now(), remoteJid: jid } };
        },
        groupMetadata: async (jid) => ({
            id: jid,
            subject: 'Test Group',
            participants: [
                { id: '6282384961407@s.whatsapp.net', admin: 'superadmin' },
                { id: '6289999999999@s.whatsapp.net', admin: null }
            ]
        }),
        groupParticipantsUpdate: async () => {},
        ev: { on: () => {}, removeAllListeners: () => {} },
        _getSent: () => sent,
        _clearSent: () => { sent.length = 0; }
    };
}
```

This allows offline unit tests for:
1. **Command Resolution & Formatting**: Testing `handleHelpCommand`, `handleStatusCommand`, `handleAboutLuxCommand`, `handleQuoteCommand`, `handleTranslateCommand`, `handleAnimeCommand`, etc.
2. **Access Control**: Verifying admin commands reject non-owners and allow designated owners.
3. **Database Operations**: Testing `persistence.js` (SQLite in-memory `:memory:` or temp file) KV set/get/delete.
4. **Subscription Logic**: Testing `subscription-manager.js` duration calculations, tier checks, and expiry transitions.
5. **Express Routes**: Testing `/health`, `/pair/status`, `/admin/api/ops` by passing a dummy app or using native `fetch` on a dynamic port (`app.listen(0)`).

---

## 7. Architectural Bottlenecks, Bugs, & Stability Risks

### Detailed Defect Catalog

#### Defect 1: Critical ReferenceError in `src/services/premium-users.js`
- **Location**: `src/services/premium-users.js:70-76`
- **Code**:
  ```javascript
  export function removePremiumUser(userId) {
      return removeUser(userId); // ReferenceError: removeUser is not defined
  }
  export function getPremiumUsers() {
      return getAllUsers(); // ReferenceError: getAllUsers is not defined
  }
  ```
- **Impact**: Any admin calling `GET /admin/api/premium-users` or `DELETE /admin/api/premium-users` encounters a 500 internal server error.
- **Fix Required**: Implement `getAllUsers()` and `removeUser()` operating on `readDb()` / `writeDb()`.

#### Defect 2: TypeError in Background Cleanup Routine
- **Location**: `src/state.js:19-34`
- **Code**:
  ```javascript
  function pruneExpiredNotes() {
      if (!global.notes) return;
      const now = Date.now();
      for (const [jid, notes] of global.notes) { // TypeError: global.notes is not iterable
          global.notes[jid] = notes.filter(n => now - new Date(n.updated).getTime() < MAX_NOTES_AGE_MS);
      }
  }
  ```
- **Cause**: `global.notes` and `global.reminders` are plain JavaScript objects (`{}`), not `Map` instances (defined in `src/globals.js:4-5`).
- **Impact**: When `startGlobalCleanup()` runs every 30 minutes, `for (const [jid, notes] of global.notes)` throws `TypeError`. The `catch (_) {}` block swallows it, aborting reminder and cooldown cleanup silently.
- **Fix Required**: Change loops to `for (const [jid, notes] of Object.entries(global.notes || {}))` and `for (const [jid, reminders] of Object.entries(global.reminders || {}))`.

#### Defect 3: In-Memory Volatility of Timers (`reminders` & `voting`)
- **Location**: `src/handlers/messages.js:516-523` and `1050-1064`
- **Problem**: Long-running user timers (`!reminder add 2h ...`) schedule a JS `setTimeout`. If PM2 restarts, restarts during updates, or crashes occur, all pending timers disappear without notification.
- **Fix Required**: Store reminder timestamps in SQLite and run an active periodic scheduler (e.g. check every 30s) that sends overdue reminders and cleans them up.

#### Defect 4: Synchronous File I/O in Services
- **Location**: `src/services/subscription-manager.js:9,17`, `src/services/premium-users.js:9,17`, `src/services/group-welcome.js:12,24`
- **Problem**: Heavy use of synchronous `fs.readFileSync` and `fs.writeFileSync` in hot command paths blocks the single Node.js event loop during concurrent chat activity.
- **Fix Required**: Migrate persistent models to the existing SQLite `better-sqlite3` database (`data/luxxbot.sqlite3`), taking advantage of SQLite WAL mode for fast concurrent non-blocking reads.

#### Defect 5: Unauthenticated Destructive Endpoint (`/pair/reset`)
- **Location**: `src/services/wa-qr.js:242-251`
- **Problem**: `POST /pair/reset` requires no credentials or session tokens, allowing anyone with access to the URL to disconnect the bot and wipe session keys.
- **Fix Required**: Require `ADMIN_API_TOKEN` authentication or a local nonce check before executing `clearWaSession`.

---

## 8. High-Impact Structural Improvement Roadmap

1. **Phase 1: Critical Bug Fixes & Stability Hardening**
   - Fix `src/services/premium-users.js`: Define `getAllUsers()` and `removeUser()`.
   - Fix `src/state.js`: Fix plain object iteration for `global.notes` and `global.reminders`.
   - Secure `/pair/reset`: Add token validation or localhost constraint.

2. **Phase 2: Automated Testing Infrastructure**
   - Implement `tests/` directory utilizing Node 20's built-in `node --test`.
   - Build a lightweight `createMockBaileysSocket()` utility.
   - Author automated unit tests for:
     - Core command handlers (`help`, `status`, `aboutlux`, `quote`, `translate`, `sastra`, etc.)
     - Utility logic (`cooldown`, `youtube-meta`, `persistence`, `wa-session`)
     - Admin API endpoints via supertest / in-memory HTTP fetch.
   - Add `"test": "node --test tests/**/*.test.js"` script to `package.json`.

3. **Phase 3: Handler Modularization & Refactoring**
   - Extract remaining inline commands from `src/handlers/messages.js` into distinct command modules:
     - `src/commands/notes.js`
     - `src/commands/reminder.js`
     - `src/commands/voting.js`
     - `src/commands/games.js`
     - `src/commands/devtools.js`
     - `src/commands/owner.js`
   - Reduce `src/handlers/messages.js` to a clean, lightweight dispatcher (< 250 lines).

4. **Phase 4: Unified SQLite Persistence & Persistent Scheduler**
   - Unify scattered JSON stores (`subscriptions.json`, `premium-users.json`, `group-settings.json`) into structured SQLite tables within `luxxbot.sqlite3`.
   - Implement a durable timer/scheduler for reminders and group voting to eliminate timer loss across process restarts.
