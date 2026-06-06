import {
    getDiscordDiagnostics,
    getDiscordInviteUrl,
    isDiscordRadioEnabled
} from '../services/discord-radio.js';
import { getNowPlayingText } from '../utils/now-playing.js';

export async function handleDiscordCommand({ sock, from, msg }) {
    const d = getDiscordDiagnostics();
    const invite = process.env.DISCORD_SERVER_INVITE?.trim() || d.inviteUrl;
    const serverName = process.env.DISCORD_SERVER_NAME?.trim() || 'Discord server';

    let block = `🎧 *DISCORD LUXXBOT*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (!isDiscordRadioEnabled()) {
        block += `⚠️ Discord belum dikonfigurasi.\nSet \`DISCORD_BOT_TOKEN\` di .env lalu restart bot.`;
        return sock.sendMessage(from, { text: block }, { quoted: msg });
    }

    if (d.guildCount === 0) {
        block += `⚠️ Bot belum ada di server Discord.\n\n`;
        if (invite) block += `🔗 Invite:\n${invite}\n\n`;
        block += `_Setelah invite, masuk VC lalu \`/join\`._`;
        return sock.sendMessage(from, { text: block }, { quoted: msg });
    }

    block += `📡 Server: *${serverName}*\n`;
    block += `🖥️ Bot di *${d.guildCount}* server\n`;

    if (d.inVoice && d.voiceChannel) {
        block += `🔊 Voice: *${d.voiceChannel}*\n`;
    } else {
        block += `🔇 Voice: belum connect — masuk VC lalu \`/join\`\n`;
    }

    block += `\n${getNowPlayingText().replace('🎶 *NOW PLAYING*', '🎶 *Lagunya sekarang*')}\n\n`;
    block += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    block += `⚡ *Perintah Discord:*\n`;
    block += `\`/join\` \`/play\` \`/queue\` \`/lirik\` \`/leave\` \`/stop\`\n\n`;
    block += `🔄 Lagu dari Discord \`/play\` masuk antrian yang sama dengan WA \`!play\`\n\n`;

    if (invite) {
        block += `🔗 *Invite server:*\n${invite}`;
    }

    await sock.sendMessage(from, { text: block }, { quoted: msg });
}

export async function handleNowPlayingCommand({ sock, from, msg }) {
    await sock.sendMessage(from, { text: getNowPlayingText() }, { quoted: msg });
}