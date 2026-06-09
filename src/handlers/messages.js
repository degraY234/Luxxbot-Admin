import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { minify } from 'terser';

import { buildMenuText } from '../../menu.js';
import { BOT_NAME, OWNER_NUMBER, PM2_APP_NAME, ai, GEMINI_API_KEY, GEMINI_VISION_MODEL, startTime, W2G_ROOM_FILE } from '../config.js';
import { state, userAIContext } from '../state.js';
import { checkCooldown, checkCommandCooldown, getRemainingCooldown } from '../utils/cooldown.js';
import { runtime } from '../utils/runtime.js';
import { getOrCreateRoom, createW2GRoom } from '../services/w2g.js';
import { addTrackToRadio } from '../services/radio-server.js';
import { getWeatherMessages } from '../services/weather.js';
import { buildChangelogText } from '../services/changelog.js';
import { groqAI, tanyakanAI, tryCreatorReply } from '../services/ai.js';
import { askLuxxAI } from '../services/ai-context.js';
import { trackGroupBotActivity } from '../services/group-bot-context.js';

import { fetchFootballSchedule } from '../services/football.js';
import {
    handlePlayCommand,
    handleRadioCommand,
    handleQueueCommand,
    handleSkipCommand,
    handleStopCommand,
    handleLyricsCommand
} from '../commands/music.js';
import { handleDlCommand } from '../commands/dl.js';
import { handleStickerCommand } from '../commands/sticker.js';
import { handleStatusCommand } from '../commands/status.js';
import { handleHelpCommand } from '../commands/help-cmd.js';
import { handleWelcomeCommand } from '../commands/welcome.js';

import { handleQuoteCommand } from '../commands/quote.js';
import { handleQuotesAnimeCommand } from '../commands/quotes-anime.js';
import { handleDarkJokesCommand } from '../commands/darkjokes.js';
import { handleAboutLuxCommand } from '../commands/aboutlux.js';
import { handleNowPlayingCommand, handleDiscordCommand } from '../commands/discord-cmd.js';
import { handleWatchCommand } from '../commands/watch.js';
import { handleSpCommand, handleSpPick, getSpSession } from '../commands/sp.js';
import { handleJoinCommand } from '../commands/join.js';
import { handleDbCommand } from '../commands/db.js';
import { handleTranslateCommand } from '../commands/translate-cmd.js';
import { handleBeritaCommand } from '../commands/berita.js';
import { handleSastraCommand, getSastraSession, handleSastraPick } from '../commands/sastra.js';
import { handleBuatCommand } from '../commands/buat.js';
import { handlePantunCommand } from '../commands/pantun.js';
import { handleGuideCommand } from '../commands/guide.js';
import { handleLaporCommand } from '../commands/lapor.js';

let boundMessageSock = null;

const COMMAND_ALIASES = {
    mrnu: 'menu',
    halp: 'help',
    radlo: 'radio',
    ply: 'play',
    wath: 'watch'
};

/** Perintah yang pakai `|` — argumen disatukan (bukan split spasi) */
const PHRASE_COMMANDS = new Set([
    's', 'sticker', 'dl', 'quote', 'lirik', 'lyrics'
]);

