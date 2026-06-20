import fs from 'fs';
import { createReadStream } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import prism from 'prism-media';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    entersState,
    VoiceConnectionStatus,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    getVoiceConnection,
    generateDependencyReport,
    demuxProbe
} from '@discordjs/voice';
import { resolveFfmpegPath } from '../utils/ffmpeg-path.js';

const FFMPEG_BIN = resolveFfmpegPath();
if (!process.env.FFMPEG_PATH) process.env.FFMPEG_PATH = FFMPEG_BIN;
const VOICE_DEBUG = process.env.DISCORD_VOICE_DEBUG === 'true';
import {
    radio,
    onRadioTrackChange,
    onRadioPlaybackStateChange,
    getCurrentMp3Path,
    isRadioPlaying,
    isRadioPaused,
    getRadioPlayback
} from './radio-server.js';
import {
    buildMusicSlashCommands,
    handleDiscordMusicInteraction
} from './discord-music-commands.js';

let client = null;
let connection = null;
let player = null;
let started = false;
let readyHandled = false;
let activeChannelName = null;
let cachedInviteUrl = null;
let joinInProgress = false;
let activeFfmpegProc = null;
let activePrismStream = null;
let voiceSubscription = null;
let discordPlayTimer = null;
let discordSyncTimer = null;
let discordLastPaused = null;
let discordLastTrackId = null;
let discordPlayInFlight = false;
let discordLastIdleRetry = 0;
let discordPlayStartedAt = 0;
let pendingResumePositionSec = null;
let lastTextChannel = null;

const DISCORD_CACHE_DIR = './temp/radio/discord-cache';

/** @type {{ slashReady: boolean, slashGuilds: string[], lastSlashError: string|null, commandCount: number }} */
const discordDiagnostics = {
    slashReady: false,
    slashGuilds: [],
    lastSlashError: null,
    commandCount: 0
};

/** Permission: View Channels + Connect + Speak + Send Messages */
const DISCORD_INVITE_PERMISSIONS = 1024 + 1048576 + 2097152 + 2048;

