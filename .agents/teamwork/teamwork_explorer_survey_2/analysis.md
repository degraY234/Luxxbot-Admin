# LuxxBot: Comprehensive Commands, Handlers, Dispatch, and Feature Enhancement Survey

## 1. Executive Summary

This investigation provides an exhaustive audit of all existing commands, handlers, plugins, feature categories, command routing, prefix handling, permission/role systems, and identified high-impact feature enhancements for the **LuxxBot WhatsApp bot** (v3.2.0). 

The bot is constructed on top of:
- **Node.js 20.x ESM** (`"type": "module"`)
- **Baileys v6.7.23** (`@whiskeysockets/baileys`) for WhatsApp Multi-Device protocol communication
- **better-sqlite3 v8.4.0** with WAL mode as local persistent key-value store (`./data/luxxbot.sqlite3`) and optional Redis fallback
- **Express v5.2.1** for internal web APIs, radio streaming, admin dashboard (`/admin`), and Watch2Gether sync
- **Discord.js v14.26.4** & `@discordjs/voice` with Opus audio piping for Discord voice sync
- **AI Integrations**: Google GenAI (`@google/genai` Gemini 2.5 Flash / Flash Lite), OpenAI (`openai`), Grok/xAI, and Groq.com

### Key Strategic Findings:
1. **Command Structure**: LuxxBot currently features over 60 active commands spanning 6 user categories (*Umum*, *AI*, *Musik*, *Hiburan*, *Media*, *Games*) and 1 *Owner* category.
2. **Latent Bugs & Phantom Commands**:
   - `!broadcast` and `!bc`: Explicitly documented in `menu.js` (lines 101-102) and guarded in `messages.js` `ownerCommands` list (line 281), but **has no implementation handler** anywhere in the codebase.
   - `!darkjokes`: Fully coded in `src/commands/darkjokes.js` and registered in `src/data/command-registry.js`, but **never imported or routed** in `src/handlers/messages.js`.
   - `!pantun`: Advertised in `src/data/command-registry.js` (line 129), but **lacks an implementation**.
   - `src/state.js` Cleanup Bug: Lines 22 & 30 use `for (const [jid, notes] of global.notes)` where `global.notes` is an Object (`{}`), throwing a runtime `TypeError: global.notes is not iterable` (currently hidden by empty `catch (_) {}`).
   - `src/services/usage-tracker.js`: Function `checkUsageLimit` calls `getTierInfo(tier)` (line 65), but `getTierInfo` is **not imported** in the file.
   - `src/services/premium-users.js`: Functions `removePremiumUser` and `getPremiumUsers` call undefined functions `removeUser` and `getAllUsers`, causing `ReferenceError` when called from Admin API.
3. **High-Impact Feature Opportunities**:
   - **Group Moderation Suite**: The bot has `!add` and `!tagall`, but critically lacks essential group moderation commands (`!kick`, `!promote`, `!demote`, `!hidetag`, `!linkgc`).
   - **Sticker to Image (`!toimg`)**: Highly demanded conversion tool that mirrors `!s` by converting quoted stickers back to viewable PNG/JPEG images via ffmpeg.
   - **Islamic Utility Suite (`!sholat`, `!quran`)**: Specifically requested in `src/commands/lapor.js` documentation; vital for the primary Indonesian user demographic.
   - **Text-to-Speech Audio PTT (`!tts`)**: Direct generation of voice notes using existing `mp3BufferToPttOgg` opus pipeline.
   - **Owner Broadcast (`!broadcast` / `!bc`)**: Fulfilling the missing owner command with throttled delivery across participating groups.

---

## 2. Complete Catalog of Existing Commands, Handlers, and Plugins

### 2.1 Category Breakdown Overview

| Category | Primary Prefix | Trigger Count | Target Scope | Permission Required |
|---|---|---|---|---|
| **Umum (General)** | `!` | 17 commands | Private / Group | User / Group Admin |
| **AI & Coding** | `!` | 11 commands | Private / Group | User |
| **Musik & Radio** | `!` | 7 commands | Private / Group | User / Owner (`!stop`) |
| **Hiburan (Fun)** | `!` | 6 commands | Private / Group | User |
| **Media & Tools** | `!` | 11 commands | Private / Group | User / Premium (`!s`, `!dl`, `!buat`) |
| **Games & Polling**| `!` | 5 commands | Private / Group | User / Group Admin (`!endvoting`) |
| **Owner / VIP** | `!` | 16 commands | Private / Group | Bot Owner (`OWNER_NUMBER`) |
| **Plugins** | `!` | Dynamic (1 loaded) | Dynamic | Configurable per plugin |

---

### 2.2 Detailed Inventory of Every Command

#### A. Category: UMUM (General & Utilities)
1. **`!menu` / `!mrnu` / `!loot`**
   - *Handler*: Inline in `src/handlers/messages.js` lines 293–320 calling `menu.js`
   - *Arguments*: `[section]` (e.g. `umum`, `ai`, `musik`, `hiburan`, `media`, `games`, `owner`)
   - *Behavior*: If section provided, renders specific section menu. If empty, displays main banner, bot status, and 3 interactive Baileys buttons (`Umum`, `Musik`, `Games`).
   - *Permissions*: Anyone. Owner section only shown if user is owner.
2. **`!help` / `!halp`**
   - *Handler*: `src/commands/help-cmd.js` (`handleHelpCommand`)
   - *Arguments*: `[command_name]`
   - *Behavior*: Queries `src/data/command-registry.js`. Returns command title, description, usage, and examples.
   - *Permissions*: Anyone.
3. **`!guide` / `!start` / `!panduan`**
   - *Handler*: `src/commands/guide.js` (`handleGuideCommand`)
   - *Arguments*: None
   - *Behavior*: Introductory guide with popular features, creator bio, and usage tips.
   - *Permissions*: Anyone.
