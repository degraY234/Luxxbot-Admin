import ytSearch from 'yt-search';
import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder
} from 'discord.js';
import {
    radio,
    addTrackToRadio,
    clearRadioQueue,
    getRadioListenUrl
} from './radio-server.js';
import { fetchLyrics } from './lyrics.js';

/** @type {Map<string, { tracks: object[], at: number }>} */
const playSessions = new Map();

const SESSION_TTL_MS = 5 * 60 * 1000;

function pruneSessions() {
    const now = Date.now();
    for (const [k, v] of playSessions) {
        if (now - v.at > SESSION_TTL_MS) playSessions.delete(k);
    }
}

export function buildMusicSlashCommands() {
    return [
        new SlashCommandBuilder()
            .setName('join')
            .setDescription('Luxx masuk voice channel kamu'),
        new SlashCommandBuilder()
            .setName('leave')
            .setDescription('Luxx keluar dari voice channel'),
        new SlashCommandBuilder()
            .setName('play')
            .setDescription('Cari lagu & masuk antrian radio (sinkron dengan WhatsApp)')
            .addStringOption((o) =>
                o.setName('lagu').setDescription('Judul lagu atau URL YouTube').setRequired(true)),
        new SlashCommandBuilder()
            .setName('queue')
            .setDescription('Lihat antrian lagu'),
        new SlashCommandBuilder()
            .setName('stop')
            .setDescription('Hentikan radio & kosongkan antrian'),
        new SlashCommandBuilder()
            .setName('lirik')
            .setDescription('Cari lirik lagu')
            .addStringOption((o) =>
                o.setName('lagu').setDescription('Nama lagu').setRequired(true))
    ].map((c) => c.toJSON());
}

function formatQueueEmbed() {
    const cur = radio.current;
    const q = radio.queue;
    const embed = new EmbedBuilder().setColor(0x3498db).setTitle('📋 Antrian Radio');

    if (!cur && !q.length) {
        embed.setDescription('Antrian kosong.\n\nTambah: Discord `/play` atau WhatsApp `!play`');
        return embed;
    }

    let desc = '';
    if (cur) {
        desc += `**▶️ Now playing**\n${cur.title}\n👤 ${cur.author} · 🙋 ${cur.requestedBy}\n\n`;
    }
    if (q.length) {
        desc += q.slice(0, 10).map((t, i) => `${i + 1}. ${t.title} — ${t.requestedBy}`).join('\n');
        if (q.length > 10) desc += `\n_...${q.length - 10} lagu lainnya_`;
    } else {
        desc += '_Tidak ada lagu berikutnya._';
    }
    embed.setDescription(desc);
    embed.addFields({ name: '🔗 Player', value: getRadioListenUrl() });
    return embed;
}

function buildPlaySelectMenu(userId, tracks) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`luxx_play_${userId}`)
        .setPlaceholder('Pilih lagu untuk antrian radio')
        .addOptions(
            tracks.slice(0, 5).map((t, i) => ({
                label: t.title.slice(0, 100),
                description: `${t.author.name} · ${t.timestamp}`.slice(0, 100),
                value: String(i)
            }))
        );
    return new ActionRowBuilder().addComponents(menu);
}