function buildInviteUrl(clientId) {
    const params = new URLSearchParams({
        client_id: clientId,
        permissions: String(DISCORD_INVITE_PERMISSIONS),
        scope: 'bot applications.commands'
    });
    const guildId = process.env.DISCORD_GUILD_ID?.trim();
    if (guildId) {
        params.set('guild_id', guildId);
        params.set('disable_guild_select', 'true');
    }
    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

export function getDiscordInviteUrl() {
    if (cachedInviteUrl) return cachedInviteUrl;
    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    if (!clientId) return null;
    return buildInviteUrl(clientId);
}

const JOIN_WORDS = ['join', 'masuk', 'luxx', 'radio', 'ikut', 'come'];
const LEAVE_WORDS = ['leave', 'keluar', 'disconnect', 'dc'];

function getBotPrefix() {
    return (process.env.DISCORD_PREFIX || '!').trim();
}

function normalizeContent(content = '') {
    return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

function stripMentions(content, userId) {
    return content
        .replace(new RegExp(`<@!?${userId}>`, 'g'), '')
        .replace(/\s+/g, ' ')
        .trim();
}

function matchesWord(text, words) {
    const prefix = getBotPrefix();
    return words.some((w) => {
        const withPrefix = `${prefix}${w}`;
        return text === w || text === withPrefix
            || text.endsWith(` ${w}`) || text.endsWith(` ${withPrefix}`)
            || text.startsWith(`${w} `) || text.startsWith(`${withPrefix} `);
    });
}

function isJoinRequest(message) {
    if (message.mentions?.has(client.user)) return true;
    const text = normalizeContent(stripMentions(message.content || '', client.user.id));
    return matchesWord(text, JOIN_WORDS);
}

function isLeaveRequest(message) {
    const text = normalizeContent(stripMentions(message.content || '', client.user.id));
    return matchesWord(text, LEAVE_WORDS);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function getActiveConnection() {
    if (connection?.state?.status && connection.state.status !== VoiceConnectionStatus.Destroyed) {
        return connection;
    }
    const envGuildId = process.env.DISCORD_GUILD_ID?.trim();
    const guildIds = envGuildId
        ? [envGuildId]
        : [...(client?.guilds?.cache?.keys() || [])];
    for (const guildId of guildIds) {
        const live = getVoiceConnection(guildId);
        if (live?.state?.status && live.state.status !== VoiceConnectionStatus.Destroyed) {
            connection = live;
            return live;
        }
    }
    connection = null;
    return null;
}

function bindConnectionHandlers(vc) {
    if (!vc || vc._luxxBound) return;
    vc._luxxBound = true;
    if (VOICE_DEBUG) {
        vc.on('debug', (msg) => console.log(`🎧 Discord VC debug: ${msg}`));
    }
    vc.on('error', (err) => console.error('❌ Discord VC:', err.message));
    vc.on('stateChange', (oldState, newState) => {
        if (oldState.status !== newState.status) {
            console.log(`🎧 Discord VC: ${oldState.status} → ${newState.status}`);
        }
        if (newState.status === VoiceConnectionStatus.Ready) {
            const ping = typeof vc.ping === 'object' ? vc.ping : null;
            if (ping) {
                console.log(`🎧 Discord VC ready — ws ${ping.ws}ms udp ${ping.udp}ms`);
            }
        }
        if (newState.status === VoiceConnectionStatus.Destroyed) {
            connection = null;
            voiceSubscription = null;
        }
    });
    vc.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(vc, VoiceConnectionStatus.Signalling, 8000),
                entersState(vc, VoiceConnectionStatus.Connecting, 8000)
            ]);
            ensureVoicePlayer();
        } catch {
            console.log('🎧 Discord VC: putus — perlu /join ulang');
            try { vc.destroy(); } catch (_) { /* ignore */ }
            connection = null;
        }
    });
}

async function joinVoiceChannelEntity(channel) {
    if (!channel?.isVoiceBased?.()) {
        return { ok: false, message: 'Channel bukan voice channel.' };
    }
    if (joinInProgress) {
        return { ok: false, message: 'Sedang connect ke voice, tunggu sebentar...' };
    }
    joinInProgress = true;

    const guild = channel.guild;
    const existing = getVoiceConnection(guild.id);
    if (existing?.joinConfig?.channelId === channel.id) {
        connection = existing;
        bindConnectionHandlers(connection);
        resetVoicePlayer();
        ensureVoicePlayer();
        activeChannelName = `${channel.name} (${guild.name})`;
        joinInProgress = false;
        return { ok: true, channelName: channel.name };
    }

    if (existing) {
        try { existing.destroy(); } catch (_) {}
        await sleep(400);
    }
    if (connection && connection !== existing) {
        try { connection.destroy(); } catch (_) {}
        connection = null;
        await sleep(400);
    }

    connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
        debug: VOICE_DEBUG
    });
    bindConnectionHandlers(connection);

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
    } catch (e) {
        console.error('❌ Voice connect detail:', e.message, connection?.state?.status);
        try { connection.destroy(); } catch (_) {}
        connection = null;
        joinInProgress = false;
        return {
            ok: false,
            message: `Gagal connect voice: ${e.message}. Cek izin Connect+Speak bot di channel.`
        };
    }

    resetVoicePlayer();
    ensureVoicePlayer();

    try {
        const botMember = await guild.members.fetch(client.user.id);
        if (botMember.voice?.serverMute) {
            console.warn('🎧 Discord: bot di-server-mute — unmute bot di server');
        }
        if (botMember.voice?.suppress) {
            console.warn('🎧 Discord: bot stage-suppressed — cek izin Speak');
        }
    } catch (_) { /* ignore */ }

    activeChannelName = `${channel.name} (${guild.name})`;
    console.log(`\x1b[35m🎧 Discord voice: ${activeChannelName}\x1b[0m`);
    joinInProgress = false;
    return { ok: true, channelName: channel.name };
}