4. **`!status`**
   - *Handler*: `src/commands/status.js` (`handleStatusCommand`)
   - *Arguments*: None
   - *Behavior*: Reports WhatsApp connection status, sleeping/self mode, anti-link, uptime, RAM consumption, radio playback & queue length, and Discord voice diagnostics.
   - *Permissions*: Anyone.
5. **`!aboutlux` / `!about`**
   - *Handler*: `src/commands/aboutlux.js` (`handleAboutLuxCommand`)
   - *Arguments*: None
   - *Behavior*: Sends creator photo (`assets/aboutlux-creator.jpg`), educational background, portfolio link, and feature index.
   - *Permissions*: Anyone.
6. **`!halo`**
   - *Handler*: Inline in `src/handlers/messages.js` lines 347–350
   - *Arguments*: None
   - *Behavior*: Friendly greeting response.
   - *Permissions*: Anyone.
7. **`!ping`**
   - *Handler*: Inline in `src/handlers/messages.js` lines 352–356
   - *Arguments*: None
   - *Behavior*: Computes delta between message timestamp and current server time (`Math.abs(Date.now() - timestamp * 1000)`).
   - *Permissions*: Anyone.
8. **`!changelogs` / `!changelog`**
   - *Handler*: Inline calling `src/services/changelog.js` (`buildChangelogText`)
   - *Arguments*: None
   - *Behavior*: Lists recent version changelogs combined from local JSON and git history.
   - *Permissions*: Anyone.
9. **`!tanggal` / `!date`**
   - *Handler*: Inline in `src/handlers/messages.js` lines 364–368
   - *Arguments*: None
   - *Behavior*: Formats current Jakarta time (`Asia/Jakarta`, WIB) in Indonesian locale.
   - *Permissions*: Anyone.
10. **`!warna` / `!color`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 370–374
    - *Arguments*: None
    - *Behavior*: Generates a random 6-character hex color code.
    - *Permissions*: Anyone.
11. **`!server`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 376–381
    - *Arguments*: None
    - *Behavior*: Displays platform, architecture, CPU model, total RAM, and process uptime.
    - *Permissions*: Anyone.
12. **`!notes` / `!catatan`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 386–469
    - *Arguments*: `add <text>` | `list` | `view <num>` | `edit <num> <text>` | `delete <num>` | `search <query>` | `clear`
    - *Behavior*: Full CRUD personal note-taking stored in SQLite kv_store (`global.notes[from]`).
    - *Permissions*: Anyone (chat-scoped).
13. **`!reminder` / `!pengingat`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 474–561
    - *Arguments*: `add <time> <msg>` | `list` | `delete <id>` | `clear`
    - *Time formats*: `30m`, `2h`, `1d`, `HH:MM`
    - *Behavior*: Schedules `setTimeout` notification and persists in `global.reminders[from]`.
    - *Permissions*: Anyone.
14. **`!welcome`**
    - *Handler*: `src/commands/welcome.js` (`handleWelcomeCommand`)
    - *Arguments*: `on` | `off` | `set <template>` | `preview`
    - *Behavior*: Configures automatic welcome greeting for new group members stored in `data/group-settings.json`.
    - *Permissions*: Group Admin or Bot Owner only.
15. **`!add`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 566–578
    - *Arguments*: `<phone_number>`
    - *Behavior*: Invokes `sock.groupParticipantsUpdate(from, [jid], 'add')`.
    - *Permissions*: Group Admin or Bot Owner only.
16. **`!tagall`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 580–594
    - *Arguments*: `[message]`
    - *Behavior*: Mentions all group members by appending `@participant` lines to message.
    - *Permissions*: Anyone in group.
17. **`!lapor` / `!report` / `!feedback`**
    - *Handler*: `src/commands/lapor.js` (`handleLaporCommand`)
    - *Arguments*: `<feedback message>`
    - *Behavior*: Forwards user feedback or bug report directly to owner WhatsApp numbers (`OWNER_NUMBER`).
    - *Permissions*: Anyone.

---

#### B. Category: AI & CHAT
18. **`!tanya`**
    - *Handler*: Inline calling `src/services/ai-context.js` (`askLuxxAI(..., 'tanya')`)
    - *Arguments*: `<question>`
    - *Behavior*: AI conversational answer using persona context, falling back across Gemini 2.5, xAI/Grok, and Groq.
    - *Permissions*: Anyone.
19. **`!q`**
    - *Handler*: Inline calling `askLuxxAI(..., 'chat_context')`
    - *Arguments*: `<text>`
    - *Behavior*: Conversational chat with retained short-term memory (up to 18 messages in `userAIContext`).
    - *Permissions*: Anyone.
20. **`!coding`**
    - *Handler*: Inline calling `askLuxxAI(..., 'coding')`
    - *Arguments*: `<prompt or code>`
    - *Behavior*: Programming assistance and explanation.
    - *Permissions*: Anyone.
21. **`!code`**
    - *Handler*: Inline calling `askLuxxAI(..., 'coding')` with code review prefix
    - *Arguments*: `<code>`
    - *Behavior*: Code debugging, review, and optimization.
    - *Permissions*: Anyone.
22. **`!db` / `!database` / `!dbdiagram`**
    - *Handler*: `src/commands/db.js` (`handleDbCommand`)
    - *Arguments*: `<project brief>`
    - *Behavior*: Generates full relational PostgreSQL DDL schema, ERD relationship text, sample REST endpoints, and query examples. Auto-chunks output to fit WhatsApp's 4096 character limit.
    - *Permissions*: Anyone.
23. **`!rangkum`**
    - *Handler*: Inline calling `askLuxxAI(..., 'rangkum')`
    - *Arguments*: `<long text>`
    - *Behavior*: Bulleted summary of provided text.
    - *Permissions*: Anyone.
24. **`!brainstorm`**
    - *Handler*: Inline calling `askLuxxAI(..., 'brainstorm')`
    - *Arguments*: `<topic>`
    - *Behavior*: Generates creative concepts and outlines.
    - *Permissions*: Anyone.
