import os from 'os';
import { BOT_NAME, startTime } from '../config.js';
import { state } from '../state.js';
import { runtime } from '../utils/runtime.js';
import { radio, getRadioListenUrl } from '../services/radio-server.js';
import { getDiscordRadioStatus, getDiscordDiagnostics } from '../services/discord-radio.js';

export async function handleStatusCommand({ sock, from, msg }) {
    const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
    const mem = process.memoryUsage();
    const queue = radio.queue || [];
    const current = radio.current;

    const discord = getDiscordDiagnostics();
    let discordBlock = getDiscordRadioStatus();
    if (discord.inviteUrl) {
        discordBlock += `\n🔗 Invite: ${discord.inviteUrl}`;
    }
    if (discord.slashReady) {
        discordBlock += `\n✅ Slash: ${discord.commandCount} cmd di ${discord.slashGuilds.join(', ') || 'guild'}`;
    } else if (discord.lastSlashError) {
        discordBlock += `\n❌ Slash: ${discord.lastSlashError.slice(0, 100)}`;
    }

    const text =
        `📊 *${BOT_NAME} STATUS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🟢 *Koneksi:* Online\n` +
        `💤 *Mode tidur:* ${state.isSleeping ? 'Ya — ketik !bangun (owner)' : 'Tidak'}\n` +
        `🔒 *Self mode:* ${state.isSelfMode ? 'Aktif (owner only)' : 'Public'}\n` +
        `🛡️ *Anti-link:* ${state.antiLink ? 'ON' : 'OFF'}\n` +
        `⏳ *Uptime:* ${runtime(uptimeSec)}\n` +
        `🧠 *RAM:* ${Math.round(mem.rss / 1024 / 1024)} MB\n` +
        `🖥️ *Host:* ${os.platform()} ${os.arch()}\n\n` +
        `📻 *Radio:*\n` +
        (current
            ? `▶️ ${current.title}\n👤 Request: ${current.requestedBy || '-'}\n`
            : `⏸️ Tidak ada lagu aktif\n`) +
        `📋 Antrian: ${queue.length} lagu\n` +
        `🔗 ${getRadioListenUrl()}\n\n` +
        `${discordBlock}\n\n` +
        `_Ketik !help <cmd> untuk bantuan perintah_`;

    await sock.sendMessage(from, { text }, { quoted: msg });
}