function resetVoicePlayer() {
    stopPrismStream();
    stopFfmpegProc();
    if (voiceSubscription) {
        try { voiceSubscription.unsubscribe(); } catch (_) { /* ignore */ }
        voiceSubscription = null;
    }
    if (player) {
        try { player.stop(true); } catch (_) { /* ignore */ }
        player.removeAllListeners();
        player = null;
    }
}

function ensureVoicePlayer() {
    const vc = getActiveConnection();
    if (!vc) return;
    if (!player) {
        player = createAudioPlayer({
            behaviors: { noSubscriber: NoSubscriberBehavior.Play },
            debug: VOICE_DEBUG
        });
        player.on('error', (err) => console.error('❌ Discord player:', err.message));
        if (VOICE_DEBUG) {
            player.on('debug', (msg) => console.log(`🎧 Discord player debug: ${msg}`));
        }
        player.on('stateChange', (oldState, newState) => {
            if (oldState.status !== newState.status) {
                console.log(`🎧 Discord player: ${oldState.status} → ${newState.status}`);
            }
            if (
                newState.status === AudioPlayerStatus.Idle
                && getActiveConnection()
                && isRadioPlaying()
                && !isRadioPaused()
            ) {
                const elapsed = Date.now() - discordPlayStartedAt;
                const pos = getRadioPlayback().positionSec || 0;
                const dur = radio.current?.durationSec || 0;
                const nearEnd = dur > 0 && pos >= dur - 8;
                if (!nearEnd && elapsed < 8000) {
                    const now = Date.now();
                    if (now - discordLastIdleRetry > 3000) {
                        discordLastIdleRetry = now;
                        discordLastTrackId = null;
                        scheduleDiscordPlay(800);
                    }
                }
            }
        });
    }
    try {
        const needsSubscribe = !voiceSubscription
            || voiceSubscription.connection !== vc
            || !player.subscribers?.some((s) => s.connection === vc);
        if (needsSubscribe) {
            if (voiceSubscription) {
                try { voiceSubscription.unsubscribe(); } catch (_) { /* ignore */ }
                voiceSubscription = null;
            }
            voiceSubscription = vc.subscribe(player);
            if (!voiceSubscription) {
                console.error('🎧 Discord: subscribe player gagal');
            } else {
                console.log(`🎧 Discord: player subscribed (${player.subscribers?.length ?? 0} subs)`);
            }
        }
    } catch (e) {
        console.error('❌ Discord subscribe:', e.message);
    }
}

function stopPrismStream() {
    if (!activePrismStream) return;
    try { activePrismStream.destroy(); } catch (_) { /* ignore */ }
    activePrismStream = null;
}

function stopFfmpegProc() {
    if (!activeFfmpegProc) return;
    try { activeFfmpegProc.kill('SIGKILL'); } catch (_) { /* ignore */ }
    activeFfmpegProc = null;
}

function ensureDiscordCacheDir() {
    if (!fs.existsSync(DISCORD_CACHE_DIR)) fs.mkdirSync(DISCORD_CACHE_DIR, { recursive: true });
}

/** Salin MP3 aktif — hindari file lock Windows saat radio stream + skip */
function stageMp3ForDiscord(src) {
    ensureDiscordCacheDir();
    const trackId = radio.current?.id ?? Date.now();
    const dest = path.join(DISCORD_CACHE_DIR, `discord-${trackId}.mp3`);
    try {
        fs.copyFileSync(src, dest);
        return dest;
    } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EPERM') {
            console.warn(`🎧 Discord stage: fallback ke src langsung (${e.code})`);
        } else {
            console.error('🎧 Discord stage copy:', e.message);
        }
        return src;
    }
}

function scheduleDiscordPlay(delayMs = 1200) {
    if (discordPlayTimer) clearTimeout(discordPlayTimer);
    discordPlayTimer = setTimeout(() => {
        discordPlayTimer = null;
        void playCurrentMp3(0);
    }, delayMs);
}

