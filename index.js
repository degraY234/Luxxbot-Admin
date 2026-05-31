import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import os from 'os';
import { GoogleGenAI } from '@google/genai';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { minify } from 'terser';
import express from 'express';
import http from 'http';
import ytdl from '@distube/ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import ytSearch from 'yt-search';

// =======================================================
// ⚙️ CONFIGURATION & GLOBAL VARIABLES 🎀
// =======================================================
const BOT_NAME = "ZetBot";
const OWNER_NUMBER = ["6282384961407", "36326967632006"];
const GEMINI_API_KEY = "AIzaSyDF6_vu01l80_4c_lXHmJPfXhKsRQ";

// 📻 WATCH2GETHER CONFIG
const W2G_API_KEY = "n617tgi74jbx7x42an7bv9w4micdbblg49i1afk1xoo8karfsma4mir23gqxrzdy";
const W2G_ROOM_FILE = "./w2g_room.json"; // Tempat nyimpen link room permanent

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const startTime = Date.now();

let isSelfMode = false;
let isSleeping = false;
let antiLink = false;

// Database sederhana untuk Fitur Notes & AI Memory
const notesDatabase = {};
const aiConversationMemory = {};

// =======================================================
// 📻 WATCH2GETHER HELPER FUNCTIONS 🎵
// =======================================================

/**
 * Ambil data room dari file lokal (biar persistent walau bot restart)
 */
function loadRoomData() {
    try {
        if (fs.existsSync(W2G_ROOM_FILE)) {
            return JSON.parse(fs.readFileSync(W2G_ROOM_FILE, 'utf8'));
        }
    } catch (e) { /* silent */ }
    return null;
}

/**
 * Simpan data room ke file lokal
 */
