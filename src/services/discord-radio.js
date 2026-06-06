import fs, { createReadStream } from 'fs';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    entersState,
    VoiceConnectionStatus,
    NoSubscriberBehavior,
    getVoiceConnection,
    generateDependencyReport,
    StreamType
} from '@discordjs/voice';
import { onRadioTrackChange, getCurrentMp3Path } from './radio-server.js';
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
    if (existing?.joinConfig?.channelId === channel.id && connection === existing) {
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
        selfMute: false
    });

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

    if (!player) {
        player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
        player.on('error', (err) => console.error('❌ Discord player:', err.message));
    }
    connection.subscribe(player);

    activeChannelName = `${channel.name} (${guild.name})`;
    console.log(`\x1b[35m🎧 Discord voice: ${activeChannelName}\x1b[0m`);
    joinInProgress = false;
    return { ok: true, channelName: channel.name };
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

function playCurrentMp3() {
    const file = getCurrentMp3Path();
    if (!player || !connection || !fs.existsSync(file)) return;

    try {
        const resource = createAudioResource(createReadStream(file), {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });
        player.stop();
        player.play(resource);
        console.log(`🎧 Discord: playing ${file}`);
    } catch (e) {
        console.error('❌ Discord play error:', e.message);
    }
}

function stopDiscordPlayback() {
    if (player) {
        try { player.stop(true); } catch (_) {}
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
    playCurrentMp3,
    leaveVoice,
    getConnection: () => connection
};

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
            const handled = await handleDiscordMusicInteraction(interaction, voiceApi);
            if (handled) return;
        } catch (e) {
            console.error('Discord interaction:', e.message);
        }
    });

    client.on('messageCreate', async (message) => {
        if (!client || message.author.bot || !message.guild) return;

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
            playCurrentMp3();
        } catch (e) {
            console.error('Discord message:', e.message);
        }
    });
}

export function startDiscordRadio() {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    if (!token) return;
    if (process.env.RAILWAY_ENVIRONMENT && process.env.DISCORD_ON_RAILWAY !== 'true') {
        console.log('\x1b[33m🤖 Discord: skip di Railway (set DISCORD_ON_RAILWAY=true untuk aktifkan)\x1b[0m');
        return;
    }
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
        if (!track) {
            stopDiscordPlayback();
            return;
        }
        if (connection) playCurrentMp3();
    });

    client.login(token).catch((e) => {
        console.error('❌ Discord login gagal:', e.message);
        started = false;
    });
}