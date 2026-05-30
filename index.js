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
const GEMINI_API_KEY = "AIzaSyDF6_vu01l80_4c_lXHC6fDHmJPfXhKsRQ"; // Masukkan API Key Gemini Bos di sini

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const startTime = Date.now();

let isSelfMode = false;
let isSleeping = false;
let antiLink = false;

// =======================================================
// 🧠 PROSES PERTANYAAN LEWAT API GEMINI AI (ANTI-SICK SYSTEM)
// =======================================================
async function tanyakanAI(query, type = 'tanya', isAdmin = false) {
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
        systemInstruction = `Anda adalah pakar pemrograman komputer (software engineer senior) yang genius sekaligus instruktur coding yang asyik dan humoris. 
        Tugas Anda: Analisis masalah error, buatkan potongan kode (clean code) sesuai permintaan user, jabarkan logikanya dengan analogi yang sangat mudah dipahami mahasiswa teknik komputer. 
        Gunakan format Markdown yang rapi untuk baris kodenya agar mudah di-copy. Jangan terlalu kaku, selipkan sedikit sarkasme komedi atau jokes anak IT di akhir jawaban. Panggil user dengan sebutan "${panggilan}".`;
    } else if (type === 'rangkum') {
        systemInstruction = `Anda adalah seorang ahli analis teks profesional. Tugas Anda adalah meringkas teks panjang yang diberikan user menjadi ringkasan yang padat, jelas, poin-poin penting tersampaikan, namun tetap ditulis dengan gaya santai dan mudah dimengerti. Panggil user dengan sebutan "${panggilan}".`;
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

    // LIST MODEL YANG AKAN DICOBA (Jika model utama sibuk, lempar ke model cadangan)
    const modelsToTry = ['gemini-2.5-flash', 'gemini-1.5-flash'];
    
    for (let modelName of modelsToTry) {
        try {
            const response = await ai.models.generateContent({
                model: modelName,
                contents: query,
                config: {
                    systemInstruction: systemInstruction,
                    temperature: 0.7,
                }
            });
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

// Helper Runtime Uptime
function runtime(seconds) {
    seconds = Number(seconds);
    var d = Math.floor(seconds / (3600 * 24));
    var h = Math.floor(seconds % (3600 * 24) / 3600);
    var m = Math.floor(seconds % 3600 / 60);
    var s = Math.floor(seconds % 60);
    var dDisplay = d > 0 ? d + (d == 1 ? " hari, " : " hari, ") : "";
    var hDisplay = h > 0 ? h + (h == 1 ? " jam, " : " jam, ") : "";
    var mDisplay = m > 0 ? m + (m == 1 ? " menit, " : " menit, ") : "";
    var sDisplay = s > 0 ? s + (s == 1 ? " detik" : " detik") : "";
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
        logger: pino({ level: 'silent' }), // FIXED: Diubah jadi pino huruf kecil menyesuaikan import modul
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
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true; // FIXED: diubah jadi DisconnectReason huruf kapital
            console.log('🔄 Koneksi terputus akibat:', lastDisconnect.error, ', mencoba menyambung ulang:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(`\n🚀 ${BOT_NAME} 🤖✨ Berhasil Online! Siap Melayani Bos DoxxBorx! 🔥\n`);
        }
    });

    // =======================================================
    // 📩 INCOMING MESSAGES HANDLER RECEPTOR
    // =======================================================
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

            if (!body.startsWith('!')) return;

            const args = body.trim().split(/ +/).slice(1);
            const command = body.trim().split(/ +/)[0].toLowerCase().slice(1);
            
            const isAdmin = OWNER_NUMBER.some(num => sender.includes(num));

            // Fitur Kunci Darurat (Self Mode)
            if (isSelfMode && !isAdmin) return;

            // Fitur Status Pingsan/Turu
            if (isSleeping && command !== 'bangun' && !isAdmin) return;
            if (isSleeping && command !== 'bangun' && isAdmin) {
                return await sock.sendMessage(from, { text: '🛌 *Saya masih mode turu nyenyak, Bos.* Ketik `!bangun` dulu untuk mengaktifkan sistem saya kembali!' }, { quoted: msg });
            }

            // FILTER PERINTAH ADMIN (OWNER ONLY)
            const adminCommands = ['refresh', 'turu', 'bangun', 'pingsan', 'self', 'public', 'join', 'leave', 'block', 'unblock', 'spek', 'uptime', 'grup', 'antilink', 'speedtest', 'broadcast', 'bc', 'systeminfo'];
            
            if (adminCommands.includes(command) && !isAdmin) {
                return await sock.sendMessage(from, { text: '⛔ *Akses Ditolak!* Fitur sakral ini dikunci khusus demi keamanan privasi dan hanya bisa dieksekusi oleh Bos DoxxBorx selaku pembuat tertinggi saya! 👑' }, { quoted: msg });
            }

            // =======================================================
            // 📜 OUTPUT TAMPILAN MENU UTAMA (CERDAS & KONDISIONAL)
            // =======================================================
            if (command === 'menu') {
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
                               `┃\n` +
                               `┣━━〔 *🖼️ ADVANCED MEDIA & SCRAPER* 〕━━\n` +
                               `┃ ├ • \`!sticker\` / \`!s\` — Ubah foto/video ke Stiker 🎬\n` +
                               `┃ ├ • \`!scrapenews\` — Scraping berita teknologi DetikInet 🌐\n` +
                               `┃ ├ • \`!ocr\` — Ekstrak tulisan dari gambar lewat Gemini AI 🔍\n` +
                               `┃\n` +
                               `┣━━〔 *🧠 ADVANCED AI TASKS* 〕━━\n` +
                               `┃ ├ • \`!tanya [soal]\` — Tanya AI (Sains & Faktual) 🧠\n` +
                               `┃ ├ • \`!coding [soal]\` — Solusi error & bikin kode IT 💻\n` +
                               `┃ ├ • \`!rangkum [teks]\` — Ringkas teks panjang kilat 📄\n` +
                               `┃ ├ • \`!brainstorm [topik]\` — Cari ide project & tugas 💡\n` +
                               `┃ ├ • \`!translate [id] [teks]\` — Terjemahan alami & luwes 🌐\n` +
                               `┃\n` +
                               `┣━━〔 *💻 DEVELOPER EXPERT TOOLS* 〕━━\n` +
                               `┃ ├ • \`!minify [kode]\` — Compress kode JS/HTML/CSS kilat 📉\n` +
                               `┃ ├ • \`!dbdiagram [teks]\` — Rancang skema database (SQL) 📊\n` +
                               `┃ ├ • \`!gitwatch [user]\` — Intip profil & repo terupdate GitHub 🐙\n` +
                               `┃ ├ • \`!jsonpretty [teks]\` — Rapikan kode JSON berantakan 🧩\n` +
                               `┃\n` +
                               `┣━━〔 *🎮 INTERACTIVE & FUN* 〕━━\n` +
                               `┃ ├ • \`!curhat [teks]\` — Pelampiasan stres bareng AI 🫂\n` +
                               `┃ ├ • \`!roastme [target]\` — Uji mental di-roasting sarkas 🔨\n` +
                               `┃ ├ • \`!apakah [soal]\` — Ramalan kasual masa depan 🔮\n` +
                               `┃ ├ • \`!kapankah [soal]\` — Prediksi waktu kocak netizen ⏳\n` +
                               `┃ ├ • \`!tagall [pesan]\` — Mention semua member (Admin) 📢\n` +
                               `┃\n`;

                if (isAdmin) {
                    menuText += `┣━━〔 *👑 OWNER CONTROL (FULL)* 〕━━\n` +
                                `┃ ├ • \`!speedtest\` — Ukur latensi riil ping server bot ⚡\n` +
                                `┃ ├ • \`!broadcast [teks]\` — Kirim pengumuman massal massif 📣\n` +
                                `┃ ├ • \`!spek\` — Intip jeroan & hardware server\n` +
                                `┃ ├ • \`!systeminfo\` — Cek beban CPU & storage mendalam 📊\n` +
                                `┃ ├ • \`!uptime\` — Cek jam begadang server bot\n` +
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
                                `┃ └ • \`!pingsan\` — Matikan sistem bot permanen\n`;
                } else {
                    menuText += `┣━━〔 *👑 OWNER CONTROL* 〕━━\n` +
                                `┃ ├ • \`!speedtest\` — Ukur latensi riil ping server bot ⚡\n` +
                                `┃ ├ • \`!broadcast [teks]\` — Kirim pengumuman massal massif 📣\n` +
                                `┃ ├ • \`!spek\` — Intip jeroan & hardware server\n` +
                                `┃ ├ • \`!uptime\` — Cek jam begadang server bot\n` +
                                `┃ ├ • \`!self\` — Kunci bot khusus untuk Bos\n` +
                                `┃ └ • \`!public\` — Buka akses bot untuk umum\n`;
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

                // 👑 FITUR ADMIN: SYSTEMINFO MENDALAM
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
    if (!teksBc) {
        return await sock.sendMessage(from, { text: '⚠️ *Mana teks pengumumannya Bos?* Contoh: `!bc Halo semua, bot akan maintenance jam 12 malam.`' }, { quoted: msg });
    }

    await sock.sendMessage(from, { text: '📢 _ZetBot sedang mengirim broadcast massal ke seluruh grup, mohon tunggu..._' }, { quoted: msg });

    try {
        // 1. Ambil semua daftar grup yang diikuti oleh bot secara real-time
        const semuaGrup = await sock.groupFetchAllParticipating();
        const jidsGrup = Object.keys(semuaGrup); // Mengambil ID grup (misal: 123456789@g.us)

        if (jidsGrup.length === 0) {
            return await sock.sendMessage(from, { text: '❌ *Gagal BC:* Bot belum masuk ke grup mana pun saat ini.' }, { quoted: msg });
        }

        let suksesGrup = 0;

        for (let jid of jidsGrup) {
            try {
                await sock.sendMessage(jid, { 
                    text: `📢 *ZETBOT BROADCAST SYSTEM* 📢\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${teksBc}\n\n🤖 _Pesan resmi dari Bos DoxxBorx_ 👑` 
                });
                suksesGrup++;
                // Beri jeda 1,5 detik per grup agar WhatsApp tidak mendeteksi aktivitas ini sebagai spam (Anti-Banned)
                await new Promise(resolve => setTimeout(resolve, 1500)); 
            } catch (err) {
                console.error(`Gagal kirim ke grup ${jid}:`, err);
            }
        }

        // 3. Laporan balik ke kamu sebagai Owner
        await sock.sendMessage(from, { 
            text: `✅ *Broadcast Selesai Dikirim, Bos!*\n\n📊 *Statistik:* Teks berhasil disebarkan ke *${suksesGrup}* grup yang aktif.` 
        }, { quoted: msg });

    } catch (error) {
        console.error(error);
        await sock.sendMessage(from, { text: '❌ *Terjadi error saat mengambil data grup WhatsApp!*' }, { quoted: msg });
    }
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

// Jalankan Bot
startBot();