async function joinMemberVoice(member, guild) {
    const fullMember = guild
        ? await guild.members.fetch(member.id).catch(() => member)
        : member;
    const voiceChannelId = fullMember?.voice?.channelId;
    if (!voiceChannelId) {
        return {
            ok: false,
            message: 'Masuk **voice channel** dulu, lalu pakai `/join`.'
        };
    }
    const channel = await client.channels.fetch(voiceChannelId).catch(() => null);
    if (!channel?.isVoiceBased?.()) {
        return { ok: false, message: 'Voice channel tidak ditemukan.' };
    }
    return joinVoiceChannelEntity(channel);
}

/** Fix 1: Join voice then immediately play current radio track — waits for Ready before playing */
async function joinAndPlay(member, guild) {
    const result = await joinMemberVoice(member, guild);
    if (!result.ok) return result;

    const vc = getActiveConnection();
    if (vc && vc.state.status !== VoiceConnectionStatus.Ready) {
        try {
            await entersState(vc, VoiceConnectionStatus.Ready, 10_000);
        } catch (e) {
            console.warn('🎧 joinAndPlay: VC belum Ready, lanjut:', e.message);
        }
    }

    // Play immediately without extra timer
    void playCurrentMp3(0);
    return result;
}

function attachResourceVolume(resource) {
    if (resource.volume) resource.volume.setVolume(1);
    return resource;
}

/** Stream file audio lewat demuxProbe — cara resmi @discordjs/voice */
async function createDiscordAudioResource(filePath) {
    const abs = path.resolve(filePath);
    const { stream, type } = await demuxProbe(createReadStream(abs));
    return attachResourceVolume(createAudioResource(stream, {
        inputType: type,
        inlineVolume: true
    }));
}

async function playDiscordResource(resource, fileLabel, startSec, trackId) {
    const vc = getActiveConnection();
    if (!vc) throw new Error('Tidak ada voice connection');
    ensureVoicePlayer();
    if (!player) throw new Error('Discord player belum siap');
    if (vc.state.status !== VoiceConnectionStatus.Ready) {
        await entersState(vc, VoiceConnectionStatus.Ready, 15_000);
    }
    player.play(resource);
    discordLastTrackId = trackId;
    discordPlayStartedAt = Date.now();
    await entersState(player, AudioPlayerStatus.Playing, 20_000);
    console.log(`🎧 Discord: playing ${fileLabel} @ ${startSec.toFixed(1)}s (subs=${player.subscribers?.length ?? 0})`);
}