25. **`!translate` / `!tr`**
    - *Handler*: `src/commands/translate-cmd.js` (`handleTranslateCommand`)
    - *Arguments*: `<text>` or `<from> <to> <text>`
    - *Behavior*: Multi-engine translation (MyMemory, Lingva, LibreTranslate).
    - *Permissions*: Anyone.
26. **`!lihat`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 699–723
    - *Arguments*: `[optional prompt]` (reply to / caption on image)
    - *Behavior*: Downloads image buffer from message and queries Gemini Vision (`gemini-2.5-flash-lite`) to analyze image contents.
    - *Permissions*: Anyone.
27. **`!resetai`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 810–816
    - *Arguments*: None
    - *Behavior*: Purges conversational memory keys for the current chat from `userAIContext`.
    - *Permissions*: Anyone.
28. **`!fact`**
    - *Handler*: Inline calling `askLuxxAI(..., 'fact')`
    - *Arguments*: None
    - *Behavior*: Returns an intriguing random trivia fact.
    - *Permissions*: Anyone.
29. **`!curhat`**
    - *Handler*: Inline calling `askLuxxAI(..., 'curhat')`
    - *Arguments*: `<story/confession>`
    - *Behavior*: Empathetic personal listener persona.
    - *Permissions*: Anyone.
30. **`!roastme`**
    - *Handler*: Inline calling `askLuxxAI(..., 'curhat')` with sarcastic roast prompt
    - *Arguments*: `[target]`
    - *Behavior*: Humorous, polite roasting.
    - *Permissions*: Anyone.

---

#### C. Category: MUSIK & RADIO
31. **`!play` / `!ply` / `!musik`**
    - *Handler*: `src/commands/music.js` (`handlePlayCommand`)
    - *Arguments*: `<song title or YouTube URL>`
    - *Behavior*: Direct YouTube URL adds to radio queue immediately. Search queries return top 5 results, saving session into `global.playSession[from]`. Responding with numbers 1–5 triggers queue addition.
    - *Permissions*: Anyone.
32. **`!radio` / `!radlo`**
    - *Handler*: `src/commands/music.js` (`handleRadioCommand`)
    - *Arguments*: None
    - *Behavior*: Sends web player URL, current track, and queue status.
    - *Permissions*: Anyone.
33. **`!nowplaying` / `!np`**
    - *Handler*: `src/commands/discord-cmd.js` (`handleNowPlayingCommand`)
    - *Arguments*: None
    - *Behavior*: Returns title, requester, and duration of the currently playing radio track.
    - *Permissions*: Anyone.
34. **`!queue`**
    - *Handler*: `src/commands/music.js` (`handleQueueCommand`)
    - *Arguments*: None
    - *Behavior*: Displays up to 12 upcoming queued songs with duration and requesters.
    - *Permissions*: Anyone.
35. **`!skip` / `!next`**
    - *Handler*: `src/commands/music.js` (`handleSkipCommand`)
    - *Arguments*: None
    - *Behavior*: Advances radio playback to next item in queue.
    - *Permissions*: Anyone.
36. **`!stop`**
    - *Handler*: `src/commands/music.js` (`handleStopCommand`)
    - *Arguments*: None
    - *Behavior*: Clears radio queue and terminates active playback.
    - *Permissions*: Bot Owner only (`isAdmin`).
37. **`!lirik` / `!lyrics`**
    - *Handler*: `src/commands/music.js` (`handleLyricsCommand`)
    - *Arguments*: `<song title [- artist]>`
    - *Behavior*: Fetches synchronized or static lyrics via lyrics scraper service.
    - *Permissions*: Anyone.
38. **`!discord`**
    - *Handler*: `src/commands/discord-cmd.js` (`handleDiscordCommand`)
    - *Arguments*: None
    - *Behavior*: Shows Discord voice status, server count, channel name, now playing, and Discord commands list.
    - *Permissions*: Anyone.
39. **`!watch` / `!stream` / `!st` / `!nonton`**
    - *Handler*: `src/commands/watch.js` (`handleWatchCommand`)
    - *Arguments*: None
    - *Behavior*: Sends live link with rich preview for Watch2Gether / Luxx Watch co-streaming room, current film, and viewers.
    - *Permissions*: Anyone.

---

#### D. Category: HIBURAN & SASTRA (Entertainment)
40. **`!anime`**
    - *Handler*: `src/commands/anime.js` (`handleAnimeCommand`)
    - *Arguments*: `[query]` (e.g. `naruto`, `trending`, `popular`)
    - *Behavior*: AniList GraphQL search with Jikan REST v4 fallback. Returns poster image, title, score, genres, release year, episode count, status, and cleaned synopsis.
    - *Permissions*: Anyone.
41. **`!waifu`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 604–618
    - *Arguments*: None
    - *Behavior*: Fetches random anime waifu artwork from `https://nekos.best/api/v2/waifu`.
    - *Permissions*: Anyone.
42. **`!quotesanime`**
    - *Handler*: `src/commands/quotes-anime.js` (`handleQuotesAnimeCommand`)
    - *Arguments*: None
    - *Behavior*: Random anime quote with character, anime title, and Indonesian translation. 8s cooldown.
    - *Permissions*: Anyone.
43. **`!meme`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 673–696
    - *Arguments*: `[subreddit]` (defaults to `memes`)
    - *Behavior*: Fetches random meme image/video from `https://meme-api.com/gimme` with imgflip fallback.
    - *Permissions*: Anyone.
44. **`!sastra` / `!puisi`**
    - *Handler*: `src/commands/sastra.js` (`handleSastraCommand`)
    - *Arguments*: `<topic>` or `pilih <country>`
    - *Behavior*: Fetches authentic literature from Wikisource ID or PoetryDB world database with 12 selectable regions. Supports interactive numerical reply (1-12).
    - *Permissions*: Anyone.