export function registerMessageHandler(sock) {
    if (boundMessageSock === sock) return;
    if (boundMessageSock?.ev) {
        try { boundMessageSock.ev.removeAllListeners('messages.upsert'); } catch { /* ignore */ }
    }
    boundMessageSock = sock;

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            if (chatUpdate.type && chatUpdate.type !== 'notify') return;

            const msg = chatUpdate.messages?.[0];
            if (!msg || !msg.message) return;
            if (msg.key.fromMe) return;
            if (msg.messageStubType) return;

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = msg.key.participant || from;

            // --- Parse message body ---
            const type = Object.keys(msg.message)[0];
            let body = '';
            if (type === 'conversation') body = msg.message.conversation;
            else if (type === 'extendedTextMessage') body = msg.message.extendedTextMessage.text;
            else if (type === 'imageMessage' && msg.message.imageMessage.caption) body = msg.message.imageMessage.caption;
            else if (type === 'videoMessage' && msg.message.videoMessage.caption) body = msg.message.videoMessage.caption;

            const text = body.trim();
            let command = null;
            let args = [];
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

            const playPickMatch = text.match(/^(?:!)?(\d{1,2})(?:[.,)\s]|$)/);
            const playSession = global.playSession?.[from];
            const playSessionFresh = playSession && (Date.now() - (playSession.at || 0) < 5 * 60 * 1000);
            const spSession = getSpSession(from);
            const sastraSession = getSastraSession(from);
            const isSpPick = Boolean(spSession && playPickMatch);
            const isPlayPick = Boolean(playSessionFresh && playPickMatch && !isSpPick);
            const isSastraPick = Boolean(sastraSession && playPickMatch && !isSpPick && !isPlayPick);

            // =======================================================
            // 🔊 PILIHAN SOUND !sp → kirim audio + simpan library
            // =======================================================
            if (isSpPick) {
                const selectedIndex = parseInt(playPickMatch[1], 10) - 1;
                const handled = await handleSpPick({ sock, from, msg, selectedIndex, sender });
                if (handled) return;
            }

            // =======================================================
            // 📜 PILIHAN NEGARA !sastra → puisi dunia
            // =======================================================
            if (isSastraPick) {
                const selectedIndex = playPickMatch[1];
                const handled = await handleSastraPick({ sock, from, msg, pick: selectedIndex });
                if (handled) return;
            }

            // =======================================================
            // 📥 PILIHAN LAGU !play → antrian RADIO (tanpa tunggu download)
            // =======================================================
            if (isPlayPick) {
                const session = playSession;
                const selectedIndex = parseInt(playPickMatch[1], 10) - 1;
                if (selectedIndex >= 0 && selectedIndex < session.tracks.length) {
                    const chosenTrack = session.tracks[selectedIndex];
                    delete global.playSession[from];
                    const requester = sender.split('@')[0];

                    await sock.sendMessage(from, {
                        text: `⏳ *${chosenTrack.title}*\nSedang masuk antrian radio...`
                    }, { quoted: msg });

                    try {
                        await addTrackToRadio(chosenTrack, requester);
                        const { getDiscordRadioStatus } = await import('../services/discord-radio.js');
                        const { sendWaRadioLink } = await import('../utils/wa-radio-link.js');
                        await sendWaRadioLink(sock, from, {
                            statusText:
                                `✅ *${chosenTrack.title}* masuk antrian!\n\n` +
                                `${getDiscordRadioStatus()}\n\n` +
                                `📋 \`!queue\` · ⏭️ \`!skip\` · 📝 \`!lirik\` · 🔗 _Link player dikirim di bawah_`,
                            quoted: msg
                        });
                    } catch (e) {
                        console.error('❌ Gagal tambah ke radio:', e.message);
                        await sock.sendMessage(from, {
                            text: `❌ Gagal menambahkan lagu.\n_${(e.message || 'error').slice(0, 120)}_`
                        }, { quoted: msg });
                    }
                    return;
                }
                await sock.sendMessage(from, {
                    text: `❌ Pilih angka 1–${session.tracks.length} dari daftar !play terakhir.`
                }, { quoted: msg });
                return;
            }

            if (playSession && !playSessionFresh) {
                delete global.playSession[from];
            }

            // --- Anti-Link ---
            if (state.antiLink && isGroup && text.match(/(chat\.whatsapp\.com\/)/gi)) {
                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    const isBotAdmin = groupMetadata?.participants?.some(
                        p => p.id === botNumber && (p.admin === 'admin' || p.admin === 'superadmin')
                    );
                    if (isBotAdmin) {
                        await sock.sendMessage(from, {
                            text: `🛡️ *Hayo Ketahuan!* @${sender.split('@')[0]} dilarang sebar link grup lain! Kamu aku *kick*. 👋`,
                            mentions: [sender]
                        });
                        await sock.groupParticipantsUpdate(from, [sender], 'remove');
                        return;
                    }
                } catch (e) {
                    console.log('⚠️ AntiLink error:', e.message);
                }
            }

            if (isGroup && text) {
                const selfJid = sock.user?.id ? `${sock.user.id.split(':')[0]}@s.whatsapp.net` : undefined;
                trackGroupBotActivity(from, sender, text, selfJid);
            }

            if (!command) return;

            console.log(`\x1b[90m📩 !${command} dari ${sender.split('@')[0]}\x1b[0m`);

            // Anti-spam hanya untuk perintah ! (per user, 5 detik)
            if (!checkCommandCooldown(sender)) {
                const wait = getRemainingCooldown(sender, 'command');
                return await sock.sendMessage(from, {
                    text: `⏳ Pelan dikit ya — tunggu ~${wait || 5} detik antar perintah 😊`
                }, { quoted: msg });
            }

            const senderNumber = sender.split('@')[0];
            // ✅ FIX: isAdmin correctly scoped as const (was shadowing outer let)
            const isAdmin = OWNER_NUMBER.some(num => senderNumber === num);

            let isLocalGroupAdmin = false;
            if (isGroup) {
                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const userParticipant = groupMetadata.participants.find(p => p.id === sender);
                    isLocalGroupAdmin = userParticipant?.admin === 'admin'
                        || userParticipant?.admin === 'superadmin'
                        || isAdmin;
                } catch (e) {
                    console.log('⚠️ Gagal ambil metadata grup:', e.message);
                }
            }

            if (state.isSelfMode && !isAdmin) return;
            const wakeCommands = ['bangun', 'menu', 'help', 'guide', 'status', 'ping', 'halo', 'aboutlux'];
            if (state.isSleeping && !wakeCommands.includes(command)) {
                if (isAdmin) {
                    return await sock.sendMessage(from, {
                        text: '🛌 *Bot mode tidur.* Ketik `!bangun` untuk aktifkan semua fitur.\n`!menu` · `!status` · `!help` tetap bisa.'
                    }, { quoted: msg });
                }
                return await sock.sendMessage(from, {
                    text: '🛌 Bot lagi tidur. Ketik `!menu` atau minta owner `!bangun`.'
                }, { quoted: msg });
            }

            const ownerCommands = ['refresh', 'turu', 'bangun', 'pingsan', 'self', 'public', 'join', 'leave', 'block', 'unblock', 'spek', 'grup', 'antilink', 'speedtest', 'broadcast', 'bc', 'systeminfo', 'eval', 'resetroom'];
            if (ownerCommands.includes(command) && !isAdmin) {
                return await sock.sendMessage(from, { text: '⛔ *Akses Ditolak!* Fitur ini cuma buat Owner! 😝👑' }, { quoted: msg });
            }

            // =======================================================
            // 📜 MENU COMMAND
            // =======================================================
            if (command === 'help') {
                return handleHelpCommand({ sock, from, msg, args });
            }

            if (command === 'menu' || command === 'loot') {
                const botUptime = runtime((Date.now() - startTime) / 1000);
                const menuText = buildMenuText(state.isSelfMode, state.isSleeping, state.antiLink, isAdmin, botUptime);
                return await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            }

            if (command === 'status') {
                return handleStatusCommand({ sock, from, msg });
            }

            if (command === 'aboutlux' || command === 'about') {
                return handleAboutLuxCommand({ sock, from, msg });
            }

            if (command === 'welcome') {
                return handleWelcomeCommand({ sock, from, msg, args, isGroup, isAdmin: isLocalGroupAdmin || isAdmin });
            }

            if (command === 'sp' || command === 'sound' || command === 'soundpad') {
                return handleSpCommand({ sock, from, msg, args, sender });
            }

            if (command === 'quote' || command === 'quotes') {
                return handleQuoteCommand({ sock, from, msg, args });
            }

            // =======================================================
            // 🎮 GENERAL COMMANDS
            // =======================================================
            if (command === 'halo') {
                await sock.sendMessage(from, { text: `Halo juga Kakak manis! 🌸 Ada yang bisa ${BOT_NAME} bantu? Ketik \`!menu\` untuk lihat fiturku! 🥳✨` }, { quoted: msg });
            }

            if (command === 'ping') {
                const latensi = Date.now() - msg.messageTimestamp * 1000;
                await sock.sendMessage(from, { text: `🏓 *Pong!* Respon: *${Math.abs(latensi)}ms* 🚀💨` }, { quoted: msg });
            }

            if (command === 'changelogs' || command === 'changelog') {
                const logText = buildChangelogText();
                await sock.sendMessage(from, { text: logText }, { quoted: msg });
            }

            if (command === 'tanggal' || command === 'date') {
                const waktu = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                await sock.sendMessage(from, { text: `🗓️ *Tanggal & Waktu Jakarta*\n\n${waktu}` }, { quoted: msg });
            }

            if (command === 'warna' || command === 'color') {
                const hex = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
                await sock.sendMessage(from, { text: `🎨 *Color Picker*\n\nWarna acak: ${hex}\nCocok buat desain, stiker, atau header chat!` }, { quoted: msg });
            }

            if (command === 'server') {
                const uptime = Math.floor(process.uptime());
                const cpu = os.cpus()[0].model;
                await sock.sendMessage(from, { text: `🖥️ *Server Info*\n\nPlatform : ${os.platform()}\nArch     : ${os.arch()}\nCPU      : ${cpu}\nMemory   : ${Math.round(os.totalmem() / 1024 / 1024)} MB\nUptime    : ${Math.floor(uptime / 60)} menit` }, { quoted: msg });
            }

            // =======================================================
            // ✍️ NOTES COMMAND
            // =======================================================
            if (command === 'notes' || command === 'catatan') {
                const subCommand = args[0]?.toLowerCase();
                if (!global.notes[from]) global.notes[from] = [];

                if (!subCommand) {
                    return await sock.sendMessage(from, {
                        text: `📝 *SISTEM CATATAN*\n\n!notes add [isi]\n!notes list\n!notes view [nomor]\n!notes edit [nomor] [isi baru]\n!notes delete [nomor]\n!notes search [kata kunci]\n!notes clear`
                    }, { quoted: msg });
                }

                switch (subCommand) {
                    case 'add': {
                        if (args.length < 2) return await sock.sendMessage(from, { text: '❌ Masukkan isi catatan. Contoh: !notes add daftar belanja' }, { quoted: msg });
                        const noteContent = args.slice(1).join(' ');
                        const noteId = Date.now();
                        global.notes[from].unshift({ id: noteId, content: noteContent, created: new Date().toISOString(), updated: new Date().toISOString() });
                        await sock.sendMessage(from, { text: `📝 *Catatan ditambahkan!*\n\n${noteContent}\n\n🆔 ID: ${noteId}` }, { quoted: msg });
                        break;
                    }
                    case 'list': {
                        const notes = global.notes[from];
                        if (!notes?.length) return await sock.sendMessage(from, { text: '📭 Tidak ada catatan.' }, { quoted: msg });
                        let listText = `📋 *DAFTAR CATATAN*\n\n`;
                        notes.forEach((note, i) => {
                            const preview = note.content.length > 50 ? note.content.substring(0, 50) + '...' : note.content;
                            listText += `${i + 1}. ${preview}\n   📅 ${new Date(note.updated).toLocaleDateString('id-ID')}\n`;
                        });
                        listText += `\n📊 Total: ${notes.length} catatan`;
                        await sock.sendMessage(from, { text: listText }, { quoted: msg });
                        break;
                    }
                    case 'view': {
                        const viewNum = parseInt(args[1]);
                        if (isNaN(viewNum) || viewNum < 1 || viewNum > global.notes[from].length)
                            return await sock.sendMessage(from, { text: '❌ Nomor catatan tidak valid.' }, { quoted: msg });
                        const note = global.notes[from][viewNum - 1];
                        await sock.sendMessage(from, { text: `📄 *CATATAN #${viewNum}*\n\n${note.content}\n\n📅 ${new Date(note.created).toLocaleString('id-ID')}\n🆔 ${note.id}` }, { quoted: msg });
                        break;
                    }
                    case 'edit': {
                        if (args.length < 3) return await sock.sendMessage(from, { text: '❌ Format: !notes edit [nomor] [isi baru]' }, { quoted: msg });
                        const editNum = parseInt(args[1]);
                        if (isNaN(editNum) || editNum < 1 || editNum > global.notes[from].length)
                            return await sock.sendMessage(from, { text: '❌ Nomor tidak valid.' }, { quoted: msg });
                        const oldContent = global.notes[from][editNum - 1].content;
                        const newContent = args.slice(2).join(' ');
                        global.notes[from][editNum - 1].content = newContent;
                        global.notes[from][editNum - 1].updated = new Date().toISOString();
                        await sock.sendMessage(from, { text: `✏️ *Catatan diperbarui!*\n\nSebelum: ${oldContent}\nSesudah: ${newContent}` }, { quoted: msg });
                        break;
                    }
                    case 'delete': {
                        const deleteNum = parseInt(args[1]);
                        if (isNaN(deleteNum) || deleteNum < 1 || deleteNum > global.notes[from].length)
                            return await sock.sendMessage(from, { text: '❌ Nomor tidak valid.' }, { quoted: msg });
                        const [deleted] = global.notes[from].splice(deleteNum - 1, 1);
                        await sock.sendMessage(from, { text: `🗑️ Catatan dihapus!\n\n${deleted.content}` }, { quoted: msg });
                        break;
                    }
                    case 'search': {
                        if (args.length < 2) return await sock.sendMessage(from, { text: '❌ Masukkan kata kunci.' }, { quoted: msg });
                        const keyword = args.slice(1).join(' ').toLowerCase();
                        const results = global.notes[from].filter(n => n.content.toLowerCase().includes(keyword));
                        if (!results.length) return await sock.sendMessage(from, { text: `🔍 Tidak ditemukan catatan dengan kata kunci "${keyword}"` }, { quoted: msg });
                        let searchText = `🔍 *HASIL: "${keyword}"*\n\n`;
                        results.forEach((n, i) => { searchText += `${i + 1}. ${n.content.substring(0, 50)}\n`; });
                        await sock.sendMessage(from, { text: searchText }, { quoted: msg });
                        break;
                    }
                    case 'clear': {
                        const cnt = global.notes[from]?.length || 0;
                        global.notes[from] = [];
                        await sock.sendMessage(from, { text: `🧹 ${cnt} catatan dihapus!` }, { quoted: msg });
                        break;
                    }
                    default:
                        await sock.sendMessage(from, { text: '❌ Perintah tidak dikenali. Ketik !notes untuk bantuan.' }, { quoted: msg });
                }
            }

            // =======================================================
            // ⏰ REMINDER COMMAND
            // =======================================================
            if (command === 'reminder' || command === 'pengingat') {
                const subCommand = args[0]?.toLowerCase();
                if (!global.reminders[from]) global.reminders[from] = [];

                if (!subCommand) {
                    return await sock.sendMessage(from, {
                        text: `⏰ *SISTEM PENGINGAT*\n\n!reminder add [waktu] [pesan]\n!reminder list\n!reminder delete [id]\n!reminder clear\n\n⏱️ Format waktu: 30m, 2h, 1d, atau HH:MM`
                    }, { quoted: msg });
                }

                switch (subCommand) {
                    case 'add': {
                        if (args.length < 3) return await sock.sendMessage(from, { text: '❌ Format: !reminder add 30m pesan kamu' }, { quoted: msg });
                        const timeInput = args[1];
                        const reminderMessage = args.slice(2).join(' ');
                        const now = new Date();
                        let reminderTime;
                        if (timeInput.includes(':')) {
                            const [hours, minutes] = timeInput.split(':').map(Number);
                            reminderTime = new Date();
                            reminderTime.setHours(hours, minutes, 0, 0);
                            if (reminderTime < now) reminderTime.setDate(reminderTime.getDate() + 1);
                        } else {
                            const unit = timeInput.slice(-1);
                            const value = parseInt(timeInput.slice(0, -1));
                            reminderTime = new Date(now);
                            if (unit === 'm') reminderTime.setMinutes(now.getMinutes() + value);
                            else if (unit === 'h') reminderTime.setHours(now.getHours() + value);
                            else if (unit === 'd') reminderTime.setDate(now.getDate() + value);
                            else return await sock.sendMessage(from, { text: '❌ Format waktu salah! Gunakan: 30m, 2h, 1d, atau HH:MM' }, { quoted: msg });
                        }
                        const reminderId = Date.now();
                        const reminder = { id: reminderId, time: reminderTime, message: reminderMessage, created: now, chatId: from };
                        global.reminders[from].push(reminder);
                        const timeDiff = reminderTime - now;
                        const hoursDiff = Math.floor(timeDiff / (1000 * 60 * 60));
                        const minutesDiff = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
                        const timeText = hoursDiff > 0 ? `${hoursDiff} jam ${minutesDiff} menit` : `${minutesDiff} menit`;
                        await sock.sendMessage(from, {
                            text: `✅ *Pengingat ditambahkan!*\n\n📝 Pesan: ${reminderMessage}\n⏰ Waktu: ${reminderTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}\n⏳ Dalam: ${timeText}\n🆔 ID: ${reminderId}`
                        }, { quoted: msg });
                        setTimeout(async () => {
                            const idx = global.reminders[from]?.findIndex(r => r.id === reminderId);
                            if (idx !== -1) {
                                await sock.sendMessage(from, { text: `⏰ *PENGINGAT!*\n\n${reminderMessage}` });
                                global.reminders[from].splice(idx, 1);
                            }
                        }, timeDiff);
                        break;
                    }
                    case 'list': {
                        const userReminders = global.reminders[from];
                        if (!userReminders?.length) return await sock.sendMessage(from, { text: '📭 Tidak ada pengingat aktif.' }, { quoted: msg });
                        let listText = `📋 *DAFTAR PENGINGAT AKTIF*\n\n`;
                        userReminders.forEach((r, i) => {
                            const timeLeft = r.time - new Date();
                            const hLeft = Math.floor(timeLeft / (1000 * 60 * 60));
                            const mLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                            listText += `${i + 1}. 📝 ${r.message}\n   ⏰ ${r.time.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}\n`;
                            listText += hLeft > 0 ? `   ⏳ ${hLeft} jam ${mLeft} menit lagi\n` : (mLeft > 0 ? `   ⏳ ${mLeft} menit lagi\n` : `   🔴 Segera!\n`);
                            listText += `   🆔 ${r.id}\n\n`;
                        });
                        await sock.sendMessage(from, { text: listText }, { quoted: msg });
                        break;
                    }
                    case 'delete': {
                        const idToDelete = args[1];
                        if (!idToDelete) return await sock.sendMessage(from, { text: '❌ Masukkan ID pengingat.' }, { quoted: msg });
                        const idx = global.reminders[from].findIndex(r => r.id == idToDelete);
                        if (idx === -1) return await sock.sendMessage(from, { text: `❌ ID ${idToDelete} tidak ditemukan.` }, { quoted: msg });
                        const [deleted] = global.reminders[from].splice(idx, 1);
                        await sock.sendMessage(from, { text: `🗑️ *Pengingat dihapus!*\n\n📝 ${deleted.message}` }, { quoted: msg });
                        break;
                    }
                    case 'clear': {
                        const count = global.reminders[from]?.length || 0;
                        global.reminders[from] = [];
                        await sock.sendMessage(from, { text: `🧹 ${count} pengingat dihapus!` }, { quoted: msg });
                        break;
                    }
                    default:
                        await sock.sendMessage(from, { text: '❌ Perintah tidak dikenali. Ketik !reminder untuk bantuan.' }, { quoted: msg });
                }
            }

            // =======================================================
            // 👥 GROUP MANAGEMENT
            // =======================================================
            if (command === 'add') {
                if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Ini cuma bisa di dalam grup Kak! 🏡' }, { quoted: msg });
                if (!isLocalGroupAdmin) return await sock.sendMessage(from, { text: '❌ Cuma admin grup atau Owner yang boleh masukin orang! 👑' }, { quoted: msg });
                const targetNum = args[0]?.replace(/[^0-9]/g, '');
                if (!targetNum) return await sock.sendMessage(from, { text: '⚠️ Masukkan nomor yang benar. Contoh: `!add 628xxx` 📱' }, { quoted: msg });
                try {
                    await sock.groupParticipantsUpdate(from, [targetNum + '@s.whatsapp.net'], 'add');
                    await sock.sendMessage(from, { text: `✅ Berhasil nambahin @${targetNum} ke grup! 🎉`, mentions: [targetNum + '@s.whatsapp.net'] }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal masukin orang, kayaknya aku belum jadi admin deh! 🥺' }, { quoted: msg });
                }
            }

            if (command === 'tagall') {
                if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Cuma bisa di grup ya Kak! 🏡' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                const peserta = groupMetadata.participants;
                const teksTambahan = args.join(' ') || 'Panggilan Darurat, Kumpul yuk!';
                let pesanTag = `📢 *PANGGILAN UNTUK SEMUA!* 📢\n📌 *Pesan:* ${teksTambahan}\n\n`;
                const mentions = [];
                for (let jlh of peserta) {
                    pesanTag += `@${jlh.id.split('@')[0]}\n`;
                    mentions.push(jlh.id);
                }
                await sock.sendMessage(from, { text: pesanTag, mentions }, { quoted: msg });
            }

            // =======================================================
            // 🌸 ANIME COMMANDS
            // =======================================================
            if (command === 'anime') {
                try {
                    const query = args.join(' ') || 'popular';
                    await sock.sendMessage(from, { text: '🎌 Sedang mencari anime...' }, { quoted: msg });
                    const url = query === 'popular'
                        ? 'https://api.jikan.moe/v4/top/anime?limit=25'
                        : `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`;
                    const res = await axios.get(url);
                    const anime = query === 'popular'
                        ? res.data.data[Math.floor(Math.random() * res.data.data.length)]
                        : res.data.data[0];
                    if (!anime) return await sock.sendMessage(from, { text: '❌ Anime tidak ditemukan.' }, { quoted: msg });
                    await sock.sendMessage(from, {
                        image: { url: anime.images.jpg.large_image_url },
                        caption: `╭━━━〔 🎌 ANIME INFO 🎌 〕━━━\n\n📺 Judul : ${anime.title}\n⭐ Rating : ${anime.score || '-'}\n🎭 Genre : ${anime.genres.map(v => v.name).join(', ')}\n📅 Tahun : ${anime.year || '-'}\n🎬 Episode : ${anime.episodes || '?'}\n\n📝 Sinopsis:\n${anime.synopsis?.substring(0, 400) || '-'}\n\n━━━━━━━━━━━━━━━━━━`
                    }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ Gagal mengambil info anime.' }, { quoted: msg });
                }
            }

            if (command === 'waifu') {
                try {
                    await sock.sendMessage(from, { text: '💖 Sedang mencari waifu...' }, { quoted: msg });
                    const res = await axios.get('https://nekos.best/api/v2/waifu');
                    const waifu = res.data.results[0];
                    const level = Math.floor(Math.random() * 100) + 1;
                    await sock.sendMessage(from, {
                        image: { url: waifu.url },
                        caption: `╭━━━〔 💖 WAIFU OF THE DAY 💖 〕━━━\n\n🌸 Status : Waifu berhasil ditemukan\n💕 Cute Level : ${level}%\n✨ Quality : Ultra HD\n\n━━━━━━━━━━━━━━━━━━`
                    }, { quoted: msg });
                } catch (err) {
                    await sock.sendMessage(from, { text: '❌ Gagal mengambil waifu.' }, { quoted: msg });
                }
            }

            if (command === 'quotesanime') {
                if (!checkCooldown(sender, 'quotesanime', 8000)) {
                    return await sock.sendMessage(from, { text: '⏳ Tunggu sebentar sebelum quote anime berikutnya.' }, { quoted: msg });
                }
                return handleQuotesAnimeCommand({ sock, from, msg });
            }

            if (command === 'character' || command === 'chara') {
                const charQuery = args.join(' ');
                if (!charQuery) return await sock.sendMessage(from, { text: '⚠️ Format: `!character nama_karakter`' }, { quoted: msg });
                await sock.sendMessage(from, { text: '🔍 Mencari karakter...' }, { quoted: msg });
                try {
                    const res = await axios.get(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(charQuery)}&limit=1`);
                    const char = res.data?.data?.[0];
                    if (!char) return await sock.sendMessage(from, { text: '❌ Karakter tidak ditemukan.' }, { quoted: msg });
                    const imgUrl = char.images?.jpg?.image_url;
                    const text2 = `👤 *${char.name}*\n\n📖 Nicknames: ${char.nicknames?.join(', ') || '-'}\n💖 Favorites: ${char.favorites || 0}`;
                    if (imgUrl) {
                        await sock.sendMessage(from, { image: { url: imgUrl }, caption: text2 }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: text2 }, { quoted: msg });
                    }
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Error saat mencari karakter.' }, { quoted: msg });
                }
            }

            // =======================================================
            // 🎵 MUSIC & ENTERTAINMENT
            // =======================================================
            if (command === 'play' || command === 'musik') {
                return await handlePlayCommand({ sock, from, msg, args });
            }

            if (command === 'radio') {
                return await handleRadioCommand({ sock, from, msg });
            }

            if (command === 'nowplaying' || command === 'np') {
                return await handleNowPlayingCommand({ sock, from, msg });
            }

            if (command === 'discord') {
                return await handleDiscordCommand({ sock, from, msg });
            }

            if (command === 'watch' || command === 'stream' || command === 'st' || command === 'nonton') {
                return await handleWatchCommand({ sock, from, msg });
            }

            if (command === 'queue') {
                return await handleQueueCommand({ sock, from, msg });
            }

            if (command === 'skip' || command === 'next') {
                return await handleSkipCommand({ sock, from, msg });
            }

            if (command === 'stop') {
                return await handleStopCommand({ sock, from, msg, isAdmin });
            }

            if (command === 'lirik' || command === 'lyrics') {
                return await handleLyricsCommand({ sock, from, msg, args });
            }

            if (command === 'darkjokes') {
                if (!checkCooldown(sender, 'darkjokes', 8000)) {
                    return await sock.sendMessage(from, { text: '⏳ Tunggu sebentar sebelum dark joke berikutnya.' }, { quoted: msg });
                }
                return handleDarkJokesCommand({ sock, from, msg });
            }

            if (command === 'cerpen') {
                const tema = args.join(' ') || 'petualangan';
                await sock.sendMessage(from, { text: '📖 Sedang menulis cerpen...' }, { quoted: msg });
                const hasil = await groqAI(`Buat cerpen Indonesia tema ${tema}.\n\nFormat:\n📖 Judul:\n...\n\n📚 Cerita:\n...\n\n✨ Pesan Moral:\n...\n\nPanjang sekitar 300 kata.`);
                await sock.sendMessage(from, { text: `╭━━━〔 📖 CERPEN ${tema.toUpperCase()} 📖 〕━━━\n\n${hasil || 'Gagal nulis cerpen 😭'}\n\n━━━━━━━━━━━━━━━━━━` }, { quoted: msg });
            }

            if (command === 'pantun') {
                return handlePantunCommand({ sock, from, msg, args });
            }

            if (command === 'meme') {
                const subreddit = args[0] || 'memes';
                await sock.sendMessage(from, { text: `📦 Mencari meme di r/${subreddit}...` }, { quoted: msg });
                try {
                    const res = await axios.get(`https://meme-api.com/gimme/${encodeURIComponent(subreddit)}`, { timeout: 8000 });
                    const data = res.data;
                    const url = data.url;
                    const isVideo = data.is_video || /\.mp4$|\.gif$/.test(url);
                    const caption = `😂 *${data.title || 'Meme'}*\n👤 ${data.author} • r/${data.subreddit}`;
                    if (isVideo) await sock.sendMessage(from, { video: { url }, caption }, { quoted: msg });
                    else await sock.sendMessage(from, { image: { url }, caption }, { quoted: msg });
                } catch (e) {
                    try {
                        const alt = await axios.get('https://api.imgflip.com/get_memes', { timeout: 6000 });
                        const templates = alt.data?.data?.memes || [];
                        const pick = templates[Math.floor(Math.random() * templates.length)];
                        if (pick?.url) await sock.sendMessage(from, { image: { url: pick.url }, caption: `😂 *${pick.name}*` }, { quoted: msg });
                        else throw new Error('No imgflip');
                    } catch (_) {
                        await sock.sendMessage(from, { text: '❌ Gagal dapet meme, coba lagi nanti.' }, { quoted: msg });
                    }
                }
            }

            // ✅ FIX: !lihat command - missing stream definition added
            if (command === 'lihat') {
                const isMedia = (type === 'imageMessage');
                const isQuotedMedia = type === 'extendedTextMessage' && msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                const captionPrompt = args.join(' ') || 'Analisis dan jelaskan objek apa saja yang ada di gambar ini secara mendalam.';
                if (!isMedia && !isQuotedMedia) return await sock.sendMessage(from, { text: '⚠️ Kirim gambarnya pakai caption `!lihat`, atau reply gambar yang ada! 📸' }, { quoted: msg });
                await sock.sendMessage(from, { text: '👁️ Aku lagi liatin gambarnya... 🧐✨' });
                try {
                    const mediaContext = isQuotedMedia
                        ? msg.message.extendedTextMessage.contextInfo.quotedMessage
                        : msg.message;
                    if (!mediaContext?.imageMessage) return await sock.sendMessage(from, { text: '❌ Gambar tidak valid.' }, { quoted: msg });
                    // ✅ FIX: stream was undefined — now properly declared here
                    const stream = await downloadContentFromMessage(mediaContext.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    const response = await ai.models.generateContent({
                        model: GEMINI_VISION_MODEL,
                        contents: [{ parts: [{ inlineData: { mimeType: 'image/jpeg', data: buffer.toString('base64') } }, { text: captionPrompt }] }]
                    });
                    await sock.sendMessage(from, { text: `👁️ *HASIL PENGLIHATANKU:* ✨\n\n${response.text}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal muat media! 😭' }, { quoted: msg });
                }
            }

            if (command === 'tanya') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Mau nanya apa? Ketik pertanyaannya! 🤓✨' }, { quoted: msg });
                try {
                    const res = await askLuxxAI(sock, from, sender, isGroup, isAdmin, query, 'tanya');
                    await sock.sendMessage(from, { text: res || '❌ AI tidak merespons. Coba lagi.' }, { quoted: msg });
                } catch (e) {
                    console.error('TANYA ERROR:', e?.message || e);
                    await sock.sendMessage(from, { text: '❌ Gagal memproses pertanyaan. Coba lagi sebentar.' }, { quoted: msg });
                }
            }

            if (command === 'db' || command === 'database') {
                return handleDbCommand({ sock, from, sender, isGroup, isAdmin, msg, args });
            }

            if (command === 'coding') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Kasih kode atau error-nya! 💻✨' }, { quoted: msg });
                const res = await askLuxxAI(sock, from, sender, isGroup, isAdmin, query, 'coding');
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            if (command === 'code') {
                const queryKode = args.join(' ');
                if (!queryKode) return await sock.sendMessage(from, { text: '⚠️ Mana kode yang mau di-debug? 💻' }, { quoted: msg });
                const hasilAI = await askLuxxAI(sock, from, sender, isGroup, isAdmin, `Debug, review, dan jelaskan error serta optimalisasi kode berikut:\n\n${queryKode}`, 'coding');
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'rangkum') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Mana teks yang mau diringkas? 📑' }, { quoted: msg });
                const res = await askLuxxAI(sock, from, sender, isGroup, isAdmin, query, 'rangkum');
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            if (command === 'brainstorm') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Butuh ide apa? Sebutin topiknya! 💡' }, { quoted: msg });
                const res = await askLuxxAI(sock, from, sender, isGroup, isAdmin, query, 'brainstorm');
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            if (command === 'translate' || command === 'tr') {
                return handleTranslateCommand({ sock, from, msg, args });
            }

            if (command === 'berita' || command === 'news') {
                return handleBeritaCommand({ sock, from, msg, args });
            }

            if (command === 'sastra' || command === 'puisi') {
                return handleSastraCommand({ sock, from, msg, args });
            }

            if (command === 'buat' || command === 'generate') {
                return handleBuatCommand({ sock, from, msg, args });
            }

            if (command === 'guide' || command === 'start' || command === 'panduan') {
                return handleGuideCommand({ sock, from, msg });
            }

            if (command === 'lapor' || command === 'report' || command === 'feedback') {
                return handleLaporCommand({ sock, from, msg, args, sender, isGroup });
            }

            if (command === 'q') {
                const queryText = args.join(' ');
                if (!queryText) return await sock.sendMessage(from, { text: '⚠️ Ngobrol apa aja bebas! Contoh: `!q halo` 💬' }, { quoted: msg });
                const res = await askLuxxAI(sock, from, sender, isGroup, isAdmin, queryText, 'chat_context');
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            if (command === 'resetai') {
                for (const key of [...userAIContext.keys()]) {
                    if (key === from || key.startsWith(`${from}|`)) userAIContext.delete(key);
                }
                await sock.sendMessage(from, { text: '♻️ *Memori Terhapus!* Obrolan kita udah aku lupain semua. Yuk mulai dari awal! 🌸' }, { quoted: msg });
            }

            if (command === 'fact') {
                const hasilAI = await askLuxxAI(sock, from, sender, isGroup, isAdmin, 'Kasih satu fakta unik, menarik, dan jarang orang tahu — satu paragraf singkat.', 'fact');
                await sock.sendMessage(from, { text: `💡 *FAKTA MENARIK HARI INI:* 🌟\n\n${hasilAI}` }, { quoted: msg });
            }

            if (command === 'curhat') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Ayo cerita, aku siap dengerin! 🫂💖' }, { quoted: msg });
                const res = await askLuxxAI(sock, from, sender, isGroup, isAdmin, query, 'curhat');
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            if (command === 'roastme') {
                const target = args.join(' ') || 'saya';
                const hasilAI = await askLuxxAI(sock, from, sender, isGroup, isAdmin, `Roasting ${target} dengan sarkasme lucu dan menghibur, tapi sopan.`, 'curhat');
                await sock.sendMessage(from, { text: `🔥 *WAKTUNYA ROASTING!* 🔥\n\n${hasilAI}` }, { quoted: msg });
            }

            // =======================================================
            // 📦 UTILITY & TOOLS
            // =======================================================
            if (command === 'cuaca' || command === 'weather') {
                const lokasi = args.join(' ').trim();
                if (!lokasi) {
                    return await sock.sendMessage(from, {
                        text: '❗️ Masukkan lokasi.\nContoh: `!cuaca Makassar` · `!cuaca Jakarta`'
                    }, { quoted: msg });
                }
                await sock.sendMessage(from, { text: `🌤️ Mengambil cuaca *${lokasi}*...` }, { quoted: msg });
                try {
                    const messages = await getWeatherMessages(lokasi);
                    for (let i = 0; i < messages.length; i++) {
                        await sock.sendMessage(from, { text: messages[i] }, { quoted: i === 0 ? msg : undefined });
                        if (i < messages.length - 1) await new Promise((r) => setTimeout(r, 700));
                    }
                } catch (err) {
                    console.error('CUACA ERROR:', err.message);
                    await sock.sendMessage(from, {
                        text:
                            `❌ Gagal ambil cuaca untuk *${lokasi}*.\n\n` +
                            `💡 Coba nama lebih spesifik:\n` +
                            `• \`!cuaca Makassar\`\n` +
                            `• \`!cuaca Jakarta Pusat\`\n` +
                            `• \`!cuaca Surabaya, Jawa Timur\`\n\n` +
                            `_${(err.message || '').slice(0, 120)}_`
                    }, { quoted: msg });
                }
            }

            if (command === 'kalkulator') {
                const rumus = args.join(' ');
                if (!rumus) return await sock.sendMessage(from, { text: '⚠️ Contoh: `!kalkulator (10 * 5) / 2` 🧮' }, { quoted: msg });
                try {
                    const hasilHitung = new Function(`return (${rumus})`)();
                    await sock.sendMessage(from, { text: `🧮 *HASIL:* ✨\n\n\`${rumus}\` = *${hasilHitung}*` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Rumus salah! Cek lagi ya. 😵' }, { quoted: msg });
                }
            }

            if (command === 'qr') {
                const teksQr = args.join(' ');
                if (!teksQr) return await sock.sendMessage(from, { text: '⚠️ Masukkan teks atau URL! 🔳' }, { quoted: msg });
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(teksQr)}`;
                await sock.sendMessage(from, { image: { url: qrUrl }, caption: `✅ *QR Code siap!* 🥳✨` }, { quoted: msg });
            }

            if (command === 'stalk') {
                const userGit = args[0];
                if (!userGit) return await sock.sendMessage(from, { text: '⚠️ Contoh: `!stalk doxxborx` 🐙' }, { quoted: msg });
                try {
                    const res = await axios.get(`https://api.github.com/users/${userGit}`);
                    const stalkText = `🐙 *PROFIL GITHUB* 🐙\n━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *Nama:* ${res.data.name || userGit}\n🏢 *Perusahaan:* ${res.data.company || '-'}\n📍 *Lokasi:* ${res.data.location || '-'}\n📁 *Repo Publik:* ${res.data.public_repos}\n👥 *Followers:* ${res.data.followers} | *Following:* ${res.data.following}\n🔗 ${res.data.html_url}`;
                    await sock.sendMessage(from, { text: stalkText }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Akun GitHub tidak ditemukan.' }, { quoted: msg });
                }
            }

            if (command === 'ocr') {
                const isMedia = (type === 'imageMessage');
                const isQuotedMedia = type === 'extendedTextMessage' && msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                if (!isMedia && !isQuotedMedia) return await sock.sendMessage(from, { text: '⚠️ Kirim gambar dengan caption `!ocr` ya! 📸' }, { quoted: msg });
                await sock.sendMessage(from, { text: '🔍 Lagi baca tulisan di gambar...' });
                try {
                    const mediaContext = isQuotedMedia ? msg.message.extendedTextMessage.contextInfo.quotedMessage : msg.message;
                    const stream = await downloadContentFromMessage(mediaContext.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    const response = await ai.models.generateContent({
                        model: GEMINI_VISION_MODEL,
                        contents: [{ parts: [{ inlineData: { mimeType: 'image/jpeg', data: buffer.toString('base64') } }, { text: 'Tolong ekstrak dan tulis ulang seluruh teks yang ada di gambar ini secara utuh dan akurat.' }] }]
                    });
                    await sock.sendMessage(from, { text: `📝 *HASIL OCR:* 🎀\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${response.text}` }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(from, { text: '❌ Gagal baca teks! Gambarnya mungkin buram. 😭' }, { quoted: msg });
                }
            }

            if (command === 'remini') {
                await sock.sendMessage(from, {
                    text: '⚠️ !remini sementara nonaktif (modul canvas bermasalah di server). Kirim ulang nanti.'
                }, { quoted: msg });
            }

            // =======================================================
            // 🎨 STICKER — !s (alias !sticker)
            // =======================================================
            if (command === 'sticker' || command === 's') {
                if (!checkCooldown(sender, 'sticker', 10000)) {
                    return sock.sendMessage(from, { text: '⏳ Sabar ya, jangan spam 😤' }, { quoted: msg });
                }
                return handleStickerCommand({ sock, from, msg, args });
            }

            // =======================================================
            // 📥 DOWNLOAD — !dl
            // =======================================================
            if (command === 'dl') {
                if (!checkCooldown(sender, 'dl', 15000)) {
                    return sock.sendMessage(from, { text: '⏳ Tunggu dulu, download butuh waktu~' }, { quoted: msg });
                }
                return handleDlCommand({ sock, from, msg, args });
            }

            // =======================================================
            // 🎲 GAMES & FUN
            // =======================================================
            if (command === 'gacha') {
                const inputGacha = args.join(' ');
                if (!inputGacha || !inputGacha.includes('|')) {
                    return await sock.sendMessage(from, { text: `❌ Format: \`!gacha Topik | Opsi A | Opsi B | Opsi C\`` }, { quoted: msg });
                }
                const komponen = inputGacha.split('|').map(item => item.trim());
                const topik = komponen[0];
                const listPilihan = komponen.slice(1);
                if (listPilihan.length < 2) return await sock.sendMessage(from, { text: '❌ Minimal 2 opsi pilihan!' }, { quoted: msg });
                await sock.sendMessage(from, { text: `🌀 *ZetBot lagi memutar dadu takdir...* 🤔 "${topik}"` }, { quoted: msg });
                const opsiTerpilih = listPilihan[Math.floor(Math.random() * listPilihan.length)];
                setTimeout(async () => {
                    await sock.sendMessage(from, { text: `🎲 *HASIL GACHA!* 🎲\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 *Topik:* "${topik}"\n🎉 *Keputusan:* ✨ *[ ${opsiTerpilih} ]* ✨\n\n━━━━━━━━━━━━━━━━━━━━━━━\nKeputusan bot bersifat mutlak! 😎` });
                }, 1500);
            }

            if (command === 'apakah') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Tanya apa aja! 🔮' }, { quoted: msg });
                const jawaban = ['Iya pasti dong! 😍', 'Kelihatannya begitu... 🤔', 'Mungkin aja 🌸', 'Wah itu ga mungkin! 🙅‍♀️', 'Sangat tidak direkomendasikan. 🛑', 'Coba tanya lagi besok 🤭'];
                await sock.sendMessage(from, { text: `🔮 *Pertanyaan:* Apakah ${query}\n🎲 *Jawaban:* ${jawaban[Math.floor(Math.random() * jawaban.length)]}` }, { quoted: msg });
            }

            if (command === 'kapankah') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Tanya waktu apa? ⏳' }, { quoted: msg });
                const prediksi = ['3 Hari lagi! 🚀', '5 tahun lagi', 'Besok subuh! 🌅', 'Nanti kalau dinosaurus hidup lagi 🦖', 'Abad depan... 👴'];
                await sock.sendMessage(from, { text: `⏳ *Pertanyaan:* Kapankah ${query}\n🎯 *Prediksi:* ${prediksi[Math.floor(Math.random() * prediksi.length)]}` }, { quoted: msg });
            }

            if (command === 'truth') {
                const listTruth = [
                    'Apa ketakutan terbesar yang pernah kamu sembunyikan dari teman terdekatmu?',
                    'Kapan terakhir kali kamu berbohong demi menghindari tugas kelompok?',
                    'Apa rahasia memalukan di HP kamu yang tidak boleh diketahui siapa pun?',
                    'Pernahkah kamu menyukai seseorang diam-diam di grup chat ini?'
                ];
                await sock.sendMessage(from, { text: `🎲 *WAKTUNYA JUJUR!* 🫣\n\n_"${listTruth[Math.floor(Math.random() * listTruth.length)]}"_` }, { quoted: msg });
            }

            if (command === 'dare') {
                const listDare = [
                    'Kirim voice note bernyanyi lagu anak-anak selama 15 detik ke grup!',
                    'Ganti nama profil WhatsApp kamu menjadi "Anak Kesayangan ZetBot" selama 1 jam.',
                    'Tag orang yang paling sering kamu stalk profilnya!'
                ];
                await sock.sendMessage(from, { text: `🎲 *TANTANGAN BUAT KAMU!* 😈\n\n⚡ *Wajib Lakuin:* _"${listDare[Math.floor(Math.random() * listDare.length)]}"_` }, { quoted: msg });
            }

            // =======================================================
            // 🗳️ VOTING SYSTEM
            // =======================================================
            if (command === 'voting') {
                const inputVoting = args.join(' ');
                if (!inputVoting || !inputVoting.includes('|')) {
                    return await sock.sendMessage(from, { text: `❌ Format salah!\n\n👉 Dengan timer: \`!voting 10m | Judul | Opsi A | Opsi B\`\n👉 Manual: \`!voting Judul | Opsi A | Opsi B\`` }, { quoted: msg });
                }
                const komponen = inputVoting.split('|').map(item => item.trim());
                const bagianPertama = komponen[0];
                const kataPertama = bagianPertama.split(' ')[0].toLowerCase();
                let topik = bagianPertama;
                let timeoutId = null;
                let teksDurasi = 'Manual (Ditutup lewat !endvoting)';
                const apakahPakaiWaktu = kataPertama.match(/^\d+[mh]$/);
                if (apakahPakaiWaktu) {
                    topik = bagianPertama.split(' ').slice(1).join(' ');
                    const angkaWaktu = parseInt(kataPertama);
                    const IsMenit = kataPertama.endsWith('m');
                    const durasiMs = IsMenit ? angkaWaktu * 60 * 1000 : angkaWaktu * 3600 * 1000;
                    teksDurasi = IsMenit ? `${angkaWaktu} Menit` : `${angkaWaktu} Jam`;
                    timeoutId = setTimeout(async () => {
                        const targetVoting = global.activeVotes[from];
                        if (targetVoting) {
                            const totalSuara = targetVoting.opsi.reduce((sum, o) => sum + o.jumlahSuara, 0);
                            let teksAkhir = `⏱️ *WAKTU HABIS! VOTING DITUTUP OTOMATIS* ⏱️\n\n📋 *Hasil Akhir:* "${targetVoting.topik}"\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                            targetVoting.opsi.forEach((item, i) => {
                                const pct = totalSuara > 0 ? ((item.jumlahSuara / totalSuara) * 100).toFixed(0) : 0;
                                teksAkhir += `${i + 1}. ${item.nama} ➡️ *${item.jumlahSuara} Suara* (${pct}%)\n`;
                            });
                            teksAkhir += `━━━━━━━━━━━━━━━━━━━━━━━\n🎉 Total: ${totalSuara} Pemilih.`;
                            await sock.sendMessage(from, { text: teksAkhir });
                            delete global.activeVotes[from];
                        }
                    }, durasiMs);
                }
                const opsi = komponen.slice(1);
                if (!topik) return await sock.sendMessage(from, { text: '❌ Topik voting belum diisi!' }, { quoted: msg });
                if (opsi.length < 2) return await sock.sendMessage(from, { text: '❌ Minimal 2 opsi pilihan!' }, { quoted: msg });
                if (global.activeVotes[from]?.timeoutId) clearTimeout(global.activeVotes[from].timeoutId);
                global.activeVotes[from] = {
                    topik,
                    opsi: opsi.map(namaOpsi => ({ nama: namaOpsi, jumlahSuara: 0 })),
                    pemilih: [],
                    timeoutId
                };
                let teksVoting = `📊 *VOTING BARU DIMULAI!* 📊\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 *Topik:* "${topik}"\n⏳ *Durasi:* ${teksDurasi}\n\n📋 *Opsi Pilihan:*\n`;
                global.activeVotes[from].opsi.forEach((item, i) => { teksVoting += `${i + 1}. ${item.nama}\n`; });
                teksVoting += `\n━━━━━━━━━━━━━━━━━━━━━━━\n👉 Ketik *!pilih [nomor_opsi]*\n🛑 Ketik *!endvoting* untuk menutup.`;
                await sock.sendMessage(from, { text: teksVoting }, { quoted: msg });
            }

            // ✅ FIX: !pilih command was truncated — now complete
            if (command === 'pilih') {
                const targetVoting = global.activeVotes[from];
                if (!targetVoting) return await sock.sendMessage(from, { text: '❌ Tidak ada sesi voting yang berjalan!' }, { quoted: msg });
                const pilihanIndex = parseInt(args[0]) - 1;
                if (isNaN(pilihanIndex) || pilihanIndex < 0 || pilihanIndex >= targetVoting.opsi.length) {
                    return await sock.sendMessage(from, { text: '❌ Nomor opsi tidak valid! Cek listnya lagi.' }, { quoted: msg });
                }
                if (targetVoting.pemilih.includes(sender)) {
                    return await sock.sendMessage(from, { text: '❌ Kamu sudah memberikan suara! Tidak boleh dua kali. 😉' }, { quoted: msg });
                }
                // ✅ Cast vote, add to voters list
                targetVoting.opsi[pilihanIndex].jumlahSuara += 1;
                targetVoting.pemilih.push(sender);
                const totalSuara = targetVoting.opsi.reduce((sum, o) => sum + o.jumlahSuara, 0);
                let teksSkor = `✅ *Suara Berhasil Dicatat!*\n\n📊 *Hasil Sementara:* "${targetVoting.topik}"\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                targetVoting.opsi.forEach((item, i) => {
                    const pct = totalSuara > 0 ? ((item.jumlahSuara / totalSuara) * 100).toFixed(0) : 0;
                    teksSkor += `${i + 1}. ${item.nama} ➡️ *${item.jumlahSuara} Suara* (${pct}%)\n`;
                });
                teksSkor += `━━━━━━━━━━━━━━━━━━━━━━━\n📥 Total Suara: *${totalSuara}*`;
                await sock.sendMessage(from, { text: teksSkor }, { quoted: msg });
            }

            if (command === 'endvoting') {
                const targetVoting = global.activeVotes[from];
                if (!targetVoting) return await sock.sendMessage(from, { text: '❌ Tidak ada sesi voting yang aktif.' }, { quoted: msg });
                if (!isAdmin && !isLocalGroupAdmin) return await sock.sendMessage(from, { text: '❌ Hanya *Admin Grup* atau *Owner Bot* yang bisa menutup voting.' }, { quoted: msg });
                const totalSuara = targetVoting.opsi.reduce((sum, o) => sum + o.jumlahSuara, 0);
                let teksAkhir = `🛑 *VOTING RESMI DITUTUP!* 🛑\n\n📋 *Hasil Akhir:* "${targetVoting.topik}"\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                targetVoting.opsi.forEach((item, i) => {
                    const pct = totalSuara > 0 ? ((item.jumlahSuara / totalSuara) * 100).toFixed(0) : 0;
                    teksAkhir += `${i + 1}. ${item.nama} ➡️ *${item.jumlahSuara} Suara* (${pct}%)\n`;
                });
                teksAkhir += `━━━━━━━━━━━━━━━━━━━━━━━\n🎉 Total Partisipasi: ${totalSuara} Pemilih.`;
                await sock.sendMessage(from, { text: teksAkhir }, { quoted: msg });
                if (targetVoting.timeoutId) clearTimeout(targetVoting.timeoutId);
                delete global.activeVotes[from];
            }

            // =======================================================
            // ⚽ FOOTBALL
            // =======================================================
            if (command === 'jadwalbola' || command === 'football') {
                const filter = args.join(' ').trim();
                await sock.sendMessage(from, { text: '⚽ Mengambil jadwal pertandingan...' }, { quoted: msg });
                try {
                    const { text, source } = await fetchFootballSchedule(filter);
                    const footer = `\n\n_${source} · LuxxBot_`;
                    const full = text + footer;
                    if (full.length > 4000) {
                        const chunks = full.match(/[\s\S]{1,3800}(?=\n|$)/g) || [full];
                        for (let i = 0; i < chunks.length; i++) {
                            await sock.sendMessage(from, { text: chunks[i] }, { quoted: i === 0 ? msg : undefined });
                        }
                    } else {
                        await sock.sendMessage(from, { text: full }, { quoted: msg });
                    }
                } catch (err) {
                    console.error('FOOTBALL ERROR:', err.message);
                    await sock.sendMessage(from, {
                        text: `❌ Gagal ambil jadwal bola.\n\n💡 Coba lagi nanti.\n_${(err.message || '').slice(0, 100)}_`
                    }, { quoted: msg });
                }
            }

            // =======================================================
            // 🛠️ DEVELOPER TOOLS
            // =======================================================
            if (command === 'minify') {
                const kodeMentah = args.join(' ');
                if (!kodeMentah) return await sock.sendMessage(from, { text: '⚠️ Contoh: `!minify function sapa() { console.log("Halo"); }`' }, { quoted: msg });
                try {
                    const hasilMinify = await minify(kodeMentah);
                    await sock.sendMessage(from, { text: `✅ *Kode Minified!* 📉\n\`\`\`javascript\n${hasilMinify.code}\n\`\`\`` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal Minify! Ada kode yang salah tulis.' }, { quoted: msg });
                }
            }

            if (command === 'jsonpretty') {
                const jsonMentah = args.join(' ');
                if (!jsonMentah) return await sock.sendMessage(from, { text: '⚠️ Contoh: `!jsonpretty {"nama":"zetbot"}` 🎀' }, { quoted: msg });
                try {
                    const jsonCantik = JSON.stringify(JSON.parse(jsonMentah), null, 4);
                    await sock.sendMessage(from, { text: `✅ *JSON Rapih!* 🧩\n\`\`\`json\n${jsonCantik}\n\`\`\`` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Format JSON Error! Cek tanda kurung dan petiknya.' }, { quoted: msg });
                }
            }

            if (command === 'dbdiagram') {
                return handleDbCommand({ sock, from, sender, isGroup, isAdmin, msg, args });
            }

            if (command === 'gitwatch') {
                const username = args[0];
                if (!username) return await sock.sendMessage(from, { text: '⚠️ Contoh: `!gitwatch doxxborx` 🐙' }, { quoted: msg });
                try {
                    const [resUser, resRepo] = await Promise.all([
                        axios.get(`https://api.github.com/users/${username}`),
                        axios.get(`https://api.github.com/users/${username}/repos?sort=updated&per_page=3`)
                    ]);
                    let gitText = `🐙 *PROFIL GITHUB* 🐙\n━━━━━━━━━━━━━━━━━━━━━━━\n👤 *${resUser.data.name || username}*\n📝 ${resUser.data.bio || '-'}\n📁 ${resUser.data.public_repos} repos | 👥 ${resUser.data.followers} followers\n\n📌 *3 REPO TERBARU:*\n`;
                    resRepo.data.forEach((repo, i) => {
                        gitText += `${i + 1}. *${repo.name}* (${repo.language || 'Text'})\n⭐ ${repo.stargazers_count} | 🔗 ${repo.html_url}\n`;
                    });
                    await sock.sendMessage(from, { text: gitText }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ User GitHub tidak ditemukan. 🥺' }, { quoted: msg });
                }
            }

            if (command === 'summarize') {
                const linkUrl = args[0];
                if (!linkUrl) return await sock.sendMessage(from, { text: '⚠️ Kasih URL artikelnya! 📰' }, { quoted: msg });
                await sock.sendMessage(from, { text: '⏳ Lagi baca artikelnya...' }, { quoted: msg });
                try {
                    const webData = await axios.get(linkUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                    const $ = cheerio.load(webData.data);
                    const coreText = $('p').text().substring(0, 4000);
                    const rangkuman = await tanyakanAI(`Rangkum teks berikut: \n\n${coreText}`, 'rangkum', isAdmin);
                    await sock.sendMessage(from, { text: `📄 *RINGKASAN:* 🎀\n\n${rangkuman}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal ambil artikel. Kayaknya web dikunci ketat! 🔒' }, { quoted: msg });
                }
            }

            if (command === 'pinghost') {
                const targetHost = args[0];
                if (!targetHost) return await sock.sendMessage(from, { text: '❌ Contoh: `!pinghost google.com`' }, { quoted: msg });
                await sock.sendMessage(from, { text: `⚡ Pinging ${targetHost}...` }, { quoted: msg });
                const { exec } = await import('child_process');
                const perintahPing = process.platform === 'win32' ? `ping -n 4 ${targetHost}` : `ping -c 4 ${targetHost}`;
                exec(perintahPing, async (error, stdout) => {
                    if (error) return await sock.sendMessage(from, { text: `❌ Host *${targetHost}* tidak merespons atau tidak valid.` }, { quoted: msg });
                    await sock.sendMessage(from, { text: `📡 *PING REPORT*\n━━━━━━━━━━━━━━━━━━━━━━━\n📌 Target: ${targetHost}\n📊 Status: ONLINE ✅\n\n\`\`\`${stdout.trim()}\`\`\`` }, { quoted: msg });
                });
            }

            // =======================================================
            // 👑 OWNER ONLY COMMANDS
            // =======================================================
            if (isAdmin) {
                if (command === 'eval') {
                    const script = args.join(' ');
                    if (!script) return await sock.sendMessage(from, { text: '⚠️ Masukkan ekspresi JavaScript Bos!' }, { quoted: msg });
                    try {
                        let evaled = eval(script);
                        if (typeof evaled !== 'string') evaled = await import('util').then(u => u.inspect(evaled));
                        await sock.sendMessage(from, { text: `🟢 *EVAL SUKSES:*\n\`\`\`javascript\n${evaled}\n\`\`\`` }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ *EVAL ERROR:*\n\`\`\`text\n${e.message}\n\`\`\`` }, { quoted: msg });
                    }
                }

                if (command === 'resetroom') {
                    await sock.sendMessage(from, { text: '🔄 Bikin room Watch2Gether baru...' }, { quoted: msg });
                    try {
                        if (fs.existsSync(W2G_ROOM_FILE)) fs.unlinkSync(W2G_ROOM_FILE);
                        const { clearRadioQueue } = await import('../services/radio-server.js');
                        clearRadioQueue();
                        const newRoom = await createW2GRoom();
                        await sock.sendMessage(from, { text: `✅ *Room baru berhasil dibuat!* 🎉\n\n📻 *Link:*\n${newRoom.url}\n\n_Antrian juga sudah direset._` }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ Gagal buat room baru: ${e.message}` }, { quoted: msg });
                    }
                }

                if (command === 'self') {
                    state.isSelfMode = true;
                    await sock.sendMessage(from, { text: '🔒 *Sistem VIP Terkunci!* Sekarang aku cuma nurut sama Bos! 😝🎀' }, { quoted: msg });
                }

                if (command === 'public') {
                    state.isSelfMode = false;
                    await sock.sendMessage(from, { text: '🔓 *Sistem Dibuka Umum!* Sekarang aku bisa dipakai siapa aja! 🥳🌸' }, { quoted: msg });
                }

                if (command === 'turu') {
                    state.isSleeping = true;
                    await sock.sendMessage(from, { text: '🛌 *Aku izin turu dulu ya...* Ketik `!bangun` kalau butuh aku lagi! 💤' }, { quoted: msg });
                }

                if (command === 'bangun') {
                    if (!state.isSleeping) return await sock.sendMessage(from, { text: '☀️ *Aku udah bangun dari tadi Bos!* 🔥🚀' }, { quoted: msg });
                    state.isSleeping = false;
                    await sock.sendMessage(from, { text: '☀️ *Yeayy Aku Bangun!* Semangat lagi bantuin Bos! 🤖💖' }, { quoted: msg });
                }

                if (command === 'antilink') {
                    const status = args[0]?.toLowerCase();
                    if (status === 'on') { state.antiLink = true; await sock.sendMessage(from, { text: '🛡️ *Anti-Link Nyala!*' }, { quoted: msg }); }
                    else if (status === 'off') { state.antiLink = false; await sock.sendMessage(from, { text: '🔓 *Anti-Link Dimatikan.*' }, { quoted: msg }); }
                    else await sock.sendMessage(from, { text: '⚠️ Format: `!antilink on` atau `!antilink off`' }, { quoted: msg });
                }

                if (command === 'spek') {
                    const coreCPU = os.cpus();
                    const totalRAM = (os.totalmem() / (1024 ** 3)).toFixed(2);
                    const freeRAM = (os.freemem() / (1024 ** 3)).toFixed(2);
                    await sock.sendMessage(from, { text: `💻 *JEROAN SERVER* 💻\n━━━━━━━━━━━━━━━━━━━━━━━\n⚙️ OS: ${os.platform()} (${os.release()})\n🧠 CPU: ${coreCPU[0].model}\n📈 RAM: ${(totalRAM - freeRAM).toFixed(2)}/${totalRAM} GB\n⏳ Uptime PC: ${Math.floor(os.uptime() / 3600)} jam` }, { quoted: msg });
                }

                if (command === 'systeminfo') {
                    const totalRAM = (os.totalmem() / (1024 ** 3)).toFixed(2);
                    const freeRAM = (os.freemem() / (1024 ** 3)).toFixed(2);
                    const loadAvg = os.loadavg().map(l => l.toFixed(2)).join(', ');
                    await sock.sendMessage(from, { text: `📊 *INFO SISTEM VIP* 📊\n━━━━━━━━━━━━━━━━━━━━━━━\n💻 OS: ${os.platform()} (${os.arch()})\n⚙️ CPU Load: [${loadAvg}]\n🧠 Core: ${os.cpus().length}\n📈 RAM: ${freeRAM} GB bebas (pakai ${(totalRAM - freeRAM).toFixed(2)} GB)` }, { quoted: msg });
                }

                if (command === 'speedtest') {
                    await sock.sendMessage(from, { text: '⚡ Uji kecepatan respon...' }, { quoted: msg });
                    const t = Date.now();
                    await new Promise(r => setTimeout(r, 10));
                    const latensi = Date.now() - t;
                    await sock.sendMessage(from, { text: `🚀 *HASIL UJI SERVER:* 🚀\n\n🌐 Latensi: *${latensi}ms*\n📊 Status: *SANGAT SEHAT* 🟢` }, { quoted: msg });
                }

                if (command === 'broadcast' || command === 'bc') {
                    const teksBc = args.join(' ');
                    if (!teksBc) return await sock.sendMessage(from, { text: '⚠️ Teksnya mana Bos? 🥺' }, { quoted: msg });
                    await sock.sendMessage(from, { text: '📢 Sebarin pesan ke semua grup...' }, { quoted: msg });
                    try {
                        const semuaGrup = await sock.groupFetchAllParticipating();
                        let sukses = 0;
                        for (let jid of Object.keys(semuaGrup)) {
                            try {
                                await sock.sendMessage(jid, { text: `📢 *PENGUMUMAN* 📢\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${teksBc}\n\n🎀 _Dari Bos DoxxBorx_ 👑` });
                                sukses++;
                                await new Promise(r => setTimeout(r, 1500));
                            } catch (err) { console.error(`Gagal ke grup ${jid}:`, err.message); }
                        }
                        await sock.sendMessage(from, { text: `✅ Beres! Tersebar ke *${sukses}* grup. 🥳` }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { text: '❌ Error waktu ambil data grup!' }, { quoted: msg });
                    }
                }

                if (command === 'grup') {
                    const aksi = args[0]?.toLowerCase();
                    if (!aksi) return await sock.sendMessage(from, { text: '⚠️ Format: `!grup open` atau `!grup close`' }, { quoted: msg });
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Harus di grup Bos!' }, { quoted: msg });
                    if (aksi === 'open') { await sock.groupSettingUpdate(from, 'not_announcement'); await sock.sendMessage(from, { text: '🔓 Grup dibuka! Semua bisa ngobrol. 🗣️🌸' }, { quoted: msg }); }
                    else if (aksi === 'close') { await sock.groupSettingUpdate(from, 'announcement'); await sock.sendMessage(from, { text: '🔒 Grup dikunci! Cuma admin yang bisa ngomong. 🤫' }, { quoted: msg }); }
                }

                if (command === 'join') {
                    return handleJoinCommand({ sock, from, msg, args });
                }

                if (command === 'leave') {
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Harus diketik di grup yang mau ditinggalin Bos!' }, { quoted: msg });
                    await sock.sendMessage(from, { text: '👋 Dadah semuanya! 🌸💨' });
                    await sock.groupLeave(from);
                }

                if (command === 'block') {
                    const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    if (!target || target === '@s.whatsapp.net') return await sock.sendMessage(from, { text: '⚠️ Tag orangnya yang mau diblokir Bos! 😠' }, { quoted: msg });
                    await sock.updateBlockStatus(target, 'block');
                    await sock.sendMessage(from, { text: '🚫 Diblokir! Nggak bakal bisa chat lagi. Hmph! 😤' }, { quoted: msg });
                }

                if (command === 'unblock') {
                    const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    if (!target || target === '@s.whatsapp.net') return await sock.sendMessage(from, { text: '⚠️ Tag orangnya yang mau dimaafin Bos! 🕊️' }, { quoted: msg });
                    await sock.updateBlockStatus(target, 'unblock');
                    await sock.sendMessage(from, { text: '🔓 Blokir dilepas. Dia dimaafin. 😇🌸' }, { quoted: msg });
                }

                if (command === 'refresh') {
                    console.clear();
                    if (global.gc) global.gc();
                    await sock.sendMessage(from, { text: '♻️ *Bersih-Bersih RAM Selesai!* Siap ngebut lagi! 🚀💨💖' }, { quoted: msg });
                }

                if (command === 'pingsan') {
                    await sock.sendMessage(from, {
                        text: `😵 *${BOT_NAME} pingsan total!*\n\nBot + PM2 dimatikan dalam 3 detik... 💀🕯️\n_Nyalakan lagi: \`npm run pm2:start\` atau \`pm2 start ${PM2_APP_NAME}\`_`
                    }, { quoted: msg });
                    setTimeout(async () => {
                        const { exec } = await import('child_process');
                        exec(`pm2 stop ${PM2_APP_NAME}`, (err) => {
                            if (err) {
                                console.error('pm2 stop gagal, fallback process.exit:', err.message);
                                process.exit(0);
                            }
                        });
                    }, 3000);
                }
            }

        } catch (err) {
            console.error('💥 Error di message handler:', err);
        }
    });
}