async function handleDiscordPlay(interaction) {
    const query = interaction.options.getString('lagu', true);
    await interaction.deferReply({ ephemeral: true });

    try {
        const search = await ytSearch(query);
        const videos = search.videos.slice(0, 5);
        if (!videos.length) {
            await interaction.editReply(`❌ Tidak ada hasil untuk **${query}**.`);
            return true;
        }

        if (videos.length === 1) {
            const v = videos[0];
            await addTrackToRadio(
                { title: v.title, url: v.url, timestamp: v.timestamp, author: v.author },
                `discord:${interaction.user.username}`
            );
            await interaction.editReply(`✅ **${v.title}** masuk antrian radio!\nSinkron dengan WhatsApp \`!nowplaying\` / \`!queue\`.`);
            return true;
        }

        const tracks = videos.map((v) => ({
            title: v.title,
            url: v.url,
            timestamp: v.timestamp,
            author: v.author
        }));
        playSessions.set(interaction.user.id, { tracks, at: Date.now() });
        pruneSessions();

        const list = tracks.map((t, i) => `**${i + 1}.** ${t.title} — ${t.author.name}`).join('\n');
        await interaction.editReply({
            content: `🎵 Hasil untuk **${query}**:\n\n${list}\n\n_Pilih dari menu di bawah:_`,
            components: [buildPlaySelectMenu(interaction.user.id, tracks)]
        });
        return true;
    } catch (e) {
        await interaction.editReply(`❌ Gagal mencari: ${e.message}`);
        return true;
    }
}

async function handlePlaySelect(interaction) {
    const session = playSessions.get(interaction.user.id);
    if (!session) {
        await interaction.reply({ content: '⏳ Sesi pencarian kedaluwarsa. Pakai `/play` lagi.', ephemeral: true });
        return true;
    }

    const idx = parseInt(interaction.values[0], 10);
    const chosen = session.tracks[idx];
    if (!chosen) {
        await interaction.reply({ content: '❌ Pilihan tidak valid.', ephemeral: true });
        return true;
    }

    playSessions.delete(interaction.user.id);
    await addTrackToRadio(
        {
            title: chosen.title,
            url: chosen.url,
            timestamp: chosen.timestamp,
            author: chosen.author
        },
        `discord:${interaction.user.username}`
    );

    await interaction.update({
        content: `✅ **${chosen.title}** masuk antrian radio!\n🙋 Request: discord:${interaction.user.username}`,
        components: []
    });
    return true;
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {{ joinMemberVoice: Function, playCurrentMp3: Function, leaveVoice: Function, getConnection: Function }} voice
 */
export async function handleDiscordMusicInteraction(interaction, voice) {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('luxx_play_')) {
        return handlePlaySelect(interaction);
    }

    if (!interaction.isChatInputCommand() || !interaction.guild) return false;

    const { commandName } = interaction;

    if (commandName === 'leave') {
        if (!voice.getConnection()) {
            await interaction.reply({ content: 'ℹ️ Bot belum di voice channel.', ephemeral: true });
            return true;
        }
        voice.leaveVoice();
        await interaction.reply('👋 Keluar dari voice channel.');
        return true;
    }

    if (commandName === 'join') {
        await interaction.deferReply();
        let member = interaction.member;
        if (interaction.guild) {
            member = await interaction.guild.members.fetch(interaction.user.id).catch(() => member);
        }
        const result = await voice.joinMemberVoice(member, interaction.guild);
        if (!result.ok) {
            await interaction.editReply(`❌ ${result.message}`);
            return true;
        }
        await interaction.editReply(
            `🎧 Masuk **${result.channelName}** — lagu dari antrian diputar di sini.\n` +
            'Perintah: `/play` `/queue` `/lirik` `/leave` `/stop` · WA: `!play` `!nowplaying`'
        );
        voice.playCurrentMp3();
        return true;
    }

    if (commandName === 'play') {
        return handleDiscordPlay(interaction);
    }

    if (commandName === 'queue') {
        await interaction.reply({ embeds: [formatQueueEmbed()] });
        return true;
    }

    if (commandName === 'stop') {
        clearRadioQueue();
        voice.leaveVoice();
        await interaction.reply('🛑 Radio dihentikan, antrian dikosongkan, bot keluar voice.');
        return true;
    }

    if (commandName === 'lirik') {
        const query = interaction.options.getString('lagu', true);
        await interaction.deferReply();
        const result = await fetchLyrics(query);
        if (!result) {
            await interaction.editReply(`❌ Lirik "${query}" tidak ditemukan.`);
            return true;
        }
        const chunk = result.slice(0, 1900);
        await interaction.editReply(chunk);
        return true;
    }

    return false;
}