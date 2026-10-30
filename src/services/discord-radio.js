import fs from 'fs';
import { createReadStream } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { Client, GatewayIntentBits, REST, Routes, Events } from 'discord.js';
import prism from 'prism-media';

const require = createRequire(import.meta.url);
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
    StreamType
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
/** @type {Map<string, Promise<string>>} */
const discordOggJobs = new Map();
let activePlaybackProc = null;
let activePrismStream = null;
const MAX_STAGE_COPY_BYTES = 12 * 1024 * 1024;
const MAX_OGG_TRANSCODE_BYTES = 80 * 1024 * 1024;
const OGG_TRANSCODE_TIMEOUT_MS = 45_000;
let voiceSubscription = null;
let discordPlayTimer = null;
let discordSyncTimer = null;
let discordLastPaused = null;
let discordLastTrackId = null;
let discordPlayInFlight = false;
let discordLastIdleRetry = 0;
let discordPlayStartedAt = 0;
let pendingResumePositionSec = null;
let discordForceResync = false;
let discordLastSyncedPositionSec = 0;
let discordStoppingIntentionally = false;
let lastTextChannel = null;
/** Native/JS opus encoder — hanya untuk jalur live PCM (cadangan). */
let discordOpusEncoderOk = false;

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

    const daveEncryption = process.env.DISCORD_DAVE !== 'false';
    connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
        daveEncryption,
        debug: VOICE_DEBUG
    });
    if (!daveEncryption) {
        console.log('🎧 Discord: DAVE encryption disabled (DISCORD_DAVE=false)');
    }
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
    cancelDiscordOggJobs();
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

function cancelDiscordOggJobs() {
    discordOggJobs.clear();
}

function ensureDiscordCacheDir() {
    if (!fs.existsSync(DISCORD_CACHE_DIR)) fs.mkdirSync(DISCORD_CACHE_DIR, { recursive: true });
}

/** Path MP3 untuk Discord — file besar tidak disalin (hemat waktu/disk) */
async function resolveDiscordPlayPath(src) {
    try {
        const size = fs.statSync(src).size;
        if (size > MAX_STAGE_COPY_BYTES) {
            console.log(`🎧 Discord: pakai file asli (${Math.round(size / 1_048_576)}MB, tanpa salin)`);
            return src;
        }
    } catch { /* fallback salin */ }

    ensureDiscordCacheDir();
    const trackId = radio.current?.id ?? Date.now();
    const dest = path.join(DISCORD_CACHE_DIR, `discord-${trackId}.mp3`);
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            fs.copyFileSync(src, dest);
            const size = fs.statSync(dest).size;
            if (size > 4096) return dest;
        } catch (e) {
            if (attempt < 3 && (e.code === 'EBUSY' || e.code === 'EPERM')) {
                await sleep(150);
                continue;
            }
            console.warn(`🎧 Discord stage: pakai src langsung (${e.message})`);
            break;
        }
    }
    return src;
}

function scheduleDiscordPlay(delayMs = 1200) {
    if (discordPlayTimer) clearTimeout(discordPlayTimer);
    discordPlayTimer = setTimeout(() => {
        discordPlayTimer = null;
        void playCurrentMp3(0);
    }, delayMs);
}

/** Paksa Discord ikut posisi radio web/admin (debounced). */
export function requestDiscordRadioSync(reason = 'manual', delayMs = 400) {
    if (!started || !getActiveConnection()) return;
    console.log(`🎧 Discord sync: ${reason}`);
    discordForceResync = true;
    discordLastTrackId = null;
    scheduleDiscordPlay(delayMs);
}

function shouldResyncIdlePlayback() {
    if (discordPlayInFlight || discordStoppingIntentionally) return false;
    if (!getActiveConnection() || !isRadioPlaying() || isRadioPaused()) return false;
    if (player?.state?.status !== AudioPlayerStatus.Idle) return false;
    if (Date.now() - discordPlayStartedAt < 15_000) return false;

    const pos = getRadioPlayback().positionSec || 0;
    const dur = radio.current?.durationSec || 0;
    if (dur > 0 && pos >= dur - 5) return false;

    const now = Date.now();
    if (now - discordLastIdleRetry < 20_000) return false;
    discordLastIdleRetry = now;
    return true;
}

function triggerIdleResync(reason) {
    if (!shouldResyncIdlePlayback()) return;
    console.log(`🎧 Discord idle resync (${reason})`);
    discordForceResync = true;
    discordLastTrackId = null;
    scheduleDiscordPlay(1200);
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

    scheduleDiscordPlay(700);
    return result;
}

