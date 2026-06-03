import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import chalk from 'chalk';
import fs from 'fs';
import axios from 'axios';
import { createCanvas, loadImage } from 'canvas';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Inisialisasi variabel global
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ownerNumber = '6282384961407'; // Nomor owner
const ownerName = 'DoxxBorx'; // Nama owner
const botVersion = '3.0.0'; // Versi bot
const startTime = Date.now();

// Setup OpenAI SDK
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Fungsi utama start bot
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['LuxxBot', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  // Handle QR code dan koneksi
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('QR Code:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const shouldReconnect = !(lastDisconnect.error instanceof Boom && lastDisconnect.error.output.statusCode === DisconnectReason.loggedOut);
      console.log('Koneksi terputus, mencoba reconnect:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(start, 3000);
      }
    } else if (connection === 'open') {
      console.log(chalk.green('Bot terkoneksi!'));
      // Kirim pesan ke owner bahwa bot sudah aktif
      try {
        await sock.sendMessage(`${ownerNumber}@s.whatsapp.net`, {
          text: `🤖 Bot sudah aktif!\nVersi: ${botVersion}\nTime: ${new Date().toLocaleString('id-ID')}`,
        });
      } catch (e) {
        console.log('Gagal kirim pesan ke owner:', e.message);
      }
    }
  });

  // Handle pesan masuk
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const sender = msg.key.participant || from;
    const messageContent = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const body = messageContent.trim();

    // Cek command prefix
    if (!body.startsWith('!')) return;
    const args = body.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Fungsi bantu
    const isGroup = from.endsWith('@g.us');
    const isOwner = ownerNumber + '@s.whatsapp.net' === sender;

    // Cek admin group jika perlu
    let isGroupAdmin = false;
    if (isGroup) {
      try {
        const groupMetadata = await sock.groupMetadata(from);
        const participant = groupMetadata.participants.find(p => p.id === sender);
        isGroupAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin' || isOwner;
      } catch (e) {
        console.log('Gagal ambil metadata grup:', e.message);
      }
    }

    // Command: menu
    if (command === 'menu' || command === 'help') {
      await sendMenu(sock, from, msg, isGroup, isGroupAdmin, sender);
      return;
    }

    // --- Contoh command: ping ---
    if (command === 'ping') {
      await sock.sendMessage(from, { text: '🏓 Pong!' }, { quoted: msg });
      return;
    }

    // --- Command lain sesuai menu dan fitur yang sudah disusun ---
    // Contoh: !dalle, !play, !json, !minify, !sticker, dll.
    // Pastikan setiap command dihandle di sini agar semua berfungsi.

    // =======================
    // Contoh Command AI: !dalle
    if (command === 'dalle') {
      const prompt = args.join(' ');
      if (!prompt) {
        return await sock.sendMessage(from, { text: '❌ Format: !dalle [deskripsi]\nContoh: !dalle sunset di pantai' }, { quoted: msg });
      }

      await sock.sendMessage(from, { text: '🎨 Membuat gambar...' }, { quoted: msg });
      try {
        const response = await openai.images.generate({
          model: 'dall-e-2',
          prompt: prompt,
          n: 1,
          size: '512x512',
        });
        const imageUrl = response.data[0].url;
        const res = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data, 'binary');
        await sock.sendMessage(from, {
          image: buffer,
          caption: `🎨 *DALL-E*\nPrompt: ${prompt}`,
        }, { quoted: msg });
      } catch (e) {
        // fallback dengan pollinations.ai
        try {
          const seed = Math.floor(Math.random() * 999999);
          const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=1024&height=1024&nologo=true`;
          const res = await axios.get(fallbackUrl, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(res.data, 'binary');
          await sock.sendMessage(from, {
            image: buffer,
            caption: `✨ Gambar alternatif dari Pollinations AI\nPrompt: ${prompt}`,
          }, { quoted: msg });
        } catch (err) {
          await sock.sendMessage(from, { text: '❌ Gagal membuat gambar!' }, { quoted: msg });
        }
      }
      return;
    }

    // =======================
    // Contoh command: !play
    if (command === 'play' || command === 'musik') {
      const query = args.join(' ');
      if (!query) {
        return await sock.sendMessage(from, { text: '❌ Format: !play [judul lagu]' }, { quoted: msg });
      }
      await sock.sendMessage(from, { text: '🎵 Mencari lagu...' }, { quoted: msg });
      try {
        const res = await ytsSearch(query);
        if (res.videos.length === 0) {
          return await sock.sendMessage(from, { text: '❌ Lagu tidak ditemukan!' }, { quoted: msg });
        }
        const video = res.videos[0];

        const stream = ytdl(video.url, { filter: 'audioonly', quality: 'highestaudio' });
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', async () => {
          const buffer = Buffer.concat(chunks);
          await sock.sendMessage(from, {
            audio: buffer,
            mimetype: 'audio/mp4',
            filename: `${video.title}.mp3`,
            caption: `🎵 *Sekarang diputar:*\n${video.title}\n${video.author.name}`,
            mentions: [sender],
          }, { quoted: msg });
        });
      } catch (e) {
        console.log('Error play:', e.message);
        await sock.sendMessage(from, { text: '❌ Gagal memutar lagu!' }, { quoted: msg });
      }
      return;
    }

    // =======================
    // Command: !json
    if (command === 'json' || command === 'jsonpretty') {
      const jsonStr = args.join(' ');
      if (!jsonStr) {
        return await sock.sendMessage(from, { text: '❌ Format: !json [json string]' }, { quoted: msg });
      }
      try {
        const jsonObj = JSON.parse(jsonStr);
        const formatted = JSON.stringify(jsonObj, null, 2);
        await sock.sendMessage(from, { text: `📊 *JSON*\n\`\`\`json\n${formatted}\n\`\`\`` }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ JSON tidak valid!' }, { quoted: msg });
      }
      return;
    }

    // =======================
    // Command: !minify
    if (command === 'minify' || command === 'minifyjs') {
      const code = body.substring(body.indexOf(' ') + 1);
      if (!code || code.length < 10) {
        return await sock.sendMessage(from, { text: '❌ Format: !minify [kode JS]' }, { quoted: msg });
      }
      try {
        const result = await minify(code);
        if (result.error) throw result.error;
        await sock.sendMessage(from, { text: `📉 *Minify*\n${result.code.substring(0, 2000)}` }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ Gagal minify kode!' }, { quoted: msg });
      }
      return;
    }

    // =======================
    // Command: !qr
    if (command === 'qr' || command === 'qrcode') {
      const textQ = args.join(' ');
      if (!textQ) {
        return await sock.sendMessage(from, { text: '❌ Format: !qr [teks/url]' }, { quoted: msg });
      }
      try {
        const qrImage = await QRCode.toDataURL(textQ, { width: 400 });
        const base64Data = qrImage.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        await sock.sendMessage(from, {
          image: buffer,
          caption: `🔳 *QR Code*\nContent: ${textQ}`
        }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ Gagal membuat QR code!' }, { quoted: msg });
      }
      return;
    }

    // =======================
    // Command: !stalk (GitHub)
    if (command === 'stalk' || command === 'github') {
      const username = args[0];
      if (!username) {
        return await sock.sendMessage(from, { text: '❌ Format: !stalk [username github]' }, { quoted: msg });
      }
      try {
        const res = await axios.get(`https://api.github.com/users/${username}`);
        const data = res.data;
        const caption = `🐙 *GitHub*\n\n👤 *User:* ${data.login}\n📝 *Name:* ${data.name || '-'}\n📌 *Bio:* ${data.bio || '-'}\n📍 *Location:* ${data.location || '-'}\n🏢 *Company:* ${data.company || '-'}\n📧 *Email:* ${data.email || 'Private'}\n🔗 *Profile:* ${data.html_url}`;
        await sock.sendMessage(from, {
          image: { url: data.avatar_url },
          caption,
        });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ User GitHub tidak ditemukan!' }, { quoted: msg });
      }
      return;
    }

    // =======================
    // Command: !summarize
    if (command === 'summarize' || command === 'ringkas') {
      const url = args[0];
      if (!url) {
        return await sock.sendMessage(from, { text: '❌ Format: !summarize [url]' }, { quoted: msg });
      }
      await sock.sendMessage(from, { text: '⏳ Meringkas artikel...' }, { quoted: msg });
      try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        $('script, style, nav, footer, header').remove();
        const text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 2000);
        if (text.length < 50) {
          return await sock.sendMessage(from, { text: '❌ Tidak bisa meringkas halaman ini!' }, { quoted: msg });
        }
        const summary = await tanyakanAI(`Ringkas artikel ini dalam 3-5 poin:\n\n${text}`);
        await sock.sendMessage(from, { text: `📰 *Ringkasan*\n${summary}` }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ Gagal meringkas!' }, { quoted: msg });
      }
      return;
    }

    // =======================
    // Command: !ceklink
    if (command === 'ceklink' || command === 'scanlink') {
      const url = args[0];
      if (!url) {
        return await sock.sendMessage(from, { text: '❌ Format: !ceklink [url]' }, { quoted: msg });
      }
      try {
        // Cek keamanan link dengan Google Safe Browsing API
        const safeBrowsingKey = process.env.GOOGLE_SAFE_BROWSING_KEY;
        let safeResult = '⚠️ Tidak bisa diverifikasi (API key tidak tersedia)';
        if (safeBrowsingKey) {
          const res = await axios.post(
            `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${safeBrowsingKey}`,
            {
              client: { clientId: 'luxxbot', clientVersion: '1.0.0' },
              threatInfo: {
                threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'],
                platformTypes: ['ANY_PLATFORM'],
                threatEntryTypes: ['URL'],
                threatEntries: [{ url }]
              }
            }
          );
          safeResult = res.data.matches ? `❌ *DANGEROUS* - ${res.data.matches[0].threatType}` : '✅ *SAFE* - Tidak terdeteksi ancaman';
        }
        // Analisis URL
        const urlObj = new URL(url);
        const isHTTPS = url.startsWith('https://');
        const suspiciousChars = url.includes('..') || url.includes('--') || url.includes('@') || url.length > 100;

        let analysis = `🔍 *Analisis Link*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        analysis += `🔗 *URL:* ${url}\n`;
        analysis += `🛡️ *Safe Browsing:* ${safeResult}\n`;
        analysis += `🔐 *HTTPS:* ${isHTTPS ? '✅ Aman' : '⚠️ HTTP (kurang aman)'}\n`;
        analysis += `📊 *Panjang:* ${url.length} karakter\n`;
        analysis += `🚩 *Karakter mencurigakan:* ${suspiciousChars ? '⚠️ Ya' : '✅ Tidak'}\n`;
        analysis += `🌐 *Domain:* ${urlObj.hostname}\n`;
        analysis += `📍 *Path:* ${urlObj.pathname}\n`;
        if (suspiciousChars || !isHTTPS) {
          analysis += `⚠️ *Peringatan:* Link ini mencurigakan!\n`;
        } else {
          analysis += `✅ *Aman:* Link ini tampaknya aman.\n`;
        }
        await sock.sendMessage(from, { text: analysis }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ Gagal analisis link!' }, { quoted: msg });
      }
      return;
    }

    // =======================
    // Command: !password
    if (command === 'password' || command === 'pwgen') {
      const length = parseInt(args[0]) || 12;
      if (length < 6 || length > 32) {
        return await sock.sendMessage(from, { text: '❌ Panjang password harus 6-32 karakter' }, { quoted: msg });
      }
      const password = generatePassword(length);
      await sock.sendMessage(from, { text: `🔑 *Password*\n\n${password}` }, { quoted: msg });
      return;
    }

    // =======================
    // Command: !tebakangka
    if (command === 'tebakangka' || command === 'guess') {
      const max = parseInt(args[0]) || 100;
      const secretNumber = Math.floor(Math.random() * max) + 1;
      const gameId = `${from}_${Date.now()}`;
      games[gameId] = {
        type: 'guess',
        secret: secretNumber,
        max: max,
        attempts: 0,
        maxAttempts: 7,
        player: sender
      };
      await sock.sendMessage(from, { text: `🎯 Tebak angka dari 1 sampai ${max}\nKamu punya 7 kesempatan!\nKirim !jawab [angka]` });
      setTimeout(() => { delete games[gameId]; }, 300000); // 5 menit
      return;
    }

    // =======================
    // Command: !tebakkata
    if (command === 'tebakkata' || command === 'wordgame') {
      const words = [
        { word: 'KOMPUTER', hint: 'Alat untuk browsing dan coding' },
        { word: 'SMARTPHONE', hint: 'Gadget yang selalu dibawa kemana-mana' },
        { word: 'INTERNET', hint: 'Jaringan global yang menghubungkan dunia' },
        { word: 'PROGRAMMER', hint: 'Orang yang membuat software' },
        { word: 'WHATSAPP', hint: 'Aplikasi chat yang sedang kita gunakan' },
      ];
      const selected = words[Math.floor(Math.random() * words.length)];
      const scrambled = selected.word.split('').sort(() => Math.random() - 0.5).join('');
      await sock.sendMessage(from, { text: `🧩 Tebak kata!\n\nKata: ${scrambled}\nHint: ${selected.hint}\nKirim !jawab [kata]` });
      const gameId = `${from}_${Date.now()}`;
      games[gameId] = {
        type: 'word',
        answer: selected.word.toLowerCase(),
        scrambled,
        hint: selected.hint,
        player: sender,
      };
      setTimeout(() => { delete games[gameId]; }, 180000); // 3 menit
      return;
    }

    // =======================
    // Command: !lirik
    if (command === 'lirik' || command === 'lyrics') {
      const query = args.join(' ');
      if (!query) {
        return await sock.sendMessage(from, { text: '❌ Format: !lirik [judul lagu]' }, { quoted: msg });
      }
      try {
        const res = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(query)}`);
        const lyrics = res.data.lyrics;
        if (!lyrics) {
          return await sock.sendMessage(from, { text: '❌ Lirik tidak ditemukan!' }, { quoted: msg });
        }
        // Split panjang
        if (lyrics.length > 3000) {
          const part1 = lyrics.substring(0, 3000);
          const part2 = lyrics.substring(3000);
          await sock.sendMessage(from, { text: `🎵 *LIRIK*\n${part1}` }, { quoted: msg });
          await sock.sendMessage(from, { text: `...Lanjutan:\n${part2}` }, { quoted: msg });
        } else {
          await sock.sendMessage(from, { text: `🎵 *LIRIK*\n${lyrics}` }, { quoted: msg });
        }
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ Gagal mencari lirik!' }, { quoted: msg });
      }
      return;
    }

    // =======================
    // Command: !translate
    if (command === 'translate' || command === 'terjemah') {
      const langCode = args[0]?.toLowerCase();
      const textToTranslate = args.slice(1).join(' ');
      const langMap = {
        en: 'English',
        id: 'Indonesia',
        ja: 'Japanese',
        ko: 'Korean',
        es: 'Spanish',
        fr: 'French',
        de: 'German',
      };
      if (!langCode || !textToTranslate || !langMap[langCode]) {
        return await sock.sendMessage(from, { text: '❌ Format: !translate [lang] [teks]\nContoh: !translate en halo' }, { quoted: msg });
      }
      try {
        const translation = await tanyakanAI(`Terjemahkan ke ${langMap[langCode]}:\n\n${textToTranslate}`);
        await sock.sendMessage(from, { text: `🌐 *Hasil*\n${translation}` }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ Gagal menerjemahkan!' }, { quoted: msg });
      }
      return;
    }

    // =======================
    // Command: !warna
    if (command === 'warna' || command === 'color') {
      const inputColor = args[0];
      if (!inputColor) {
        // generate warna acak
        const randHex = Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        const hexColor = `#${randHex}`;
        const r = parseInt(randHex.substring(0, 2), 16);
        const g = parseInt(randHex.substring(2, 4), 16);
        const b = parseInt(randHex.substring(4, 6), 16);
        await sock.sendMessage(from, { text: `🎨 *Warna acak*\nHex: ${hexColor}\nRGB: rgb(${r}, ${g}, ${b})` }, { quoted: msg });
        return;
      }
      try {
        let hex, r, g, b, rgb;
        if (inputColor.startsWith('#')) {
          hex = inputColor;
          const cleanHex = inputColor.replace('#', '');
          if (cleanHex.length === 3) {
            hex = '#' + cleanHex.split('').map(c => c + c).join('');
          }
          r = parseInt(hex.substring(1, 3), 16);
          g = parseInt(hex.substring(3, 5), 16);
          b = parseInt(hex.substring(5, 7), 16);
          rgb = `rgb(${r}, ${g}, ${b})`;
        } else if (inputColor.startsWith('rgb')) {
          const matches = inputColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (!matches) throw new Error('Format RGB salah');
          r = parseInt(matches[1]);
          g = parseInt(matches[2]);
          b = parseInt(matches[3]);
          hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        } else {
          // nama warna
          const colorNames = {
            merah: '#FF0000',
            hijau: '#00FF00',
            biru: '#0000FF',
            kuning: '#FFFF00',
            ungu: '#800080',
            pink: '#FFC0CB',
            hitam: '#000000',
            putih: '#FFFFFF',
            orange: '#FFA500',
            coklat: '#A52A2A',
            abu: '#808080'
          };
          const cHex = colorNames[inputColor.toLowerCase()];
          if (!cHex) throw new Error('Nama warna tidak dikenal');
          hex = cHex;
          const cleanHex = cHex.replace('#', '');
          r = parseInt(cleanHex.substring(0, 2), 16);
          g = parseInt(cleanHex.substring(2, 4), 16);
          b = parseInt(cleanHex.substring(4, 6), 16);
          rgb = `rgb(${r}, ${g}, ${b})`;
        }
        await sock.sendMessage(from, { text: `🎨 *Warna*\nHex: ${hex}\nRGB: ${rgb}` }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ Format warna tidak valid!' }, { quoted: msg });
      }
      return;
    }

    // =======================
    // Command: !tanggal
    if (command === 'tanggal' || command === 'date') {
      const now = new Date();
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const dateStr = now.toLocaleDateString('id-ID', options);
      const timeStr = now.toLocaleTimeString('id-ID', { hour12: false });
      await sock.sendMessage(from, { text: `📅 ${dateStr}\n⏰ ${timeStr}` }, { quoted: msg });
      return;
    }

    // =======================
    // Command: !jadwalsholat
    if (command === 'jadwalsholat' || command === 'sholat') {
      const city = args.join(' ') || 'jakarta';
      await sock.sendMessage(from, { text: '🕌 Mengambil jadwal sholat...' }, { quoted: msg });
      try {
        const response = await axios.get(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Indonesia&method=2`);
        const data = response.data.data;
        const timings = data.timings;
        const date = data.date.readable;
        await sock.sendMessage(from, {
          text: `🕌 *Jadwal Sholat*\n\n📅 ${date}\n\nFajr: ${timings.Fajr}\nDhuhr: ${timings.Dhuhr}\nAsr: ${timings.Asr}\nMaghrib: ${timings.Maghrib}\nIsha: ${timings.Isha}`
        });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ Gagal mendapatkan jadwal sholat' });
      }
      return;
    }

    // =======================
    // Command: !hitung
    if (command === 'hitung' || command === 'count') {
      const textCount = body.substring(body.indexOf(' ') + 1);
      if (!textCount) {
        return await sock.sendMessage(from, { text: '❌ Format: !hitung [teks]' }, { quoted: msg });
      }
      const charCount = textCount.length;
      const wordCount = textCount.trim().split(/\s+/).length;
      const lineCount = textCount.split('\n').length;
      const spaceCount = (textCount.match(/ /g) || []).length;
      // Hitung huruf terbanyak
      const freq = {};
      for (const c of textCount.toLowerCase()) {
        if (/[a-z]/.test(c)) freq[c] = (freq[c] || 0) + 1;
      }
      const mostFreq = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      const mostChar = mostFreq ? `${mostFreq[0]}: ${mostFreq[1]}` : '-';

      const analysis = `📊 *Analisis Teks*\n\n`;
      analysis += `📝 *Teks:* ${textCount.substring(0,50)}\n`;
      analysis += `🔢 *Karakter:* ${charCount}\n`;
      analysis += `📝 *Kata:* ${wordCount}\n`;
      analysis += `📄 *Baris:* ${lineCount}\n`;
      analysis += `🕳️ *Spasi:* ${spaceCount}\n`;
      analysis += `🔥 *Huruf terbanyak:* ${mostChar}\n`;

      await sock.sendMessage(from, { text: analysis }, { quoted: msg });
      return;
    }

    // =======================
    // Command: !menu
    if (command === 'menu' || command === 'help') {
      await sendMenu(sock, from, msg, isGroup, isGroupAdmin, sender);
      return;
    }

    // =======================
    // Handle game commands, AI commands, dan lainnya
    // Pastikan semua command yang ada di menu dan fitur sudah di-handle di sini agar berfungsi penuh
    // Contoh: !dalle, !play, !json, !minify, !sticker, !simi, dll.
    // Jika belum ada, tambahkan sesuai fitur yang sudah dibuat.
  });
}

// Fungsi pengiriman menu lengkap
async function sendMenu(sock, from, msg, isGroup, isAdmin, sender) {
  const uptime = formatUptime((Date.now() - startTime) / 1000);
  let menuText = `╔══════════════════════════════════════════════════════════╗\n`;
  menuText += `║                 🌸 *LuxxBot PREMIUM MENU* 🌸                ║\n`;
  menuText += `╠══════════════════════════════════════════════════════════╣\n`;
  menuText += `║ 📊 SYSTEM STATUS\n`;
  menuText += `║ ├─ 🛠️ Mode: ${isSelfMode ? '🔒 Self' : '🔓 Public'}\n`;
  menuText += `║ ├─ 💤 Status: ${isSleeping ? '🛌 Tertidur' : '⚡ Online'}\n`;
  menuText += `║ ├─ 🛡️ Anti-Link: ${antiLink ? '🟢 Aktif' : '🔴 Nonaktif'}\n`;
  menuText += `║ ├─ ⏳ Runtime: ${uptime}\n`;
  menuText += `║ └─ 📡 Server: 🟢 Stabil\n`;
  menuText += `╠══════════════════════════════════════════════════════════╣\n`;

  // General commands
  menuText += `║ 🎮 *General Commands*\n`;
  menuText += `║ ├─ !halo - Sapaan ramah\n`;
  menuText += `║ ├─ !ping - Cek respon\n`;
  menuText += `║ ├─ !menu - Tampilkan menu\n`;
  menuText += `║ ├─ !changelogs - Update terbaru\n`;
  menuText += `║ ├─ !notes - Catatan pribadi\n`;
  menuText += `║ ├─ !remindme - Pengingat\n`;
  menuText += `║ ├─ !add - Tambah member\n`;
  menuText += `║ ├─ !tagall - Mention semua\n`;
  menuText += `╠══════════════════════════════════════════════════════════╣\n`;

  // AI & Chat
  menuText += `║ 🧠 *AI & Chat*\n`;
  menuText += `║ ├─ !tanya - Tanya AI\n`;
  menuText += `║ ├─ !ai - Chat AI\n`;
  menuText += `║ ├─ !dalle - Generate gambar\n`;
  menuText += `║ ├─ !translate - Terjemah\n`;
  menuText += `║ ├─ !ringkas - Ringkas artikel\n`;
  menuText += `║ ├─ !gpt - ChatGPT\n`;
  menuText += `║ ├─ !stablediff - Diffusion\n`;
  menuText += `║ ├─ !resetai - Reset memory AI\n`;
  menuText += `╠══════════════════════════════════════════════════════════╣\n`;

  // Media & download
  menuText += `║ 🎬 *Media & Download*\n`;
  menuText += `║ ├─ !ytmp3 - Download MP3\n`;
  menuText += `║ ├─ !ytmp4 - Download MP4\n`;
  menuText += `║ ├─ !tiktok - TikTok downloader\n`;
  menuText += `║ ├─ !ig - Instagram download\n`;
  menuText += `║ ├─ !fb - Facebook download\n`;
  menuText += `║ ├─ !twitter - Twitter download\n`;
  menuText += `║ ├─ !spotify - Spotify download\n`;
  menuText += `║ ├─ !jsonpretty - Format JSON\n`;
  menuText += `║ ├─ !minify - Minify JS\n`;
  menuText += `╠══════════════════════════════════════════════════════════╣\n`;

  // Entertainment
  menuText += `║ 🎵 *Music & Entertainment*\n`;
  menuText += `║ ├─ !stream - Watch2Gether\n`;
  menuText += `║ ├─ !play - Main lagu\n`;
  menuText += `║ ├─ !lirik - Cari lirik\n`;
  menuText += `║ ├─ !meme - Meme lucu\n`;
  menuText += `║ ├─ !joke - Joke acak\n`;
  menuText += `║ ├─ !waifu - Waifu random\n`;
  menuText += `║ ├─ !anime - Info anime\n`;
  menuText += `║ ├─ !character - Karakter anime\n`;
  menuText += `║ ├─ !truth - Truth game\n`;
  menuText += `║ ├─ !dare - Daring game\n`;
  menuText += `╠══════════════════════════════════════════════════════════╣\n`;

  // Utility tools
  menuText += `║ 🛠️ *Tools & Utilities*\n`;
  menuText += `║ ├─ !qr - Generate QR\n`;
  menuText += `║ ├─ !password - Generate password\n`;
  menuText += `║ ├─ !calc - Kalkulator\n`;
  menuText += `║ ├─ !warna - Konversi warna\n`;
  menuText += `║ ├─ !hitung - Analisis teks\n`;
  menuText += `║ ├─ !ceklink - Scan link\n`;
  menuText += `║ ├─ !stalk - Stalk GitHub\n`;
  menuText += `║ ├─ !cuaca - Cek cuaca\n`;
  menuText += `║ ├─ !tanggal - Tanggal & waktu\n`;
  menuText += `║ ├─ !jadwalsholat - Jadwal sholat\n`;
  menuText += `╠══════════════════════════════════════════════════════════╣\n`;

  // Games & Fun
  menuText += `║ 🎲 *Games & Fun*\n`;
  menuText += `║ ├─ !gacha - Gacha decision\n`;
  menuText += `║ ├─ !truth - Truth game\n`;
  menuText += `║ ├─ !dare - Dare game\n`;
  menuText += `║ ├─ !rps - Rock Paper Scissors\n`;
  menuText += `║ ├─ !roll - Roll dice\n`;
  menuText += `║ ├─ !flip - Flip coin\n`;
  menuText += `║ ├─ !tebakangka - Guess number\n`;
  menuText += `║ ├─ !tebakkata - Guess word\n`;
  menuText += `║ ├─ !meme - Meme\n`;
  menuText += `║ ├─ !joke - Joke\n`;
  menuText += `║ ├─ !waifu - Waifu\n`;
  menuText += `╠══════════════════════════════════════════════════════════╣\n`;

  // Owner control panel
  if (isAdmin) {
    menuText += `║ 👑 *Owner Control*\n`;
    menuText += `║ ├─ !speedtest - Speed test\n`;
    menuText += `║ ├─ !bc - Broadcast\n`;
    menuText += `║ ├─ !block - Block user\n`;
    menuText += `║ ├─ !unblock - Unblock user\n`;
    menuText += `║ ├─ !eval - Run code\n`;
    menuText += `║ ├─ !update - Update bot\n`;
    menuText += `║ └─ !restart - Restart bot\n`;
    menuText += `╠══════════════════════════════════════════════════════════╣\n`;
  }

  // Info
  menuText += `║ 💎 *Bot Info*\n`;
  menuText += `║ ├─ Creator: DoxxBorx\n`;
  menuText += `║ ├─ Version: ${botVersion}\n`;
  menuText += `║ ├─ Total Commands: 75+\n`;
  menuText += `║ └─ Status: 🟢 Aktif & Siap Melayani\n`;
  menuText += `╚══════════════════════════════════════════════════════════╝\n`;
  menuText += `\n💖 *Made with Love by DoxxBorx*\n`;
  menuText += `🎀 _Type !command untuk bantuan spesifik_\n`;

  await sock.sendMessage(from, { text: menuText }, { quoted: msg });
}

// Helper function: format uptime
function formatUptime(seconds) {
  seconds = Math.floor(seconds);
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  let str = '';
  if (d > 0) str += `${d}d `;
  if (h > 0) str += `${h}h `;
  if (m > 0) str += `${m}m `;
  str += `${s}s`;
  return str;
}

// Function generate password
function generatePassword(length = 12) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

// Placeholder for yts search
async function ytsSearch(query) {
  const { yts } = await import('yt-search');
  const r = await yts(query);
  return r;
}

// ===================
// Start bot
// ===================
start();

// Handle error dan exit
process.on('SIGINT', () => {
  console.log(chalk.yellow('🛑 Bot dimatikan...'));
  process.exit(0);
});
process.on('uncaughtException', (err) => {
  console.error('Error tidak tertangani:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Rejection tidak tertangani:', reason);
});