45. **`!darkjokes` (Orphaned / Unrouted)**
    - *Handler*: `src/commands/darkjokes.js` (`handleDarkJokesCommand`)
    - *Arguments*: None
    - *Behavior*: Setup + punchline dark joke with sensitivity filter. **Note: Unrouted in `messages.js`**.
    - *Permissions*: Anyone.
46. **`!pantun` (Unimplemented)**
    - *Handler*: None.
    - *Registered in*: `src/data/command-registry.js` line 129.

---

#### E. Category: MEDIA & TOOLS
47. **`!s` / `!sticker`**
    - *Handler*: `src/commands/sticker.js` (`handleStickerCommand`)
    - *Arguments*: `[style|topText|bottomText]` (reply to image/video)
    - *Behavior*: Generates WebP sticker with 16 styling presets (`premium`, `neon`, `gold`, `cyber`, `meme`, etc.), text overlays, and video clipping up to 16MB. Requires Premium check.
    - *Permissions*: User / Premium.
48. **`!dl`**
    - *Handler*: `src/commands/dl.js` (`handleDlCommand`)
    - *Arguments*: `[mode] <url>` (`!dl <link>`, `!dl mp3 <link>`, `!dl mp4hd <link>`)
    - *Behavior*: Downloads video or audio from YouTube, TikTok, Instagram, and Facebook via yt-dlp / `@tobyg74/tiktok-api-dl`. Validates WhatsApp mobile size limits (64MB video, 16MB audio). Requires Premium check.
    - *Permissions*: User / Premium.
49. **`!buat` / `!generate`**
    - *Handler*: `src/commands/buat.js` (`handleBuatCommand`)
    - *Arguments*: `<prompt>`
    - *Behavior*: High-resolution AI image generation through FLUX/Pollinations/OpenAI/Gemini. Requires Premium check.
    - *Permissions*: User / Premium.
50. **`!sp` / `!sound` / `!soundpad`**
    - *Handler*: `src/commands/sp.js` (`handleSpCommand`)
    - *Arguments*: `<query>` | `cari <keyword>` | `trending` | `best` | `random` | `ptt <name>` | `fav` | `find <word>` | `del <name>` | `rename <old> <new>` | `info <name>`
    - *Behavior*: Comprehensive soundboard. Searches MyInstants/Pixabay/Freesound, stores up to 80 sound files per chat in local cache, sends as MP3 audio or Opus PTT voice notes. Supports interactive number reply.
    - *Permissions*: Anyone.
51. **`!quote` / `!quotes`**
    - *Handler*: `src/commands/quote.js` (`handleQuoteCommand`)
    - *Arguments*: None (random quote) or `<text> | <author> | <origin>`
    - *Behavior*: Wisdom quotes fetched from remote APIs or parsed from custom input.
    - *Permissions*: Anyone.
52. **`!cuaca` / `!weather`**
    - *Handler*: Inline calling `src/services/weather.js` (`getWeatherMessages`)
    - *Arguments*: `<city>` (e.g. `Makassar`, `Jakarta Pusat`)
    - *Behavior*: Realtime temperature, humidity, wind speed, UV index, hourly predictions, and 7-day forecast via Open-Meteo.
    - *Permissions*: Anyone.
53. **`!ocr`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 906–925
    - *Arguments*: None (reply to / caption on image)
    - *Behavior*: Optical character recognition via Gemini Vision extracting text from images.
    - *Permissions*: Anyone.
54. **`!qr`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 885–891
    - *Arguments*: `<text or url>`
    - *Behavior*: Generates QR code image via QRServer API.
    - *Permissions*: Anyone.
55. **`!kalkulator`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 871–883
    - *Arguments*: `<math expression>` (e.g. `(10 * 5) / 2`)
    - *Behavior*: Sanitizes characters to `[0-9+\-*/().%\s]` and evaluates math expressions.
    - *Permissions*: Anyone.
56. **`!stalk`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 893–904
    - *Arguments*: `<github_username>`
    - *Behavior*: Fetches GitHub user profile info (name, company, location, public repos, followers).
    - *Permissions*: Anyone.
57. **`!gitwatch`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1169–1186
    - *Arguments*: `<github_username>`
    - *Behavior*: Fetches GitHub user profile plus top 3 recently updated public repositories with star counts.
    - *Permissions*: Anyone.
58. **`!summarize`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1188–1202
    - *Arguments*: `<web_url>`
    - *Behavior*: Scrapes webpage paragraphs via Cheerio and summarizes contents using AI.
    - *Permissions*: Anyone.
59. **`!minify`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1141–1151
    - *Arguments*: `<javascript code>`
    - *Behavior*: Minifies JS code via Terser.
    - *Permissions*: Anyone.
60. **`!jsonpretty`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1153–1163
    - *Arguments*: `<json string>`
    - *Behavior*: Pretty-prints JSON with 4-space indentation.
    - *Permissions*: Anyone.
61. **`!pinghost`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1204–1215
    - *Arguments*: `<hostname>`
    - *Behavior*: Executes system ping (4 packets) and returns stdout report.
    - *Permissions*: Anyone.

---

#### F. Category: GAMES & FUN
62. **`!apakah`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 992–998
    - *Arguments*: `<question>`
    - *Behavior*: Magic 8-ball randomized answer.
    - *Permissions*: Anyone.
63. **`!kapankah`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1000–1006
    - *Arguments*: `<question>`
    - *Behavior*: Randomized future time prediction.
    - *Permissions*: Anyone.
64. **`!gacha`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 975–990
    - *Arguments*: `<Topic> | <Option A> | <Option B> | ...`
    - *Behavior*: Random choice selector with dramatic 1.5s delay.
    - *Permissions*: Anyone.
65. **`!truth`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1008–1017
    - *Arguments*: None
    - *Behavior*: Random truth question.
    - *Permissions*: Anyone.
66. **`!dare`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1019–1027
    - *Arguments*: None
    - *Behavior*: Random dare challenge.
    - *Permissions*: Anyone.