async function playCurrentMp3(retry = 0) {
    if (discordPlayInFlight) {
        if (retry < 6) setTimeout(() => playCurrentMp3(retry + 1), 700);
        return;
    }

    const paused = isRadioPaused();
    const playing = isRadioPlaying();
    const vc = getActiveConnection();
    console.log(`🎧 Discord play: retry=${retry} conn=${Boolean(vc)} paused=${paused} radio=${playing}`);

    if (!vc) {
        if (retry < 8) setTimeout(() => playCurrentMp3(retry + 1), 800);
        else console.log('🎧 Discord: tidak di voice — pakai /join dulu');
        return;
    }
    ensureVoicePlayer();
    if (!player) {
        if (retry < 20) setTimeout(() => playCurrentMp3(retry + 1), 500);
        return;
    }
    if (paused) {
        console.log('🎧 Discord: radio dijeda — voice ikut pause');
        stopDiscordPlayback();
        discordLastPaused = true;
        return;
    }
    discordLastPaused = false;
    if (!playing) {
        if (retry < 16) setTimeout(() => playCurrentMp3(retry + 1), 700);
        return;
    }

    const file = getCurrentMp3Path();
    if (!fs.existsSync(file)) {
        console.log(`🎧 Discord: file belum ada (${path.basename(file)}) retry=${retry}`);
        if (retry < 24) setTimeout(() => playCurrentMp3(retry + 1), 500);
        return;
    }

    // Fix 6: consume captured resume position once, fall back to live position otherwise
    let startSec;
    if (pendingResumePositionSec !== null) {
        startSec = Math.max(0, pendingResumePositionSec);
        pendingResumePositionSec = null;
    } else {
        startSec = Math.max(0, getRadioPlayback().positionSec || 0);
    }
    const trackId = radio.current?.id ?? null;
    if (
        trackId != null
        && trackId === discordLastTrackId
        && player.state.status === AudioPlayerStatus.Playing
    ) {
        return;
    }

    discordPlayInFlight = true;
    stopDiscordPlayback();

    const staged = stageMp3ForDiscord(file);

    try {
        ensureVoicePlayer();
        const ogg = await buildDiscordOggFile(staged, startSec, trackId ?? 'x');
        console.log(`🎧 Discord: stream ogg @ ${startSec.toFixed(1)}s (${path.basename(ogg)}, ${fs.statSync(ogg).size}B)`);
        const resource = await createDiscordAudioResource(ogg);
        await playDiscordResource(resource, path.basename(ogg), startSec, trackId);
    } catch (e) {
        console.error('❌ Discord play:', e.message);
        stopDiscordPlayback();
        discordLastTrackId = null;
        if (retry < 5) {
            setTimeout(() => playCurrentMp3(retry + 1), 1200);
        } else if (lastTextChannel) {
            // Fix 4: notify user after all retries exhausted
            lastTextChannel.send(
                '❌ **Discord gagal memutar audio** setelah beberapa percobaan.\n' +
                'Radio web masih berjalan. Coba `/join` ulang atau tunggu track berikutnya.'
            ).catch((sendErr) => {
                console.error('🎧 Discord: gagal kirim error notification:', sendErr.message);
            });
        }
    } finally {
        discordPlayInFlight = false;
    }
}

/** Transcode ke OGG Opus 48kHz — Discord butuh format ini */
function buildDiscordOggFile(staged, startSec, trackId) {
    ensureDiscordCacheDir();
    const bucket = Math.floor(Math.max(0, startSec) / 30);
    const out = path.join(DISCORD_CACHE_DIR, `voice-${trackId}-${bucket}.ogg`);
    const trackPreparedAt = radio.current?.preparedAt ?? 0;
    if (fs.existsSync(out)) {
        const stat = fs.statSync(out);
        if (stat.size > 800 && stat.mtimeMs >= trackPreparedAt) {
            return Promise.resolve(out);
        }
    }
    const absIn = path.resolve(staged);
    const absOut = path.resolve(out);
    return new Promise((resolve, reject) => {
        const args = ['-hide_banner', '-loglevel', 'error', '-y'];
        if (startSec > 0.5) args.push('-ss', String(startSec));
        args.push(
            '-i', absIn,
            '-vn', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2',
            '-application', 'audio', '-f', 'ogg', absOut
        );
        const proc = spawn(FFMPEG_BIN, args, { windowsHide: true });
        activeFfmpegProc = proc;
        let stderr = '';
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (activeFfmpegProc === proc) activeFfmpegProc = null;
            if (code === 0 && fs.existsSync(absOut) && fs.statSync(absOut).size > 800) resolve(absOut);
            else reject(new Error(stderr.slice(-280) || `ffmpeg ogg exit ${code}`));
        });
    });
}

function stopDiscordPlayback() {
    stopPrismStream();
    stopFfmpegProc();
    if (player) {
        try { player.stop(true); } catch (_) { /* ignore */ }
    }
}

function leaveVoice() {
    stopDiscordPlayback();
    if (connection) {
        try { connection.destroy(); } catch (_) {}
        connection = null;
    }
    activeChannelName = null;
}

const voiceApi = {
    joinMemberVoice,
    joinAndPlay,
    playCurrentMp3: () => scheduleDiscordPlay(300),
    scheduleDiscordPlay,
    leaveVoice,
    getConnection: () => getActiveConnection()
};

