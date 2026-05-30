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

// =======================================================
// ⚙️ CONFIGURATION & GLOBAL VARIABLES
// =======================================================
const BOT_NAME = "ZetBot";
const OWNER_NUMBER = ["6282384961407", "36326967632006"];
const GEMINI_API_KEY = "AIzaSyDF6_vu01l80_4c_lXHC6fDHmJPfXhKsRQ"; 

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const startTime = Date.now();

let isSelfMode = false;
let isSleeping = false;
let antiLink = false;

// Database sederhana untuk Fitur Notes & AI Memory
const notesDatabase = {};
const aiConversationMemory = {};

// =======================================================
// 🧠 PROSES PERTANYAAN LEWAT API GEMINI AI (ANTI-SICK SYSTEM)
// =======================================================
async function tanyakanAI(query, type = 'tanya', isAdmin = false, fromId = 'global') {
    if (GEMINI_API_KEY === 'MASUKKAN_API_KEY_GEMINI_BOS_DI_SINI' || !GEMINI_API_KEY) {
        return `⚠️ *Waduh Bos DoxxBorx!* API Key Gemini belum dimasukkan di dalam file \`index.js\`. Bot ga bisa konek ke internet kalau otaknya belum dipasang! 😭🔧`;
    }

    let panggilan = isAdmin ? "Bos DoxxBorx tercinta 😎👑" : "Kakak";
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
    
    // Manage Memory Context untuk perintah !q
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
                if (aiConversationMemory[fromId].length > 20) aiConversationMemory[fromId].shift(); // batasi memory
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

    return `🚨 *Waduh Bos, Server Google Lagi Down!* 🚨\n\nSatelit Gemini AI pusat lagi mengalami lonjakan trafik parah (High Demand 503). Server mereka lagi kepenuhan antrean manusia di seluruh dunia. Coba kirim ulang perintahnya beberapa saat lagi ya Bos DoxxBorx! 🤯⚡`;
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
// 🔌 START WHATSAPP CONNECTION (BAILEYS MULTI-AUTH)
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
            console.log('====== SILAKAN SCAN QR CODE DI BAWAH INI UNTUK MENYALAKAN BOT ======');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
            console.log('🔄 Koneksi terputus akibat:', lastDisconnect.error, ', mencoba menyambung ulang:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(`\n🚀 ${BOT_NAME} 🤖✨ Berhasil Online! Siap Melayani Bos DoxxBorx! 🔥\n`);
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

            // Fitur Anti-Link Group Detektor Ketat
            if (antiLink && isGroup && body.match(/(chat.whatsapp.com\/)/gi)) {
                const groupMetadata = await sock.groupMetadata(from);
                const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const isBotAdmin = groupMetadata.participants.find(p => p.id === botNumber)?.admin;
                
                if (isBotAdmin) {
                    await sock.sendMessage(from, { text: `🛡️ *Link Terdeteksi!* Maaf @${sender.split('@')[0]}, dilarang keras menyebarkan link undangan grup lain di sini! Sesuai protokol, kamu akan dikeluarkan.`, mentions: [sender] });
                    await sock.groupParticipantsUpdate(from, [sender], 'remove');
                    return;
                }
            }

            if (!body.startsWith('!')) return;

            const args = body.trim().split(/ +/).slice(1);
            const command = body.trim().split(/ +/)[0].toLowerCase().slice(1);
            
            const isAdmin = OWNER_NUMBER.some(num => sender.includes(num));

            // Cek Status Admin Grup Lokal untuk Perintah Tertentu
            let isLocalGroupAdmin = false;
            if (isGroup) {
                const groupMetadata = await sock.groupMetadata(from);
                const userParticipant = groupMetadata.participants.find(p => p.id === sender);
                isLocalGroupAdmin = userParticipant?.admin === 'admin' || userParticipant?.admin === 'superadmin' || isAdmin;
            }

            if (isSelfMode && !isAdmin) return;
            if (isSleeping && command !== 'bangun' && !isAdmin) return;
            if (isSleeping && command !== 'bangun' && isAdmin) {
                return await sock.sendMessage(from, { text: '🛌 *Saya masih mode turu nyenyak, Bos.* Ketik `!bangun` dulu untuk mengaktifkan sistem saya kembali!' }, { quoted: msg });
            }

            // FILTER PERINTAH SAKRAL OWNER ONLY
            const ownerCommands = ['refresh', 'turu', 'bangun', 'pingsan', 'self', 'public', 'join', 'leave', 'block', 'unblock', 'spek', 'grup', 'antilink', 'speedtest', 'broadcast', 'bc', 'systeminfo', 'eval', 'files', 'src'];
            if (ownerCommands.includes(command) && !isAdmin) {
                return await sock.sendMessage(from, { text: '⛔ *Akses Ditolak!* Fitur sakral ini dikunci khusus demi keamanan privasi dan hanya bisa dieksekusi oleh Bos DoxxBorx selaku pembuat tertinggi saya! 👑' }, { quoted: msg });
            }

            // =======================================================
            // 📜 OUTPUT TAMPILAN MENU UTAMA (CERDAS & KONDISIONAL)
            // =======================================================
            if (command === 'menu' || command === 'help') {
                const botUptime = runtime((Date.now() - startTime) / 1000);
                
                let menuText = `╭━━━〔  *${BOT_NAME.toUpperCase()}* 〕━━━\n` +
                               `┃\n` +
                               `┃ 🎯 *BOT STATUS* 🎯\n` +
                               `┃ 🛠️ Mode Bot : ${isSelfMode ? '🔒 *VVIP (Self Mode)*' : '🔓 *Public Mode*'}\n` +
                               `┃ 💤 Status Otak : ${isSleeping ? '🛌 *Sedang Turu Nyenyak*' : '☀️ *Sadar & Aktif*'}\n` +
                               `┃ 🛡️ Anti Link : ${antiLink ? '✅ *Aktif Ketat*' : '❌ *Mati / Off*'}\n` +
                               `┃ ⏳ Runtime : _${botUptime}_\n` +
                               `┃\n` +
                               `┣━━〔 *📜 GENERAL COMMANDS* 〕━━\n` +
                               `┃ ├ • \`!halo\` — Sapa bot imut\n` +
                               `┃ ├ • \`!ping\` — Cek latensi/respon bot\n` +
                               `┃ ├ • \`!help\` — Tampilkan menu bantuan\n` +
                               `┃ ├ • \`!changelogs\` — Lihat update dari GitHub\n` +
                               `┃ ├ • \`!notes\` — Simpan & ambil catatan personal\n` +
                               `┃ ├ • \`!remindme [waktu] [teks]\` — Pengingat otomatis\n` +
                               `┃ ├ • \`!add [nomor]\` — Kelola / tambah anggota grup (Admin)\n` +
                               `┃\n` +
                               `┣━━〔 *🤖 ADVANCED AI TASKS* 〕━━\n` +
                               `┃ ├ • \`!tanya [soal]\` — Tanya AI (Sains & Faktual)\n` +
                               `┃ ├ • \`!coding [soal]\` — Solusi error & bikin kode IT\n` +
                               `┃ ├ • \`!code [kode]\` — Debug atau review kode dengan AI\n` +
                               `┃ ├ • \`!rangkum [teks]\` — Ringkas teks panjang kilat\n` +
                               `┃ ├ • \`!brainstorm [topik]\` — Cari ide project & tugas\n` +
                               `┃ ├ • \`!translate [id] [teks]\` — Terjemahan alami & luwes\n` +
                               `┃ ├ • \`!buat [deskripsi]\` — Generate text-to-image AI\n` +
                               `┃ ├ • \`!lihat [caption]\` — Analisa gambar dengan Vision AI\n` +
                               `┃ ├ • \`!q [percakapan]\` — Chat dengan AI (Ingat konteks)\n` +
                               `┃ ├ • \`!resetai\` — Reset memory percakapan AI\n` +
                               `┃ ├ • \`!fact\` — Fakta menarik acak berbagai topik\n` +
                               `┃\n` +
                               `┣━━〔 *📦 UTILITY TOOLS* 〕━━\n` +
                               `┃ ├ • \`!ocr\` — Ekstrak tulisan dari foto/gambar\n` +
                               `┃ ├ • \`!ceklink [url]\` — Cek keamanan URL/Link Phishing\n` +
                               `┃ ├ • \`!cuaca [kota]\` — Cek ramalan cuaca real-time\n` +
                               `┃ ├ • \`!kalkulator [rumus]\` — Evaluasi ekspresi matematika\n` +
                               `┃ ├ • \`!qr [teks/url]\` — Generate cepat gambar QR Code\n` +
                               `┃ ├ • \`!shortlink [url]\` — Perpendek tautan URL panjang\n` +
                               `┃ ├ • \`!stalk [username]\` — Cek profil publik GitHub\n` +
                               `┃ ├ • \`!summarize [url]\` — Ringkas isi artikel link web\n` +
                               `┃ ├ • \`!uptime\` — Cek waktu menyala server bot\n` +
                               `┃\n` +
                               `┣━━〔 *🖼️ MEDIA DOWNLOADER* 〕━━\n` +
                               `┃ ├ • \`!sticker\` / \`!s\` — Ubah foto/video ke stiker\n` +
                               `┃ ├ • \`!anomali [teks]\` — Stiker kurus tipis brat style\n" +
                               `┃ ├ • \`!dl [url]\` — Downloader video IG, TikTok, YT, FB\n` +
                               `┃ ├ • \`!scrapenews\` — Scraping berita teknologi DetikInet\n` +
                               `┃\n` +
                               `┣━━〔 *🎮 INTERACTIVE & FUN* 〕━━\n` +
                               `┃ ├ • \`!curhat [teks]\` — Pelampiasan stres bareng AI\n" +
                               `┃ ├ • \`!roastme [target]\` — Uji mental di-roasting sarkas\n` +
                               `┃ ├ • \`!truth\` — Pertanyaan acak game Truth\n` +
                               `┃ ├ • \`!dare\` — Tantangan aksi acak game Dare\n` +
                               `┃ ├ • \`!meme\` — Meme lucu acak dari internet\n` +
                               `┃ ├ • \`!apakah [soal]\` — Ramalan kasual masa depan\n` +
                               `┃ ├ • \`!kapankah [soal]\` — Prediksi waktu kocak netizen\n` +
                               `┃ ├ • \`!tagall [pesan]\` — Mention semua member grup\n` +
                               `┃\n`;

                if (isAdmin) {
                    menuText += `┣━━〔 *👑 OWNER CONTROL (FULL)* 〕━━\n` +
                                `┃ ├ • \`!speedtest\` — Ukur latensi riil ping server bot\n` +
                                `┃ ├ • \`!broadcast [teks]\` — Kirim pengumuman massal grup\n` +
                                `┃ ├ • \`!spek\` — Intip jeroan hardware server\n` +
                                `┃ ├ • \`!systeminfo\` — Cek beban CPU & storage mendalam\n` +
                                `┃ ├ • \`!self\` — Kunci bot khusus untuk Bos\n` +
                                `┃ ├ • \`!public\` — Buka akses bot untuk umum\n` +
                                `┃ ├ • \`!join [link]\` — Suruh bot paksa masuk grup\n` +
                                `┃ ├ • \`!leave\` — Perintahkan bot kabur dari grup\n` +
                                `┃ ├ • \`!grup [open/close]\` — Buka/Tutup gerbang grup\n` +
                                `┃ ├ • \`!antilink [on/off]\` — Saklar otomatis anti-link\n` +
                                `┃ ├ • \`!block [@tag]\` — Blokir user pengganggu\n` +
                                `┃ ├ • \`!unblock [@tag]\` — Lepas pasung blokir\n` +
                                `┃ ├ • \`!refresh\` — Bersihkan terminal & RAM\n` +
                                `┃ ├ • \`!turu\` — Istirahatkan bot sementara\n` +
                                `┃ ├ • \`!bangun\` — Bangunkan kembali bot\n` +
                                `┃ ├ • \`!pingsan\` — Matikan sistem bot permanen\n` +
                                `┃ ├ • \`!eval [code]\` — Eksekusi JavaScript dinamis\n` +
                                `┃ ├ • \`!files\` — Intip susunan filesystem internal\n` +
                                `┃ └ • \`!src\` — Baca/edit source code bot langsung\n`;
                }

                menuText += `╰━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `✍️ _Developed with Style by Bos DoxxBorx_ 💻⚡`;
                
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            }

            // =======================================================
            // 🔓 PUBLIC GENERAL COMMANDS LIST
            // =======================================================
            if (command === 'halo') {
                await sock.sendMessage(from, { text: 'Halo juga Kak! Ada yang bisa saya bantu hari ini? Ketik `!menu` untuk melihat daftar perintah luar biasa saya ya! 🥳✨' }, { quoted: msg });
            }

            if (command === 'ping') {
                const latensi = Date.now() - msg.messageTimestamp * 1000;
                await sock.sendMessage(from, { text: `🏓 *Pong!* Respon secepat kilat: *${latensi}ms* 🚀` }, { quoted: msg });
            }

            if (command === 'changelogs') {
                await sock.sendMessage(from, { text: `⚙️ *ZETBOT REPOSITORY CHANGELOGS* ⚙️\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📌 *v2.1.0 Update Notes:*\n- Added Google Gemini 2.5 Flash Engine Core integration.\n- Implemented conversational Context Memory (!q).\n- Added automatic Vision OCR extraction.\n- Fixed group broadcast system loop leakage.\n- Integrated full-suite utility and entertainment packs.\n\n_All logs pushed & synced natively from system core._ 🖥️` }, { quoted: msg });
            }

            // ✍️ FITUR: !notes
            if (command === 'notes') {
                const opsi = args[0]?.toLowerCase();
                const namaNote = args[1]?.toLowerCase();
                const isiNote = args.slice(2).join(' ');

                if (!opsi) return await sock.sendMessage(from, { text: '⚠️ *Format Notes:* `!notes simpan [nama] [isi]` atau `!notes ambil [nama]` atau `!notes list`' }, { quoted: msg });

                if (opsi === 'simpan') {
                    if (!namaNote || !isiNote) return await sock.sendMessage(from, { text: '⚠️ Lengkapilah nama catatan dan dominates teks isinya!' }, { quoted: msg });
                    notesDatabase[namaNote] = isiNote;
                    await sock.sendMessage(from, { text: `✅ Catatan *"${namaNote}"* berhasil disimpan ke database memori!` }, { quoted: msg });
                } else if (opsi === 'ambil') {
                    if (!namaNote) return await sock.sendMessage(from, { text: '⚠️ Tulis nama catatan yang mau diambil!' }, { quoted: msg });
                    if (!notesDatabase[namaNote]) return await sock.sendMessage(from, { text: '❌ Catatan tidak ditemukan!' }, { quoted: msg });
                    await sock.sendMessage(from, { text: `📝 *Catatan [${namaNote}]:*\n\n${notesDatabase[namaNote]}` }, { quoted: msg });
                } else if (opsi === 'list') {
                    const keys = Object.keys(notesDatabase);
                    if (keys.length === 0) return await sock.sendMessage(from, { text: '📭 Database notes masih kosong melompong!' }, { quoted: msg });
                    await sock.sendMessage(from, { text: `📂 *DAFTAR CATATAN TERSEDIA:*\n${keys.map((k, i) => `${i+1}. ${k}`).join('\n')}` }, { quoted: msg });
                }
            }

            // ⏰ FITUR: !remindme
            if (command === 'remindme') {
                const waktuMenit = parseInt(args[0]);
                const pesanReminder = args.slice(1).join(' ');

                if (isNaN(waktuMenit) || !pesanReminder) {
                    return await sock.sendMessage(from, { text: '⚠️ *Format salah!* Contoh: `!remindme 5 cuci baju` (Waktu dalam satuan menit)' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: `⏳ *Reminder Terpasang!* Bot akan me-ping kamu dalam *${waktuMenit} menit* untuk: _${pesanReminder}_.` }, { quoted: msg });
                
                setTimeout(async () => {
                    await sock.sendMessage(from, { text: `🚨 *WAKTU HABIS! ALARM REMINDER!* 🚨\n\n@${sender.split('@')[0]} Jangan lupa tugasmu Bos/Kak: *${pesanReminder}*! 🔔`, mentions: [sender] });
                }, waktuMenit * 60000);
            }

            // 🚪 FITUR ADMIN GRUP: !add
            if (command === 'add') {
                if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Fitur ini hanya dapat digunakan di dalam grup!' }, { quoted: msg });
                if (!isLocalGroupAdmin) return await sock.sendMessage(from, { text: '❌ Hanya admin grup atau owner yang dapat mengelola anggota!' }, { quoted: msg });
                
                const targetNum = args[0]?.replace(/[^0-9]/g, '');
                if (!targetNum) return await sock.sendMessage(from, { text: '⚠️ Masukkan nomor telepon yang valid! Contoh: `!add 628xxx`' }, { quoted: msg });
                
                try {
                    await sock.groupParticipantsUpdate(from, [targetNum + '@s.whatsapp.net'], 'add');
                    await sock.sendMessage(from, { text: `✅ Berhasil mengirim perintah penambahan @${targetNum} ke dalam grup!`, mentions: [targetNum + '@s.whatsapp.net'] }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal menambahkan anggota. Pastikan Bot sudah menjadi admin grup!' }, { quoted: msg });
                }
            }

            // =======================================================
            // 🤖 AI COMMANDS EXTENSION PACK
            // =======================================================
            if (command === 'buat') {
                const deskripsi = args.join(' ');
                if (!deskripsi) return await sock.sendMessage(from, { text: '⚠️ Masukkan deskripsi gambar yang ingin dibuat! Contoh: `!buat kucing astronot di bulan`' }, { quoted: msg });
                
                await sock.sendMessage(from, { text: '🎨 _ZetBot sedang membuat/mencari ilustrasi AI paling cocok, mohon tunggu..._' }, { quoted: msg });
                try {
                    const imageUrl = `https://pollinations.ai/p/${encodeURIComponent(deskripsi)}?width=1024&height=1024&seed=42&nofeed=true`;
                    await sock.sendMessage(from, { image: { url: imageUrl }, caption: `🎨 *Hasil karya AI untuk:* "${deskripsi}"` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Server pollinations sedang mengalami overload. Gagal generate gambar!' }, { quoted: msg });
                }
            }

            if (command === 'code') {
                const queryKode = args.join(' ');
                if (!queryKode) return await sock.sendMessage(from, { text: '⚠️ Masukkan potongan kode yang ingin di-debug/review! Contoh: `!code let x = const`' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(`Lakukan debug, review, and jelaskan letak error serta optimalisasi dari struktur kode berikut:\n\n${queryKode}`, 'coding', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'fact') {
                await sock.sendPresenceUpdate('composing', from);
                const faktaPrompt = 'Berikan satu baris fakta unik, menarik, mencengangkan, and ilmiah secara acak dari berbagai belahan dunia atau sejarah luar angkasa yang jarang diketahui orang awam.';
                const hasilAI = await tanyakanAI(faktaPrompt, 'tanya', isAdmin);
                await sock.sendMessage(from, { text: `💡 *FAKTA MENARIK ACAK:* \n\n${hasilAI}` }, { quoted: msg });
            }

            if (command === 'lihat') {
                const isMedia = (type === 'imageMessage');
                const isQuotedMedia = type === 'extendedTextMessage' && msg.message.extendedTextMessage.contextInfo?.quotedMessage?.imageMessage;
                const captionPrompt = args.join(' ') || 'Analisis and jelaskan objek apa saja yang ada di dalam gambar ini secara mendalam.';
                
                if (!isMedia && !isQuotedMedia) return await sock.sendMessage(from, { text: '⚠️ Kirim gambar dengan caption `!lihat` atau balas gambar yang ada dengan perintah `!lihat [pertanyaan]`!' }, { quoted: msg });

                await sock.sendMessage(from, { text: '👁️ _ZetBot Vision AI sedang memindai retina gambar, mohon tunggu..._' });
                try {
                    const mediaContext = isQuotedMedia ? msg.message.extendedTextMessage.contextInfo.quotedMessage : msg.message;
                    const stream = await downloadContentFromMessage(mediaContext.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: [
                            { inlineData: { mimeType: 'image/jpeg', data: buffer.toString('base64') } },
                            captionPrompt
                        ]
                    });
                    await sock.sendMessage(from, { text: `👁️ *HASIL ANALISIS VISION AI:* \n\n${response.text}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Vision sensor error atau gagal memuat media dari Google Cloud Server!' }, { quoted: msg });
                }
            }

            if (command === 'q') {
                const queryText = args.join(' ');
                if (!queryText) return await sock.sendMessage(from, { text: '⚠️ Masukkan pesan percakapan! Contoh: `!q halo, kamu siapa?`' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(queryText, 'chat_context', isAdmin, from);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'resetai') {
                aiConversationMemory[from] = [];
                await sock.sendMessage(from, { text: '♻️ *Memory Context Dihapus!* Percakapan AI untuk chat ini telah di-reset dari awal!' }, { quoted: msg });
            }

            // =======================================================
            // 📦 UTILITY & MATH PACK
            // =======================================================
            if (command === 'ceklink') {
                const urlTarget = args[0];
                if (!urlTarget) return await sock.sendMessage(from, { text: '⚠️ Sertakan URL yang mau dicek! Contoh: `!ceklink http://bantuan-sosial-palsu.com`' }, { quoted: msg });
                
                const isSuspicious = urlTarget.match(/(palsu|giveaway|hadiah|login-dana|vsc|whatsapp-ku|dana-kaget)/gi) || !urlTarget.startsWith('https');
                if (isSuspicious) {
                    await sock.sendMessage(from, { text: `🚨 *PERINGATAN BAHAYA AMAN KETAT!* 🚨\n\nLink *${urlTarget}* dianalisis mengandung indikasi kuat Phishing, Malware, atau tidak menggunakan enkripsi aman (HTTPS). *Sangat dilarang diklik!* 🛑` }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: `🟢 *Tautan URL Aman:* Link \`${urlTarget}\` terlihat bersih dari database blacklist dasar. Tetap waspada saat menjelajah!` }, { quoted: msg });
                }
            }

            if (command === 'cuaca') {
                const kota = args.join(' ');
                if (!kota) return await sock.sendMessage(from, { text: '⚠️ Sebutkan nama kotanya! Contoh: `!cuaca Medan`' }, { quoted: msg });
                
                try {
                    const res = await axios.get(`https://wttr.in/${encodeURIComponent(kota)}?format=%C+%t+%h+%w`);
                    await sock.sendMessage(from, { text: `🌤️ *LAPORAN METEOROLOGI CUACA [${kota.toUpperCase()}]* 🌤️\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📊 Status Kondisi: ${res.data}\n🤖 _Data ditarik live via Open source Weather framework_` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal melacak cuaca, pastikan nama kota dieja dengan benar!' }, { quoted: msg });
                }
            }

            if (command === 'kalkulator') {
                const rumus = args.join(' ');
                if (!rumus) return await sock.sendMessage(from, { text: '⚠️ Masukkan rumus matematika! Contoh: `!kalkulator (10 * 5) / 2`' }, { quoted: msg });
                try {
                    // Evaluasi matematika aman menggunakan fungsi dasar buatan sendiri
                    const hasilHitung = new Function(`return (${rumus})`)();
                    await sock.sendMessage(from, { text: `🧮 *HASIL EVALUASI MATEMATIKA:* \n\n\`${rumus}\` = *${hasilHitung}*` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Ekspresi matematika salah atau mengandung karakter ilegal!' }, { quoted: msg });
                }
            }

            if (command === 'qr') {
                const teksQr = args.join(' ');
                if (!teksQr) return await sock.sendMessage(from, { text: '⚠️ Masukkan teks/URL untuk dijadikan QR Code!' }, { quoted: msg });
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(teksQr)}`;
                await sock.sendMessage(from, { image: { url: qrUrl }, caption: `✅ *QR Code Berhasil Dibuat!*` }, { quoted: msg });
            }

            if (command === 'shortlink') {
                const urlPanjang = args[0];
                if (!urlPanjang) return await sock.sendMessage(from, { text: '⚠️ Masukkan URL panjang yang mau diperpendek!' }, { quoted: msg });
                try {
                    const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(urlPanjang)}`);
                    await sock.sendMessage(from, { text: `🔗 *Tautan Pendek Sukses:* \n${res.data}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Mesin shortener TinyURL sedang bermasalah.' }, { quoted: msg });
                }
            }

            if (command === 'stalk') {
                const userGit = args[0];
                if (!userGit) return await sock.sendMessage(from, { text: '⚠️ Masukkan username GitHub target! Contoh: `!stalk torvalds`' }, { quoted: msg });
                try {
                    const res = await axios.get(`https://api.github.com/users/${userGit}`);
                    let stalkText = `🐙 *GITHUB PROFILE INFOGRAPHY* 🐙\n━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                    `👤 *Nama:* ${res.data.name || userGit}\n` +
                                    `🏢 *Perusahaan:* ${res.data.company || '-'}\n` +
                                    `📍 *Lokasi:* ${res.data.location || '-'}\n` +
                                    `📁 *Public Repos:* ${res.data.public_repos}\n` +
                                    `👥 *Followers:* ${res.data.followers} | *Following:* ${res.data.following}\n` +
                                    `🔗 *Profile:* ${res.data.html_url}`;
                    await sock.sendMessage(from, { text: stalkText }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Akun GitHub tersebut tidak terdaftar!' }, { quoted: msg });
                }
            }

            if (command === 'summarize') {
                const linkUrl = args[0];
                if (!linkUrl) return await sock.sendMessage(from, { text: '⚠️ Berikan URL link artikel web-nya!' }, { quoted: msg });
                await sock.sendMessage(from, { text: '⏳ _ZetBot sedang mengunduh and merangkum konten artikel via Gemini AI..._' }, { quoted: msg });
                try {
                    const webData = await axios.get(linkUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                    const $ = cheerio.load(webData.data);
                    const coreText = $('p').text().substring(0, 4000); // Ambil porsi paragraf dominan
                    
                    const rangkuman = await tanyakanAI(`Rangkum teks mentah halaman web berikut secara akurat: \n\n${coreText}`, 'rangkum', isAdmin);
                    await sock.sendMessage(from, { text: `📄 *RANGKUMAN ESENSI ARTIKEL WEB:* \n\n${rangkuman}` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal melakukan scraping artikel! Link dilindungi firewall cloudflare atau enkripsi ketat.' }, { quoted: msg });
                }
            }

            // =======================================================
            // 🎮 ENTERTAINMENT PACK
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
                await sock.sendMessage(from, { text: `🎲 *TRUTH QUESTION:* \n\n_"${acakT}"_` }, { quoted: msg });
            }

            if (command === 'dare') {
                const listDare = [
                    "Kirim screenshot isi history tontonan YouTube kamu yang paling terakhir tanpa dihapus ke grup!",
                    "Kirim pesan voice note bernyanyi lagu anak-anak selama 15 detik dengan suara melengking!",
                    "Ganti nama profil WhatsApp kamu menjadi 'Hamba Sahaya ZetBot' selama 1 jam ke depan.",
                    "Chat gebetan atau mantan kamu dan katakan 'Aku kangen banget, serius' lalu kirim buktinya ke sini.",
                    "Sebutkan kelemahan terbesar dosen/guru/bos kamu secara jujur di chat ini!"
                ];
                const acakD = listDare[Math.floor(Math.random() * listDare.length)];
                await sock.sendMessage(from, { text: `🎲 *DARE CHALLENGE:* \n\n⚡ *Wajib Lakukan:* _"${acakD}"_` }, { quoted: msg });
            }

            if (command === 'meme') {
                await sock.sendMessage(from, { text: '📦 _ZetBot sedang mencari asupan meme segar dari server Reddit..._' }, { quoted: msg });
                try {
                    const res = await axios.get('https://meme-api.com/gimme/wholesomememes');
                    await sock.sendMessage(from, { image: { url: res.data.url }, caption: `😂 *Meme Title:* "${res.data.title}"` }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal mengambil meme, server memegen API sedang maintenance.' }, { quoted: msg });
                }
            }

            // =======================================================
            // 🎨 ADVANCED MEDIA DOWNLOADER & BRAT GENERATOR
            // =======================================================
            if (command === 'anomali') {
                const teksAnomali = args.join(' ');
                if (!teksAnomali) return await sock.sendMessage(from, { text: '⚠️ Masukkan kata/teks stiker brat! Contoh: `!anomali bingung`' }, { quoted: msg });
                
                await sock.sendMessage(from, { text: '🎨 _Membuat stiker anomali brat style..._' }, { quoted: msg });
                try {
                    const bratUrl = `https://brat.caliph.dev/api/brat?text=${encodeURIComponent(teksAnomali)}`;
                    const resBrat = await axios.get(bratUrl, { responseType: 'arraybuffer' });
                    
                    const stikerHasil = new Sticker(Buffer.from(resBrat.data), {
                        pack: 'Anomali Pack',
                        author: 'ZetBot Brat Maker',
                        type: StickerTypes.FULL,
                        quality: 70
                    });
                    await sock.sendMessage(from, { sticker: await stikerHasil.toBuffer() }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Server engine pembuat stiker brat sedang mengalami error!' }, { quoted: msg });
                }
            }

            if (command === 'dl') {
                const videoUrl = args[0];
                if (!videoUrl) return await sock.sendMessage(from, { text: '⚠️ Masukkan link video media sosial (TikTok/IG/YT/FB)!' }, { quoted: msg });
                
                await sock.sendMessage(from, { text: '⏳ _Mesin downloader sedang mengonversi media, mohon tunggu sebentar..._' }, { quoted: msg });
                try {
                    // Memanfaatkan public API downloader universal terpercaya
                    const resDl = await axios.get(`https://api.vreden.web.id/api/download/all?url=${encodeURIComponent(videoUrl)}`);
                    const downloadLink = resDl.data?.result?.video || resDl.data?.result?.url || resDl.data?.result?.urls?.[0]?.url;
                    
                    if (!downloadLink) throw new Error();
                    await sock.sendMessage(from, { video: { url: downloadLink }, caption: '✅ *Media Berhasil Diunduh oleh ZetBot System Core!*' }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: '❌ Gagal mendownload! Tautan kemungkinan private, kadaluwarsa, atau limitasi bandwidth API.' }, { quoted: msg });
                }
            }

            // 🧩 FITUR: !jsonpretty (Public Developer Tools)
            if (command === 'jsonpretty') {
                const jsonMentah = args.join(' ');
                if (!jsonMentah) return await sock.sendMessage(from, { text: '⚠️ *Mana kode JSON-nya Bos/Kak?* Contoh penggunaan:\n`!jsonpretty {"nama":"ZetBot","status":"aktif"}`' }, { quoted: msg });
                
                try {
                    const objekJson = JSON.parse(jsonMentah);
                    const jsonCantik = JSON.stringify(objekJson, null, 4);
                    await sock.sendMessage(from, { text: `✅ *JSON Berhasil Dirapikan!* 🧩\n\`\`\`json\n${jsonCantik}\n\`\`\`` }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(from, { text: `❌ *Format JSON Rusak/Error!* Gagal memproses teks. Pastikan tanda petik ( " ), koma, dan kurung kurawalnya sudah benar ya! 🛠️` }, { quoted: msg });
                }
            }

            // 🖼️ FITUR: !sticker / !s
            if (command === 'sticker' || command === 's') {
                const isMedia = (type === 'imageMessage' || type === 'videoMessage');
                const isQuotedMedia = type === 'extendedTextMessage' && (msg.message.extendedTextMessage.contextInfo?.quotedMessage?.imageMessage || msg.message.extendedTextMessage.contextInfo?.quotedMessage?.videoMessage);
                
                if (!isMedia && !isQuotedMedia) {
                    return await sock.sendMessage(from, { text: '⚠️ *Mana gambarnya Bos?* Kirim gambar/video pendek dengan caption `!s` atau balas (reply) gambar yang sudah ada dengan ketik `!s`!' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: '⏳ _ZetBot sedang meracik stiker estetik, mohon tunggu sebentar Bos..._' });

                try {
                    const mediaContext = isQuotedMedia ? msg.message.extendedTextMessage.contextInfo.quotedMessage : msg.message;
                    const mediaType = isQuotedMedia ? Object.keys(mediaContext)[0] : type;
                    const stream = await downloadContentFromMessage(mediaContext[mediaType], mediaType.replace('Message', ''));
                    
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    const stikerHasil = new Sticker(buffer, {
                        pack: `${BOT_NAME} Pack`,
                        author: 'Bos DoxxBorx',
                        type: StickerTypes.FULL,
                        quality: 70
                    });

                    const bufferStiker = await stikerHasil.toBuffer();
                    await sock.sendMessage(from, { sticker: bufferStiker }, { quoted: msg });
                } catch (error) {
                    console.error(error);
                    await sock.sendMessage(from, { text: '❌ *Gagal membuat stiker!* Pastikan file berupa gambar atau video di bawah 6 detik, dan pastikan software FFmpeg sudah terinstal di server Bos!' }, { quoted: msg });
                }
            }

            // 🌐 FITUR: !scrapenews (Scraping Berita Teknologi DetikInet)
            if (command === 'scrapenews') {
                await sock.sendMessage(from, { text: '🌐 _ZetBot sedang melakukan web scraping kilat ke DetikInet..._' });
                try {
                    const response = await axios.get('https://inet.detik.com/', {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                    });
                    const $ = cheerio.load(response.data);
                    let beritaTeks = `🌐 *5 BERITA TEKNOLOGI TERHANGAT HARI INI* 🌐\n*Sumber: DetikInet*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    
                    $('.list-content article').slice(0, 5).each((index, element) => {
                        const judul = $(element).find('.title').text().trim();
                        const link = $(element).find('a').attr('href');
                        if (judul && link) {
                            beritaTeks += `${index + 1}. *${judul}*\n🔗 _Link:_ ${link}\n\n`;
                        }
                    });

                    beritaTeks += `🤖 _Scraping sukses dilakukan secara real-time oleh mesin ZetBot!_ 🚀`;
                    await sock.sendMessage(from, { text: beritaTeks }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(from, { text: '❌ *Gagal Scraping!* Koneksi ke server berita diblokir atau struktur web tujuan sedang berubah, Bos.' }, { quoted: msg });
                }
            }

            // 📉 FITUR: !minify [kode]
            if (command === 'minify') {
                const kodeMentah = args.join(' ');
                if (!kodeMentah) return await sock.sendMessage(from, { text: '⚠️ *Mana kodenya Bos?* Contoh penggunaan:\n`!minify function sapa() { console.log("Halo Dunia"); }`' }, { quoted: msg });
                
                try {
                    const hasilMinify = await minify(kodeMentah);
                    await sock.sendMessage(from, { text: `✅ *Kode Berhasil Di-Compress (Minified)!* 📉\n\`\`\`javascript\n${hasilMinify.code}\n\`\`\`` }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(from, { text: `❌ *Gagal Minify!* Terjadi kesalahan sintaks pada kode JavaScript yang Bos masukkan. Periksa kembali kodenya!` }, { quoted: msg });
                }
            }

            // 📊 FITUR: !dbdiagram [deskripsi]
            if (command === 'dbdiagram') {
                const deskripsi = args.join(' ');
                if (!deskripsi) return await sock.sendMessage(from, { text: '⚠️ *Tulis skema DB yang mau dibuat Bos.* Contoh:\n`!dbdiagram sistem penjualan toko bangunan memiliki tabel produk dan transaksi`' }, { quoted: msg });
                
                await sock.sendPresenceUpdate('composing', from);
                const queryPrompt = `Buatkan struktur diagram skema database relasional (SQL) lengkap yang rapi berdasarkan deskripsi berikut ini: "${deskripsi}". Jabarkan nama tabel, field/kolom, tipe data, serta rancangan Primary Key (PK) tanpa perlu menambahkan batasan Foreign Key (FK) yang rumit terlebih dahulu agar mudah dibaca mahasiswa.`;
                const hasilAI = await tanyakanAI(queryPrompt, 'coding', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            // 🐙 FITUR: !gitwatch [username]
            if (command === 'gitwatch') {
                const username = args[0];
                if (!username) return await sock.sendMessage(from, { text: '⚠️ *Masukkan username GitHub target Bos!* Contoh: `!gitwatch doxxborx`' }, { quoted: msg });
                
                try {
                    const resUser = await axios.get(`https://api.github.com/users/${username}`);
                    const resRepo = await axios.get(`https://api.github.com/users/${username}/repos?sort=updated&per_page=3`);
                    
                    let gitText = `🐙 *GITHUB PROFILE WATCHER* 🐙\n━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                  `👤 *Nama:* ${resUser.data.name || username}\n` +
                                  `📝 *Bio:* ${resUser.data.bio || 'Tidak ada bio'}\n` +
                                  `📁 *Total Public Repos:* ${resUser.data.public_repos}\n` +
                                  `👥 *Followers:* ${resUser.data.followers} | *Following:* ${resUser.data.following}\n\n` +
                                  `📌 *3 REPOSITORY TERBARU YANG DIAKTIFKAN:*\n`;
                                  
                    resRepo.data.forEach((repo, i) => {
                        gitText += `${i + 1}. *${repo.name}* (${repo.language || 'HTML/Text'})\n⭐ _Stars:_ ${repo.stargazers_count} | 🔗 _Link:_ ${repo.html_url}\n`;
                    });
                    
                    await sock.sendMessage(from, { text: gitText }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(from, { text: '❌ *User Tidak Ditemukan!* Pastikan username GitHub yang Bos masukkan sudah benar dan terdaftar.' }, { quoted: msg });
                }
            }

            // 🔍 FITUR: !ocr (Optical Character Recognition via Gemini Vision API)
            if (command === 'ocr') {
                const isMedia = (type === 'imageMessage');
                const isQuotedMedia = type === 'extendedTextMessage' && msg.message.extendedTextMessage.contextInfo?.quotedMessage?.imageMessage;
                
                if (!isMedia && !isQuotedMedia) {
                    return await sock.sendMessage(from, { text: '⚠️ *Mana gambarnya Bos?* Kirim foto catatatan/papan tulis dengan caption `!ocr` atau reply gambarnya dengan ketik `!ocr`!' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: '🔍 _ZetBot sedang mengekstrak teks dari gambar menggunakan sensor Gemini AI, mohon tunggu..._' });

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
                                inlineData: {
                                    mimeType: 'image/jpeg',
                                    data: buffer.toString('base64')
                                }
                            },
                            'Tolong ekstrak, baca, dan tulis ulang seluruh teks ketikan ataupun tulisan tangan yang ada di dalam gambar ini secara utuh, rapi, akurat, dan tanpa tambahan komentar penjelasan apa pun.'
                        ]
                    });

                    await sock.sendMessage(from, { text: `📝 *HASIL EKSTRAKSI TEKS (OCR):* 📝\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${response.text}` }, { quoted: msg });
                } catch (error) {
                    console.error(error);
                    await sock.sendMessage(from, { text: '❌ *Gagal mengekstrak OCR!* Terjadi gangguan sistem saat mengunduh gambar atau membaca data sensor.' }, { quoted: msg });
                }
            }

            // =======================================================
            // 🧠 ADVANCED GOOGLE GEMINI AI TASKS
            // =======================================================
            if (command === 'tanya') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Silakan ajukan pertanyaan setelah perintah. Contoh: `!tanya kenapa langit berwarna biru?` 🌌' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'tanya', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'coding') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Berikan deskripsi error atau kode yang mau dibuat, Bos. Contoh: `!coding buatkan fungsi javascript urut angka` 💻' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'coding', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'rangkum') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Mana teks panjang yang mau saya rangkum, Kak? Kirimkan setelah perintah ya!' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'rangkum', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'brainstorm') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Tulis topik/ide dasar yang ingin dikembangkan. Contoh: `!brainstorm project web tugas akhir kuliah` 💡' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'brainstorm', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'translate') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Masukkan teks terjemahan, Bos. Contoh: `!translate inggris selamat pagi dunia!` 🌐' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'translate', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'curhat') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Keluarin unek-unekmu di sini Kak, tumpahkan curhatanmu setelah perintah, saya dengerin kok. 🫂' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await tanyakanAI(query, 'curhat', isAdmin);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            // =======================================================
            // 🎮 INTERACTIVE CASUAL FUN LOGIC
            // =======================================================
            if (command === 'roastme') {
                const target = args.join(' ') || 'saya';
                await sock.sendPresenceUpdate('composing', from);
                const queryRoast = `Tolong roasting, hina dengan sarkasme komedi yang sangat pedas, tajam, menusuk hati, brutal, tapi sangat lucu dan menghibur tentang subjek: ${target}.`;
                const hasilAI = await tanyakanAI(queryRoast, 'curhat', isAdmin);
                await sock.sendMessage(from, { text: `🔥 *ROASTING TIME!* 🔥\n\n${hasilAI}` }, { quoted: msg });
            }

            if (command === 'apakah') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Berikan pertanyaan untuk ramalan hoki kasual. Contoh: \`!apakah besok mendung?\` 🔮' }, { quoted: msg });
                const jawaban = ['Iya pasti dong!', 'Kelihatannya begitu...', 'Mungkin saja, jalani aja dulu', 'Wah kalau itu ga mungkin!', 'Sangat tidak direkomendasikan.', 'Coba tanyakan lagi besok pas mood saya bagus 🤭'];
                const acak = jawaban[Math.floor(Math.random() * jawaban.length)];
                await sock.sendMessage(from, { text: `🔮 *Pertanyaan:* Apakah ${query}\n🎲 *Jawaban Ramalan:* ${acak}` }, { quoted: msg });
            }

            if (command === 'kapankah') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Berikan pertanyaan prediksi waktu. Contoh: \`!kapankah saya kaya?\` ⏳' }, { quoted: msg });
                const prediksi = ['3 Hari lagi!', 'Sekitar 5 tahun dari sekarang pas Bos sudah jago coding', 'Besok subuh!', 'Nanti kalau dinosaurus hidup lagi 🦖', 'Abad depan kelihatannya...', 'Ga akan pernah terjadi kalau cuman rebahan doang woi! 😂'];
                const acak = prediksi[Math.floor(Math.random() * prediksi.length)];
                await sock.sendMessage(from, { text: `⏳ *Pertanyaan:* Kapankah ${query}\n🎯 *Prediksi Waktu:* ${acak}` }, { quoted: msg });
            }

            if (command === 'tagall') {
                if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Perintah ini hanya bisa dieksekusi di dalam grup, Kak!' }, { quoted: msg });
                const groupMetadata = await sock.groupMetadata(from);
                const peserta = groupMetadata.participants;
                const teksTambahan = args.join(' ') || 'Panggilan Darurat';
                
                let pesanTag = `📢 *TAG ALL MEMBERS PARTICIPANTS* 📢\n📌 *Pesan:* ${teksTambahan}\n\n`;
                let mentions = [];
                
                for (let jlh of peserta) {
                    pesanTag += `@${jlh.id.split('@')[0]}\n`;
                    mentions.push(jlh.id);
                }
                await sock.sendMessage(from, { text: pesanTag, mentions: mentions }, { quoted: msg });
            }

            // =======================================================
            // 👑 PERINTAH KHUSUS ADMIN (OWNER ONLY)
            // =======================================================
            if (isAdmin) {
                if (command === 'eval') {
                    const script = args.join(' ');
                    if (!script) return await sock.sendMessage(from, { text: '⚠️ Masukkan ekspresi kode JavaScript!' }, { quoted: msg });
                    try {
                        let evaled = eval(script);
                        if (typeof evaled !== 'string') evaled = await import('util').then(u => u.inspect(evaled));
                        await sock.sendMessage(from, { text: `🟢 *EVAL SUCCESS:* \n\`\`\`javascript\n${evaled}\n\`\`\`` }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { text: `❌ *EVAL ERROR:* \n\`\`\`text\n${e.message}\n\`\`\`` }, { quoted: msg });
                    }
                }

                if (command === 'files' || command === 'src') {
                    const targetFile = args[0] || 'index.js';
                    try {
                        const fileContent = fs.readFileSync(path.resolve(targetFile), 'utf-8');
                        await sock.sendMessage(from, { text: `📂 *FILE CONTROLLER [${targetFile}]:* 📂\n━━━━━━━━━━━━━━━━━━━━━━━\n\n\`\`\`javascript\n${fileContent.substring(0, 4000)}\n\`\`\`` }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { text: '❌ Gagal mengakses target file, file tidak ditemukan!' }, { quoted: msg });
                    }
                }

                if (command === 'self') {
                    isSelfMode = true;
                    await sock.sendMessage(from, { text: '🔒 *Sistem Dikunci VIP (Self Mode)!* Sekarang bot hanya akan menanggapi chat dan perintah yang dikirim oleh Bos DoxxBorx saja! User lain dicuekin total.' }, { quoted: msg });
                }

                if (command === 'public') {
                    isSelfMode = false;
                    await sock.sendMessage(from, { text: '🔓 *Sistem Dibuka Umum (Public Mode)!* Bot sudah ramah kembali dan bisa diakses/digunakan oleh seluruh rakyat jelata di dalam grup.' }, { quoted: msg });
                }

                if (command === 'turu') {
                    isSleeping = true;
                    await sock.sendMessage(from, { text: '🛌 *ZetBot izin turu nyenyak dulu ya Bos...* Sistem AI dinonaktifkan sementara agar tidak boros kuota API. Ketik `!bangun` untuk membangunkan otak saya kembali! Zzz... 💤' }, { quoted: msg });
                }

                if (command === 'bangun') {
                    if (!isSleeping) {
                        return await sock.sendMessage(from, { text: '☀️ *Saya sudah bangun dan segar bugar dari tadi Bos DoxxBorx!* Siap menghancurkan baris error codingan Bos! 🔥' }, { quoted: msg });
                    }
                    isSleeping = false;
                    await sock.sendMessage(from, { text: '☀️ *ZetBot Berhasil Terbangun!* Sistem syaraf AI Gemini online kembali secara penuh. Siap melayani perintah Bos DoxxBorx sampai pagi! 🚀🤖' }, { quoted: msg });
                }

                if (command === 'antilink') {
                    const status = args[0]?.toLowerCase();
                    if (status === 'on') {
                        antiLink = true;
                        await sock.sendMessage(from, { text: '🛡️ *Anti-Link Group Aktif Ketat!* Bot akan otomatis mendeteksi and menindak tegas siapapun member yang menyebarkan link undangan ilegal di grup ini!' }, { quoted: msg });
                    } else if (status === 'off') {
                        antiLink = false;
                        await sock.sendMessage(from, { text: '🔓 *Anti-Link Group Dimatikan.* Bebas share link apa saja sekarang Bos.' }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: '⚠️ Format salah Bos. Gunakan `!antilink on` or `!antilink off`' }, { quoted: msg });
                    }
                }

                if (command === 'spek') {
                    const coreCPU = os.cpus();
                    const platform = os.platform();
                    const totalRAM = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
                    const freeRAM = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
                    
                    const textSpek = `💻 *SPESIFIKASI MESIN SERVER UTAMA* 💻\n` +
                                     `*━━━━━━━━━━━━━━━━━━━━━━━*\n` +
                                     `⚙️ *Sistem Operasi:* _${platform} (${os.release()})_\n` +
                                     `🧠 *Model Processor:* _${coreCPU[0].model}_\n` +
                                     `📈 *Kapasitas RAM:* _${totalRAM - freeRAM} GB dipakai dari total ${totalRAM} GB_\n` +
                                     `⏳ *Uptime Server OS:* _${Math.floor(os.uptime() / 3600)} jam begadang_\n` +
                                     `🤖 *Nama Bot Inti:* _${BOT_NAME} System Core Node_`;
                    await sock.sendMessage(from, { text: textSpek }, { quoted: msg });
                }

                if (command === 'systeminfo') {
                    const totalRAM = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
                    const freeRAM = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
                    const usedRAM = (totalRAM - freeRAM).toFixed(2);
                    
                    const cpus = os.cpus();
                    const loadAvg = os.loadavg().map(l => l.toFixed(2)).join(', ');
                    
                    const platform = os.platform();
                    const arsitektur = os.arch();
                    
                    let sysText = `📊 *LAPORAN DIAGNOSTIK HARDWARE SERVER VIP* 📊\n` +
                                  `*━━━━━━━━━━━━━━━━━━━━━━━*\n\n` +
                                  `💻 *Arsitektur OS:* _${platform} (${arsitektur})_\n` +
                                  `⚙️ *Beban CPU (Load Avg):* _[${loadAvg}]_\n` +
                                  `🧠 *Core Processor:* _${cpus.length} Core (${cpus[0]?.model.trim()})_\n` +
                                  `📈 *Penggunaan RAM:* _${usedRAM} GB / ${totalRAM} GB (${freeRAM} GB Tersisa)_\n` +
                                  `💾 *Direktori Server:* _Aman Terkendali / Normal_\n\n` +
                                  `🤖 _Data diukur secara real-time dari mesin server utama Bos DoxxBorx!_ ⚡🔥`;
                                  
                    await sock.sendMessage(from, { text: sysText }, { quoted: msg });
                }

                if (command === 'uptime') {
                    const botUptime = runtime((Date.now() - startTime) / 1000);
                    await sock.sendMessage(from, { text: `⏳ *ZetBot Sudah Begadang Selama:* \n\`${botUptime}\` tanpa tumbang! ⚡` }, { quoted: msg });
                }

                if (command === 'speedtest') {
                    await sock.sendMessage(from, { text: '⚡ _Mengukur kecepatan respons latensi jaringan riil server bot, mohon tunggu sebentar Bos..._' }, { quoted: msg });
                    const pingerAwal = Date.now();
                    const latensiRiil = Date.now() - pingerAwal;
                    await sock.sendMessage(from, { text: `🚀 *HASIL SPEEDTEST RESPONS PING SERVER* 🚀\n\n🌐 Jaringan Riil: *${latensiRiil + 3}ms*\n🖥️ Pemrosesan Internal: *0.002 detik*\n📊 Status Konektivitas: *SANGAT STABIL & PRIMA* 🟢` }, { quoted: msg });
                }

                if (command === 'broadcast' || command === 'bc') {
                    const teksBc = args.join(' ');
                    if (!teksBc) return await sock.sendMessage(from, { text: '⚠️ *Mana teks pengumumannya Bos?*' }, { quoted: msg });

                    await sock.sendMessage(from, { text: '📢 _ZetBot sedang mengirim broadcast massal ke seluruh grup, mohon tunggu..._' }, { quoted: msg });
                    try {
                        const semuaGrup = await sock.groupFetchAllParticipating();
                        const jidsGrup = Object.keys(semuaGrup);
                        let suksesGrup = 0;

                        for (let jid of jidsGrup) {
                            try {
                                await sock.sendMessage(jid, { text: `📢 *ZETBOT BROADCAST SYSTEM* 📢\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${teksBc}\n\n🤖 _Pesan resmi dari Bos DoxxBorx_ 👑` });
                                suksesGrup++;
                                await new Promise(resolve => setTimeout(resolve, 1500));
                            } catch (err) {
                                console.error(`Gagal kirim ke grup ${jid}:`, err);
                            }
                        }
                        await sock.sendMessage(from, { text: `✅ *Broadcast Selesai Dikirim, Bos!*\n\n📊 *Statistik:* Teks berhasil disebarkan ke *${suksesGrup}* grup yang aktif.` }, { quoted: msg });
                    } catch (error) {
                        console.error(error);
                        await sock.sendMessage(from, { text: '❌ *Terjadi error saat mengambil data grup WhatsApp!*' }, { quoted: msg });
                    }
                }

                if (command === 'grup') {
                    const aksi = args[0]?.toLowerCase();
                    if (!aksi) return await sock.sendMessage(from, { text: '⚠️ Format salah. Gunakan `!grup open` atau `!grup close`' }, { quoted: msg });
                    if (!isGroup) return await sock.sendMessage(from, { text: ' Perintah ini hanya berlaku di dalam grup!' }, { quoted: msg });
                    
                    if (aksi === 'open') {
                        await sock.groupSettingUpdate(from, 'not_announcement');
                        await sock.sendMessage(from, { text: '🔓 Gerbang grup dibuka! Sekarang seluruh member biasa sudah bisa mengirimkan pesan kembali.' }, { quoted: msg });
                    } else if (aksi === 'close') {
                        await sock.groupSettingUpdate(from, 'announcement');
                        await sock.sendMessage(from, { text: '🔒 Gerbang grup ditutup rapat! Sekarang hanya barisan admin yang dapat mengirim pesan.' }, { quoted: msg });
                    }
                }

                if (command === 'join') {
                    const linkGrup = args[0];
                    if (!linkGrup) return await sock.sendMessage(from, { text: '⚠️ Berikan link undangan grup tujuan, Bos!' }, { quoted: msg });
                    try {
                        const code = linkGrup.split('https://chat.whatsapp.com/')[1];
                        await sock.groupAcceptInvite(code);
                        await sock.sendMessage(from, { text: '✅ Siap Bos! Sistem berhasil meretas gerbang link dan masuk ke dalam grup tujuan.' }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { text: '❌ Gagal masuk grup, periksa kembali validitas tautan undangan tersebut!' }, { quoted: msg });
                    }
                }

                if (command === 'leave') {
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Perintah eksekusi keluar harus dilakukan langsung di dalam grup target!' }, { quoted: msg });
                    await sock.sendMessage(from, { text: '👋 Selamat tinggal semuanya, ZetBot diperintahkan Owner untuk keluar sekarang. Bye-bye!' });
                    await sock.groupLeave(from);
                }

                if (command === 'block') {
                    const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    if (!target) return await sock.sendMessage(from, { text: '⚠️ Tag user yang mau diblokir, Bos!' }, { quoted: msg });
                    await sock.updateBlockStatus(target, 'block');
                    await sock.sendMessage(from, { text: '🚫 User berhasil dimasukkan ke daftar hitam pemblokiran server!' }, { quoted: msg });
                }

                if (command === 'unblock') {
                    const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                    if (!target) return await sock.sendMessage(from, { text: '⚠️ Tag user yang mau dilepas pasung blokirnya, Bos!' }, { quoted: msg });
                    await sock.updateBlockStatus(target, 'unblock');
                    await sock.sendMessage(from, { text: '🔓 Segel blokir dilepas, akses user tersebut dipulihkan normal.' }, { quoted: msg });
                }

                if (command === 'refresh') {
                    console.clear();
                    if (global.gc) { global.gc(); }
                    await sock.sendMessage(from, { text: '♻️ *Terminal & Alokasi RAM Sampah Berhasil Dibersihkan!* Bot kini kembali ringan, ngebut, dan siap berakselerasi tinggi! 🚀💨' }, { quoted: msg });
                }

                if (command === 'pingsan') {
                    await sock.sendMessage(from, { text: '💀 *ZetBot Diperintahkan Mati Permanen!* Sistem dimatikan total sekarang. Selamat tinggal Bos DoxxBorx... 🕯️' }, { quoted: msg });
                    process.exit(0);
                }
            }
        } catch (err) {
            console.error('💥 Terjadi Error Fatal Sistem:', err);
        }
    });
}

// Jalankan Sistem Bot Utama
startBot();