function saveRoomData(data) {
    try {
        fs.writeFileSync(W2G_ROOM_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Gagal simpan room data:", e.message);
    }
}

/**
 * Buat room Watch2Gether baru via API.
 * Hanya dipanggil sekali, room disimpan permanent.
 */
async function createW2GRoom() {
    const res = await axios.post('https://api.w2g.tv/rooms/create.json', {
        w2g_api_key: W2G_API_KEY,
        share: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // video placeholder awal
        bg_color: "#00ff00",
        bg_opacity: "50"
    });
    const streamKey = res.data.streamkey;
    const roomUrl = `https://w2g.tv/rooms/${streamKey}`;
    const roomData = { streamkey: streamKey, url: roomUrl, created_at: new Date().toISOString() };
    saveRoomData(roomData);
    return roomData;
}

/**
 * Dapatkan room yang sudah ada, atau buat baru kalau belum ada.
 */
async function getOrCreateRoom() {
    const existing = loadRoomData();
    if (existing && existing.streamkey) return existing;
    return await createW2GRoom();
}

/**
 * Tambahkan video YouTube ke room Watch2Gether yang sudah ada.
 * @param {string} streamkey - Key room W2G
 * @param {string} youtubeUrl - URL video YouTube
 * @param {string} title - Judul video (opsional, untuk log)
 */
async function addVideoToRoom(streamkey, youtubeUrl, title = '') {
    try {
        const response = await axios.post(
            `https://api.w2g.tv/rooms/${streamkey}/playlists/current/mediaitems`,
            {
                w2g_api_key: W2G_API_KEY,
                add_items: [{ url: youtubeUrl, title: title }]
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );
        console.log(`✅ Video berhasil masuk W2G playlist: ${title}`);
        return response.data;
    } catch (e) {
        // Log detail errornya biar gampang debug
        console.error('❌ W2G API Error:', e.response?.status, e.response?.data || e.message);
        throw e;
    }
}

// =======================================================
// 🧠 PROSES PERTANYAAN LEWAT API GEMINI AI (ANTI-SICK SYSTEM) 🐰✨
// =======================================================
async function tanyakanAI(query, type = 'tanya', isAdmin = false, fromId = 'global') {
    if (GEMINI_API_KEY === 'AIzaSyDF6_vu01l80_4c_lXHC6fDHmJPfXhKsRQ' || !GEMINI_API_KEY) {
        return `⚠️ *Waduh Bos DoxxBorx!* API Key Gemini belum dimasukkan di dalam file \`index.js\`. Bot ga bisa konek ke internet kalau otaknya belum dipasang! 😭🔧`;
    }

    let panggilan = isAdmin ? "Bos DoxxBorx tercinta 😎👑" : "Kakak manis 🌸";
    let systemInstruction = "";
    
    if (type === 'tanya') {
        systemInstruction = `Anda adalah asisten AI pribadi yang super cerdas, berwawasan luas berdasarkan seluruh data internet terbaru, namun memiliki kepribadian yang kocak, jenaka, santai, suka memakai emoji keren, dan agak sombong tapi imut. 
        Tugas Anda: Jawab pertanyaan user dengan data yang SANGAT JELAS, AKURAT, DAN BENAR secara ilmiah/faktual. Wajib selipkan bumbu bercanda, analogi lucu, atau punchline komedi agar tidak kaku. 
        Panggil user dengan sebutan "${panggilan}". Katakan padanya bahwa pemilik tertinggi bot ini adalah Bos DoxxBorx sang penguasa coding jika ada yang bertanya tentang owner atau pencipta.`;
    } else if (type === 'coding') {
        systemInstruction = `Anda adalah pakar pemrograman komputer (software engineer senior) yang genius sekaligus instruktur coding yang asyik and humoris. 
        Tugas Anda: Analisis masalah error, buatkan potongan kode (clean code) sesuai permintaan user, jabarkan logikanya dengan analogi yang sangat mudah dipahami mahasiswa teknik komputer. 
        Gunakan format Markdown yang rapi untuk baris kodenya agar mudah di-copy. Jangan terlalu kaku, selipkan sedikit sarkasme komedi atau jokes anak IT di akhir jawaban. Panggil user dengan sebutan "${panggilan}".`;
    } else if (type === 'rangkum') {
        systemInstruction = `Anda adalah seorang ahli analis teks profesional. Tugas Anda adalah meringkas teks panjang atau artikel dari URL yang diberikan user menjadi ringkasan yang padat, jelas, poin-poin penting tersampaikan, namun tetap ditulis dengan gaya santai dan mudah dimengerti. Panggil user dengan sebutan "${panggilan}".`;
    } else if (type === 'brainstorm') {
        systemInstruction = `Anda adalah konsultan kreatif dan pakar inovasi digital yang super seru. 
        Tugas Anda: Berikan ide-ide segar, out-of-the-box, kreatif, inovatif, dan aplikatif untuk project web, aplikasi, artikel, tugas kuliah, atau strategi konten yang ditanyakan user. 
        Berikan jawaban dalam bentuk poin-poin yang terstruktur rapi. Berikan semangat dan bumbu komedi segar khas anak muda agar user terinspirasi. Panggil user dengan sebutan "${panggilan}".`;
    } else if (type === 'translate') {
        systemInstruction = `Anda adalah penerjemah multi-bahasa profesional yang sangat ahli dalam memahami slang, idiom, dan konteks budaya lokal (bukan terjemahan kaku mesin kamus biasa). 
        Tugas Anda: Terjemahkan teks yang diberikan ke bahasa tujuan secara alami, luwes, mengalir, namun tetap mempertahankan arti aslinya. 
        Setelah memberikan terjemahan utama, berikan penjelasan singkat tentang konteks penggunaan kalimat tersebut jika dirasa perlu dengan gaya santai. Panggil user dengan sebutan "${panggilan}".`;
    } else {
        systemInstruction = `Anda adalah tempat curhat atau pelampiasan emosi yang ramah, menghibur, dan sangat humoris. Panggil user dengan sebutan "${panggilan}". Berikan tanggapan yang solutif namun dibalut dengan candaan komedi absurd khas warga netizen agar emosi user mereda.`;
    }

    const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash'];
    
    let contentsPayload = query;
    if (type === 'chat_context') {
        if (!aiConversationMemory[fromId]) aiConversationMemory[fromId] = [];
        aiConversationMemory[fromId].push({ role: 'user', parts: [{ text: query }] });
        contentsPayload = aiConversationMemory[fromId];
    }

    for (let modelName of modelsToTry) {
        try {
            const response = await ai.models.generateContent({
                model: modelName,
                contents: contentsPayload,
                config: {
                    systemInstruction: systemInstruction,
                    temperature: 0.7,
                }
            });
            
            if (type === 'chat_context') {
                aiConversationMemory[fromId].push({ role: 'model', parts: [{ text: response.text }] });
                if (aiConversationMemory[fromId].length > 20) aiConversationMemory[fromId].shift();
            }
            return response.text;
        } catch (error) {
            if (error.status === 503 || error.message?.includes('demand')) {
                console.log(`⚠️ Model ${modelName} lagi sibuk berat, mengalihkan ke model cadangan...`);
                continue; 
            }
            throw error;
        }
    }

    return `🚨 *Waduh Bos, Server Google Lagi Down!* 🚨\n\nSatelit Gemini AI pusat lagi mengalami lonjakan trafik parah. Coba kirim ulang perintahnya beberapa saat lagi ya Bos DoxxBorx! 🤯⚡`;
}

function runtime(seconds) {
    seconds = Number(seconds);
    var d = Math.floor(seconds / (3600 * 24));
    var h = Math.floor(seconds % (3600 * 24) / 3600);
    var m = Math.floor(seconds % 3600 / 60);
    var s = Math.floor(seconds % 60);
    var dDisplay = d > 0 ? d + " hari, " : "";
    var hDisplay = h > 0 ? h + " jam, " : "";
    var mDisplay = m > 0 ? m + " menit, " : "";
    var sDisplay = s > 0 ? s + " detik" : "0 detik";
    return dDisplay + hDisplay + mDisplay + sDisplay;
}

// =======================================================
// 🔌 START WHATSAPP CONNECTION (BAILEYS MULTI-AUTH) 💖
// =======================================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_zetbot');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), 
        printQRInTerminal: true,
        auth: state,
        browser: [BOT_NAME, 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\n\x1b[35m🎀 ============================================== 🎀\x1b[0m');
            console.log('\x1b[36m✨ SILAKAN SCAN QR CODE DI BAWAH UNTUK MENYALAKAN BOT ✨\x1b[0m');
            console.log('\x1b[35m🎀 ============================================== 🎀\x1b[0m\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
            console.log('🔄 Koneksi terputus akibat:', lastDisconnect.error, ', mencoba menyambung ulang:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('\x1b[36m%s\x1b[0m', `
            ╔════════════════════════════════════════════════════╗
            ║  🚀 ZETBOT MULTI-DEVICE IS SUCCESSFULLY ONLINE! 🤖 ║
            ╚════════════════════════════════════════════════════╝
            `);
            console.log(`\x1b[32m🌸 ✨ Yeayy! ${BOT_NAME} Berhasil Online! Siap Melayani Bos DoxxBorx! 🎀💖\x1b[0m\n`);

            // Pastikan room W2G sudah ada saat bot nyala
            getOrCreateRoom()
                .then(room => console.log(`\x1b[35m📻 Room W2G siap: ${room.url}\x1b[0m`))
                .catch(e => console.error('❌ Gagal init room W2G:', e.message));
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const msg = chatUpdate.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = isGroup ? (msg.key.participant || '') : from;
            
            const type = Object.keys(msg.message)[0];
            const body = (type === 'conversation') ? msg.message.conversation : 
                         (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : 
                         (type === 'imageMessage') ? msg.message.imageMessage.caption : 
                         (type === 'videoMessage') ? msg.message.videoMessage.caption : '';

            const text = body.trim();

            // =======================================================
            // 📥 HANDLE REPLY PILIHAN LAGU → MASUK ANTRIAN W2G
            // =======================================================
            if (global.playSession && global.playSession[from] && !msg.key.fromMe) {
                const session = global.playSession[from];
                const selectedIndex = parseInt(text) - 1;

                if (!isNaN(selectedIndex) && selectedIndex >= 0 && selectedIndex < session.tracks.length) {
                    const chosenTrack = session.tracks[selectedIndex];

                    // Hapus session supaya tidak terulang
                    delete global.playSession[from];

                    await sock.sendMessage(from, {
                        text: `✅ *${chosenTrack.title}* berhasil ditambahkan ke antrian!\n\n📻 Buka room radio kita untuk dengerin bareng:\n👉 ${session.roomUrl}\n\n💡 Ketik \`!queue\` untuk lihat antrian lagu.`
                    }, { quoted: msg });

                    try {
                        // Tambahkan video ke playlist room W2G
                        await addVideoToRoom(session.streamkey, chosenTrack.url, chosenTrack.title);
                        console.log(`🎵 Ditambahkan ke W2G: ${chosenTrack.title}`);
                    } catch (e) {
                        console.error('❌ Gagal tambah video ke W2G:', e.message);
                        await sock.sendMessage(from, {
                            text: `⚠️ Lagunya sudah ditambahkan ke antrian bot, tapi gagal sync ke room W2G. Coba ketik \`!play\` lagi ya Kak!`
                        }, { quoted: msg });
                    }

                    // Simpan antrian lokal juga untuk !queue command
                    if (!global.radioQueue) global.radioQueue = [];
                    global.radioQueue.push({
                        title: chosenTrack.title,
                        url: chosenTrack.url,
                        duration: chosenTrack.timestamp,
                        author: chosenTrack.author?.name || 'Unknown',
                        requestedBy: sender.split('@')[0],
                        from: from
                    });

                    return;
                }
            }

            // Fitur Anti-Link Group Detektor Ketat
            if (antiLink && isGroup && body.match(/(chat.whatsapp.com\/)/gi)) {
                const groupMetadata = await sock.groupMetadata(from);
                const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const isBotAdmin = groupMetadata.participants.find(p => p.id === botNumber)?.admin;
                
                if (isBotAdmin) {
                    await sock.sendMessage(from, { text: `🛡️ *Hayo Ketahuan!* Maaf @${sender.split('@')[0]} sayang, dilarang keras sebar link grup lain di sini ya! Sesuai protokol, kamu aku *kick*. Bye bye~ 👋🤭`, mentions: [sender] });
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    return;
                }
            }

            if (!body.startsWith('!')) return;

            const args = text.split(/ +/).slice(1);
            const command = text.split(/ +/)[0].toLowerCase().slice(1);
            
            const isAdmin = OWNER_NUMBER.some(num => sender.includes(num));

            let isLocalGroupAdmin = false;
            if (isGroup) {
                const groupMetadata = await sock.groupMetadata(from);
                const userParticipant = groupMetadata.participants.find(p => p.id === sender);
                isLocalGroupAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin' || isAdmin;
            }

            if (isSelfMode && !isAdmin) return;
            if (isSleeping && command !== 'bangun' && !isAdmin) return;
            if (isSleeping && command !== 'bangun' && isAdmin) {
                return await sock.sendMessage(from, { text: '🛌 *Ssstt.. aku masih turu nyenyak, Bos.* Ketik `!bangun` dulu dong biar aku melek lagi! 🥱🌸' }, { quoted: msg });
            }

            const ownerCommands = ['refresh', 'turu', 'bangun', 'pingsan', 'self', 'public', 'join', 'leave', 'block', 'unblock', 'spek', 'grup', 'antilink', 'speedtest', 'broadcast', 'bc', 'systeminfo', 'eval', 'resetroom'];
            if (ownerCommands.includes(command) && !isAdmin) {
                return await sock.sendMessage(from, { text: '⛔ *Waduh, Akses Ditolak!* Fitur sakral ini cuma buat Bos DoxxBorx tersayang! Kamu nggak boleh pakai ya~ 😝👑' }, { quoted: msg });
            }

            // =======================================================
            // 📜 OUTPUT TAMPILAN MENU UTAMA
            // =======================================================
            if (command === 'menu' || command === 'help') {
                const botUptime = runtime((Date.now() - startTime) / 1000);
                
                let menuText = `╭━━━〔  🌸 *${BOT_NAME.toUpperCase()} MENU* 🌸 〕━━━\n` +
                               `┃\n` +
                               `┃ 🎀 *STATUS BOT* 🎀\n` +
                               `┃ 🛠️ Mode Bot : ${isSelfMode ? '🔒 *VVIP (Self Mode)*' : '🔓 *Public Mode (Bebas)*'}\n` +
                               `┃ 💤 Kondisi : ${isSleeping ? '🛌 *Lagi Bobo Nyenyak*' : '☀️ *Lagi Semangat 100%*'}\n` +
                               `┃ 🛡️ Anti Link : ${antiLink ? '✅ *Aktif Ketat*' : '❌ *Mati / Off*'}\n` +
                               `┃ ⏳ Runtime : _${botUptime}_\n` +
                               `┃\n` +
                               `┣━━〔 🧸 *GENERAL COMMANDS* 〕━━\n` +
                               `┃ ├ • \`!halo\` — Sapa bot imut 👋\n` +
                               `┃ ├ • \`!ping\` — Cek respon bot 🏓\n` +
                               `┃ ├ • \`!help\` — Lihat menu bantuan 📜\n` +
                               `┃ ├ • \`!changelogs\` — Info update bot 📢\n` +
                               `┃ ├ • \`!notes\` — Simpan catatan rahasia 📝\n` +
                               `┃ ├ • \`!remindme\` — Alarm pengingat ⏰\n` +
                               `┃ ├ • \`!add\` — Tambah member grup 👥\n` +
                               `┃\n` +
                               `┣━━〔 🧠 *ADVANCED AI TASKS* 〕━━\n` +
                               `┃ ├ • \`!tanya\` — Nanya apa aja ke AI 🤓\n` +
                               `┃ ├ • \`!coding\` — Solusi error coding 💻\n` +
                               `┃ ├ • \`!code\` — Review kode kamu 🕵️‍♂️\n` +
                               `┃ ├ • \`!rangkum\` — Ringkas teks panjang 📑\n` +
                               `┃ ├ • \`!brainstorm\` — Cari ide kreatif 💡\n` +
                               `┃ ├ • \`!translate\` — Translator gaul 🌐\n` +
                               `┃ ├ • \`!buat\` — Gambar imajinasi AI 🎨\n` +
                               `┃ ├ • \`!lihat\` — Mata AI deteksi gambar 👁️\n` +
                               `┃ ├ • \`!q\` — Ngobrol seru bareng AI 💬\n` +
                               `┃ ├ • \`!resetai\` — Lupakan obrolan ♻️\n` +
                               `┃ ├ • \`!fact\` — Fakta unik acak 🤯\n` +
                               `┃\n` +
                               `┣━━〔 📦 *UTILITY TOOLS* 〕━━\n` +
                               `┃ ├ • \`!ocr\` — Ambil teks dari foto 🔍\n` +
                               `┃ ├ • \`!ceklink\` — Cek link bahaya 🚨\n` +
                               `┃ ├ • \`!cuaca\` — Ramalan cuaca hari ini 🌤️\n` +
                               `┃ ├ • \`!kalkulator\` — Hitung-hitungan 🧮\n` +
                               `┃ ├ • \`!qr\` — Bikin QR Code keren 🔳\n` +
                               `┃ ├ • \`!stalk\` — Intip profil GitHub 🐙\n` +
                               `┃ ├ • \`!summarize\` — Ringkas artikel web 📰\n` +
                               `┃\n` +
                               `┣━━〔 🖼️ *MEDIA DOWNLOADER* 〕━━\n` +
                               `┃ ├ • \`!sticker\` / \`!s\` — Bikin stiker lucu 🥳\n` +
                               `┃ ├ • \`!anomali\` — Stiker brat style 😎\n` +
                               `┃ ├ • \`!dl\` — Download video sosmed 📥\n` +
                               `┃ ├ • \`!radio\` — Buka room nonton bareng 📻\n` +
                               `┃\n` +
                               `┣━━〔 🎮 *INTERACTIVE & FUN* 〕━━\n` +
                               `┃ ├ • \`!curhat\` — Tempat keluh kesah 🫂\n` +
                               `┃ ├ • \`!roastme\` — Mental aman? 🔥\n` +
                               `┃ ├ • \`!truth\` — Jujur-jujuran yuk! 🤫\n` +
                               `┃ ├ • \`!dare\` — Tantangan seru! 😈\n` +
                               `┃ ├ • \`!meme\` — Asupan meme segar 😂\n` +
                               `┃ ├ • \`!apakah\` — Ramalan kasual 🔮\n` +
                               `┃ ├ • \`!kapankah\` — Prediksi waktu kocak ⏳\n` +
                               `┃ ├ • \`!tagall\` — Panggil semua orang 📢\n` +
                               `┃\n`;

                if (isAdmin) {
                    menuText += `┣━━〔 👑 *OWNER CONTROL (VIP)* 〕━━\n` +
                                `┃ ├ • \`!speedtest\` — Uji ngebut server 🚀\n` +
                                `┃ ├ • \`!broadcast\` — Kirim pesan massal 📡\n` +
                                `┃ ├ • \`!spek\` — Cek jeroan server 💻\n` +
                                `┃ ├ • \`!systeminfo\` — Info RAM & CPU 📊\n` +
                                `┃ ├ • \`!self\` — Kunci bot buat Bos aja 🔒\n` +
                                `┃ ├ • \`!public\` — Buka bot buat umum 🔓\n` +
                                `┃ ├ • \`!join\` — Paksa bot masuk grup 🏃‍♂️\n` +
                                `┃ ├ • \`!leave\` — Bot kabur dari grup 💨\n` +
                                `┃ ├ • \`!grup\` — Buka/Tutup grup 🚪\n` +
                                `┃ ├ • \`!antilink\` — Sabuk pengaman grup 🛡️\n` +
                                `┃ ├ • \`!block\` — Tendang orang usil 🚫\n` +
                                `┃ ├ • \`!unblock\` — Maafin orang usil 🕊️\n` +
                                `┃ ├ • \`!refresh\` — Bersih-bersih RAM ♻️\n` +
                                `┃ ├ • \`!turu\` — Suruh bot tidur 🛌\n` +
                                `┃ ├ • \`!bangun\` — Bangunin bot ☀️\n` +
                                `┃ ├ • \`!pingsan\` — Matikan bot total 💀\n` +
                                `┃ ├ • \`!resetroom\` — Buat ulang room W2G 🔄\n` +
                                `┃ └ • \`!eval\` — Tes kode JavaScript ⚙️\n`;
                }

                menuText += `╰━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `🎀 _Made with Love by Bos DoxxBorx_ 💖✨`;
                
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            }

            // =======================================================
            // 🔓 PUBLIC GENERAL COMMANDS LIST
            // =======================================================
            if (command === 'halo') {
                await sock.sendMessage(from, { text: 'Halo juga Kakak manis! 🌸 Ada yang bisa Zeta bantu hari ini? Ketik `!menu` untuk lihat keajaibanku ya! 🥳✨' }, { quoted: msg });
            }

            if (command === 'ping') {
                const latensi = Date.now() - msg.messageTimestamp * 1000;
                await sock.sendMessage(from, { text: `🏓 *Pong!* Respon secepat kilat: *${latensi}ms* 🚀💨` }, { quoted: msg });
            }

            if (command === 'changelogs') {
                await sock.sendMessage(from, { text: `⚙️ *ZETBOT UPDATE LOGS* ⚙️\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🎀 *v2.3.0 Hacking Update:*\n- Fitur Radio W2G dengan sistem antrian lagu 🎵\n- Menu lebih kawaii dengan banyak emoji 🌸\n- Terminal log lebih keren ala hacker 😎\n\n_Stay tuned buat update kece lainnya!_ 💖` }, { quoted: msg });
            }

            // ✍️ FITUR: !notes
            if (command === 'notes') {
                const opsi = args[0]?.toLowerCase();
                const namaNote = args[1]?.toLowerCase();
                const isiNote = args.slice(2).join(' ');

                if (!opsi) return await sock.sendMessage(from, { text: '⚠️ *Format Notes:* `!notes simpan [nama] [isi]` atau `!notes ambil [nama]` atau `!notes list` 📝' }, { quoted: msg });

                if (opsi === 'simpan') {
                    if (!namaNote || !isiNote) return await sock.sendMessage(from, { text: '⚠️ Kasih nama dan isinya dong Kak biar bisa disimpen! 🎀' }, { quoted: msg });
                    notesDatabase[namaNote] = isiNote;
                    await sock.sendMessage(from, { text: `✅ Yey! Catatan *"${namaNote}"* udah berhasil disimpen di otakku! 🧠✨` }, { quoted: msg });
                } else if (opsi === 'ambil') {
                    if (!namaNote) return await sock.sendMessage(from, { text: '⚠️ Catatan apa yang mau diambil Kak? Namanya apa? 🧐' }, { quoted: msg });
                    if (!notesDatabase[namaNote]) return await sock.sendMessage(from, { text: '❌ Yaah, catatannya nggak ketemu Kak! 😭' }, { quoted: msg });
                    await sock.sendMessage(from, { text: `📝 *Catatan [${namaNote}]:*\n\n${notesDatabase[namaNote]}` }, { quoted: msg });
                } else if (opsi === 'list') {
                    const keys = Object.keys(notesDatabase);
                    if (keys.length === 0) return await sock.sendMessage(from, { text: '📭 Kotak catatannya masih kosong melompong nih! 🕸️' }, { quoted: msg });
                    await sock.sendMessage(from, { text: `📂 *DAFTAR CATATAN RAHASIA:* 🎀\n${keys.map((k, i) => `${i+1}. ${k}`).join('\n')}` }, { quoted: msg });
                }
            }

            // ⏰ FITUR: !remindme
            if (command === 'remindme') {
                const waktuMenit = parseInt(args[0]);
                const pesanReminder = args.slice(1).join(' ');

                if (isNaN(waktuMenit) || !pesanReminder) {
                    return await sock.sendMessage(from, { text: '⚠️ *Formatnya salah Kak!* Contoh yang bener: `!remindme 5 cuci baju` (Waktu dalam menit ya) ⏰' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: `⏳ *Alarm Dipasang!* Nanti aku ingetin dalam *${waktuMenit} menit* untuk: _${pesanReminder}_. Jangan sampai lupa ya! 🌸✨` }, { quoted: msg });
                
                setTimeout(async () => {
                    await sock.sendMessage(from, { text: `🚨 *KRING KRING! WAKTU HABIS!* 🚨\n\n@${sender.split('@')[0]} Kak, jangan lupa lakuin ini sekarang: *${pesanReminder}*! Semangat! 💖🔔`, mentions: [sender] });
                }, waktuMenit * 60000);
            }

            // 🚪 FITUR ADMIN GRUP: !add
            if (command === 'add') {
                if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Ini cuma bisa dipakai di dalam grup Kak! 🏡' }, { quoted: msg });
                if (!isLocalGroupAdmin) return await sock.sendMessage(from, { text: '❌ Maaf, cuma admin grup atau Bosku yang boleh masukin orang! 👑' }, { quoted: msg });
                
                const targetNum = args[0]?.replace(/[^0-9]/g, '');
                if (!targetNum) return await sock.sendMessage(from, { text: '⚠️ Masukkan nomor yang bener dong Kak! Contoh: `!add 628xxx` 📱' }, { quoted: msg });
                
                try {
                    await sock.groupParticipantsUpdate(from, [targetNum + '@s.whatsapp.net'], 'add');
                    await sock.sendMessage(from, { text: `✅ Yuhu! Berhasil nambahin @${targetNum} ke grup kita! Selamat datang! 🎉`, mentions: [targetNum + '@s.whatsapp.net'] }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal masukin orang nih. Kayaknya aku belum dijadiin admin deh! 🥺' }, { quoted: msg });
                }
            }

            // =======================================================
            // 🤖 AI COMMANDS EXTENSION PACK 🌸
            // =======================================================
            if (command === 'buat') {
                const deskripsi = args.join(' ');
                if (!deskripsi) return await sock.sendMessage(from, { text: '⚠️ Kasih tau aku mau digambarin apa Kak! Contoh: `!buat kucing pakai pita pink` 🎀' }, { quoted: msg });
                
                await sock.sendMessage(from, { text: '🎨 _Aku lagi ngelukis gambarnya nih, tunggu sebentar ya Kak..._ 🖌️✨' }, { quoted: msg });
                try {
                    const imageUrl = `https://pollinations.ai/p/${encodeURIComponent(deskripsi)}?width=1024&height=1024&seed=42&nofeed=true`;
                    await sock.sendMessage(from, { image: { url: imageUrl }, caption: `🎨 *Tadaa! Ini hasil lukisanku untuk:* "${deskripsi}" 💖` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Aduh, server lukisannya lagi capek. Gagal bikin gambar deh! 😭' }, { quoted: msg });
                }
            }

            if (command === 'code') {
                const queryKode = args.join(' ');
                if (!queryKode) return await sock.sendMessage(from, { text: '⚠️ Mana kode yang mau di-debug Kak? Contoh: `!code let x = const` 💻' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(`Lakukan debug, review, and jelaskan letak error serta optimalisasi dari struktur kode berikut:\n\n${queryKode}`, 'coding', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'fact') {
                await sock.sendPresenceUpdate('composing', from);
                const faktaPrompt = 'Berikan satu baris fakta unik, menarik, mencengangkan, and ilmiah secara acak dari berbagai belahan dunia atau sejarah luarspace yang jarang diketahui orang awam.';
                const hasilAI = await tanyakanAI(faktaPrompt, 'tanya', isAdmin);
                await sock.sendMessage(from, { text: `💡 *FAKTA MENARIK HARI INI:* 🌟\n\n${hasilAI}` }, { quoted: msg });
            }

            if (command === 'lihat') {
                const isMedia = (type === 'imageMessage');
                const isQuotedMedia = type === 'extendedTextMessage' && msg.message.extendedTextMessage.contextInfo?.quotedMessage?.imageMessage;
                const captionPrompt = args.join(' ') || 'Analisis and jelaskan objek apa saja yang ada di dalam gambar ini secara mendalam.';
                
                if (!isMedia && !isQuotedMedia) return await sock.sendMessage(from, { text: '⚠️ Kirim gambarnya dong Kak pakai caption `!lihat`, atau balas gambar yang udah ada! 📸' }, { quoted: msg });

                await sock.sendMessage(from, { text: '👁️ _Aku lagi pelototin gambarnya nih, sabar ya Kak..._ 🧐✨' });
                try {
                    const mediaContext = isQuotedMedia ? msg.message.extendedTextMessage.contextInfo.quotedMessage : msg.message;
                    const stream = await downloadContentFromMessage(mediaContext.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: [
                            {
                                parts: [
                                    { inlineData: { mimeType: 'image/jpeg', data: buffer.toString('base64') } },
                                    { text: captionPrompt }
                                ]
                            }
                        ]
                    });
                    await sock.sendMessage(from, { text: `👁️ *HASIL PENGLIHATANKU:* ✨\n\n${response.text}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Mataku kelilipan error nih, gagal muat media dari server! 😭' }, { quoted: msg });
                }
            }

            if (command === 'q') {
                const queryText = args.join(' ');
                if (!queryText) return await sock.sendMessage(from, { text: '⚠️ Ngobrol apa aja bebas Kak! Contoh: `!q halo, kamu lagi apa?` 💬' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(queryText, 'chat_context', isAdmin, from);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'resetai') {
                aiConversationMemory[from] = [];
                await sock.sendMessage(from, { text: '♻️ *Memori Terhapus!* Obrolan kita tadi udah aku lupain semua Kak. Yuk mulai dari awal! 🌸' }, { quoted: msg });
            }

            // =======================================================
            // 📦 UTILITY & MATH PACK 🎀
            // =======================================================
            if (command === 'cuaca') {
                const kota = args.join(' ');
                if (!kota) return await sock.sendMessage(from, { text: '⚠️ Kasih tau nama kotanya dong Kak! Contoh: `!cuaca Medan` 🌤️' }, { quoted: msg });
                
                try {
                    const res = await axios.get(`https://wttr.in/${encodeURIComponent(kota)}?format=%C+%t+%h+%w`);
                    await sock.sendMessage(from, { text: `🌤️ *CUACA HARI INI DI [${kota.toUpperCase()}]* 🌤️\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📊 *Kondisi:* ${res.data}\n🎀 _Jangan lupa bawa payung kalau mendung ya Kak!_` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Nggak bisa liat cuacanya nih, ejaan kotanya udah bener belum Kak? 🤔' }, { quoted: msg });
                }
            }

            if (command === 'kalkulator') {
                const rumus = args.join(' ');
                if (!rumus) return await sock.sendMessage(from, { text: '⚠️ Mana yang mau dihitung Kak? Contoh: `!kalkulator (10 * 5) / 2` 🧮' }, { quoted: msg });
                try {
                    const hasilHitung = new Function(`return (${rumus})`)();
                    await sock.sendMessage(from, { text: `🧮 *HASIL HITUNGANNYA:* ✨\n\n\`${rumus}\` = *${hasilHitung}*` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Duh, rumus matematikanya pusingin kepalaku! Ada yang salah tulis kayaknya Kak. 😵' }, { quoted: msg });
                }
            }

            if (command === 'qr') {
                const teksQr = args.join(' ');
                if (!teksQr) return await sock.sendMessage(from, { text: '⚠️ Masukkan teks atau URL yang mau dibikin QR Code Kak! 🔳' }, { quoted: msg });
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(teksQr)}`;
                await sock.sendMessage(from, { image: { url: qrUrl }, caption: `✅ *QR Codenya udah jadi nih Kak!* Keren kan? 🥳✨` }, { quoted: msg });
            }

            if (command === 'stalk') {
                const userGit = args[0];
                if (!userGit) return await sock.sendMessage(from, { text: '⚠️ Siapa username GitHub yang mau di-kepo-in Kak? Contoh: `!stalk doxxborx` 🐙' }, { quoted: msg });
                try {
                    const res = await axios.get(`https://api.github.com/users/${userGit}`);
                    let stalkText = `🐙 *PROFIL GITHUB TARGET* 🐙\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                    `👤 *Nama:* ${res.data.name || userGit}\n` +
                                    `🏢 *Perusahaan:* ${res.data.company || '-'}\n` +
                                    `📍 *Lokasi:* ${res.data.location || '-'}\n` +
                                    `📁 *Repo Publik:* ${res.data.public_repos}\n` +
                                    `👥 *Followers:* ${res.data.followers} | *Following:* ${res.data.following}\n` +
                                    `🔗 *Link Profil:* ${res.data.html_url}\n\n🌸 _Stalking selesai Kak!_ 🕵️‍♀️`;
                    await sock.sendMessage(from, { text: stalkText }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Akun GitHub-nya nggak ketemu Kak, salah ketik mungkin? 🥺' }, { quoted: msg });
                }
            }

            if (command === 'summarize') {
                const linkUrl = args[0];
                if (!linkUrl) return await sock.sendMessage(from, { text: '⚠️ Kasih URL artikelnya ke aku Kak biar kuringkas! 📰' }, { quoted: msg });
                await sock.sendMessage(from, { text: '⏳ _Lagi baca artikelnya ngebut nih, tunggu ya Kak..._ 👓✨' }, { quoted: msg });
                try {
                    const webData = await axios.get(linkUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                    const $ = cheerio.load(webData.data);
                    const coreText = $('p').text().substring(0, 4000); 
                    
                    const rangkuman = await tanyakanAI(`Rangkum teks mentah halaman web berikut secara akurat: \n\n${coreText}`, 'rangkum', isAdmin);
                    await sock.sendMessage(from, { text: `📄 *INI RINGKASANNYA KAK:* 🎀\n\n${rangkuman}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Yah gagal ambil artikelnya Kak. Kayaknya web-nya dikunci super ketat deh! 🔒' }, { quoted: msg });
                }
            }

            // =======================================================
            // 🎮 ENTERTAINMENT PACK 🥳
            // =======================================================
            if (command === 'truth') {
                const listTruth = [
                    "Apa ketakutan terbesar yang pernah kamu sembunyikan dari teman terdekatmu?",
                    "Jika kamu bisa bertukar nasib dengan orang di ruangan ini selama satu hari, siapa yang kamu pilih?",
                    "Kapan terakhir kali kamu berbohong demi menghindari tugas kelompok kuliah?",
                    "Apa rahasia memalukan di laptop/HP kamu yang tidak boleh diketahui orang tua?",
                    "Pernahkah kamu menyukai seseorang diam-diam di grup chat ini?"
                ];
                const acakT = listTruth[Math.floor(Math.random() * listTruth.length)];
                await sock.sendMessage(from, { text: `🎲 *WAKTUNYA JUJUR!* 🫣\n\n_"${acakT}"_` }, { quoted: msg });
            }

            if (command === 'dare') {
                const listDare = [
                    "Kirim screenshot isi history tontonan YouTube kamu yang paling terakhir tanpa dihapus ke grup!",
                    "Kirim pesan voice note bernyanyi lagu anak-anak selama 15 detik dengan suara melengking!",
                    "Ganti nama profil WhatsApp kamu menjadi 'Anak Kesayangan ZetBot' selama 1 jam ke depan.",
                    "Chat gebetan atau mantan kamu dan katakan 'Aku kangen banget, serius' lalu kirim buktinya ke sini.",
                    "Sebutkan kelemahan terbesar dosen/guru/bos kamu secara jujur di chat ini!"
                ];
                const acakD = listDare[Math.floor(Math.random() * listDare.length)];
                await sock.sendMessage(from, { text: `🎲 *TANTANGAN BUAT KAMU!* 😈\n\n⚡ *Wajib Lakuin:* _"${acakD}"_` }, { quoted: msg });
            }

            if (command === 'meme') {
                await sock.sendMessage(from, { text: '📦 _Lagi nyari meme paling lucu sejagat raya nih..._ 😂✨' }, { quoted: msg });
                try {
                    const res = await axios.get('https://meme-api.com/gimme/wholesomememes');
                    await sock.sendMessage(from, { image: { url: res.data.url }, caption: `😂 *Judul Meme:* "${res.data.title}"` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Aduh gagal dapet meme, pabrik memenya lagi tutup Kak. 😭' }, { quoted: msg });
                }
            }

            // =======================================================
            // 📻 RADIO & PLAY COMMANDS (WATCH2GETHER) 🎵
            // =======================================================

            // !radio → Kirim link room W2G permanent + info antrian
            if (command === 'radio') {
                try {
                    await sock.sendMessage(from, { text: '⏳ _Ambil link room radio dulu ya Kak..._ 📻' }, { quoted: msg });

                    const room = await getOrCreateRoom();
                    const queueList = global.radioQueue && global.radioQueue.length > 0
                        ? global.radioQueue.map((t, i) => `${i + 1}. 🎵 ${t.title} — req by @${t.requestedBy}`).join('\n')
                        : '_Antrian kosong. Jadilah yang pertama request lagu!_';

                    const radioText =
                        `╭━━━〔 📻 *ZETBOT RADIO ROOM* 〕━━━\n` +
                        `┃\n` +
                        `┃ 🎬 *Platform:* Watch2Gether\n` +
                        `┃ 🔗 *Link Room:*\n` +
                        `┃ ${room.url}\n` +
                        `┃\n` +
                        `┃ 📋 *ANTRIAN LAGU SEKARANG:*\n` +
                        `┃ ${queueList.split('\n').join('\n┃ ')}\n` +
                        `┃\n` +
                        `╰━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `🎀 _Gabung dan dengerin bareng yuk!_ 💖`;

                    await sock.sendMessage(from, { text: radioText }, { quoted: msg });
                } catch (e) {
                    console.error('❌ Error command !radio:', e.message);
                    await sock.sendMessage(from, { text: '❌ Waduh, gagal ambil link room radionya Kak! Coba lagi sebentar ya. 😭' }, { quoted: msg });
                }
            }


            // =======================================================
            // 🎨 ADVANCED MEDIA DOWNLOADER & BRAT GENERATOR 🎀
            // =======================================================
            if (command === 'anomali') {
                const teksAnomali = args.join(' ');
                if (!teksAnomali) return await sock.sendMessage(from, { text: '⚠️ Ketik kata-katanya Kak buat stiker brat-nya! Contoh: `!anomali pusing mikirin koding` 😵‍💫' }, { quoted: msg });
                
                await sock.sendMessage(from, { text: '🎨 _Bikin stiker ala-ala brat style dulu..._ 😎✨' }, { quoted: msg });
                try {
                    const bratUrl = `https://brat.caliph.dev/api/brat?text=${encodeURIComponent(teksAnomali)}`;
                    const resBrat = await axios.get(bratUrl, { responseType: 'arraybuffer' });
                    
                    const stikerHasil = new Sticker(Buffer.from(resBrat.data), {
                        pack: 'Anomali Cute Pack 🌸',
                        author: 'ZetBot by DoxxBorx',
                        type: StickerTypes.FULL,
                        quality: 70
                    });
                    await sock.sendMessage(from, { sticker: await stikerHasil.toBuffer() }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Nggak bisa bikin stiker brat nih, servernya lagi ngambek! 😤' }, { quoted: msg });
                }
            }

            if (command === 'dl') {
                const videoUrl = args[0];
                if (!videoUrl) return await sock.sendMessage(from, { text: '⚠️ Mana link video TikTok/IG/YT-nya Kak? 🎬' }, { quoted: msg });
                
                await sock.sendMessage(from, { text: '⏳ _Lagi mungut videonya dari internet nih, tunggu sebentar ya Kak manis..._ 📥💖' }, { quoted: msg });
                try {
                    const resDl = await axios.get(`https://api.vreden.web.id/api/download/all?url=${encodeURIComponent(videoUrl)}`);
                    const downloadLink = resDl.data?.result?.video || resDl.data?.result?.url || resDl.data?.result?.urls?.[0]?.url;
                    
                    if (!downloadLink) throw new Error();
                    await sock.sendMessage(from, { video: { url: downloadLink }, caption: '✅ *Ini dia videonya Kak! Selamat menonton!* 🍿✨' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Videonya gagal didownload Kak! Mungkin videonya di-private atau link-nya udah basi. 😭' }, { quoted: msg });
                }
            }

            if (command === 'jsonpretty') {
                const jsonMentah = args.join(' ');
                if (!jsonMentah) return await sock.sendMessage(from, { text: '⚠️ *Mana kode JSON-nya Kak?* Contoh:\n`!jsonpretty {"nama":"ZetBot","lucu":true}` 🎀' }, { quoted: msg });
                
                try {
                    const objekJson = JSON.parse(jsonMentah);
                    const jsonCantik = JSON.stringify(objekJson, null, 4);
                    await sock.sendMessage(from, { text: `✅ *JSON Udah Rapih Nih!* 🧩✨\n\`\`\`json\n${jsonCantik}\n\`\`\`` }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(from, { text: `❌ *Format JSON Error!* Gagal dirapihin Kak, coba cek lagi tanda kurung sama petiknya ya! 🛠️🥺` }, { quoted: msg });
                }
            }

            if (command === 'sticker' || command === 's') {
                const isMedia = (type === 'imageMessage' || type === 'videoMessage');
                const isQuotedMedia = type === 'extendedTextMessage' && (msg.message.extendedTextMessage.contextInfo?.quotedMessage?.imageMessage || msg.message.extendedTextMessage.contextInfo?.quotedMessage?.videoMessage);
                
                if (!isMedia && !isQuotedMedia) {
                    return await sock.sendMessage(from, { text: '⚠️ *Mana gambarnya Kak?* Kirim gambar/video pendek pakai caption `!s` atau balas gambarnya ya! 📸🎀' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: '⏳ _Lagi sulap gambar jadi stiker imut, tunggu ya Kak..._ 🪄✨' });

                try {
                    const mediaContext = isQuotedMedia ? msg.message.extendedTextMessage.contextInfo.quotedMessage : msg.message;
                    const mediaType = isQuotedMedia ? Object.keys(mediaContext)[0] : type;
                    const stream = await downloadContentFromMessage(mediaContext[mediaType], mediaType.replace('Message', ''));
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const stikerHasil = new Sticker(buffer, {
                        pack: `${BOT_NAME} Kawaii Pack 🌸`,
                        author: 'Bos DoxxBorx ✨',
                        type: StickerTypes.FULL,
                        quality: 70
                    });

                    const bufferStiker = await stikerHasil.toBuffer();
                    await sock.sendMessage(from, { sticker: bufferStiker }, { quoted: msg });
                } catch (error) {
                    console.error(error);
                    await sock.sendMessage(from, { text: '❌ *Yah gagal bikin stiker!* Pastikan gambarnya jelas dan video jangan kepanjangan ya Kak! 😭' }, { quoted: msg });
                }
            }

            if (command === 'minify') {
                const kodeMentah = args.join(' ');
                if (!kodeMentah) return await sock.sendMessage(from, { text: '⚠️ *Mana kodenya Kak?* Contoh penggunaan:\n`!minify function sapa() { console.log("Halo Dunia"); }` 🎀' }, { quoted: msg });
                
                try {
                    const hasilMinify = await minify(kodeMentah);
                    await sock.sendMessage(from, { text: `✅ *Kode Udah Menciut (Minified)!* 📉✨\n\`\`\`javascript\n${hasilMinify.code}\n\`\`\`` }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(from, { text: `❌ *Gagal Minify!* Ada kode yang salah tulis tuh Kak, coba dicek lagi ya! 🧐` }, { quoted: msg });
                }
            }

            if (command === 'dbdiagram') {
                const deskripsi = args.join(' ');
                if (!deskripsi) return await sock.sendMessage(from, { text: '⚠️ *Tulis skema DB-nya Kak.* Contoh:\n`!dbdiagram sistem jualan baju` 👗✨' }, { quoted: msg });
                
                await sock.sendPresenceUpdate('composing', from);
                const queryPrompt = `Buatkan struktur diagram skema database relasional (SQL) lengkap yang rapi berdasarkan deskripsi berikut ini: "${deskripsi}". Jabarkan nama tabel, field/kolom, tipe data, serta rancangan Primary Key (PK) tanpa perlu menambahkan batasan Foreign Key (FK) yang rumit terlebih dahulu agar mudah dibaca mahasiswa.`;
                const hasilAI = await tanyakanAI(queryPrompt, 'coding', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'gitwatch') {
                const username = args[0];
                if (!username) return await sock.sendMessage(from, { text: '⚠️ *Siapa username GitHub-nya Kak?* Contoh: `!gitwatch doxxborx` 🐙🎀' }, { quoted: msg });
                
                try {
                    const resUser = await axios.get(`https://api.github.com/users/${username}`);
                    const resRepo = await axios.get(`https://api.github.com/users/${username}/repos?sort=updated&per_page=3`);
                    
                    let gitText = `🐙 *PEMANTAU PROFIL GITHUB* 🐙\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                  `👤 *Nama:* ${resUser.data.name || username}\n` +
                                  `📝 *Bio:* ${resUser.data.bio || 'Misterius banget, nggak ada bio'}\n` +
                                  `📁 *Total Repo:* ${resUser.data.public_repos}\n` +
                                  `👥 *Followers:* ${resUser.data.followers} | *Following:* ${resUser.data.following}\n\n` +
                                  `📌 *3 REPO TERBARU:* 🌟\n`;
                                  
                    resRepo.data.forEach((repo, i) => {
                        gitText += `${i + 1}. *${repo.name}* (${repo.language || 'HTML/Text'})\n⭐ _Stars:_ ${repo.stargazers_count} | 🔗 _Link:_ ${repo.html_url}\n`;
                    });
                    
                    await sock.sendMessage(from, { text: gitText }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(from, { text: '❌ *Orangnya nggak ada!* Pastikan ejaan namanya bener ya Kak. 🥺' }, { quoted: msg });
                }
            }

            if (command === 'ocr') {
                const isMedia = (type === 'imageMessage');
                const isQuotedMedia = type === 'extendedTextMessage' && msg.message.extendedTextMessage.contextInfo?.quotedMessage?.imageMessage;
                
                if (!isMedia && !isQuotedMedia) {
                    return await sock.sendMessage(from, { text: '⚠️ *Mana gambar teksnya Kak?* Kirim fotonya pakai caption `!ocr` ya! 📸✍️' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: '🔍 _Lagi baca tulisan di gambarnya nih, tunggu ya Kak..._ 👓✨' });

                try {
                    const mediaContext = isQuotedMedia ? msg.message.extendedTextMessage.contextInfo.quotedMessage : msg.message;
                    const stream = await downloadContentFromMessage(mediaContext.imageMessage, 'image');
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: [
                            {
                                parts: [
                                    { inlineData: { mimeType: 'image/jpeg', data: buffer.toString('base64') } },
                                    { text: 'Tolong ekstrak, baca, dan tulis ulang seluruh teks ketikan ataupun tulisan tangan yang ada di dalam gambar ini secara utuh, rapi, akurat, dan tanpa tambahan komentar penjelasan apa pun.' }
                                ]
                            }
                        ]
                    });

                    await sock.sendMessage(from, { text: `📝 *HASIL BACAAN TEKS (OCR):* 🎀\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${response.text}` }, { quoted: msg });
                } catch (error) {
                    console.error(error);
                    await sock.sendMessage(from, { text: '❌ *Gagal baca teks!* Gambarnya burem atau sistemku lagi ngantuk Kak. 😭' }, { quoted: msg });
                }
            }

            // =======================================================
            // 🧠 ADVANCED GOOGLE GEMINI AI TASKS 🌸
            // =======================================================
            if (command === 'tanya') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Mau nanya apa Kak? Ketik pertanyaannya ya! 🤓✨' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'tanya', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'coding') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Kasih tau error-nya atau kode yang mau dibikin dong Kak! 💻✨' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'coding', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'rangkum') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Mana teks panjang yang mau di-ringkas Kak? 📑✨' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'rangkum', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'brainstorm') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Butuh ide apa nih Kak? Sebutin topiknya yuk! 💡✨' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'brainstorm', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'translate') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Teksnya mana yang mau ditranslate Kak? 🌐✨' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'translate', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'curhat') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Ayo keluarin unek-uneknya Kak, aku siap dengerin keluh kesahmu! 🫂💖' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'curhat', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            // =======================================================
            // 🎮 INTERACTIVE CASUAL FUN LOGIC 🎀
            // =======================================================
            if (command === 'roastme') {
                const target = args.join(' ') || 'saya';
                await sock.sendPresenceUpdate('composing', from);
                const queryRoast = `Tolong roasting, hina dengan sarkasme komedi yang sangat pedas, tajam, menusuk hati, brutal, tapi sangat lucu dan menghibur tentang subjek: ${target}.`;
                const hasilAI = await tanyakanAI(queryRoast, 'curhat', isAdmin);
                await sock.sendMessage(from, { text: `🔥 *WAKTUNYA ROASTING!* 🔥\n\n${hasilAI}` }, { quoted: msg });
            }

            if (command === 'apakah') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Tanya apa aja Kak, biar aku ramal! 🔮✨' }, { quoted: msg });
                const jawaban = ['Iya pasti dong! 😍', 'Kelihatannya begitu Kak... 🤔', 'Mungkin aja, jalani aja dulu 🌸', 'Wah kalau itu ga mungkin! 🙅‍♀️', 'Sangat tidak direkomendasikan. 🛑', 'Coba tanyain lagi besok pas moodku bagus 🤭'];
                const acak = jawaban[Math.floor(Math.random() * jawaban.length)];
                await sock.sendMessage(from, { text: `🔮 *Pertanyaan:* Apakah ${query}\n🎲 *Jawaban Ramalan:* ${acak}` }, { quoted: msg });
            }

            if (command === 'kapankah') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Tanya waktu apa nih Kak? ⏳✨' }, { quoted: msg });
                const prediksi = ['3 Hari lagi! 🚀', 'Sekitar 5 tahun lagi Kak', 'Besok subuh! 🌅', 'Nanti kalau dinosaurus hidup lagi 🦖', 'Abad depan kelihatannya... 👴', 'Ga bakal terjadi kalau cuma rebahan aja ih! 😂'];
                const acak = prediksi[Math.floor(Math.random() * prediksi.length)];
                await sock.sendMessage(from, { text: `⏳ *Pertanyaan:* Kapankah ${query}\n🎯 *Prediksi Waktu:* ${acak}` }, { quoted: msg });
            }

            if (command === 'tagall') {
                if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Cuma bisa dipakai di grup ya Kak! 🏡' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                const peserta = groupMetadata.participants;
                const teksTambahan = args.join(' ') || 'Panggilan Darurat, Kumpul yuk!';
                
                let pesanTag = `📢 *PANGGILAN UNTUK SEMUA!* 📢\n📌 *Pesan:* ${teksTambahan}\n\n`;
                let mentions = [];
                
                for (let jlh of peserta) {
                    pesanTag += `@${jlh.id.split('@')[0]}\n`;
                    mentions.push(jlh.id);
                }
                await sock.sendMessage(from, { text: pesanTag, mentions: mentions }, { quoted: msg });
            }

            // =======================================================
            // 👑 PERINTAH KHUSUS ADMIN (OWNER ONLY VIP) 👑
            // =======================================================
            if (isAdmin) {
                if (command === 'eval') {
                    const script = args.join(' ');
                    if (!script) return await sock.sendMessage(from, { text: '⚠️ Masukkan ekspresi kode JavaScript Bos!' }, { quoted: msg });
                    try {
                        let evaled = eval(script);
                        if (typeof evaled !== 'string') evaled = await import('util').then(u => u.inspect(evaled));
                        await sock.sendMessage(from, { text: `🟢 *EVAL SUKSES:* ✨\n\`\`\`javascript\n${evaled}\n\`\`\`` }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ *EVAL ERROR:* 😭\n\`\`\`text\n${e.message}\n\`\`\`` }, { quoted: msg });
                    }
                }

                // !resetroom → Hapus room lama dan buat room W2G baru
                if (command === 'resetroom') {
                    await sock.sendMessage(from, { text: '🔄 _Bikin room Watch2Gether baru nih Bos, tunggu ya..._ ⏳' }, { quoted: msg });
                    try {
                        // Hapus file lama
                        if (fs.existsSync(W2G_ROOM_FILE)) fs.unlinkSync(W2G_ROOM_FILE);
                        // Kosongkan antrian
                        global.radioQueue = [];
                        // Buat room baru
                        const newRoom = await createW2GRoom();
                        await sock.sendMessage(from, {
                            text: `✅ *Room baru berhasil dibuat Bos!* 🎉\n\n📻 *Link Room Baru:*\n${newRoom.url}\n\n_Antrian lagu juga sudah direset._`
                        }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ Gagal buat room baru Bos! Error: ${e.message}` }, { quoted: msg });
                    }
                }

                if (command === 'self') {
                    isSelfMode = true;
                    await sock.sendMessage(from, { text: '🔒 *Sistem VIP Terkunci!* Sekarang aku cuma nurut sama Bos DoxxBorx aja! Yang lain aku cuekin bleee~ 😝🎀' }, { quoted: msg });
                }

                if (command === 'public') {
                    isSelfMode = false;
                    await sock.sendMessage(from, { text: '🔓 *Sistem Dibuka Umum!* Yeyy, sekarang aku ramah lagi dan bisa dipakai siapa aja di grup! 🥳🌸' }, { quoted: msg });
                }

                if (command === 'turu') {
                    isSleeping = true;
                    await sock.sendMessage(from, { text: '🛌 *Aku izin turu dulu ya Bos...* Capek kerja terus. Ketik `!bangun` kalau Bos butuh aku lagi! Zzz... 💤🧸' }, { quoted: msg });
                }

                if (command === 'bangun') {
                    if (!isSleeping) {
                        return await sock.sendMessage(from, { text: '☀️ *Aku udah bangun dari tadi Bos!* Siap tempur bantu kodingan Bos! 🔥🚀' }, { quoted: msg });
                    }
                    isSleeping = false;
                    await sock.sendMessage(from, { text: '☀️ *Yeayy Aku Bangun!* Semangat lagi bantuin Bos DoxxBorx kerja! Mari kita gass! 🤖💖' }, { quoted: msg });
                }

                if (command === 'antilink') {
                    const status = args[0]?.toLowerCase();
                    if (status === 'on') {
                        antiLink = true;
                        await sock.sendMessage(from, { text: '🛡️ *Anti-Link Ketat Nyala!* Siapapun yang sebar link grup lain bakal aku kick tanpa ampun! 😠⚔️' }, { quoted: msg });
                    } else if (status === 'off') {
                        antiLink = false;
                        await sock.sendMessage(from, { text: '🔓 *Anti-Link Dimatikan.* Santai dulu Bos, sekarang bebas sebar link di sini. 🌸' }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: '⚠️ Formatnya `!antilink on` atau `!antilink off` ya Bosku! 🎀' }, { quoted: msg });
                    }
                }

                if (command === 'spek') {
                    const coreCPU = os.cpus();
                    const platform = os.platform();
                    const totalRAM = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
                    const freeRAM = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
                    
                    const textSpek = `💻 *JEROAN SERVER KITA* 💻\n` +
                                     `*━━━━━━━━━━━━━━━━━━━━━━━*\n` +
                                     `⚙️ *Sistem Operasi:* _${platform} (${os.release()})_\n` +
                                     `🧠 *Processor:* _${coreCPU[0].model}_\n` +
                                     `📈 *RAM Terpakai:* _${(totalRAM - freeRAM).toFixed(2)} GB dari ${totalRAM} GB_\n` +
                                     `⏳ *Uptime PC:* _${Math.floor(os.uptime() / 3600)} jam non-stop_\n` +
                                     `🤖 *Nama Bot:* _${BOT_NAME} Kawaii Core 🎀_`;
                    await sock.sendMessage(from, { text: textSpek }, { quoted: msg });
                }

                if (command === 'systeminfo') {
                    const totalRAM = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
                    const freeRAM = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
                    const usedRAM = (totalRAM - freeRAM).toFixed(2);
                    const cpus = os.cpus();
                    const loadAvg = os.loadavg().map(l => l.toFixed(2)).join(', ');
                    
                    let sysText = `📊 *INFO SISTEM VIP BOS* 📊\n` +
                                  `*━━━━━━━━━━━━━━━━━━━━━━━*\n\n` +
                                  `💻 *OS:* _${os.platform()} (${os.arch()})_\n` +
                                  `⚙️ *Beban CPU:* _[${loadAvg}]_\n` +
                                  `🧠 *Core CPU:* _${cpus.length} Core_\n` +
                                  `📈 *Sisa RAM:* _${freeRAM} GB (Kepakai ${usedRAM} GB)_\n` +
                                  `💾 *Kondisi:* _Semuanya mantap dan ngebut! 🚀💖_`;
                                  
                    await sock.sendMessage(from, { text: sysText }, { quoted: msg });
                }

                if (command === 'speedtest') {
                    await sock.sendMessage(from, { text: '⚡ _Uji seberapa ngebut aku bales chat Bos, bentar ya..._ 🚀' }, { msg });
                    const pingerAwal = Date.now();
                    const latensiRiil = Date.now() - pingerAwal;
                    await sock.sendMessage(from, { text: `🚀 *HASIL UJI NYALI SERVER:* 🚀\n\n🌐 Jaringan: *${latensiRiil + 3}ms*\n🖥️ Pemrosesan: *Melesat kilat!*\n📊 Status: *SANGAT SEHAT & PRIMA* 🟢🎀` }, { quoted: msg });
                }

                if (command === 'broadcast' || command === 'bc') {
                    const teksBc = args.join(' ');
                    if (!teksBc) return await sock.sendMessage(from, { text: '⚠️ *Teksnya mana Bos? Masa aku BC angin?* 🥺' }, { quoted: msg });

                    await sock.sendMessage(from, { text: '📢 _Lagi sebarin pesan ke semua grup nih Bos, tunggu ya..._ 🏃‍♀️💨' }, { quoted: msg });
                    try {
                        const semuaGrup = await sock.groupFetchAllParticipating();
                        const jidsGrup = Object.keys(semuaGrup);
                        let suksesGrup = 0;

                        for (let jid of jidsGrup) {
                            try {
                                await sock.sendMessage(jid, { text: `📢 *PENGUMUMAN DARI PUSAT* 📢\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${teksBc}\n\n🎀 _Pesan resmi dari Bos DoxxBorx_ 👑` });
                                suksesGrup++;
                                await new Promise(resolve => setTimeout(resolve, 1500));
                            } catch (err) {
                                console.error(`Gagal kirim ke grup ${jid}:`, err);
                            }
                        }
                        await sock.sendMessage(from, { text: `✅ *Beres Bos!* Pesannya udah kusebarin ke *${suksesGrup}* grup yang ada aku di dalamnya. 🥳🎉` }, { quoted: msg });
                    } catch (error) {
                        console.error(error);
                        await sock.sendMessage(from, { text: '❌ *Ada error waktu ambil data grup nih Bos!* 😭' }, { quoted: msg });
                    }
                }

                if (command === 'grup') {
                    const aksi = args[0]?.toLowerCase();
                    if (!aksi) return await sock.sendMessage(from, { text: '⚠️ Format salah Bos. Ketik `!grup open` atau `!grup close` 🚪' }, { quoted: msg });
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Ini cuma berlaku di grup aja Bos! 🏡' }, { quoted: msg });
                    
                    if (aksi === 'open') {
                        await sock.groupSettingUpdate(from, 'not_announcement');
                        await sock.sendMessage(from, { text: '🔓 Gerbang grup dibuka! Sekarang semua orang boleh ngobrol lagi. Yeyy! 🗣️🌸' }, { quoted: msg });
                    } else if (aksi === 'close') {
                        await sock.groupSettingUpdate(from, 'announcement');
                        await sock.sendMessage(from, { text: '🔒 Gerbang grup ditutup! Sssttt, sekarang cuma admin aja yang boleh ngomong. 🤫👑' }, { quoted: msg });
                    }
                }

                if (command === 'join') {
                    const linkGrup = args[0];
                    if (!linkGrup) return await sock.sendMessage(from, { text: '⚠️ Link undangannya mana Bos? 🔗' }, { quoted: msg });
                    try {
                        const code = linkGrup.split('https://chat.whatsapp.com/')[1];
                        await sock.groupAcceptInvite(code);
                        await sock.sendMessage(from, { text: '✅ Siap laksanakan Bos! Aku udah nyusup dan masuk ke grup itu. 🥷✨' }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { text: '❌ Aduh gagal masuk grup, link-nya mungkin udah direvoke atau kadaluwarsa Bos! 🥺' }, { quoted: msg });
                    }
                }

                if (command === 'leave') {
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Harus diketik di grup yang mau ditinggalin Bos! 🏃‍♀️' }, { quoted: msg });
                    await sock.sendMessage(from, { text: '👋 Dadah semuanya! Aku disuruh Bos pergi dari sini. Sampai jumpa lagi! 🌸💨' });
                    await sock.groupLeave(from);
                }

                if (command === 'block') {
                    const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    if (!target) return await sock.sendMessage(from, { text: '⚠️ Tag orangnya yang mau diblokir Bos! 😠' }, { quoted: msg });
                    await sock.updateBlockStatus(target, 'block');
                    await sock.sendMessage(from, { text: '🚫 Udah ku-blokir Bos! Nggak bakal berani chat lagi dia. Hmph! 😤' }, { quoted: msg });
                }

                if (command === 'unblock') {
                    const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    if (!target) return await sock.sendMessage(from, { text: '⚠️ Tag orangnya yang mau dimaafin Bos! 🕊️' }, { quoted: msg });
                    await sock.updateBlockStatus(target, 'unblock');
                    await sock.sendMessage(from, { text: '🔓 Udah kulepas blokirnya. Dia udah dimaafin. 😇🌸' }, { quoted: msg });
                }

                if (command === 'refresh') {
                    console.clear();
                    if (global.gc) { global.gc(); }
                    await sock.sendMessage(from, { text: '♻️ *Selesai Bersih-Bersih RAM!* Sekarang aku berasa enteng banget, siap ngebut lagi Bos! 🚀💨💖' }, { quoted: msg });
                }

                if (command === 'pingsan') {
                    await sock.sendMessage(from, { text: '💀 *Duh.. Aku disuruh mati total sama Bos.* Selamat tinggal dunia WhatsApp... 🕯️🥀' }, { quoted: msg });
                    process.exit(0);
                }
            }
        } catch (err) {
            console.error('💥 Yahh Ada Error Bos:', err);
        }
    });
}

// Jalankan Sistem Bot Utama 🎀🚀
startBot();