function attachResourceVolume(resource) {
    if (resource.volume) resource.volume.setVolume(2);
    return resource;
}

function probeDiscordOpusEncoder() {
    try {
        const { OpusEncoder } = require('@discordjs/opus');
        const enc = new OpusEncoder(48_000, 2);
        enc.encode(Buffer.alloc(3840));
        discordOpusEncoderOk = true;
        return '@discordjs/opus';
    } catch (nativeErr) {
        try {
            const OpusScript = require('opusscript');
            const enc = new OpusScript(48_000, 2);
            enc.encode(Buffer.alloc(3840));
            discordOpusEncoderOk = true;
            return 'opusscript';
        } catch (scriptErr) {
            discordOpusEncoderOk = false;
            console.error(`❌ Discord opus encoder GAGAL: ${nativeErr.message}`);
            console.error('   Voice pakai jalur OGG (tanpa encoder). Fix: npm install && npm run discord:rebuild');
            return null;
        }
    }
}

function stopActivePlaybackProc() {
    if (!activePlaybackProc) return;
    try { activePlaybackProc.kill('SIGTERM'); } catch (_) { /* ignore */ }
    activePlaybackProc = null;
}

/**
 * Stream PCM langsung dari ffmpeg — mulai cepat walau file MP3 besar (pakai -ss seek).
 * Tidak menunggu transcode penuh ke OGG.
 */
function createLivePcmResource(filePath, startSec = 0) {
    stopActivePlaybackProc();
    const seek = Math.floor(Math.max(0, startSec));
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    if (seek > 0) args.push('-ss', String(seek));
    args.push(
        '-i', path.resolve(filePath),
        '-vn',
        '-analyzeduration', '0',
        '-probesize', '32768',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
    );
    const proc = spawn(FFMPEG_BIN, args, { windowsHide: true });
    activePlaybackProc = proc;
    proc.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (msg) console.warn(`🎧 Discord ffmpeg live: ${msg.slice(-200)}`);
    });
    proc.on('error', (err) => console.error('🎧 Discord ffmpeg spawn:', err.message));
    proc.on('close', (code) => {
        if (activePlaybackProc === proc) activePlaybackProc = null;
        if (code && code !== 0) console.warn(`🎧 Discord ffmpeg live exit ${code}`);
    });
    return attachResourceVolume(createAudioResource(proc.stdout, {
        inputType: StreamType.Raw,
        inlineVolume: true,
        silencePaddingFrames: 5
    }));
}

/** Resource dari file OGG kecil di disk — inlineVolume:false agar pipeline OggDemuxer aktif */
function createOggFileResource(oggPath) {
    const abs = path.resolve(oggPath);
    return createAudioResource(createReadStream(abs), {
        inputType: StreamType.OggOpus,
        inlineVolume: false,
        silencePaddingFrames: 5
    });
}

/**
 * Stream OGG Opus dari ffmpeg stdout — mulai cepat, tanpa opus encoder Node.
 * inlineVolume harus false: volume constraint memaksa jalur raw→opus encoder (rusak di PC ini).
 */
function createOggPipeResource(filePath, startSec = 0) {
    stopActivePlaybackProc();
    const seek = Math.floor(Math.max(0, startSec));
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    if (seek > 0) args.push('-ss', String(seek));
    args.push(
        '-i', path.resolve(filePath),
        '-vn',
        '-map', '0:a:0?',
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2',
        '-application', 'audio',
        '-f', 'ogg',
        'pipe:1'
    );
    const proc = spawn(FFMPEG_BIN, args, { windowsHide: true });
    activePlaybackProc = proc;
    proc.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (msg) console.warn(`🎧 Discord ffmpeg ogg pipe: ${msg.slice(-200)}`);
    });
    proc.on('error', (err) => console.error('🎧 Discord ffmpeg ogg spawn:', err.message));
    proc.on('close', (code) => {
        if (activePlaybackProc === proc) activePlaybackProc = null;
        if (code && code !== 0) console.warn(`🎧 Discord ffmpeg ogg pipe exit ${code}`);
    });
    return createAudioResource(proc.stdout, {
        inputType: StreamType.OggOpus,
        inlineVolume: false,
        silencePaddingFrames: 5
    });
}