67. **`!voting`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1032–1090
    - *Arguments*: `[duration] | <Topic> | <Option 1> | <Option 2> | ...` (e.g. `!voting 10m | Makan siang | Bakso | Mie Ayam`)
    - *Behavior*: Starts custom poll. Supports duration timer (`10m`, `1h`) with automatic closing. Stores state in `global.activeVotes[from]`.
    - *Permissions*: Anyone.
68. **`!pilih`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1093–1116
    - *Arguments*: `<option_number>`
    - *Behavior*: Casts single vote for user, rejects duplicate votes from same participant, updates score & percentage tally.
    - *Permissions*: Anyone.
69. **`!endvoting`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1118–1134
    - *Arguments*: None
    - *Behavior*: Concludes voting session and outputs final tally.
    - *Permissions*: Group Admin or Bot Owner only.

---

#### G. Category: OWNER / VIP
70. **`!eval`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1221–1236
    - *Arguments*: `<javascript expression>`
    - *Behavior*: Executes JS in `"use strict"` sandbox with blacklist regex blocking `process`, `require`, `import`, `fs`, `child_process`, `exec`, `spawn`, `global`.
    - *Permissions*: Bot Owner only.
71. **`!self`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1252–1256
    - *Behavior*: Sets `state.isSelfMode = true`. Bot ignores all non-owner messages.
    - *Permissions*: Bot Owner only.
72. **`!public`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1258–1262
    - *Behavior*: Sets `state.isSelfMode = false`.
    - *Permissions*: Bot Owner only.
73. **`!turu`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1264–1268
    - *Behavior*: Sets `state.isSleeping = true`. Bot ignores non-wake commands.
    - *Permissions*: Bot Owner only.
74. **`!bangun`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1270–1275
    - *Behavior*: Wakes bot from sleep mode (`state.isSleeping = false`).
    - *Permissions*: Bot Owner only.
75. **`!antilink`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1277–1283
    - *Arguments*: `on` | `off`
    - *Behavior*: Enables or disables automatic kick of users sending `chat.whatsapp.com` links.
    - *Permissions*: Bot Owner only.
76. **`!spek`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1285–1291
    - *Behavior*: Reports OS platform, CPU model, RAM usage, and machine uptime.
    - *Permissions*: Bot Owner only.
77. **`!systeminfo`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1293–1299
    - *Behavior*: Reports detailed CPU load average, core count, and RAM breakdown.
    - *Permissions*: Bot Owner only.
78. **`!speedtest`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1301–1308
    - *Behavior*: Measures server loop latency.
    - *Permissions*: Bot Owner only.
79. **`!grup`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1310–1317
    - *Arguments*: `open` | `close`
    - *Behavior*: Sets group announcement mode (`not_announcement` vs `announcement`).
    - *Permissions*: Bot Owner only.
80. **`!join`**
    - *Handler*: `src/commands/join.js` (`handleJoinCommand`)
    - *Arguments*: `<invite link>` or quoted invite message
    - *Behavior*: Joins group via code or v4 invite payload.
    - *Permissions*: Bot Owner only.
81. **`!leave`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1323–1328
    - *Behavior*: Leaves the current group (`sock.groupLeave(from)`).
    - *Permissions*: Bot Owner only.
82. **`!block`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1330–1336
    - *Arguments*: `@user` or `<number>`
    - *Behavior*: Blocks contact on WhatsApp (`sock.updateBlockStatus(target, 'block')`).
    - *Permissions*: Bot Owner only.
83. **`!unblock`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1338–1344
    - *Arguments*: `@user` or `<number>`
    - *Behavior*: Unblocks contact on WhatsApp.
    - *Permissions*: Bot Owner only.
84. **`!refresh`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1346–1351
    - *Behavior*: Clears console and runs `global.gc()`.
    - *Permissions*: Bot Owner only.
85. **`!resetroom`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1238–1250
    - *Behavior*: Deletes `w2g_room.json`, resets W2G room and radio queue.
    - *Permissions*: Bot Owner only.
86. **`!pingsan`**
    - *Handler*: Inline in `src/handlers/messages.js` lines 1353–1367
    - *Behavior*: Stops bot process via PM2 (`pm2 stop luxx`) with process.exit fallback.
    - *Permissions*: Bot Owner only.
87. **`!broadcast` / `!bc` (Missing Handler)**
    - *Registered in*: `menu.js` (lines 101-102) & `messages.js` `ownerCommands` list (line 281).
    - *Status*: **UNIMPLEMENTED in `messages.js`**.

---

## 3. Command Dispatch Mechanism Deep-Dive

### 3.1 Message Ingestion and Normalization
In `src/handlers/messages.js`:
```javascript
sock.ev.on('messages.upsert', async (chatUpdate) => {
    if (chatUpdate.type && chatUpdate.type !== 'notify') return;
    const msg = chatUpdate.messages?.[0];
    if (!msg || !msg.message) return;
    if (msg.key.fromMe) return;
    if (msg.messageStubType) return;
```
- Only processes `notify` updates (real incoming user messages).
- Explicitly ignores `fromMe` to prevent recursive loop triggers.
- Ignores Baileys message stub types (system messages such as group subject changes, participant adds, call logs).