export function setLastTextChannel(channel) {
    lastTextChannel = channel;
}

export function isDiscordRadioEnabled() {
    return Boolean(process.env.DISCORD_BOT_TOKEN?.trim());
}

export function getDiscordDiagnostics() {
    return {
        ...discordDiagnostics,
        guildCount: client?.guilds?.cache?.size ?? 0,
        inviteUrl: getDiscordInviteUrl(),
        inVoice: Boolean(connection && activeChannelName),
        voiceChannel: activeChannelName
    };
}

export function getDiscordRadioStatus() {
    if (!isDiscordRadioEnabled()) {
        return '_Discord: set `DISCORD_BOT_TOKEN` di .env lalu restart bot._';
    }
    const guildCount = client?.guilds?.cache?.size ?? 0;
    if (guildCount === 0) {
        const link = getDiscordInviteUrl();
        return link
            ? `⚠️ *Discord:* bot belum di server.\nInvite: ${link}`
            : '⚠️ *Discord:* bot belum di-invite ke server.';
    }
    if (!discordDiagnostics.slashReady && discordDiagnostics.lastSlashError) {
        return `⚠️ *Discord:* slash gagal didaftar.\n_${discordDiagnostics.lastSlashError.slice(0, 120)}_\nInvite ulang bot (scope applications.commands).`;
    }
    if (connection && activeChannelName) {
        return `🎧 *Discord:* aktif di **${activeChannelName}** — \`/play\` \`/queue\` \`/lirik\` \`/leave\` \`/stop\`.`;
    }
    const slashHint = discordDiagnostics.slashReady
        ? 'Slash siap — masuk VC lalu `/join` (lagu dari WA `!play` atau Discord `/play`).'
        : 'Slash sedang didaftar...';
    return `🎧 *Discord:* ${slashHint} \`/join\` \`/play\` \`/queue\` \`/lirik\` \`/leave\` \`/stop\``;
}

function shouldRegisterGlobalSlash() {
    return process.env.DISCORD_REGISTER_GLOBAL === 'true';
}

function formatSlashError(err) {
    const raw = err?.rawError?.message || err?.message || String(err);
    const code = err?.status || err?.code;
    if (code === 401) return `${raw} — token Discord tidak valid.`;
    if (code === 403) return `${raw} — bot perlu di-invite ulang dengan scope applications.commands.`;
    return raw;
}

async function registerGuildSlashCommands(guildId, guildName = guildId) {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    const rest = new REST({ version: '10' }).setToken(token);
    const body = buildMusicSlashCommands();
    discordDiagnostics.commandCount = body.length;
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body });
    if (!discordDiagnostics.slashGuilds.includes(guildName)) {
        discordDiagnostics.slashGuilds.push(guildName);
    }
    console.log(`\x1b[32m✅ Slash (${body.length} cmd) terdaftar di guild: ${guildName}\x1b[0m`);
}

async function registerGlobalSlashCommands() {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    const rest = new REST({ version: '10' }).setToken(token);
    const body = buildMusicSlashCommands();
    await rest.put(Routes.applicationCommands(client.user.id), { body });
    console.log(`\x1b[35m✅ Slash global (${body.length} cmd) — bisa butuh ~1 jam di server lain\x1b[0m`);
}