/** Cadangan: putar MP3 — ffmpeg internal ke OGG lalu OggDemuxer (tanpa opus encoder Node) */
function createMp3FileResource(filePath, startSec = 0) {
    const abs = path.resolve(filePath);
    const seek = Math.floor(Math.max(0, startSec));
    if (seek <= 0) {
        return createAudioResource(abs, {
            inlineVolume: false,
            silencePaddingFrames: 5
        });
    }
    stopActivePlaybackProc();
    const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-ss', String(seek),
        '-i', abs,
        '-vn',
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-ar', '48000',
        '-ac', '2',
        '-f', 'ogg',
        'pipe:1'
    ];
    const proc = spawn(FFMPEG_BIN, args, { windowsHide: true });
    activePlaybackProc = proc;
    proc.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (msg) console.warn(`🎧 Discord ffmpeg mp3 seek: ${msg.slice(-200)}`);
    });
    proc.on('close', (code) => {
        if (activePlaybackProc === proc) activePlaybackProc = null;
        if (code && code !== 0) console.warn(`🎧 Discord ffmpeg mp3 seek exit ${code}`);
    });
    return createAudioResource(proc.stdout, {
        inputType: StreamType.OggOpus,
        inlineVolume: false,
        silencePaddingFrames: 5
    });
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
        })
    ]);
}

async function playDiscordResource(resource, fileLabel, startSec, trackId) {
    const vc = getActiveConnection();
    if (!vc) throw new Error('Tidak ada voice connection');
    ensureVoicePlayer();
    if (!player) throw new Error('Discord player belum siap');
    if (vc.state.status !== VoiceConnectionStatus.Ready) {
        await entersState(vc, VoiceConnectionStatus.Ready, 15_000);
    }
    if (!player.subscribers?.some((s) => s.connection === vc)) {
        if (voiceSubscription) {
            try { voiceSubscription.unsubscribe(); } catch (_) { /* ignore */ }
            voiceSubscription = null;
        }
        voiceSubscription = vc.subscribe(player);
        if (!voiceSubscription) throw new Error('Gagal subscribe player ke voice connection');
        console.log(`🎧 Discord: re-subscribed player (${player.subscribers?.length ?? 0} subs)`);
    }
    player.play(resource);
    discordLastTrackId = trackId;
    discordPlayStartedAt = Date.now();
    await entersState(player, AudioPlayerStatus.Playing, 20_000);
    console.log(`🎧 Discord: playing ${fileLabel} @ ${startSec.toFixed(1)}s (subs=${player.subscribers?.length ?? 0}, vc=${vc.state.status})`);
    setTimeout(() => {
        const st = player?.state;
        const res = st?.resource;
        if (st?.status === AudioPlayerStatus.Playing) {
            const dur = Math.round(res?.playbackDuration || st.playbackDuration || 0);
            const pkts = getActiveConnection()?.state?.networking?.connectionData?.packetsPlayed;
            console.log(`🎧 Discord: playback ${dur}ms missed=${st.missedFrames ?? 0} udpPkts=${pkts ?? '?'}`);
            if (dur < 500) {
                console.warn('🎧 Discord: playback <500ms — pipeline OGG mungkin rusak; coba DISCORD_DAVE=false');
            }
        } else if (st?.status === AudioPlayerStatus.Idle) {
            console.warn('🎧 Discord: player idle setelah 4s — audio tidak mengalir');
        }
    }, 4000);
}

function discordOggCachePath(trackId, seekSec) {
    return path.join(DISCORD_CACHE_DIR, `voice-${trackId}-at${Math.floor(Math.max(0, seekSec))}.ogg`);
}

function readCachedOgg(trackId, seekSec) {
    const out = discordOggCachePath(trackId, seekSec);
    if (!fs.existsSync(out)) return null;
    const stat = fs.statSync(out);
    const trackPreparedAt = radio.current?.preparedAt ?? 0;
    if (stat.size > 2000 && stat.mtimeMs >= trackPreparedAt) return out;
    return null;
}