### 3.2 Prefix Detection & Argument Parsing
```javascript
type = Object.keys(msg.message)[0];
let body = '';
if (type === 'conversation') body = msg.message.conversation;
else if (type === 'extendedTextMessage') body = msg.message.extendedTextMessage.text;
else if (type === 'imageMessage' && msg.message.imageMessage.caption) body = msg.message.imageMessage.caption;
else if (type === 'videoMessage' && msg.message.videoMessage.caption) body = msg.message.videoMessage.caption;

text = body.trim();
command = null;
args = [];
if (text.startsWith('!')) {
    const raw = text.slice(1).trim();
    const sp = raw.indexOf(' ');
    command = (sp === -1 ? raw : raw.slice(0, sp)).toLowerCase();
    if (COMMAND_ALIASES[command]) command = COMMAND_ALIASES[command];
    const rest = sp === -1 ? '' : raw.slice(sp + 1).trim();
    args = rest
        ? (PHRASE_COMMANDS.has(command) ? [rest] : rest.split(/\s+/))
        : [];
}
```
**Key Observations:**
1. **Single Hardcoded Prefix**: Detection strictly requires `text.startsWith('!')`. Prefixes like `/`, `.`, or `#` are ignored.
2. **Phrase Commands**: For commands defined in `PHRASE_COMMANDS = new Set(['s', 'sticker', 'dl', 'quote', 'lirik', 'lyrics'])`, `args` is kept as a single string `[rest]`. This allows multi-word inputs containing pipes `|` or spaces to pass intact to sub-parsers without splitting by whitespace.
3. **Aliasing**: `COMMAND_ALIASES` catches common typos:
   - `mrnu` → `menu`
   - `halp` → `help`
   - `radlo` → `radio`
   - `ply` → `play`
   - `wath` → `watch`

### 3.3 Stateful Selection Interceptors (Pre-Dispatch Bypass)
Lines 133–198 intercept numerical replies:
```javascript
const playPickMatch = text.match(/^(?:!)?(\d{1,2})(?:[.,)\s]|$)/);
const playSession = global.playSession?.[from];
const playSessionFresh = playSession && (Date.now() - (playSession.at || 0) < 5 * 60 * 1000);
const spSession = getSpSession(from);
const sastraSession = getSastraSession(from);
const isSpPick = Boolean(spSession && playPickMatch);
const isPlayPick = Boolean(playSessionFresh && playPickMatch && !isSpPick);
const isSastraPick = Boolean(sastraSession && playPickMatch && !isSpPick && !isPlayPick);
```
- Users can respond with simple numbers (e.g. `1`, `3`, `5`) within a 5-minute window (`5 * 60 * 1000`).
- Priority resolution: `spPick` > `playPick` > `sastraPick`.
- Automatically clears the session once consumed.

### 3.4 Middleware Pipeline Execution Order

```
[Incoming Message]
       │
       ▼
[Anti-Link Check] ──────────► (If link detected & Bot is Group Admin: Kick sender & return)
       │
       ▼
[Track Group Activity] ─────► (Records recent message in group-bot-context)
       │
       ▼
[Prefix Check] ─────────────► (If no command: return)
       │
       ▼
[Global Command Cooldown] ──► (5s per sender via checkCommandCooldown. Rejects if active)
       │
       ▼
[Role & Permission Checks]
       ├─► Check Owner: OWNER_NUMBER.some(...) -> isAdmin
       └─► Check Group Admin: userParticipant?.admin === 'admin' -> _localGroupAdminFlag
       │
       ▼
[Plugin Hook: 'message'] ───► (dispatchHook to plugin listeners)
       │
       ▼
[Plugin Registry] ──────────► (getPluginCommand. If match: execute plugin handler & return)
       │
       ▼
[Self Mode Filter] ─────────► (If state.isSelfMode && !isAdmin: return)
       │
       ▼
[Sleep Mode Filter] ────────► (If state.isSleeping && !wakeCommands: send notice & return)
       │
       ▼
[Owner Commands Filter] ────► (If ownerCommands.includes(command) && !isAdmin: reject & return)
       │
       ▼
[Premium Tier Filter] ──────► (Per-command checkPremiumAccess for !s, !dl, !buat)
       │
       ▼
[Command Switch Execution] ─► (Routes to specific command handler)
```

---

## 4. Latent Codebase Bugs and Architectural Gaps

During our survey, five distinct discrepancies and latent bugs were identified:

### Bug 1: Missing Broadcast Command Handler
- **Location**: `menu.js` lines 101–102 lists `!broadcast` and `!bc`. `src/handlers/messages.js` line 281 lists `broadcast` and `bc` in `ownerCommands`.
- **Defect**: Neither `if (command === 'broadcast')` nor `if (command === 'bc')` exists in `messages.js` or in any command module. The command fails silently or reports unknown.

### Bug 2: Disconnected Dark Jokes Command
- **Location**: `src/commands/darkjokes.js` is fully implemented, exported as `handleDarkJokesCommand`, and registered in `src/data/command-registry.js` (line 39) and `menu.js` (line 161).
- **Defect**: It is **never imported** in `src/handlers/messages.js` and there is no `if (command === 'darkjokes')` branch.

### Bug 3: Missing Pantun Implementation
- **Location**: `src/data/command-registry.js` line 129 documents:
  ```javascript
  pantun: {
      title: 'Pantun Live',
      usage: '!pantun | !pantun <tema>',
      desc: 'Pantun acak dari Wikisource/puisi dunia — bukan database statis.',
      example: '!pantun cinta'
  }
  ```
- **Defect**: No command handler exists for `!pantun`.

### Bug 4: Fatal Iteration Bug in `src/state.js` Periodic Cleanup
- **Location**: `src/state.js` lines 22 & 30:
  ```javascript
  function pruneExpiredNotes() {
      if (!global.notes) return;
      const now = Date.now();
      for (const [jid, notes] of global.notes) { ... } // <--- TypeError!
  }
  function pruneExpiredReminders() {
      if (!global.reminders) return;
      const now = Date.now();
      for (const [jid, reminders] of global.reminders) { ... } // <--- TypeError!
  }
  ```
- **Defect**: `global.notes` and `global.reminders` are Plain Objects (`{}`), initialized in `src/utils/global-store.js` as `{}`. Executing `for ... of` on a plain Object throws `TypeError: global.notes is not iterable`. Because it is wrapped in `try { ... } catch (_) {}` in `startGlobalCleanup()`, the exception is swallowed, but notes and reminders are **never cleaned up**, accumulating indefinitely.
- **Fix Required**: Use `for (const [jid, notes] of Object.entries(global.notes))` and `for (const [jid, reminders] of Object.entries(global.reminders))`.