async function registerAllSlashCommands() {
    const commands = buildMusicSlashCommands();
    discordDiagnostics.commandCount = commands.length;
    discordDiagnostics.slashGuilds = [];
    discordDiagnostics.lastSlashError = null;

    const envGuildId = process.env.DISCORD_GUILD_ID?.trim();
    const guilds = client.guilds.cache;

    if (envGuildId) {
        const named = guilds.get(envGuildId)?.name;
        try {
            await registerGuildSlashCommands(envGuildId, named || envGuildId);
            discordDiagnostics.slashReady = true;
        } catch (e) {
            discordDiagnostics.lastSlashError = formatSlashError(e);
            console.error(`❌ Slash guild ${envGuildId}:`, discordDiagnostics.lastSlashError);
        }
    }

    for (const [, guild] of guilds) {
        if (envGuildId && guild.id === envGuildId) continue;
        try {
            await registerGuildSlashCommands(guild.id, guild.name);
            discordDiagnostics.slashReady = true;
        } catch (e) {
            const msg = formatSlashError(e);
            discordDiagnostics.lastSlashError = msg;
            console.error(`❌ Slash guild ${guild.name}:`, msg);
        }
    }

    if (shouldRegisterGlobalSlash()) {
        try {
            await registerGlobalSlashCommands();
        } catch (e) {
            const msg = formatSlashError(e);
            discordDiagnostics.lastSlashError = msg;
            console.error('❌ Slash global:', msg);
        }
    }

    if (discordDiagnostics.slashReady) {
        console.log('\x1b[35m   Perintah Discord: /join /play /leave /queue /lirik /stop\x1b[0m');
    }
}

async function logDiscordStartup() {
    const guilds = client.guilds.cache;
    cachedInviteUrl = buildInviteUrl(client.user.id);
    process.env.DISCORD_CLIENT_ID = client.user.id;

    console.log(`\x1b[35m📡 Discord: bot ada di ${guilds.size} server\x1b[0m`);
    if (guilds.size === 0) {
        console.log('\x1b[33m⚠️  Bot BELUM di-invite ke server Discord!\x1b[0m');
        console.log(`\x1b[36m${cachedInviteUrl}\x1b[0m`);
        console.log('\x1b[33m   Pastikan invite punya scope: bot + applications.commands\x1b[0m');
        return;
    }
    for (const [, guild] of guilds) {
        console.log(`\x1b[32m   ✓ ${guild.name} (${guild.id})\x1b[0m`);
    }

    await registerAllSlashCommands();
}

function registerDiscordHandlers() {
    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.channel?.isTextBased?.()) {
                setLastTextChannel(interaction.channel);
            }
            const handled = await handleDiscordMusicInteraction(interaction, voiceApi);
            if (handled) return;
        } catch (e) {
            console.error('Discord interaction:', e.message);
        }
    });

    client.on('messageCreate', async (message) => {
        if (!client || message.author.bot || !message.guild) return;
        if (message.channel?.isTextBased?.()) {
            setLastTextChannel(message.channel);
        }

        const mentioned = message.mentions?.has(client.user);
        const hasContent = Boolean(message.content?.trim());
        if (!mentioned && !hasContent) return;
        if (!isLeaveRequest(message) && !isJoinRequest(message)) return;

        try {
            if (isLeaveRequest(message)) {
                if (!connection) {
                    await message.reply('ℹ️ Bot belum di voice channel.');
                    return;
                }
                leaveVoice();
                await message.reply('👋 Keluar dari voice channel.');
                return;
            }

            const member = message.member
                ?? await message.guild.members.fetch(message.author.id).catch(() => null);
            const result = await joinMemberVoice(member, message.guild);
            if (!result.ok) {
                await message.reply(`❌ ${result.message}`);
                return;
            }
            await message.reply(
                `🎧 Masuk **${result.channelName}** — lagu dari WA !play · /queue /lirik /leave /stop`
            );
            scheduleDiscordPlay(500);
        } catch (e) {
            console.error('Discord message:', e.message);
        }
    });
}