/** Urutan: cache OGG → OGG pipe → MP3+ffmpeg → transcode file → live PCM (hanya jika opus OK) */
async function startDiscordPlayback(playPath, label, fileSize, startSec, trackId) {
    const mb = Math.round(fileSize / 1_048_576);
    const seekKey = Math.floor(Math.max(0, startSec));
    const id = trackId ?? 'x';

    const cachedSeek = readCachedOgg(id, seekKey);
    if (cachedSeek) {
        try {
            console.log(`🎧 Discord: cache ogg ${path.basename(cachedSeek)} @ ${seekKey}s`);
            await playDiscordResource(createOggFileResource(cachedSeek), path.basename(cachedSeek), seekKey, trackId);
            return seekKey;
        } catch (e) {
            console.warn(`🎧 Discord cache ogg gagal (${e.message})`);
        }
    }

    if (seekKey > 0) {
        const cachedZero = readCachedOgg(id, 0);
        if (cachedZero) {
            try {
                console.log(`🎧 Discord: cache ogg dari awal (sync ${seekKey}s → 0s)`);
                await playDiscordResource(createOggFileResource(cachedZero), path.basename(cachedZero), 0, trackId);
                return 0;
            } catch (e) {
                console.warn(`🎧 Discord cache ogg@0 gagal (${e.message})`);
            }
        }
    }

    try {
        console.log(`🎧 Discord: ogg pipe @ ${seekKey}s (${label}, ${mb}MB)`);
        const resource = createOggPipeResource(playPath, seekKey);
        await playDiscordResource(resource, `${label} [ogg-pipe]`, seekKey, trackId);
        return seekKey;
    } catch (pipeErr) {
        console.warn(`🎧 Discord ogg pipe gagal (${pipeErr.message})`);
    }

    try {
        console.log(`🎧 Discord: mp3→ogg @ ${seekKey}s (${label}, ${mb}MB)`);
        const resource = createMp3FileResource(playPath, seekKey);
        await playDiscordResource(resource, label, seekKey, trackId);
        return seekKey;
    } catch (mp3Err) {
        console.warn(`🎧 Discord mp3 gagal (${mp3Err.message})`);
    }

    if (fileSize <= MAX_OGG_TRANSCODE_BYTES) {
        try {
            console.log(`🎧 Discord: transcode ogg file @ ${seekKey}s (${label}, ${mb}MB)`);
            const ogg = await withTimeout(
                buildDiscordOggFile(playPath, seekKey, id),
                OGG_TRANSCODE_TIMEOUT_MS,
                'ogg transcode'
            );
            const oggSize = fs.statSync(ogg).size;
            console.log(`🎧 Discord: putar ogg ${path.basename(ogg)} (${oggSize}B)`);
            await playDiscordResource(createOggFileResource(ogg), path.basename(ogg), seekKey, trackId);
            return seekKey;
        } catch (oggErr) {
            console.warn(`🎧 Discord ogg file gagal (${oggErr.message})`);
        }
    }

    if (!discordOpusEncoderOk) {
        throw new Error('Semua jalur OGG gagal dan opus encoder tidak tersedia — install @discordjs/opus atau opusscript');
    }

    console.log(`🎧 Discord: live pcm @ ${seekKey}s (${label}, ${mb}MB)`);
    const resource = createLivePcmResource(playPath, seekKey);
    await playDiscordResource(resource, label, seekKey, trackId);
    return seekKey;
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

    const file = radio.current?.filePath || getCurrentMp3Path();
    if (!file || !fs.existsSync(file)) {
        console.log(`🎧 Discord: file belum ada (${file ? path.basename(file) : '—'}) retry=${retry}`);
        if (retry < 24) setTimeout(() => playCurrentMp3(retry + 1), 500);
        return;
    }

    const fileSize = fs.statSync(file).size;
    if (fileSize < 4096) {
        console.log(`🎧 Discord: file terlalu kecil (${fileSize}B) retry=${retry}`);
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
    const dur = radio.current?.durationSec || 0;
    if (dur > 8) startSec = Math.min(startSec, dur - 3);
    const trackId = radio.current?.id ?? null;
    const livePos = getRadioPlayback().positionSec || 0;
    const positionDrifted = trackId != null
        && trackId === discordLastTrackId
        && Math.abs(livePos - discordLastSyncedPositionSec) > 45;
    if (
        !discordForceResync
        && !positionDrifted
        && trackId != null
        && trackId === discordLastTrackId
        && player.state.status === AudioPlayerStatus.Playing
    ) {
        return;
    }
    discordForceResync = false;

    discordPlayInFlight = true;
    discordStoppingIntentionally = true;
    stopDiscordPlayback();
    discordStoppingIntentionally = false;

    const playPath = await resolveDiscordPlayPath(file);
    const label = path.basename(playPath);

    try {
        ensureVoicePlayer();
        const syncedAt = await startDiscordPlayback(playPath, label, fileSize, startSec, trackId);
        discordLastSyncedPositionSec = syncedAt;
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

/** Transcode ke file OGG Opus — jangan pakai pipe (Premature close di Windows) */
function buildDiscordOggFile(staged, startSec, trackId) {
    ensureDiscordCacheDir();
    const seekKey = Math.floor(Math.max(0, startSec));
    const out = discordOggCachePath(trackId, seekKey);
    const trackPreparedAt = radio.current?.preparedAt ?? 0;

    if (fs.existsSync(out)) {
        const stat = fs.statSync(out);
        if (stat.size > 2000 && stat.mtimeMs >= trackPreparedAt) {
            return Promise.resolve(out);
        }
    }

    const pending = discordOggJobs.get(out);
    if (pending) return pending;

    const absIn = path.resolve(staged);
    const absOut = path.resolve(out);
    const dur = radio.current?.durationSec || 0;
    const remaining = dur > seekKey ? Math.min(dur - seekKey + 2, 7200) : 600;

    const job = new Promise((resolve, reject) => {
        const args = ['-hide_banner', '-loglevel', 'warning', '-y'];
        if (seekKey > 0) args.push('-ss', String(seekKey));
        args.push(
            '-i', absIn,
            '-t', String(remaining),
            '-map', '0:a:0?',
            '-vn',
            '-c:a', 'libopus',
            '-b:a', '128k',
            '-ar', '48000',
            '-ac', '2',
            '-application', 'audio',
            '-f', 'ogg',
            absOut
        );
        console.log(`🎧 Discord transcode: ${path.basename(staged)} → ${path.basename(out)} @ ${seekKey}s`);
        const proc = spawn(FFMPEG_BIN, args, { windowsHide: true });
        let stderr = '';
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            discordOggJobs.delete(out);
            if (code === 0 && fs.existsSync(absOut) && fs.statSync(absOut).size > 2000) {
                resolve(absOut);
                return;
            }
            reject(new Error(stderr.slice(-320).trim() || `ffmpeg ogg exit ${code}`));
        });
    });

    discordOggJobs.set(out, job);
    return job;
}

function stopDiscordPlayback() {
    discordStoppingIntentionally = true;
    if (player) {
        try { player.stop(true); } catch (_) { /* ignore */ }
    }
    stopActivePlaybackProc();
    stopPrismStream();
    discordStoppingIntentionally = false;
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
        console.log(`🎧 Discord ffmpeg path: ${FFMPEG_BIN}`);
        console.log(generateDependencyReport());
        const opusLib = probeDiscordOpusEncoder();
        if (opusLib) {
            console.log(`🎧 Discord opus encoder: ${opusLib} OK (cadangan live PCM)`);
        } else {
            console.log('🎧 Discord: opus encoder tidak ada — voice pakai jalur OGG saja');
        }
        try {
            await logDiscordStartup();
        } catch (e) {
            discordDiagnostics.lastSlashError = formatSlashError(e);
            console.error('❌ Discord startup:', discordDiagnostics.lastSlashError);
        }
    };
    client.once(Events.ClientReady, onDiscordReady);

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
        discordForceResync = true;
        if (!track) {
            cancelDiscordOggJobs();
            if (player) {
                try { player.stop(true); } catch (_) { /* ignore */ }
            }
            if (radio.isPreparing || radio.queue.length) return;
            discordLastPaused = null;
            return;
        }
        if (track?.filePath && fs.existsSync(track.filePath)) {
            void resolveDiscordPlayPath(track.filePath)
                .then((p) => buildDiscordOggFile(p, 0, track.id))
                .then((ogg) => console.log(`🎧 Discord prefetch: ${path.basename(ogg)}`))
                .catch(() => {});
        }
        if (getActiveConnection() && isRadioPlaying() && !isRadioPaused()) scheduleDiscordPlay(500);
    });

    onRadioPlaybackStateChange((state) => {
        if (!getActiveConnection() || !isRadioPlaying()) return;
        if (state.paused) {
            stopDiscordPlayback();
            discordLastPaused = true;
            discordLastTrackId = null;
            return;
        }
        if (state.track) {
            pendingResumePositionSec = state.positionSec ?? null;
            discordForceResync = true;
            discordLastTrackId = null;
            scheduleDiscordPlay(500);
        }
    });

    discordSyncTimer = setInterval(() => {
        if (!getActiveConnection() || !isRadioPlaying()) return;
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
            triggerIdleResync('sync-timer');
        }
    }, 12_000);

    client.login(token).catch((e) => {
        console.error('❌ Discord login gagal:', e.message);
        started = false;
    });
}