### Bug 5: Missing Imports and Functions in Premium / Usage Tracker Services
- **Location 1**: `src/services/usage-tracker.js` line 65 calls `getTierInfo(tier)`, but `getTierInfo` is never imported from `./premium-users.js`. Calling `checkUsageLimit` causes `ReferenceError: getTierInfo is not defined`.
- **Location 2**: `src/services/premium-users.js` line 71 & 75:
  ```javascript
  export function removePremiumUser(userId) {
      return removeUser(userId); // <--- ReferenceError: removeUser is not defined
  }
  export function getPremiumUsers() {
      return getAllUsers();     // <--- ReferenceError: getAllUsers is not defined
  }
  ```
  Neither `removeUser` nor `getAllUsers` exists in `premium-users.js`.

---

## 5. Evaluation of User Experience and Feature Gaps

### 5.1 Group Administration Experience
- **Current State**: Admins can only `!add`, `!welcome`, `!tagall`, and toggle `!grup open/close`.
- **The Gap**: Group admins frequently encounter unruly participants, spammers, or raid bots. Without `!kick`, admins must open WhatsApp manually. When admins want to share the group link, they cannot retrieve it through the bot (`!linkgc`). When admins want to appoint sub-moderators, they cannot promote/demote (`!promote`, `!demote`). Furthermore, `!tagall` sends a wall of phone numbers that annoys members; standard modern bots use invisible mentions (`!hidetag`).

### 5.2 Media Manipulation Experience
- **Current State**: Bot creates stickers via `!s` with 16 styling filters and text overlays.
- **The Gap**: Users frequently send stickers and want to extract the underlying image or meme to save to their camera roll or forward to other apps. A sticker-to-image converter (`!toimg`) is absent.

### 5.3 Localized Everyday Utilities (Indonesia Focus)
- **Current State**: Weather (`!cuaca`) and News (`!berita`) are available.
- **The Gap**: LuxxBot is tailored to Indonesian users (WIB timezones, Indonesian personas, Bahasa prompt engineering). In Indonesian WhatsApp groups, **Prayer Times (`!sholat`)** and **Qur'an Search (`!quran`)** are standard high-demand features. This was even cited in the bot's own documentation (`!lapor request fitur !sholat`).

### 5.4 Audio & Voice Engagement
- **Current State**: SoundPad (`!sp`) allows playback of internet memes and sound clips, and converts MP3 to PTT via `mp3BufferToPttOgg`.
- **The Gap**: Users enjoy voice communication. Adding **Text-to-Speech (`!tts`)** allows the bot to speak aloud arbitrary messages in Indonesian, English, or Japanese voice notes (PTT).

---

## 6. Prioritized High-Impact Feature Additions

We evaluated potential features based on four criteria:
1. **User Impact**: Daily utility, engagement, and group management necessity.
2. **Architectural Cleanliness**: Can be implemented without breaking existing modules.
3. **Dependency Footprint**: Zero heavy or unmaintainable dependencies (utilizing already installed packages: Baileys, axios, cheerio, fluent-ffmpeg, better-sqlite3).
4. **Offline Testability**: Handlers can be fully unit-tested with mocked socket objects.

### Priority Matrix

| Feature | Category | Impact | Complexity | Dependencies | Priority |
|---|---|---|---|---|---|
| **Group Moderation Suite** (`!kick`, `!promote`, `!demote`, `!hidetag`, `!linkgc`) | Group Admin | **Very High** | Low | Native Baileys | **P1 (Immediate)** |
| **Sticker-to-Image Converter** (`!toimg`) | Media Tool | **Very High** | Low | ffmpeg / Baileys | **P1 (Immediate)** |
| **Jadwal Sholat & Qur'an** (`!sholat`, `!quran`) | Utility | **High** | Low | axios / public APIs | **P1 (Immediate)** |
| **Text-to-Speech Voice Note** (`!tts`) | Media / Fun | **High** | Low | axios + `audio-ptt.js` | **P2 (Near-term)** |
| **Owner Broadcast Suite** (`!broadcast` / `!bc`) | Owner VIP | **High** | Medium | Native Baileys | **P2 (Near-term)** |
| **Bugfixes & Reconnections** (`!darkjokes`, `!pantun`, `state.js`, `premium-users.js`) | Stability | **Critical** | Low | Internal | **P0 (Baseline)** |

---

## 7. Technical Specifications & Acceptance Criteria

### Specification 1: Group Moderation Suite (`!kick`, `!promote`, `!demote`, `!hidetag`, `!linkgc`)
- **Module**: `src/commands/group-admin.js` (or integrated into handler)
- **Commands**:
  1. `!kick <@user|number>`: Removes target participant from the group.
  2. `!promote <@user|number>`: Promotes participant to group administrator.
  3. `!demote <@user|number>`: Demotes group administrator to regular member.
  4. `!hidetag <message>`: Broadcasts announcement with all group members mentioned invisibly in metadata.
  5. `!linkgc`: Generates and returns current group invite link (`sock.groupInviteCode(from)`).
- **Security & Permissions**:
  - `isGroup === true` validation required.
  - Caller must be Group Admin (`_localGroupAdminFlag === true`) or Bot Owner (`isAdmin === true`).
  - Bot itself must have admin privileges for `kick`, `promote`, `demote`, `linkgc`.
  - Target protection: Bot cannot kick itself or the bot owner.
- **Acceptance Criteria**:
  - `!kick`, `!promote`, `!demote` accurately parse mentioned JIDs (`mentionedJid`) or phone numbers in arguments.
  - Non-admins attempting execution receive clear `⛔ Khusus Admin Grup` notice.
  - `!hidetag` tags all participants without listing numbers in message text.
  - `!linkgc` returns valid `https://chat.whatsapp.com/<code>`.

---