export function startDiscordRadio() {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    if (!token) return;
    if (started) return;
    started = true;

    const intents = [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ];
    if (process.env.DISCORD_MESSAGE_CONTENT === 'true') {
        intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    }

    client = new Client({ intents });

    const onDiscordReady = async () => {
        if (readyHandled) return;
        readyHandled = true;
        console.log(`\x1b[35m🤖 Discord bot online: ${client.user.tag}\x1b[0m`);
        try {
            const ff = prism.FFmpeg.getInfo(true);
            console.log(`🎧 Discord ffmpeg: ${ff.command} v${ff.version} (libopus: ${ff.output.includes('--enable-libopus') ? 'yes' : 'no'})`);
        } catch (e) {
            console.error('🎧 Discord: ffmpeg tidak ditemukan:', e.message);
        }
        console.log(generateDependencyReport());
        try {
            await logDiscordStartup();
        } catch (e) {
            discordDiagnostics.lastSlashError = formatSlashError(e);
            console.error('❌ Discord startup:', discordDiagnostics.lastSlashError);
        }
    };
    client.once('ready', onDiscordReady);

    client.on('guildCreate', async (guild) => {
        console.log(`\x1b[32m✅ Bot baru masuk server: ${guild.name}\x1b[0m`);
        try {
            await registerGuildSlashCommands(guild.id, guild.name);
            discordDiagnostics.slashReady = true;
        } catch (e) {
            console.error(`❌ Slash guild ${guild.name}:`, formatSlashError(e));
        }
    });

    registerDiscordHandlers();

    onRadioTrackChange((track) => {
        discordLastTrackId = null;
        if (!track) {
            stopFfmpegProc();
            if (player) {
                try { player.stop(true); } catch (_) { /* ignore */ }
            }
            if (radio.isPreparing || radio.queue.length) return;
            discordLastPaused = null;
            return;
        }
        if (getActiveConnection() && !isRadioPaused()) scheduleDiscordPlay(500);
    });

    onRadioPlaybackStateChange((state) => {
        if (!getActiveConnection()) return;
        if (state.paused) {
            stopDiscordPlayback();
            discordLastPaused = true;
            discordLastTrackId = null;
            return;
        }
        if (state.track) {
            // Fix 6: capture resume position from event before timer fires
            pendingResumePositionSec = state.positionSec ?? null;
            scheduleDiscordPlay(500);
        }
    });

    discordSyncTimer = setInterval(() => {
        if (!getActiveConnection()) return;
        ensureVoicePlayer();

        if (!isRadioPlaying()) return;
        const paused = isRadioPaused();
        if (paused && discordLastPaused !== true) {
            stopDiscordPlayback();
            discordLastPaused = true;
            return;
        }
        if (!paused && discordLastPaused === true) {
            discordLastPaused = false;
            discordLastTrackId = null;
            scheduleDiscordPlay(250);
            return;
        }
        if (!paused && player?.state?.status === AudioPlayerStatus.Idle) {
            const elapsed = Date.now() - discordPlayStartedAt;
            const pos = getRadioPlayback().positionSec || 0;
            const dur = radio.current?.durationSec || 0;
            const nearEnd = dur > 0 && pos >= dur - 8;
            if (!nearEnd && elapsed < 10000) {
                const now = Date.now();
                if (now - discordLastIdleRetry > 5000) {
                    // Fix 7: check OGG cache before scheduling re-transcode
                    const currentTrackId = radio.current?.id;
                    const currentPos = getRadioPlayback().positionSec || 0;
                    const currentBucket = Math.floor(Math.max(0, currentPos) / 30);
                    const cachedOgg = path.join(DISCORD_CACHE_DIR, `voice-${currentTrackId}-${currentBucket}.ogg`);
                    const trackPreparedAt = radio.current?.preparedAt ?? 0;

                    const cacheValid = currentTrackId != null
                        && fs.existsSync(cachedOgg)
                        && (() => {
                            try {
                                const s = fs.statSync(cachedOgg);
                                return s.size > 800 && s.mtimeMs >= trackPreparedAt;
                            } catch { return false; }
                        })();

                    if (cacheValid) {
                        return; // cache is fresh — skip re-transcode, player will recover on next idle
                    }

                    discordLastIdleRetry = now;
                    discordLastTrackId = null;
                    scheduleDiscordPlay(600);
                }
            }
        }
    }, 2000);

    client.login(token).catch((e) => {
        console.error('❌ Discord login gagal:', e.message);
        started = false;
    });
}