### Specification 2: Sticker to Image Converter (`!toimg`)
- **Module**: `src/commands/toimg.js`
- **Command**: `!toimg` (reply to a sticker)
- **Behavior**:
  1. Inspects quoted message for `stickerMessage`.
  2. Downloads sticker buffer using Baileys `downloadContentFromMessage(quoted.stickerMessage, 'image')`.
  3. Uses `fluent-ffmpeg` to convert WebP to PNG/JPEG:
     ```javascript
     ffmpeg(tmpIn).toFormat('png').save(tmpOut)
     ```
  4. Sends resulting image back via `sock.sendMessage(from, { image: buffer, caption: '✅ Stiker berhasil diubah jadi gambar!' }, { quoted: msg })`.
- **Acceptance Criteria**:
  - If command is invoked without replying to a sticker, returns: `⚠️ Reply stiker yang mau dijadikan gambar dengan !toimg!`.
  - Converts static WebP stickers to clean PNG images.
  - Cleans up temporary disk files in `os.tmpdir()` or `./temp`.

---

### Specification 3: Jadwal Sholat & Al-Qur'an Utility (`!sholat`, `!quran`)
- **Module**: `src/commands/islami.js`
- **Commands**:
  1. `!sholat <nama_kota>`:
     - Queries public Indonesian prayer times API (e.g., Aladhan API or Kemenag-compatible endpoint) with zero authentication required.
     - Returns schedule: Imsak, Subuh, Terbit, Dhuha, Dzuhur, Ashar, Maghrib, Isya for today's date.
     - Includes timezone label (WIB/WITA/WIT).
  2. `!quran <surah_nomor/nama> [ayat]`:
     - Queries public Al-Qur'an API (e.g. `https://equran.id/api/v2/surat`).
     - Returns Surah name (Arabic + Latin), total verses, revelation type (Makkiyyah/Madaniyyah), translation, and specific verse text if requested.
- **Acceptance Criteria**:
  - `!sholat Jakarta` returns all 8 prayer times formatted cleanly with emojis.
  - Invalid city name returns helpful error with suggested cities.
  - `!quran 1` returns Surah Al-Fatihah Arabic text, transliteration, and Indonesian translation.

---

### Specification 4: Text-to-Speech (TTS) Voice Note Generator (`!tts`)
- **Module**: `src/commands/tts.js`
- **Command**: `!tts [kode_bahasa] <teks>`
- **Behavior**:
  1. Defaults to Indonesian (`id`) if language code not specified.
  2. Supported codes: `id`, `en`, `ja`, `ar`, `ko`.
  3. Fetches speech audio stream via Google Translate TTS:
     `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`
  4. Converts MP3 buffer to WhatsApp PTT Opus Ogg using existing `mp3BufferToPttOgg(mp3Buffer)` in `src/utils/audio-ptt.js`.
  5. Sends as native voice note: `sock.sendMessage(from, { audio: oggBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg })`.
- **Acceptance Criteria**:
  - Max text length capped at 250 characters to prevent abuse.
  - Returns voice note with active waveform audio.
  - Does not crash if network fails; provides clean fallback notice.

---

### Specification 5: Owner Broadcast System (`!broadcast` / `!bc`)
- **Module**: `src/commands/broadcast.js`
- **Command**: `!broadcast <pesan>` or `!bc <pesan>`
- **Behavior**:
  1. Verifies caller is Bot Owner (`isAdmin === true`).
  2. Fetches participating groups from `sock.groupFetchAllParticipating()`.
  3. Iterates over groups and dispatches formatted broadcast announcement:
     ```
     📢 *LUXXBOT BROADCAST*
     ━━━━━━━━━━━━━━━━━━━━━━━
     <message text>
     ━━━━━━━━━━━━━━━━━━━━━━━
     _Pesan resmi dari Developer / Owner LuxxBot_
     ```
  4. Introduces 1500ms throttle delay between deliveries to adhere to WhatsApp anti-spam policies.
  5. Replies to owner with summary report: total targeted, total successfully delivered, failed count.
- **Acceptance Criteria**:
  - Unauthorized execution receives `⛔ Akses Ditolak! Fitur ini cuma buat Owner!`.
  - Broadcasts to all participating groups without crashing on closed/restricted groups.
  - Returns completion metrics to the invoking owner.

---

### Specification 6: Bug Fixes & Wiring Reconciliation
1. **Wire `!darkjokes`**:
   - In `src/handlers/messages.js`:
     ```javascript
     import { handleDarkJokesCommand } from '../commands/darkjokes.js';
     // ...
     if (command === 'darkjokes' || command === 'darkjoke') {
         return await handleDarkJokesCommand({ sock, from, msg });
     }
     ```
2. **Implement `!pantun`**:
   - Route `!pantun` in `messages.js` to return curated classic and modern Indonesian pantun with themes (nasihat, jenaka, cinta, teka-teki).
3. **Fix `src/state.js` Object Iteration**:
   - Update lines 22 & 30 to iterate `Object.entries(global.notes)` and `Object.entries(global.reminders)`.
4. **Fix `src/services/usage-tracker.js` & `premium-users.js`**:
   - Import `getTierInfo` in `usage-tracker.js`.
   - Add missing `removeUser` and `getAllUsers` helpers to `premium-users.js`.

---

## 8. Automated Test Strategy (Zero WhatsApp Dependency)

In compliance with Requirement **R3**, all new commands and features can be verified using an automated offline test runner (`scripts/test-commands.mjs`):
1. **Mock Baileys Socket**:
   - Mock object providing `sendMessage`, `groupMetadata`, `groupParticipantsUpdate`, `groupInviteCode`, `groupFetchAllParticipating`.
   - Records sent messages, payloads, and mentions into memory.
2. **Mock Baileys Message**:
   - Mock message payload with `key: { remoteJid, participant, fromMe: false }` and `message: { conversation: '...' }`.
3. **Assertions**:
   - Verifies command parsing, permissions verification, API payload formatting, error handling, and response content.
4. **Integration**:
   - Added as an npm script in `package.json` (e.g. `npm test` or `node scripts/test-commands.mjs`).
