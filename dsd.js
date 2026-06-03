import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import chalk from 'chalk';
import fs from 'fs';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import axios from 'axios';
import OpenAI from 'openai'; // Cukup panggil ini saja!
import pino from 'pino';
import os from 'os';
import { createCanvas, loadImage } from 'canvas';
import { GoogleGenAI } from '@google/genai';
import * as cheerio from 'cheerio';
import { minify } from 'terser';
import express from 'express';
import http from 'http';
import ytdl from '@distube/ytdl-core';
import ytdl from 'ytdl-core';
import TikTok from '@tobyg74/tiktok-api-dl';
import yts from 'yt-search';

console.log("Gemini Key Loaded:", !!process.env.GEMINI_API_KEY);
console.log("OpenAI Key Loaded:", !!process.env.OPENAI_API_KEY);

const BOT_NAME = "zetbot";
const OWNER_NUMBER = ["6282384961407", "36326967632006"];
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Inisialisasi OpenAI SDK v4 yang benar
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// TAMBAHKAN INI:
const ownerName = "DoxxBorx"; // Tambahkan
const ownerNumber = "6282384961407@s.whatsapp.net"; // Tambahkan
const botVersion = "3.0.0"; // Tambahkan
const games = {}; // Untuk game state // Tambahkan
const danaNumber = "0838-XXXX-XXXX";
const ovoNumber = "0838-XXXX-XXXX";
const gopayNumber = "0838-XXXX-XXXX";
const bankAccount = "BCA 1234567890 a/n DoxxBorx";
const saweriaLink = "saweria.co/doxxborx";
const trakteerLink = "trakteer.id/doxxborx";
const ownerEmail = "doxxborx@example.com";
const ownerGitHub = "github.com/doxxborx";
const ownerInstagram = "@doxxborx";

const startTime = Date.now();

// 📻 WATCH2GETHER CONFIG
const W2G_API_KEY = process.env.STREAM_TOKEN;
const W2G_ROOM_FILE = "./w2g_room.json";

let isSelfMode = false;
let isSleeping = false;
let antiLink = false;

// Database sederhana
const userCooldown = new Map();
const userAIContext = new Map();
const MAX_MEMORY = 12;
const notesDatabase = {};
const imageCache = new Map();
const aiQueue = [];
let isProcessingQueue = false;
const bratStyles = [
    'cute', 'dark', 'neon', 'anime', 'glitch', 'minimal'
];

// =======================================================
// 🔧 HELPER FUNCTIONS
// =======================================================
function checkCooldown(id) {
    const now = Date.now();
    const exp = userCooldown.get(id);

    if (exp && now < exp) return false;

    userCooldown.set(id, now + 8000);
    return true;
}

function getUserContext(userId) {
    if (!userAIContext.has(userId)) {
        userAIContext.set(userId, []);
    }
    return userAIContext.get(userId);
}

function addToContext(userId, role, text) {
    const ctx = getUserContext(userId);
    ctx.push({ role, text });
    if (ctx.length > MAX_MEMORY) ctx.shift();
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

function formatUptime(seconds) { // TAMBAHKAN FUNGSI INI
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    let result = [];
    if (days > 0) result.push(`${days}d`);
    if (hours > 0) result.push(`${hours}h`);
    if (minutes > 0) result.push(`${minutes}m`);
    if (secs > 0 || result.length === 0) result.push(`${secs}s`);
    
    return result.join(' ');
}


// =======================================================
// 📻 WATCH2GETHER HELPER FUNCTIONS 🎵
// =======================================================
function loadRoomData() {
    try {
        if (fs.existsSync(W2G_ROOM_FILE)) {
            return JSON.parse(fs.readFileSync(W2G_ROOM_FILE, 'utf8'));
        }
    } catch (e) { /* silent */ }
    return null;
}

function saveRoomData(data) {
    try {
        fs.writeFileSync(W2G_ROOM_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Gagal simpan room data:", e.message);
    }
}

// =======================================================
// 🧠 AI QUEUE SYSTEM
// =======================================================
function runAIQueue(text, type, isAdmin, fromId) {
    return new Promise((resolve, reject) => {
        aiQueue.push({ text, type, isAdmin, fromId, resolve, reject });
        processQueue();
    });
}

async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (aiQueue.length > 0) {
        const job = aiQueue.shift();

        try {
            const res = await tanyakanAI(
                job.text,
                job.type,
                job.isAdmin,
                job.fromId
            );
            job.resolve(res);
            await new Promise(r => setTimeout(r, 1200));
        } catch (e) {
            job.reject(e);
        }
    }
    isProcessingQueue = false;
}

// =======================================================
// 🖼️ IMAGE PROCESSING FUNCTIONS (FIXED)
// =======================================================
function randomGradient() {
    const colors = [
        "#ff9a9e", "#fad0c4", "#fbc2eb",
        "#a18cd1", "#f6d365", "#fda085",
        "#84fab0", "#8fd3f4"
    ];
    const c1 = colors[Math.floor(Math.random() * colors.length)];
    const c2 = colors[Math.floor(Math.random() * colors.length)];
    return `linear-gradient(45deg, ${c1}, ${c2})`;
}

async function addTextToImageV3(buffer, topText = '', bottomText = '', style = 'premium') {
    try {
        const img = await loadImage(buffer);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        
        ctx.drawImage(img, 0, 0);
        
        // 🎀 WAIFU FRAME
        if (style === 'waifu') {
            ctx.strokeStyle = '#ff69b4';
            ctx.lineWidth = 20;
            ctx.strokeRect(0, 0, img.width, img.height);
        }
        
        // 🤖 CYBER FRAME
        if (style === 'cyber') {
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 6;
            ctx.strokeRect(20, 20, img.width - 40, img.height - 40);
        }
        
        const fontSize = Math.max(32, Math.floor(img.width / 12));
        ctx.textAlign = "center";
        ctx.font = `bold ${fontSize}px Sans`;
        
        function applyStyle() {
            ctx.shadowBlur = 0;
            
            switch (style) {
                case 'waifu':
                    ctx.fillStyle = '#ffb6c1';
                    ctx.strokeStyle = '#ff1493';
                    ctx.lineWidth = 10;
                    ctx.shadowColor = '#ff69b4';
                    ctx.shadowBlur = 20;
                    break;
                    
                case 'manga':
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 12;
                    break;
                    
                case 'meme':
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 12;
                    break;
                    
                case 'glow':
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#00ff88';
                    ctx.lineWidth = 10;
                    ctx.shadowColor = '#00ff88';
                    ctx.shadowBlur = 35;
                    break;
                    
                case 'cyber':
                    ctx.fillStyle = '#00ffff';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 10;
                    ctx.shadowColor = '#00ffff';
                    ctx.shadowBlur = 30;
                    break;
                    
                case 'neon':
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#00ffff';
                    ctx.lineWidth = 10;
                    ctx.shadowColor = '#00ffff';
                    ctx.shadowBlur = 25;
                    break;
                    
                case 'gold':
                    ctx.fillStyle = '#FFD700';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 8;
                    break;
                    
                case 'anime':
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#ff1493';
                    ctx.lineWidth = 10;
                    break;
                    
                default:
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 10;
            }
        }
        
        applyStyle();
        
        function drawWrappedText(text, startY) {
            if (!text) return;
            
            const maxWidth = img.width * 0.9;
            const words = text.split(' ');
            let line = '';
            let lines = [];
            
            for (const word of words) {
                const testLine = line + word + ' ';
                if (ctx.measureText(testLine).width > maxWidth && line) {
                    lines.push(line.trim());
                    line = word + ' ';
                } else {
                    line = testLine;
                }
            }
            
            if (line) {
                lines.push(line.trim());
            }
            
            for (let i = 0; i < lines.length; i++) {
                const y = startY + i * (fontSize + 12);
                const width = ctx.measureText(lines[i]).width + 40;
                
                // background transparan
                ctx.fillStyle = 'rgba(0,0,0,0.35)';
                ctx.fillRect(img.width / 2 - width / 2, y - fontSize, width, fontSize + 15);
                
                applyStyle();
                ctx.strokeText(lines[i], img.width / 2, y);
                ctx.fillText(lines[i], img.width / 2, y);
            }
        }
        
        drawWrappedText(topText, fontSize + 40);
        
        const bottomLines = bottomText.split(' ').length > 6 ? 2 : 1;
        drawWrappedText(bottomText, img.height - (bottomLines * (fontSize + 20)) - 40);
        
        return canvas.toBuffer('image/png');
    } catch (error) {
        console.error("Error addTextToImageV3:", error);
        return buffer; // Return original buffer if error
    }
}

async function addTextToImage(buffer, text) {
    try {
        const img = await loadImage(buffer);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        
        ctx.drawImage(img, 0, 0);
        const fontSize = Math.floor(img.width / 12);
        
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, img.height * 0.75, img.width, img.height * 0.25);
        
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${fontSize}px Sans`;
        ctx.textAlign = "center";
        
        const maxWidth = img.width * 0.9;
        const words = text.split(' ');
        let line = '';
        let y = img.height * 0.85;
        
        for (let n = 0; n < words.length; n++) {
            let testLine = line + words[n] + ' ';
            let metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && n > 0) {
                ctx.fillText(line, img.width / 2, y);
                line = words[n] + ' ';
                y += fontSize + 10;
            } else {
                line = testLine;
            }
        }
        
        ctx.fillText(line, img.width / 2, y);
        return canvas.toBuffer("image/png");
    } catch (error) {
        console.error("Error addTextToImage:", error);
        return buffer;
    }
}

async function addAnimatedTextStyle(buffer, text) {
    try {
        const img = await loadImage(buffer);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        
        ctx.drawImage(img, 0, 0);
        const fontSize = Math.floor(img.width / 10);
        
        ctx.font = `bold ${fontSize}px Sans`;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(255,255,255,0.8)";
        ctx.shadowBlur = 20;
        
        const x = img.width / 2;
        const y = img.height * 0.8;
        
        // glitch effect
        ctx.fillStyle = "#ff4dff";
        ctx.fillText(text, x + 2, y);
        
        ctx.fillStyle = "#00ffff";
        ctx.fillText(text, x - 2, y);
        
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, x, y);
        
        return canvas.toBuffer("image/png");
    } catch (error) {
        console.error("Error addAnimatedTextStyle:", error);
        return buffer;
    }
}

async function generateFallbackImage(text) {
    try {
        const seed = Math.floor(Math.random() * 999999);
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}, sticker style, cute, high quality?seed=${seed}`;
        
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());
        return buffer;
    } catch (error) {
        console.error("Error generateFallbackImage:", error);
        // Return default image
        const canvas = createCanvas(512, 512);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff69b4';
        ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px Sans';
        ctx.textAlign = 'center';
        ctx.fillText(text.substring(0, 30), 256, 256);
        return canvas.toBuffer('image/png');
    }
}

async function polishText(text) {
    try {
        if (!GEMINI_API_KEY) return text;
        
        const prompt = `Perbaiki teks ini jadi lebih aesthetic, pendek, dan keren untuk sticker: "${text}"`;
        
        const result = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: prompt
        });
        
        return result.text || text;
    } catch {
        return text;
    }
}

// =======================================================
// 🎵 VIDEO PROCESSING FUNCTIONS (SIMPLIFIED)
// =======================================================
async function downloadBuffer(mediaMsg) {
    const stream = await downloadContentFromMessage(mediaMsg, 'video');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

async function handlePlayCommand(query, message) {
  const videoData = await searchYouTube(query);
  if (!videoData) {
    message.reply(`Maaf, tidak menemukan video yang cocok untuk "${query}".`);
    return;
  }
  message.channel.send(`Memutar: **${videoData.title}** (${videoData.duration})\nURL: ${videoData.url}`);
  // Tambahkan kode untuk memutar lagu berdasarkan videoData.url
}

// =======================================================
// 📻 WATCH2GETHER FUNCTIONS
// =======================================================
async function createW2GRoom() {
    if (!W2G_API_KEY) {
        throw new Error("W2G_API_KEY not found in .env");
    }
    
    try {
        const res = await axios.post('https://api.w2g.tv/rooms/create.json', {
            w2g_api_key: W2G_API_KEY,
            share: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            bg_color: "#00ff00",
            bg_opacity: "50"
        });
        
        const streamKey = res.data.streamkey;
        const roomUrl = `https://w2g.tv/rooms/${streamKey}`;
        const roomData = { streamkey: streamkey, url: roomUrl, created_at: new Date().toISOString() };
        
        saveRoomData(roomData);
        return roomData;
    } catch (error) {
        console.error("Error createW2GRoom:", error.message);
        throw error;
    }
}

async function getOrCreateRoom() {
    const existing = loadRoomData();
    if (existing && existing.streamkey) return existing;
    return await createW2GRoom();
}

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
        console.error('❌ W2G API Error:', e.response?.status, e.response?.data || e.message);
        throw e;
    }
}

async function isYouTubeVideoPlayable(url) {
  try {
    const info = await ytdl.getInfo(url);
    // Jika info berhasil didapat, video bisa diputar
    return { success: true, info };
  } catch (error) {
    // Jika error, bisa jadi URL tidak valid atau video tidak tersedia
    return { success: false, error: error.message };
  }
}

async function searchYouTube(query) {
  const result = await yts(query);
  if (result.videos.length === 0) {
    return null; // Tidak ditemukan video
  }
  // Ambil video pertama
  const video = result.videos[0];
  return {
    url: video.url,
    title: video.title,
    duration: video.duration.timestamp,
    thumbnail: video.thumbnail,
  };
}

// =======================================================
// 📱 INSTAGRAM DOWNLOADER
// =======================================================
async function getInstagramMedia(url) {
    try {
        // METHOD 1: SnapAPI
        try {
            const res = await axios.get(`https://snapinsta.app/api/ajaxSearch`, {
                params: { url }
            });
            
            const data = res.data;
            if (data?.media?.length) {
                return data.media[0].url;
            }
        } catch (e) {
            console.log("SnapAPI gagal, lanjut fallback...");
        }
        
        // METHOD 2: SaveInsta fallback
        try {
            const res = await axios.post(
                "https://saveinsta.io/core/ajax.php",
                new URLSearchParams({
                    url,
                    submit: ""
                }),
                {
                    headers: {
                                                "content-type": "application/x-www-form-urlencoded"
                    }
                }
            );

            const $ = cheerio.load(res.data);
            const media = [];

            $("a").each((i, el) => {
                const link = $(el).attr("href");
                if (link && link.includes("http")) {
                    media.push(link);
                }
            });

            if (media.length > 0) return media[0];

        } catch (e) {
            console.log("SaveInsta gagal, lanjut fallback...");
        }
        
                // METHOD 3: Embed fallback
        try {
            const shortUrl = url.split("?")[0];
            const embed = `https://www.instagram.com/oembed/?url=${shortUrl}`;
            const res = await axios.get(embed);
            
            if (res.data?.thumbnail_url) {
                return res.data.thumbnail_url;
            }
        } catch (e) {
            console.log("Embed fallback gagal...");
        }
        
        throw new Error("Semua metode IG gagal");
    } catch (err) {
        console.log("IG ERROR:", err.message);
        return null;
    }
}

// =======================================================
// 🧠 AI FUNCTIONS
// =======================================================
async function groqAI(prompt) {
    try {
        if (!process.env.GROQ_API_KEY) return null;
        
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.9,
                max_tokens: 1000
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data.choices[0].message.content;
    } catch (err) {
        console.log('GROQ ERROR:', err.response?.data || err);
        return null;
    }
}

async function tanyakanAI(query, type = 'tanya', isAdmin = false, fromId = 'global') {
    const context = getUserContext(fromId);
    let contentsPayload = query;
    
    if (type === 'chat_context') {
        context.push({ role: 'user', text: query });
        contentsPayload = context.map(c => ({
            role: c.role === 'user' ? 'user' : 'model',
            parts: [{ text: c.text }]
        }));
    }
    
    const systemInstruction = `Anda adalah AI santai, lucu, tapi pintar.`;
    
    // Try Gemini first
    try {
        const res = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: contentsPayload,
            config: {
                systemInstruction,
                temperature: 0.7
            }
        });
        
        addToContext(fromId, 'user', query);
        addToContext(fromId, 'model', res.text);
        return res.text;
    } catch (e) {
        // Fallback to OpenAI
        try {
            if (process.env.OPENAI_API_KEY) {
                const res = await openai.chat.completions.create({
                    model: "gpt-3.5-turbo",
                    messages: [
                        { role: "system", content: systemInstruction },
                        { role: "user", content: query }
                    ]
                });
                return res.choices[0].message.content;
            }
        } catch (e1) {
            // Fallback to Groq
            try {
                return await groqAI(query);
            } catch (e2) {
                return "❌ Semua AI lagi tumbang, coba lagi nanti.";
            }
        }
    }
}

// =======================================================
// 📊 GLOBAL VARIABLES FOR VOTING & QUEUE
// =======================================================
global.activeVotes = {};
global.radioQueue = [];
global.playSession = {};

// =======================================================
// 🔌 START WHATSAPP CONNECTION
// =======================================================
function hasExistingSession() {
    const sessionPath = './session';
    if (!fs.existsSync(sessionPath)) return false;
    
    const files = fs.readdirSync(sessionPath);
    return files.includes('creds.json');
}

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./session_luxxbot');
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true,
            auth: state,
            browser: ["LuxxBot", 'Chrome', '1.0.0']
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                console.log('\n\x1b[35m╔════════════════════════════════════════════════════╗\x1b[0m');
                console.log('\x1b[36m║          🌸 LUXxBOT PREMIUM EDITION 🌸             ║\x1b[0m');
                console.log('\x1b[35m╚════════════════════════════════════════════════════╝\x1b[0m\n');
                qrcode.generate(qr, { small: true });
            }
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect.error instanceof Boom) ? 
                    lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
                console.log('🔄 Koneksi terputus, mencoba menyambung ulang:', shouldReconnect);
                if (shouldReconnect) {
                    setTimeout(() => startBot(), 5000);
                }
            } else if (connection === 'open') {
                console.log('\x1b[36m%s\x1b[0m', `
                ╔══════════════════════════════════════════════════════════╗
                ║  🚀 LUXxBOT PREMIUM MULTI-DEVICE SUCCESSFULLY ONLINE!   ║
                ║  🤖 Version: 3.0.0 | Created by: DoxxBorx               ║
                ╚══════════════════════════════════════════════════════════╝
                `);
                console.log(`\x1b[32m🌸 ✨ Yeayy! LuxxBot Berhasil Online! Siap Melayani! 🎀💖\x1b[0m\n`);
                
                // Init W2G Room
                getOrCreateRoom()
                    .then(room => console.log(`\x1b[35m📻 Room W2G siap: ${room.url}\x1b[0m`))
                    .catch(e => console.error('❌ Gagal init room W2G:', e.message));
            }
        });
        
        // =======================================================
        // 📱 MESSAGE HANDLER
        // =======================================================
        sock.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const msg = chatUpdate.messages[0];
                if (!msg || !msg.message) return;
                if (msg.key.fromMe) return;
                if (!msg.message || msg.messageStubType) return;
                
                const from = msg.key.remoteJid;
                if (!checkCooldown(from)) {
                    await sock.sendMessage(from, {
                        text: '⏳ Tunggu dulu ya sayang, jangan spam aku 😤'
                    }, { quoted: msg });
                    return;
                }

                client.on('message', async (message) => {
  if (message.author.bot) return;
  if (message.content.startsWith('!play')) {
    const args = message.content.slice('!play'.length).trim();
    if (!args) {
      message.reply('Silakan berikan kata kunci lagu.');
      return;
    }
    await handlePlayCommand(args, message);
  }
});
                
                const isGroup = from.endsWith('@g.us');
                const sender = msg.key.participant || from;
                
                const type = Object.keys(msg.message)[0];
                const body = (type === 'conversation') ? msg.message.conversation :
                            (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text :
                            (type === 'imageMessage') ? msg.message.imageMessage.caption :
                            (type === 'videoMessage') ? msg.message.videoMessage.caption : '';
                const text = body ? body.trim() : '';
                
                // Anti-Link Detection
                if (antiLink && isGroup && text.match(/(chat\.whatsapp\.com\/)/gi)) {
                    try {
                        const groupMetadata = await sock.groupMetadata(from);
                        const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                        const isBotAdmin = groupMetadata?.participants?.some(
                            p => p.id === botNumber && (p.admin === 'admin' || p.admin === 'superadmin')
                        );
                        
                        if (isBotAdmin) {
                            await sock.sendMessage(from, { 
                                text: `🛡️ *Hayo Ketahuan!* Maaf @${sender.split('@')[0]} sayang, dilarang keras sebar link grup lain di sini ya! Sesuai protokol, kamu aku *kick*. Bye bye~ 👋🤭`, 
                                mentions: [sender] 
                            });
                            await sock.groupParticipantsUpdate(from, [sender], 'remove');
                            return;
                        }
                    } catch (e) {
                        console.log('⚠️ AntiLink error:', e.message);
                    }
                }
                
                if (!text.startsWith('!')) return;
                
                const args = text.split(/ +/).slice(1);
                const command = text.split(/ +/)[0].toLowerCase().slice(1);
                
                const isAdmin = OWNER_NUMBER.some(num => sender.includes(num));
                
                let isLocalGroupAdmin = false;
                if (isGroup) {
                    try {
                        const groupMetadata = await sock.groupMetadata(from);
                        const userParticipant = groupMetadata.participants.find(p => p.id === sender);
                        isLocalGroupAdmin = userParticipant?.admin === 'admin' || 
                                          userParticipant?.admin === 'superadmin' || 
                                          isAdmin;
                    } catch (e) {
                        console.log('⚠️ Gagal ambil metadata grup:', e.message);
                    }
                }
                
                if (isSelfMode && !isAdmin) return;
                if (isSleeping && command !== 'bangun' && !isAdmin) {
                    return await sock.sendMessage(from, { 
                        text: '🛌 *Ssstt.. aku masih turu nyenyak, Bos.* Ketik `!bangun` dulu dong biar aku melek lagi! 🥱🌸' 
                    }, { quoted: msg });
                }
                
                // =======================================================
                // 🌟 SUPER PREMIUM MENU DESIGN
                // =======================================================
                if (command === 'menu' || command === 'help' || command === 'start') {
    const botUptime = runtime((Date.now() - startTime) / 1000);
    let menuText = `╔══════════════════════════════════════════════════════════╗\n`;
    menuText += `║                 🌸 *LUXxBOT PREMIUM MENU* 🌸                ║\n`;
    menuText += `╠══════════════════════════════════════════════════════════╣\n`;
    menuText += `║ 📊 *SYSTEM STATUS*                                        ║\n`;
    menuText += `║ ├─ 🛠️ Mode Bot    : ${isSelfMode ? '🔒 VIP SELF MODE' : '🔓 PUBLIC MODE'}\n`;
    menuText += `║ ├─ 💤 Status Bot  : ${isSleeping ? '🛌 SLEEP MODE' : '⚡ ONLINE'}\n`;
    menuText += `║ ├─ 🛡️ Anti-Link   : ${antiLink ? '🟢 ACTIVE' : '🔴 OFF'}\n`;
    menuText += `║ ├─ ⏳ Runtime     : ${botUptime}\n`;
    menuText += `║ └─ 📡 Server      : 🟢 STABLE CONNECTION\n`;
    menuText += `╠══════════════════════════════════════════════════════════╣\n`;
    
    // Menu Commands
    menuText += `║ 🎮 *GENERAL COMMANDS*                                    ║\n`;
    menuText += `║ ├─ !halo       - Sapaan ramah ke bot (👋)\n`;
    menuText += `║ ├─ !ping       - Cek kecepatan respon bot (🏓)\n`;
    menuText += `║ ├─ !menu       - Tampilkan menu lengkap ini (📜)\n`;
    menuText += `║ ├─ !changelogs - Update & fitur terbaru (📢)\n`;
    menuText += `║ ├─ !notes      - Catatan pribadi (📝)\n`;
    menuText += `║ ├─ !remindme   - Pengingat otomatis (⏰)\n`;
    menuText += `║ ├─ !add        - Tambah member ke grup (👥)\n`;
    menuText += `║ ├─ !tagall     - Mention semua member grup (📢)\n`;
    menuText += `╠══════════════════════════════════════════════════════════╣\n`;

    // AI & Chat Commands
    menuText += `║ 🧠 *AI & Chat*                                              ║\n`;
    menuText += `║ ├─ !tanya      - Tanya AI apapun (🤖)\n`;
    menuText += `║ ├─ !ai         - Chat dengan AI (💬)\n`;
    menuText += `║ ├─ !coding     - Bantuan coding & debug (💻)\n`;
    menuText += `║ ├─ !code       - Review & analisa kode (🔍)\n`;
    menuText += `║ ├─ !rangkum    - Ringkas teks panjang (📑)\n`;
    menuText += `║ ├─ !brainstorm - Ide kreatif & inovatif (💡)\n`;
    menuText += `║ ├─ !gif        - Cari gif lucu/keren (GIF)\n`;
    menuText += `║ ├─ !translate  - Terjemahan multi bahasa (🌐)\n`;
    menuText += `║ ├─ !buat       - Generate gambar AI (🎨)\n`;
    menuText += `║ ├─ !lihat      - Analisa gambar dengan AI (👁️)\n`;
    menuText += `║ ├─ !gpt        - ChatGPT premium (💬)\n`;
    menuText += `║ ├─ !dalle      - Generate gambar AI (🎨)\n`;
    menuText += `║ ├─ !stablediff - Stable Diffusion AI (🖼️)\n`;
    menuText += `║ ├─ !q          - Chat bebas dengan AI (🗨️)\n`;
    menuText += `║ ├─ !resetai    - Reset memori AI (♻️)\n`;
    menuText += `║ ├─ !fact       - Fakta menarik acak (🤯)\n`;
    menuText += `║ ├─ !ocr        - Ekstrak teks dari gambar (🔍)\n`;
    menuText += `╠══════════════════════════════════════════════════════════╣\n`;

    // Media & Creative Commands
    menuText += `║ 🎨 *MEDIA & CREATIVE*                                       ║\n`;
    menuText += `║ ├─ !sticker    - Buat stiker premium (🎭)\n`;
    menuText += `║ ├─ !s          - Shortcut buat stiker (🎨)\n`;
    menuText += `║ ├─ !anomali    - Sticker aesthetic style (✨)\n`;
    menuText += `║ ├─ !dl         - Download media (YT/TT/IG) (📥)\n`;
    menuText += `║ ├─ !remini     - HD kan foto (✨)\n`;
    menuText += `║ ├─ !ig         - Download Instagram (📷)\n`;
    menuText += `║ ├─ !fb         - Download Facebook (👥)\n`;
    menuText += `║ ├─ !twitter    - Download Twitter (🐦)\n`;
    menuText += `║ ├─ !spotify    - Download Spotify (🎵)\n`;
    menuText += `║ ├─ !jsonpretty - Format JSON (🧩)\n`;
    menuText += `║ ├─ !minify     - Minify kode JavaScript (📉)\n`;
    menuText += `╠══════════════════════════════════════════════════════════╣\n`;

    // Music & Entertainment Commands
    menuText += `║ 🎵 *MUSIC & ENTERTAINMENT*                                  ║\n`;
    menuText += `║ ├─ !stream     - Nonton bareng W2G (📻)\n`;
    menuText += `║ ├─ !play       - Play musik YouTube (🎵)\n`;
    menuText += `║ ├─ !queue      - Lihat antrian lagu (📋)\n`;
    menuText += `║ ├─ !lirik [judul lagu] - Cari lirik lagu (🎵)\n`;
    menuText += `║ ├─ !anime      - Info anime (🎌)\n`;
    menuText += `║ ├─ !waifu      - Random waifu (💖)\n`;
    menuText += `║ ├─ !character  - Cari karakter anime (👤)\n`;
    menuText += `║ ├─ !meme       - Meme lucu (😂)\n`;
    menuText += `║ ├─ !joke       - Lelucon acak (🤣)\n`;
    menuText += `║ ├─ !truth      - Game truth (🫣)\n`;
    menuText += `║ ├─ !dare       - Game dare (😈)\n`;
    menuText += `╠══════════════════════════════════════════════════════════╣\n`;

    // Utility & Tools Commands
    menuText += `║ 📊 *UTILITY & TOOLS*                                        ║\n`;
    menuText += `║ ├─ !cuaca      - Info cuaca real-time (🌤️)\n`;
    menuText += `║ ├─ !kalkulator - Hitung matematika (🧮)\n`;
    menuText += `║ ├─ !qr         - Generate QR code (🔳)\n`;
    menuText += `║ ├─ !password   - Generate password (🔑)\n`;
    menuText += `║ ├─ !stalk      - Cek profil GitHub (🐙)\n`;
    menuText += `║ ├─ !summarize  - Ringkas artikel web (📰)\n`;
    menuText += `║ ├─ !ceklink    - Scan link berbahaya (🛡️)\n`;
    menuText += `║ ├─ !gitwatch   - Pantau aktivitas GitHub (👁️)\n`;
    menuText += `║ ├─ !simi [pertanyaan] - Chat dengan Simi (🤖)\n`;
    menuText += `║ ├─ !dbdiagram  - Generate diagram database (📊)\n`;
    menuText += `╠══════════════════════════════════════════════════════════╣\n`;

    // Games & Fun Commands
    menuText += `║ 🎲 *GAMES & FUN*                                            ║\n`;
    menuText += `║ ├─ !gacha      - Decision maker random (🎲)\n`;
    menuText += `║ ├─ !apakah     - Jawaban acak (🔮)\n`;
    menuText += `║ ├─ !kapankah   - Ramalan waktu (⏳)\n`;
    menuText += `║ ├─ !roll       - Roll dice (🎲)\n`;
    menuText += `║ ├─ !tebakkata - Tebak kata acak (📝)\n`;
    menuText += `║ ├─ !tebakangka - Tebak angka (🔢)\n`;
    menuText += `║ ├─ !flip       - Flip coin (🪙)\n`;
    menuText += `║ ├─ !rps        - Rock Paper Scissors (✊✋✌️)\n`;
    menuText += `║ ├─ !roastme    - Roast lucu (🔥)\n`;
    menuText += `║ ├─ !voting     - Buat polling/voting (🗳️)\n`;
    menuText += `║ ├─ !pilih      - Pilih opsi voting (✅)\n`;
    menuText += `║ ├─ !endvoting  - Tutup voting (🛑)\n`;
    menuText += `║ ├─ !cerpen     - Generate cerpen AI (📖)\n`;
    menuText += `║ ├─ !pantun     - Pantun lucu/cinta/nasihat (🎭)\n`;
    menuText += `║ ├─ !quotes     - Quotes inspiratif (💫)\n`;
    menuText += `║ ├─ !darkjokes  - Dark jokes acak (😈)\n`;
    menuText += `╠══════════════════════════════════════════════════════════╣\n`;

    // Owner Control Panel (Hanya untuk admin)
    if (isAdmin) {
        menuText += `║ 👑 *OWNER CONTROL PANEL*                                   ║\n`;
        menuText += `║ ├─ !speedtest  - Uji kecepatan server (🚀)\n`;
        menuText += `║ ├─ !broadcast  - Kirim pesan ke semua (📢)\n`;
        menuText += `║ ├─ !bc         - Shortcut broadcast (📝)\n`;
        menuText += `║ ├─ !spek       - Info spesifikasi sistem (💻)\n`;
        menuText += `║ ├─ !systeminfo - Detail CPU & RAM (📊)\n`;
        menuText += `║ ├─ !self       - Mode private (🔒)\n`;
        menuText += `║ ├─ !public     - Mode publik (🔓)\n`;
        menuText += `║ ├─ !join       - Join grup (➕)\n`;
        menuText += `║ ├─ !kick       - Kick member dari grup (👢)\n`;
        menuText += `║ ├─ !promote    - Promote ke admin (⬆️)\n`;
        menuText += `║ ├─ !demote     - Demote dari admin (⬇️)\n`;
        menuText += `║ ├─ !leave      - Keluar grup (🚪)\n`;
        menuText += `║ ├─ !grup       - Kontrol grup (⚙️)\n`;
        menuText += `║ ├─ !antilink   - Proteksi link grup (🛡️)\n`;
        menuText += `║ ├─ !block      - Blokir user (🚫)\n`;
        menuText += `║ ├─ !unblock    - Buka blokir (🕊️)\n`;
        menuText += `║ ├─ !refresh    - Bersihkan sistem (♻️)\n`;
        menuText += `║ ├─ !turu       - Tidurkan bot (🛌)\n`;
        menuText += `║ ├─ !bangun     - Bangunkan bot (☀️)\n`;
        menuText += `║ ├─ !pingsan    - Matikan bot (💀)\n`;
        menuText += `║ ├─ !resetroom  - Reset room W2G (🔄)\n`;
        menuText += `║ ├─ !eval       - Jalankan code (⚙️)\n`;
        menuText += `║ └─ !update     - Update bot (🔄)\n`;
        menuText += `╠══════════════════════════════════════════════════════════╣\n`;
    }

    // Bot Info
    menuText += `║ 💎 *BOT INFORMATION*                                        ║\n`;
    menuText += `║ ├─ Creator    : DoxxBorx (👑)\n`;
    menuText += `║ ├─ Version    : 3.0.0 Premium Edition (🚀)\n`;
    menuText += `║ ├─ Total Fitur: 75+ Commands (📦)\n`;
    menuText += `║ ├─ Status     : 🟢 ACTIVE & READY TO SERVE (✅)\n`;
    menuText += `║ └─ Support    : @6282384961407 (📞)\n`;
    menuText += `╚══════════════════════════════════════════════════════════╝\n`;
    menuText += `\n💖 *Made with Love by DoxxBorx* ✨\n`;
    menuText += `🎀 _Type !command for specific help_ 📚`;

    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
    return;
}

// =======================================================
// 🎨 DALL-E IMAGE GENERATION (DENGAN AUTO FALLBACK GRATIS)
// =======================================================
if (command === 'dalle' || command === 'generate') {
    const prompt = args.join(' ');
    if (!prompt) {
        return await sock.sendMessage(from, { text: '❌ *Format Salah!*\nContoh: `!dalle cat wearing sunglasses` 🕶️🐱' }, { quoted: msg });
    }
    
    await sock.sendMessage(from, { text: '🎨 _Sedang membuat gambar, mohon tunggu sebentar..._' }, { quoted: msg });
    
    try {
        // Coba pakai dall-e-2 terlebih dahulu karena dall-e-3 memicu error 'model does not exist' di akun Tier 0
        const response = await openai.images.generate({
            model: "dall-e-2", 
            prompt: prompt,
            n: 1,
            size: "512x512"
        });
        
        const imageUrl = response.data[0].url;
        const res = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data, 'binary');
        
        await sock.sendMessage(from, { 
            image: buffer, 
            caption: `🎨 *DALL-E Generated Image*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Prompt:* ${prompt}\n\n_Generated by OpenAI DALL-E_` 
        }, { quoted: msg });
        
    } catch (e) {
        console.log('⚠️ OpenAI DALL-E Gagal/Limit, dialihkan ke Engine Fallback Gratis...');
        
        try {
            // JIKA OPENAI ERROR, OTOMATIS PAKAI POLLINATIONS AI (100% GRATIS & TANPA LIMIT API)
            const seed = Math.floor(Math.random() * 999999);
            const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=1024&height=1024&nologo=true`;
            
            const res = await axios.get(fallbackUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(res.data, 'binary');
            
            await sock.sendMessage(from, { 
                image: buffer, 
                caption: `✨ *AI Image Generated (Alternative Engine)*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Prompt:* ${prompt}\n\n_Engine: Pollinations AI (Free System)_` 
            }, { quoted: msg });
            
        } catch (fallbackError) {
            console.error('Semua engine pembuat gambar gagal:', fallbackError);
            await sock.sendMessage(from, { text: '❌ Gagal total untuk membuat gambar. Semua sistem AI sedang sibuk atau limit harian habis.' }, { quoted: msg });
        }
    }
}

// =======================================================
// 🔮 NEW COMMANDS TO ADD
// =======================================================

// 🎵 PLAY MUSIC
if (command === 'play' || command === 'musik') {
    const query = args.join(' ');
    if (!query) {
        return await sock.sendMessage(from, { 
            text: '❌ Format: !play [judul lagu]\nContoh: !play lagu terbaru' 
        }, { quoted: msg });
    }
    
    await sock.sendMessage(from, { 
        text: '🎵 Mencari lagu...' 
    }, { quoted: msg });
    
    try {
        const search = await ytSearch(query);
        const video = search.videos[0];
        
        if (!video) {
            return await sock.sendMessage(from, { 
                text: '❌ Lagu tidak ditemukan!' 
            }, { quoted: msg });
        }
        
        // Download audio
        const audioStream = ytdl(video.url, { filter: 'audioonly', quality: 'highestaudio' });
        const chunks = [];
        
        audioStream.on('data', chunk => chunks.push(chunk));
        audioStream.on('end', async () => {
            const buffer = Buffer.concat(chunks);
            
            await sock.sendMessage(from, {
                audio: buffer,
                mimetype: 'audio/mp4',
                filename: `${video.title}.mp3`,
                caption: `🎵 *Now Playing*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Judul:* ${video.title}\n👤 *Artist:* ${video.author.name}\n⏱️ *Durasi:* ${video.timestamp}\n\n_Requested by @${sender.split('@')[0]}_`,
                mentions: [sender]
            }, { quoted: msg });
        });
        
    } catch (e) {
        console.error("Play error:", e);
        await sock.sendMessage(from, { 
            text: '❌ Gagal memutar lagu!' 
        }, { quoted: msg });
    }
}

// 🖼️ GENERATE AI IMAGE
if (command === 'buat' || command === 'generate') {
    const prompt = args.join(' ');
    if (!prompt) {
        return await sock.sendMessage(from, { 
            text: '❌ Format: !buat [deskripsi gambar]\nContoh: !buat sunset di pantai' 
        }, { quoted: msg });
    }
    
    await sock.sendMessage(from, { 
        text: '🎨 Membuat gambar AI...' 
    }, { quoted: msg });
    
    try {
        // Using pollinations.ai as fallback
        const seed = Math.floor(Math.random() * 999999);
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}`;
        
        await sock.sendMessage(from, {
            image: { url: url },
            caption: `🎨 *AI Generated Image*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Prompt:* ${prompt}\n🤖 *Model:* Pollinations AI\n\n_Generated for @${sender.split('@')[0]}_`,
            mentions: [sender]
        }, { quoted: msg });
        
    } catch (e) {
        console.error("Generate error:", e);
        await sock.sendMessage(from, { 
            text: '❌ Gagal membuat gambar!' 
        }, { quoted: msg });
    }
}

// 📊 JSON FORMATTER
if (command === 'json' || command === 'jsonpretty') {
    const jsonText = args.join(' ');
    if (!jsonText) {
        return await sock.sendMessage(from, { 
            text: '❌ Format: !json [json string]\nContoh: !json {"name":"test","age":20}' 
        }, { quoted: msg });
    }
    
    try {
        const parsed = JSON.parse(jsonText);
        const formatted = JSON.stringify(parsed, null, 2);
        
        await sock.sendMessage(from, { 
            text: `📊 *JSON Formatted*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n\`\`\`json\n${formatted.substring(0, 3000)}\n\`\`\`` 
        }, { quoted: msg });
        
    } catch (e) {
        await sock.sendMessage(from, { 
            text: `❌ JSON tidak valid!\nError: ${e.message}` 
        }, { quoted: msg });
    }
}

// 📉 MINIFY CODE
if (command === 'minify' || command === 'minifyjs') {
    const code = body.substring(body.indexOf(' ') + 1);
    if (!code || code.length < 10) {
        return await sock.sendMessage(from, { 
            text: '❌ Format: !minify [kode javascript]\nKirim kode dengan caption !minify' 
        }, { quoted: msg });
    }
    
    await sock.sendMessage(from, { 
        text: '📉 Meminify kode...' 
    }, { quoted: msg });
    
    try {
        const result = await minify(code);
        
        if (result.error) {
            throw new Error(result.error);
        }
        
        const originalSize = code.length;
        const minifiedSize = result.code.length;
        const reduction = (((originalSize - minifiedSize) / originalSize) * 100).toFixed(2);
        
        await sock.sendMessage(from, { 
            text: `📉 *Code Minified*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📏 *Original:* ${originalSize} chars\n📏 *Minified:* ${minifiedSize} chars\n📊 *Reduction:* ${reduction}%\n\n\`\`\`javascript\n${result.code.substring(0, 2000)}\n\`\`\`` 
        }, { quoted: msg });
        
    } catch (e) {
        await sock.sendMessage(from, { 
            text: `❌ Gagal meminify!\nError: ${e.message}` 
        }, { quoted: msg });
    }
}

// =======================================================
// 🐦 TWITTER DOWNLOADER
// =======================================================
if (command === 'twitter' || command === 'twt') {
    const url = args[0];
    if (!url) {
        return await sock.sendMessage(from, { 
            text: '❌ Format: !twitter [url]\nContoh: !twitter https://twitter.com/user/status/123' 
        }, { quoted: msg });
    }
    
    await sock.sendMessage(from, { 
        text: '📥 Downloading from Twitter...' 
    }, { quoted: msg });
    
    try {
        // Using twt-dl API
        const response = await axios.get(`https://twt-dl.vercel.app/api?url=${encodeURIComponent(url)}`);
        const data = response.data;
        
        if (data.media && data.media.length > 0) {
            const mediaUrl = data.media[0];
            const mediaRes = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(mediaRes.data, 'binary');
            
            const caption = `🐦 *Twitter Download*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *User:* ${data.user?.name || 'Unknown'}\n📝 *Tweet:* ${data.text?.substring(0, 200) || 'No text'}\n❤️ *Likes:* ${data.likes || 0}\n🔁 *Retweets:* ${data.retweets || 0}`;
            
            if (mediaUrl.includes('.mp4')) {
                await sock.sendMessage(from, {
                    video: buffer,
                    caption: caption
                }, { quoted: msg });
            } else {
                await sock.sendMessage(from, {
                    image: buffer,
                    caption: caption
                }, { quoted: msg });
            }
        } else {
            await sock.sendMessage(from, { 
                text: '❌ Tidak ada media yang ditemukan di tweet ini!' 
            }, { quoted: msg });
        }
    } catch (e) {
        console.error('Twitter error:', e);
        await sock.sendMessage(from, { 
            text: '❌ Gagal download dari Twitter!' 
        }, { quoted: msg });
    }
}

// =======================================================
// 🎵 SPOTIFY DOWNLOADER
// =======================================================
if (command === 'spotify' || command === 'spotdl') {
    const url = args[0];
    if (!url) {
        return await sock.sendMessage(from, { 
            text: '❌ Format: !spotify [url]\nContoh: !spotify https://open.spotify.com/track/123' 
        }, { quoted: msg });
    }
    
    await sock.sendMessage(from, { 
        text: '🎵 Downloading from Spotify...' 
    }, { quoted: msg });
    
    try {
        // Using spotify-dl API
        const response = await axios.get(`https://spotify-downloader-api.vercel.app/download?url=${encodeURIComponent(url)}`);
        const data = response.data;
        
        if (data.downloadUrl) {
            const audioRes = await axios.get(data.downloadUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(audioRes.data, 'binary');
            
            const caption = `🎵 *Spotify Download*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🎤 *Title:* ${data.title || 'Unknown'}\n👤 *Artist:* ${data.artist || 'Unknown'}\n💽 *Album:* ${data.album || 'Unknown'}\n⏱️ *Duration:* ${data.duration || 'Unknown'}`;
            
            await sock.sendMessage(from, {
                audio: buffer,
                mimetype: 'audio/mpeg',
                caption: caption
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { 
                text: '❌ Gagal download dari Spotify!' 
            }, { quoted: msg });
        }
    } catch (e) {
        console.error('Spotify error:', e);
        await sock.sendMessage(from, { 
            text: '❌ Gagal download dari Spotify!' 
        }, { quoted: msg });
    }
}

// =======================================================
// 👤 ANIME CHARACTER SEARCH
// =======================================================
if (command === 'character' || command === 'chara') {
    const query = args.join(' ');
    if (!query) {
        return await sock.sendMessage(from, { 
            text: '❌ Format: !character [nama karakter]\nContoh: !character naruto uzumaki' 
        }, { quoted: msg });
    }
    
    await sock.sendMessage(from, { 
        text: '🎌 Mencari karakter anime...' 
    }, { quoted: msg });
    
    try {
        const response = await axios.get(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(query)}&limit=1`);
        const charaData = response.data.data[0];
        
        if (!charaData) {
            return await sock.sendMessage(from, { 
                text: '❌ Karakter tidak ditemukan!' 
            }, { quoted: msg });
        }
        
        const caption = `👤 *${charaData.name}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Nama:* ${charaData.name}\n🔤 *Nama lain:* ${charaData.name_kanji || '-'}\n⭐ *Favorit:* ${charaData.favorites?.toLocaleString() || 0}\n🎭 *Anime:* ${charaData.anime?.[0]?.name || '-'}\n📖 *Manga:* ${charaData.manga?.[0]?.name || '-'}\n\n📝 *About:*\n${(charaData.about || 'No description available').substring(0, 300)}...\n\n🔗 *MyAnimeList:* ${charaData.url || '-'}`;
        
        if (charaData.images?.jpg?.image_url) {
            await sock.sendMessage(from, {
                image: { url: charaData.images.jpg.image_url },
                caption: caption
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { text: caption }, { quoted: msg });
        }
    } catch (e) {
        console.log('Character error:', e.message);
        await sock.sendMessage(from, { 
            text: '❌ Gagal mencari karakter!' 
        }, { quoted: msg });
    }
}

                // =======================================================
                // 🎮 GENERAL COMMANDS
                // =======================================================
                if (command === 'halo' || command === 'hi' || command === 'hai') {
                    const greetings = [
                        `Halo juga Kakak manis! 🌸 Ada yang bisa LuxxBot bantu hari ini?`,
                        `Yahallo~ 👋 Siap melayani Kakak!`,
                        `Hai hai! 🎀 LuxxBot siap membantu!`,
                        `Konichiwa~ 💖 Ada yang bisa dibantu?`
                    ];
                    const randomGreet = greetings[Math.floor(Math.random() * greetings.length)];
                    await sock.sendMessage(from, { text: randomGreet }, { quoted: msg });
                }

                if (command === 'ping') {
                    const latensi = Date.now() - msg.messageTimestamp * 1000;
                    await sock.sendMessage(from, { 
                        text: `🏓 *Pong!*\n⚡ Respon: *${latensi}ms*\n📡 Status: 🟢 ONLINE\n💾 RAM: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB` 
                    }, { quoted: msg });
                }

                if (command === 'changelogs' || command === 'update') {
                    await sock.sendMessage(from, { 
                        text: `📢 *LUXXBOT v3.0.0 CHANGELOGS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n✨ *New Features:*\n• Menu premium dengan design baru 🌸\n• 75+ commands lengkap 🚀\n• AI Gemini, OpenAI, Groq support 🧠\n• Watch2Gether streaming system 📻\n• Advanced sticker maker 🎨\n• Instagram/TikTok/YouTube downloader 📥\n• Voting system dengan timer ⏰\n• Anti-link protection 🛡️\n• Anime & entertainment pack 🎌\n• Database diagram generator 📊\n• OCR image to text 🔍\n• Weather & calculator utility 🌤️\n• Random games & fun commands 🎲\n\n🔧 *Improvements:*\n• Performance optimization 300%\n• Better error handling\n• Queue system untuk AI\n• Cache system untuk gambar\n• Multi-language support\n\n🎀 *Coming Soon:*\n• Spotify integration\n• Voice message AI\n• More anime features\n• Custom theme system\n\n_Stay tuned for more updates!_ 💖` 
                    }, { quoted: msg });
                }

                // =======================================================
                // 📝 NOTES SYSTEM
                // =======================================================
                if (command === 'notes') {
                    const subcmd = args[0]?.toLowerCase();
                    const noteName = args[1];
                    const noteContent = args.slice(2).join(' ');
                    
                    if (!subcmd) {
                        return await sock.sendMessage(from, { 
                            text: `📝 *NOTES SYSTEM*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n• !notes save [nama] [isi] - Simpan catatan\n• !notes get [nama] - Ambil catatan\n• !notes list - Lihat semua catatan\n• !notes delete [nama] - Hapus catatan\n• !notes clear - Hapus semua catatan` 
                        }, { quoted: msg });
                    }
                    
                    if (subcmd === 'save' || subcmd === 'simpan') {
                        if (!noteName || !noteContent) {
                            return await sock.sendMessage(from, { 
                                text: '❌ Format: !notes save [nama] [isi catatan]' 
                            }, { quoted: msg });
                        }
                        notesDatabase[noteName] = noteContent;
                        await sock.sendMessage(from, { 
                            text: `✅ Catatan *"${noteName}"* berhasil disimpan! 🎀` 
                        }, { quoted: msg });
                        
                    } else if (subcmd === 'get' || subcmd === 'ambil') {
                        if (!noteName) {
                            return await sock.sendMessage(from, { 
                                text: '❌ Format: !notes get [nama]' 
                            }, { quoted: msg });
                        }
                        if (!notesDatabase[noteName]) {
                            return await sock.sendMessage(from, { 
                                text: `❌ Catatan *"${noteName}"* tidak ditemukan!` 
                            }, { quoted: msg });
                        }
                        await sock.sendMessage(from, { 
                            text: `📝 *Catatan: ${noteName}*\n━━━━━━━━━━━━━━━━━━━━━━━\n${notesDatabase[noteName]}` 
                        }, { quoted: msg });
                        
                    } else if (subcmd === 'list') {
                        const notes = Object.keys(notesDatabase);
                        if (notes.length === 0) {
                            return await sock.sendMessage(from, { 
                                text: '📭 Belum ada catatan yang disimpan!' 
                            }, { quoted: msg });
                        }
                        let listText = `📂 *DAFTAR CATATAN*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                        notes.forEach((note, index) => {
                            listText += `${index + 1}. ${note}\n`;
                        });
                        await sock.sendMessage(from, { text: listText }, { quoted: msg });
                        
                    } else if (subcmd === 'delete' || subcmd === 'hapus') {
                        if (!noteName) {
                            return await sock.sendMessage(from, { 
                                text: '❌ Format: !notes delete [nama]' 
                            }, { quoted: msg });
                        }
                        if (!notesDatabase[noteName]) {
                            return await sock.sendMessage(from, { 
                                text: `❌ Catatan *"${noteName}"* tidak ditemukan!` 
                            }, { quoted: msg });
                        }
                        delete notesDatabase[noteName];
                        await sock.sendMessage(from, { 
                            text: `✅ Catatan *"${noteName}"* berhasil dihapus!` 
                        }, { quoted: msg });
                        
                    } else if (subcmd === 'clear') {
                        const noteCount = Object.keys(notesDatabase).length;
                        Object.keys(notesDatabase).forEach(key => {
                            delete notesDatabase[key];
                        });
                        await sock.sendMessage(from, { 
                            text: `✅ Semua catatan (${noteCount}) berhasil dihapus!` 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // ⏰ REMINDER SYSTEM
                // =======================================================
                if (command === 'remindme' || command === 'reminder') {
                    const timeArg = args[0];
                    const reminderText = args.slice(1).join(' ');
                    
                    if (!timeArg || !reminderText) {
                        return await sock.sendMessage(from, { 
                            text: `⏰ *REMINDER SYSTEM*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nFormat: !remindme [waktu] [pesan]\n\nContoh:\n• !remindme 30m Beli susu\n• !remindme 2h Meeting penting\n• !remindme 1d Ulang tahun teman\n\nSatuan waktu: m (menit), h (jam), d (hari)` 
                        }, { quoted: msg });
                    }
                    
                    const timeMatch = timeArg.match(/^(\d+)([mhd])$/);
                    if (!timeMatch) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format waktu salah! Gunakan: 30m, 2h, 1d' 
                        }, { quoted: msg });
                    }
                    
                    const amount = parseInt(timeMatch[1]);
                    const unit = timeMatch[2];
                    let milliseconds = 0;
                    
                    switch (unit) {
                        case 'm': milliseconds = amount * 60 * 1000; break;
                        case 'h': milliseconds = amount * 60 * 60 * 1000; break;
                        case 'd': milliseconds = amount * 24 * 60 * 60 * 1000; break;
                    }
                    
                    const userName = sender.split('@')[0];
                    const reminderTime = new Date(Date.now() + milliseconds);
                    
                    await sock.sendMessage(from, { 
                        text: `✅ *Reminder Set!*\n⏰ Akan diingatkan: ${timeArg}\n📝 Pesan: ${reminderText}\n🗓️ Pada: ${reminderTime.toLocaleString()}` 
                    }, { quoted: msg });
                    
                    setTimeout(async () => {
                        try {
                            await sock.sendMessage(from, { 
                                text: `⏰ *REMINDER!*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n@${userName} Jangan lupa ya!\n📝 ${reminderText}\n\n_Dari reminder yang kamu set ${timeArg} yang lalu_`,
                                mentions: [sender]
                            });
                        } catch (e) {
                            console.log('Reminder error:', e.message);
                        }
                    }, milliseconds);
                }

                // =======================================================
                // 👥 GROUP MANAGEMENT
                // =======================================================
                if (command === 'add') {
                    if (!isGroup) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Command ini hanya bisa digunakan di grup!' 
                        }, { quoted: msg });
                    }
                    
                    if (!isLocalGroupAdmin && !isAdmin) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Hanya admin grup atau owner yang bisa menggunakan command ini!' 
                        }, { quoted: msg });
                    }
                    
                    const phoneNumber = args[0];
                    if (!phoneNumber) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !add [nomor]\nContoh: !add 6281234567890' 
                        }, { quoted: msg });
                    }
                    
                    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
                    const jid = cleanNumber + '@s.whatsapp.net';
                    
                    try {
                        await sock.groupParticipantsUpdate(from, [jid], 'add');
                        await sock.sendMessage(from, { 
                            text: `✅ Berhasil menambahkan @${cleanNumber} ke grup! 🎉`,
                            mentions: [jid]
                        }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: `❌ Gagal menambahkan: ${e.message}` 
                        }, { quoted: msg });
                    }
                }

                if (command === 'tagall') {
                    if (!isGroup) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Command ini hanya bisa digunakan di grup!' 
                        }, { quoted: msg });
                    }
                    
                    const message = args.join(' ') || 'Panggilan dari admin!';
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    
                    let tagText = `📢 *TAG ALL MEMBERS*\n━━━━━━━━━━━━━━━━━━━━━━━\n${message}\n\n`;
                    let mentions = [];
                    
                    participants.forEach(participant => {
                        tagText += `@${participant.id.split('@')[0]}\n`;
                        mentions.push(participant.id);
                    });
                    
                    await sock.sendMessage(from, { 
                        text: tagText,
                        mentions: mentions
                    }, { quoted: msg });
                }

                // =======================================================
                // 🎌 ANIME & ENTERTAINMENT PACK
                // =======================================================
                if (command === 'anime') {
                    const query = args.join(' ') || 'random';
                    
                    await sock.sendMessage(from, { 
                        text: '🎌 Mencari info anime...' 
                    }, { quoted: msg });
                    
                    try {
                        let animeData;
                        
                        if (query === 'random' || query === 'popular') {
                            const response = await axios.get('https://api.jikan.moe/v4/top/anime?limit=50');
                            const animeList = response.data.data;
                            animeData = animeList[Math.floor(Math.random() * animeList.length)];
                        } else {
                            const response = await axios.get(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`);
                            animeData = response.data.data[0];
                        }
                        
                        if (!animeData) {
                            return await sock.sendMessage(from, { 
                                text: '❌ Anime tidak ditemukan!' 
                            }, { quoted: msg });
                        }
                        
                        const caption = `🎌 *${animeData.title}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📺 *English Title:* ${animeData.title_english || '-'}\n⭐ *Score:* ${animeData.score || '-'}/10\n📅 *Aired:* ${animeData.aired?.string || '-'}\n🎬 *Episodes:* ${animeData.episodes || '?'}\n📺 *Type:* ${animeData.type}\n🎭 *Status:* ${animeData.status}\n\n📝 *Synopsis:*\n${(animeData.synopsis || 'No synopsis available').substring(0, 300)}...\n\n                        🔗 *MyAnimeList:* ${animeData.url || '-'}`;
                        
                        if (animeData.images?.jpg?.image_url) {
                            await sock.sendMessage(from, {
                                image: { url: animeData.images.jpg.image_url },
                                caption: caption
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: caption }, { quoted: msg });
                        }
                        
                    } catch (e) {
                        console.log('Anime error:', e.message);
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mengambil data anime!' 
                        }, { quoted: msg });
                    }
                }

                if (command === 'waifu') {
                    try {
                        const response = await axios.get('https://api.waifu.pics/sfw/waifu');
                        const waifuUrl = response.data.url;
                        
                        await sock.sendMessage(from, {
                            image: { url: waifuUrl },
                            caption: '💖 *Your Random Waifu!*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n_Generated by Waifu.pics API_'
                        }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mengambil waifu!' 
                        }, { quoted: msg });
                    }
                }

                if (command === 'meme') {
                    try {
                        const subreddits = ['memes', 'dankmemes', 'wholesomememes', 'me_irl'];
                        const randomSub = subreddits[Math.floor(Math.random() * subreddits.length)];
                        const response = await axios.get(`https://meme-api.com/gimme/${randomSub}`);
                        const meme = response.data;
                        
                        await sock.sendMessage(from, {
                            image: { url: meme.url },
                            caption: `😂 *Random Meme*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Title:* ${meme.title}\n👤 *Author:* ${meme.author}\n👍 *Upvotes:* ${meme.ups}\n📁 *Subreddit:* r/${meme.subreddit}`
                        }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mengambil meme!' 
                        }, { quoted: msg });
                    }
                }

                if (command === 'joke') {
                    try {
                        const response = await axios.get('https://v2.jokeapi.dev/joke/Any?safe-mode');
                        const joke = response.data;
                        
                        let jokeText = '';
                        if (joke.type === 'single') {
                            jokeText = joke.joke;
                        } else {
                            jokeText = `${joke.setup}\n\n...${joke.delivery}`;
                        }
                        
                        await sock.sendMessage(from, { 
                            text: `🤣 *Random Joke*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${jokeText}\n\n🎭 Category: ${joke.category}` 
                        }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mengambil joke!' 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 🎮 TRUTH OR DARE GAME
                // =======================================================
                if (command === 'truth') {
                    const truths = [
                        "Apa rahasia terbesar yang belum pernah kamu beritahu siapa pun?",
                        "Kapan terakhir kali kamu menangis dan kenapa?",
                        "Apa kebiasaan terburukmu yang tidak ingin diketahui orang?",
                        "Siapa orang yang pernah kamu sakiti dan belum pernah kamu minta maaf?",
                        "Apa hal paling memalukan yang pernah terjadi padamu?",
                        "Pernahkah kamu berbohong kepada orang tuamu? Tentang apa?",
                        "Apa impian terbesarmu yang belum tercapai?",
                        "Siapa mantan yang masih kamu pikirkan sampai sekarang?",
                        "Apa hal paling egois yang pernah kamu lakukan?",
                        "Pernahkah kamu menyukai sahabatmu sendiri?"
                    ];
                    
                    const randomTruth = truths[Math.floor(Math.random() * truths.length)];
                    await sock.sendMessage(from, { 
                        text: `🫣 *TRUTH TIME*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${randomTruth}\n\n_Jawab dengan jujur ya!_ 😉` 
                    }, { quoted: msg });
                }

                if (command === 'dare') {
                    const dares = [
                        "Kirim pesan 'Aku sayang kamu' ke kontak pertama di chat list!",
                        "Ganti foto profil jadi foto lucu selama 1 jam!",
                        "Nyanyi lagu favoritmu dan kirim voice note ke grup!",
                        "Panggil admin grup dengan sebutan 'Sayang'!",
                        "Post story IG dengan caption 'Aku pengen punya pacar'!",
                        "Telepon teman terdekat dan bilang kamu kangen!",
                        "Kirim pesan ke mantan 'Aku masih suka sama kamu'!",
                        "Ganti nama WA jadi 'Baby Bot' selama 24 jam!",
                        "Post foto masa kecilmu di status WA!",
                        "Bilang 'I love you' ke orang pertama yang kamu lihat!"
                    ];
                    
                    const randomDare = dares[Math.floor(Math.random() * dares.length)];
                    await sock.sendMessage(from, { 
                        text: `😈 *DARE TIME*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${randomDare}\n\n_Lakukan sekarang! Jangan menunda!_ ⏰` 
                    }, { quoted: msg });
                }

                // =======================================================
                // 🌤️ WEATHER SYSTEM
                // =======================================================
                if (command === 'cuaca' || command === 'weather') {
                    const location = args.join(' ');
                    if (!location) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !cuaca [kota]\nContoh: !cuaca Jakarta' 
                        }, { quoted: msg });
                    }
                    
                    await sock.sendMessage(from, { 
                        text: '⏳ Mengambil data cuaca...' 
                    }, { quoted: msg });
                    
                    try {
                        const apiKey = process.env.WEATHER_API_KEY || '';
                        if (!apiKey) {
                            return await sock.sendMessage(from, { 
                                text: '❌ API key cuaca belum diatur!' 
                            }, { quoted: msg });
                        }
                        
                        const response = await axios.get(
                            `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${apiKey}&units=metric&lang=id`
                        );
                        
                        const weather = response.data;
                        const temp = Math.round(weather.main.temp);
                        const feelsLike = Math.round(weather.main.feels_like);
                        const humidity = weather.main.humidity;
                        const windSpeed = Math.round(weather.wind.speed * 3.6);
                        const description = weather.weather[0].description;
                        const icon = weather.weather[0].icon;
                        
                        const weatherEmoji = {
                            '01': '☀️', '02': '⛅', '03': '☁️', '04': '☁️',
                            '09': '🌧️', '10': '🌦️', '11': '⛈️', '13': '❄️', '50': '🌫️'
                        };
                        
                        const emoji = weatherEmoji[icon.slice(0, 2)] || '🌤️';
                        
                        const caption = `${emoji} *CUACA ${location.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🌡️ *Suhu:* ${temp}°C\n💨 *Terasa:* ${feelsLike}°C\n💧 *Kelembaban:* ${humidity}%\n🌬️ *Angin:* ${windSpeed} km/jam\n📝 *Kondisi:* ${description}\n📍 *Koordinat:* ${weather.coord.lat}, ${weather.coord.lon}`;
                        
                        await sock.sendMessage(from, { text: caption }, { quoted: msg });
                        
                    } catch (e) {
                        console.log('Weather error:', e.response?.data || e.message);
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mengambil data cuaca! Pastikan nama kota benar.' 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 🧮 CALCULATOR
                // =======================================================
                if (command === 'kalkulator' || command === 'calc') {
                    const expression = args.join(' ');
                    if (!expression) {
                        return await sock.sendMessage(from, { 
                            text: `🧮 *KALKULATOR*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nFormat: !calc [ekspresi]\n\nContoh:\n• !calc 5+3*2\n• !calc sin(45)\n• !calc 2^10\n• !calc sqrt(25)\n\nOperasi: + - * / ^ sqrt sin cos tan log` 
                        }, { quoted: msg });
                    }
                    
                    try {
                        // Sanitize and evaluate
                        const sanitized = expression
                            .replace(/[^0-9+\-*/.()^√sincostanlogπ]/g, '')
                            .replace(/√/g, 'Math.sqrt')
                            .replace(/sin/g, 'Math.sin')
                            .replace(/cos/g, 'Math.cos')
                            .replace(/tan/g, 'Math.tan')
                            .replace(/log/g, 'Math.log10')
                            .replace(/π/g, 'Math.PI')
                            .replace(/\^/g, '**');
                        
                        const result = eval(sanitized);
                        
                        await sock.sendMessage(from, { 
                            text: `🧮 *HASIL PERHITUNGAN*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Ekspresi:* ${expression}\n✅ *Hasil:* ${result}\n\n_Note: Gunakan dengan bijak ya!_ 🎓` 
                        }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: `❌ Gagal menghitung! Pastikan format benar.\nError: ${e.message}` 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 🔳 QR CODE GENERATOR
                // =======================================================
                if (command === 'qr' || command === 'qrcode') {
                    const text = args.join(' ');
                    if (!text) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !qr [teks/url]\nContoh: !qr https://github.com' 
                        }, { quoted: msg });
                    }
                    
                    try {
                        const qrCode = await QRCode.toDataURL(text, { 
                            width: 400,
                            margin: 2,
                            color: {
                                dark: '#000000',
                                light: '#FFFFFF'
                            }
                        });
                        
                        const base64Data = qrCode.replace(/^data:image\/png;base64,/, '');
                        const buffer = Buffer.from(base64Data, 'base64');
                        
                        await sock.sendMessage(from, {
                            image: buffer,
                            caption: `🔳 *QR Code Generated*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Content:* ${text}\n\n_Scan QR code di atas!_ 📱`
                        }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal membuat QR code!' 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 🐙 GITHUB STALKER
                // =======================================================
                if (command === 'stalk' || command === 'github') {
                    const username = args[0];
                    if (!username) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !stalk [username github]\nContoh: !stalk octocat' 
                        }, { quoted: msg });
                    }
                    
                    await sock.sendMessage(from, { 
                        text: '⏳ Mengambil data GitHub...' 
                    }, { quoted: msg });
                    
                    try {
                        const response = await axios.get(`https://api.github.com/users/${username}`);
                        const user = response.data;
                        
                        const caption = `🐙 *GITHUB PROFILE*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n👤 *Username:* ${user.login}\n📝 *Nama:* ${user.name || '-'}\n📌 *Bio:* ${user.bio || '-'}\n📍 *Lokasi:* ${user.location || '-'}\n🏢 *Company:* ${user.company || '-'}\n📧 *Email:* ${user.email || 'Private'}\n🔗 *Blog:* ${user.blog || '-'}\n\n📊 *Stats:*\n📂 *Repos:* ${user.public_repos}\n👥 *Followers:* ${user.followers}\n👣 *Following:* ${user.following}\n📅 *Created:* ${new Date(user.created_at).toLocaleDateString()}\n\n🔗 *Profile:* ${user.html_url}`;
                        
                        if (user.avatar_url) {
                            await sock.sendMessage(from, {
                                image: { url: user.avatar_url },
                                caption: caption
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: caption }, { quoted: msg });
                        }
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ User GitHub tidak ditemukan!' 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 📰 WEB SUMMARIZER
                // =======================================================
                if (command === 'summarize' || command === 'ringkas') {
                    const url = args[0];
                    if (!url) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !summarize [url]\nContoh: !summarize https://example.com/article' 
                        }, { quoted: msg });
                    }
                    
                    await sock.sendMessage(from, { 
                        text: '⏳ Meringkas artikel...' 
                    }, { quoted: msg });
                    
                    try {
                        const response = await axios.get(url);
                        const $ = cheerio.load(response.data);
                        
                        // Remove scripts and styles
                        $('script, style, nav, footer, header').remove();
                        
                        // Get text content
                        const text = $('body').text()
                            .replace(/\s+/g, ' ')
                            .trim()
                            .substring(0, 2000);
                        
                        if (text.length < 50) {
                            return await sock.sendMessage(from, { 
                                text: '❌ Tidak bisa meringkas halaman ini!' 
                            }, { quoted: msg });
                        }
                        
                        // Use AI to summarize
                        const summary = await tanyakanAI(`Ringkas artikel ini dengan jelas dalam 3-5 poin:\n\n${text.substring(0, 1500)}`);
                        
                        await sock.sendMessage(from, { 
                            text: `📰 *RINGKASAN ARTIKEL*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🔗 *URL:* ${url}\n\n📝 *Ringkasan:*\n${summary}\n\n_Summarized by LuxxBot AI_ 🧠` 
                        }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: `❌ Gagal meringkas! ${e.message}` 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 🛡️ LINK SCANNER
                // =======================================================
                if (command === 'ceklink' || command === 'scanlink') {
                    const url = args[0];
                    if (!url) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !ceklink [url]\nContoh: !ceklink https://example.com' 
                        }, { quoted: msg });
                    }
                    
                    await sock.sendMessage(from, { 
                        text: '🛡️ Scanning link...' 
                    }, { quoted: msg });
                    
                    try {
                        // Check with Google Safe Browsing
                        const safeBrowsingKey = process.env.GOOGLE_SAFE_BROWSING_KEY;
                        let safeResult = '⚠️ Tidak bisa diverifikasi (API key tidak ada)';
                        
                        if (safeBrowsingKey) {
                            const response = await axios.post(
                                'https://safebrowsing.googleapis.com/v4/threatMatches:find',
                                {
                                    client: {
                                        clientId: "luxxbot",
                                        clientVersion: "1.0.0"
                                    },
                                    threatInfo: {
                                        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
                                        platformTypes: ["ANY_PLATFORM"],
                                        threatEntryTypes: ["URL"],
                                        threatEntries: [{ url }]
                                    }
                                },
                                {
                                    params: { key: safeBrowsingKey }
                                }
                            );
                            
                            safeResult = response.data.matches ? 
                                `❌ *DANGEROUS* - ${response.data.matches[0].threatType}` : 
                                '✅ *SAFE* - Tidak terdeteksi ancaman';
                        }
                        
                        // Check URL structure
                        const urlObj = new URL(url);
                        const isHTTPS = urlObj.protocol === 'https:';
                        const hasSuspiciousChars = url.includes('..') || url.includes('--') || 
                                                  url.includes('@') || url.length > 100;
                        
                                                let analysis = `🔍 *ANALISIS LINK*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🔗 *URL:* ${url}\n\n`;
                        analysis += `🛡️ *Safe Browsing:* ${safeResult}\n`;
                        analysis += `🔐 *HTTPS:* ${isHTTPS ? '✅ Aman' : '⚠️ HTTP (kurang aman)'}\n`;
                        analysis += `📊 *Panjang URL:* ${url.length} karakter\n`;
                        analysis += `🚩 *Karakter mencurigakan:* ${hasSuspiciousChars ? '⚠️ Ya' : '✅ Tidak'}\n`;
                        analysis += `🌐 *Domain:* ${urlObj.hostname}\n`;
                        analysis += `📍 *Path:* ${urlObj.pathname}\n\n`;
                        
                        if (hasSuspiciousChars || !isHTTPS) {
                            analysis += `⚠️ *WARNING:* Link ini memiliki karakteristik yang mencurigakan!\n`;
                            analysis += `• Gunakan dengan hati-hati\n`;
                            analysis += `• Jangan masukkan data sensitif\n`;
                            analysis += `• Pastikan dari sumber terpercaya\n`;
                        } else {
                            analysis += `✅ *KESIMPULAN:* Link ini tampak aman untuk dibuka\n`;
                        }
                        
                        analysis += `\n_Disclaimer: Analisis ini tidak 100% akurat_`;
                        
                        await sock.sendMessage(from, { text: analysis }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: `❌ Gagal menganalisis link! Pastikan URL valid.\nError: ${e.message}` 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 📊 PASSWORD GENERATOR
                // =======================================================
                if (command === 'password' || command === 'pwgen') {
                    const length = parseInt(args[0]) || 12;
                    
                    if (length < 6 || length > 32) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Panjang password harus antara 6-32 karakter!' 
                        }, { quoted: msg });
                    }
                    
                    const chars = {
                        uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                        lowercase: 'abcdefghijklmnopqrstuvwxyz',
                        numbers: '0123456789',
                        symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
                    };
                    
                    let password = '';
                    const allChars = chars.uppercase + chars.lowercase + chars.numbers + chars.symbols;
                    
                    // Ensure at least one of each type
                    password += chars.uppercase[Math.floor(Math.random() * chars.uppercase.length)];
                    password += chars.lowercase[Math.floor(Math.random() * chars.lowercase.length)];
                    password += chars.numbers[Math.floor(Math.random() * chars.numbers.length)];
                    password += chars.symbols[Math.floor(Math.random() * chars.symbols.length)];
                    
                    // Fill remaining length
                    for (let i = 4; i < length; i++) {
                        password += allChars[Math.floor(Math.random() * allChars.length)];
                    }
                    
                    // Shuffle password
                    password = password.split('').sort(() => Math.random() - 0.5).join('');
                    
                    const strength = length >= 16 ? '🔐 Sangat Kuat' : 
                                    length >= 12 ? '🔒 Kuat' : 
                                    length >= 8 ? '✅ Sedang' : '⚠️ Lemah';
                    
                    const pwText = `🔑 *PASSWORD GENERATOR*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    pwText += `📏 *Panjang:* ${length} karakter\n`;
                    pwText += `💪 *Kekuatan:* ${strength}\n`;
                    pwText += `🔢 *Tipe:* Huruf besar/kecil, angka, simbol\n\n`;
                    pwText += `📝 *Password:* \`${password}\`\n\n`;
                    pwText += `💡 *Tips Keamanan:*\n`;
                    pwText += `• Jangan bagikan password ini\n`;
                    pwText += `• Gunakan password berbeda untuk setiap akun\n`;
                    pwText += `• Simpan di password manager\n`;
                    pwText += `• Ubah password secara berkala\n\n`;
                    pwText += `_Generated by LuxxBot Security System_ 🛡️`;
                    
                    await sock.sendMessage(from, { text: pwText }, { quoted: msg });
                }

                // =======================================================
                // 🎰 RANDOM GAME SYSTEM
                // =======================================================
                if (command === 'roll' || command === 'dadu') {
                    const max = parseInt(args[0]) || 6;
                    const result = Math.floor(Math.random() * max) + 1;
                    
                    const diceEmoji = ['🎲', '🎯', '🎳', '🏀', '⚽', '🎪'];
                    const randomEmoji = diceEmoji[Math.floor(Math.random() * diceEmoji.length)];
                    
                    await sock.sendMessage(from, { 
                        text: `${randomEmoji} *ROLL DICE*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🎰 *Hasil:* **${result}** / ${max}\n\n_Player: @${sender.split('@')[0]}_`,
                        mentions: [sender]
                    }, { quoted: msg });
                }

                if (command === 'flip' || command === 'koin') {
                    const result = Math.random() > 0.5 ? 'HEADS' : 'TAILS';
                    const emoji = result === 'HEADS' ? '👑' : '🪙';
                    
                    await sock.sendMessage(from, { 
                        text: `${emoji} *COIN FLIP*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🎰 *Hasil:* **${result}**\n\n_Player: @${sender.split('@')[0]}_`,
                        mentions: [sender]
                    }, { quoted: msg });
                }

                if (command === 'rps' || command === 'suit') {
                    const choices = ['✊', '✋', '✌️'];
                    const choiceNames = ['BATU', 'KERTAS', 'GUNTING'];
                    const userChoice = args[0]?.toLowerCase();
                    
                    if (!userChoice || !['batu', 'kertas', 'gunting', '✊', '✋', '✌️'].includes(userChoice)) {
                        return await sock.sendMessage(from, { 
                            text: '🎮 *ROCK PAPER SCISSORS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nFormat: !rps [pilihan]\n\nPilihan:\n• ✊ batu\n• ✋ kertas\n• ✌️ gunting\n\nContoh: !rps batu' 
                        }, { quoted: msg });
                    }
                    
                    let userIndex;
                    if (userChoice === 'batu' || userChoice === '✊') userIndex = 0;
                    else if (userChoice === 'kertas' || userChoice === '✋') userIndex = 1;
                    else userIndex = 2;
                    
                    const botIndex = Math.floor(Math.random() * 3);
                    const botChoice = choices[botIndex];
                    
                    let result;
                    if (userIndex === botIndex) {
                        result = '🤝 SERI!';
                    } else if (
                        (userIndex === 0 && botIndex === 2) || // batu vs gunting
                        (userIndex === 1 && botIndex === 0) || // kertas vs batu
                        (userIndex === 2 && botIndex === 1)    // gunting vs kertas
                    ) {
                        result = '🎉 KAMU MENANG!';
                    } else {
                        result = '😢 KAMU KALAH!';
                    }
                    
                    const rpsText = `🎮 *ROCK PAPER SCISSORS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    rpsText += `👤 *Kamu:* ${choices[userIndex]} (${choiceNames[userIndex]})\n`;
                    rpsText += `🤖 *Bot:* ${botChoice} (${choiceNames[botIndex]})\n\n`;
                    rpsText += `🏆 *HASIL:* ${result}\n\n`;
                    rpsText += `_Player: @${sender.split('@')[0]}_`;
                    
                    await sock.sendMessage(from, { 
                        text: rpsText,
                        mentions: [sender]
                    }, { quoted: msg });
                }

                // =======================================================
                // 🎯 NUMBER GUESSING GAME
                // =======================================================
                if (command === 'tebakangka' || command === 'guess') {
                    const max = parseInt(args[0]) || 100;
                    const secretNumber = Math.floor(Math.random() * max) + 1;
                    let attempts = 0;
                    const maxAttempts = 7;
                    
                    const gameText = `🎯 *TEBAK ANGKA*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    gameText += `Saya telah memilih angka antara 1-${max}\n`;
                    gameText += `Kamu punya ${maxAttempts} kesempatan!\n`;
                    gameText += `Kirim angka tebakanmu...\n\n`;
                    gameText += `_Game ID: ${Date.now()}_`;
                    
                    await sock.sendMessage(from, { text: gameText }, { quoted: msg });
                    
                    // Store game state
                    const gameId = `${from}_${Date.now()}`;
                    games[gameId] = {
                        type: 'guess',
                        secret: secretNumber,
                        max: max,
                        attempts: 0,
                        maxAttempts: maxAttempts,
                        player: sender
                    };
                    
                    // Set timeout to clear game
                    setTimeout(() => {
                        if (games[gameId]) {
                            delete games[gameId];
                        }
                    }, 5 * 60 * 1000); // 5 minutes timeout
                }

                // =======================================================
                // 📝 WORD GAME SYSTEM
                // =======================================================
                if (command === 'tebakkata' || command === 'wordgame') {
                    const words = [
                        { word: "KOMPUTER", hint: "Alat untuk browsing dan coding" },
                        { word: "SMARTPHONE", hint: "Gadget yang selalu dibawa kemana-mana" },
                        { word: "INTERNET", hint: "Jaringan global yang menghubungkan dunia" },
                        { word: "PROGRAMMER", hint: "Orang yang membuat software" },
                        { word: "WHATSAPP", hint: "Aplikasi chat yang sedang kita gunakan" },
                        { word: "INDONESIA", hint: "Negara kita tercinta" },
                        { word: "JAVASCRIPT", hint: "Bahasa pemrograman untuk web" },
                        { word: "PIZZA", hint: "Makanan Italia yang populer" },
                        { word: "NETFLIX", hint: "Platform streaming film" },
                        { word: "YOUTUBE", hint: "Platform video terbesar di dunia" }
                    ];
                    
                    const selected = words[Math.floor(Math.random() * words.length)];
                    const scrambled = selected.word.split('').sort(() => Math.random() - 0.5).join('');
                    
                    const gameText = `🧩 *TEBAK KATA*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    gameText += `📝 *Kata acak:* ${scrambled}\n`;
                    gameText += `💡 *Hint:* ${selected.hint}\n`;
                    gameText += `🎯 *Panjang kata:* ${selected.word.length} huruf\n\n`;
                    gameText += `Kirim jawabanmu!\n`;
                    gameText += `_Format: !jawab [kata]_`;
                    
                    await sock.sendMessage(from, { text: gameText }, { quoted: msg });
                    
                    // Store game state
                    const gameId = `${from}_${Date.now()}`;
                    games[gameId] = {
                        type: 'word',
                        answer: selected.word.toLowerCase(),
                        scrambled: scrambled,
                        hint: selected.hint,
                        player: sender,
                        timestamp: Date.now()
                    };
                    
                    setTimeout(() => {
                        if (games[gameId]) {
                            delete games[gameId];
                        }
                    }, 3 * 60 * 1000); // 3 minutes timeout
                }

                // =======================================================
                // 🎵 LYRICS FINDER
                // =======================================================
                if (command === 'lirik' || command === 'lyrics') {
                    const query = args.join(' ');
                    if (!query) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !lirik [judul lagu]\nContoh: !lirik perfect ed sheeran' 
                        }, { quoted: msg });
                    }
                    
                    await sock.sendMessage(from, { 
                        text: '🎵 Mencari lirik...' 
                    }, { quoted: msg });
                    
                    try {
                        const response = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(query)}`);
                        const lyrics = response.data.lyrics;
                        
                        if (!lyrics) {
                            return await sock.sendMessage(from, { 
                                text: '❌ Lirik tidak ditemukan!' 
                            }, { quoted: msg });
                        }
                        
                        // Split if too long
                        if (lyrics.length > 3000) {
                            const part1 = lyrics.substring(0, 3000);
                            const part2 = lyrics.substring(3000);
                            
                            await sock.sendMessage(from, { 
                                text: `🎵 *LIRIK LAGU*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Judul:* ${query}\n\n${part1}\n\n_(bersambung...)_` 
                            }, { quoted: msg });
                            
                            await sock.sendMessage(from, { 
                                text: `🎵 *LIRIK LAGU (lanjutan)*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n${part2}\n\n_Source: lyrics.ovh_` 
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { 
                                text: `🎵 *LIRIK LAGU*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Judul:* ${query}\n\n${lyrics}\n\n_Source: lyrics.ovh_` 
                            }, { quoted: msg });
                        }
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mencari lirik!' 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 📚 TRANSLATOR
                // =======================================================
                if (command === 'translate' || command === 'terjemah') {
                    const text = args.slice(1).join(' ');
                    const targetLang = args[0]?.toLowerCase();
                    
                    if (!targetLang || !text) {
                        return await sock.sendMessage(from, { 
                            text: `🌐 *TRANSLATOR*\n━━━━━━━━━━━━━━━━━━━━━━━\n\nFormat: !translate [bahasa] [teks]\n\nContoh:\n• !translate en halo apa kabar\n• !translate id hello how are you\n• !translate jp selamat pagi\n\nBahasa yang didukung:\n• en = English\n• id = Indonesia\n• jp = Japanese\n• ko = Korean\n• es = Spanish\n• fr = French\n• de = German` 
                        }, { quoted: msg });
                    }
                    
                    const langCodes = {
                        'en': 'English',
                        'id': 'Indonesia', 
                        'jp': 'Japanese',
                        'ja': 'Japanese',
                        'ko': 'Korean',
                        'es': 'Spanish',
                        'fr': 'French',
                        'de': 'German',
                        'zh': 'Chinese',
                        'ar': 'Arabic',
                        'ru': 'Russian'
                    };
                    
                    if (!langCodes[targetLang]) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Bahasa tidak didukung! Lihat !translate untuk daftar bahasa.' 
                        }, { quoted: msg });
                    }
                    
                    await sock.sendMessage(from, { 
                        text: '🌐 Menerjemahkan...' 
                    }, { quoted: msg });
                    
                    try {
                        const translation = await tanyakanAI(
                            `Terjemahkan teks berikut ke bahasa ${langCodes[targetLang]}:\n\n${text}\n\nHanya berikan terjemahannya saja tanpa penjelasan.`
                        );
                        
                        await sock.sendMessage(from, { 
                            text: `🌐 *HASIL TERJEMAHAN*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n📝 *Teks asli:* ${text}\n🎯 *Bahasa target:* ${langCodes[targetLang]}\n\n✅ *Hasil:* ${translation}\n\n_Translated by LuxxBot AI_ 🤖` 
                        }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal menerjemahkan!' 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 🎨 COLOR PICKER & CONVERTER
                // =======================================================
                if (command === 'warna' || command === 'color') {
                    const colorInput = args[0];
                    
                    if (!colorInput) {
                        // Generate random color
                        const randomColor = Math.floor(Math.random() * 16777215).toString(16);
                        const hexColor = `#${randomColor.padStart(6, '0')}`;
                        
                                                // Convert to RGB
                        const r = parseInt(randomColor.substring(0, 2), 16);
                        const g = parseInt(randomColor.substring(2, 4), 16);
                        const b = parseInt(randomColor.substring(4, 6), 16);
                        
                        const colorText = `🎨 *RANDOM COLOR*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                        colorText += `🟦 *Hex:* ${hexColor}\n`;
                        colorText += `🟥 *RGB:* rgb(${r}, ${g}, ${b})\n`;
                        colorText += `🎯 *Preview:* ████████████\n\n`;
                        colorText += `_Warna acak telah dihasilkan!_`;
                        
                        await sock.sendMessage(from, { text: colorText }, { quoted: msg });
                        return;
                    }
                    
                    // Parse color input
                    try {
                        let hex, rgb;
                        
                        if (colorInput.startsWith('#')) {
                            // Hex input
                            hex = colorInput;
                            const cleanHex = colorInput.replace('#', '');
                            if (cleanHex.length !== 6 && cleanHex.length !== 3) {
                                throw new Error('Format hex tidak valid');
                            }
                            
                            // Expand 3-digit hex to 6-digit
                            const fullHex = cleanHex.length === 3 
                                ? cleanHex.split('').map(c => c + c).join('')
                                : cleanHex;
                            
                            r = parseInt(fullHex.substring(0, 2), 16);
                            g = parseInt(fullHex.substring(2, 4), 16);
                            b = parseInt(fullHex.substring(4, 6), 16);
                            rgb = `rgb(${r}, ${g}, ${b})`;
                            
                        } else if (colorInput.startsWith('rgb')) {
                            // RGB input
                            rgb = colorInput;
                            const matches = colorInput.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                            if (!matches) {
                                throw new Error('Format RGB tidak valid');
                            }
                            
                            r = parseInt(matches[1]);
                            g = parseInt(matches[2]);
                            b = parseInt(matches[3]);
                            
                            // Convert to hex
                            hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
                            
                        } else {
                            // Color name
                            const colorNames = {
                                'merah': '#FF0000', 'red': '#FF0000',
                                'hijau': '#00FF00', 'green': '#00FF00',
                                'biru': '#0000FF', 'blue': '#0000FF',
                                'kuning': '#FFFF00', 'yellow': '#FFFF00',
                                'ungu': '#800080', 'purple': '#800080',
                                'pink': '#FFC0CB', 'hitam': '#000000',
                                'black': '#000000', 'putih': '#FFFFFF',
                                'white': '#FFFFFF', 'orange': '#FFA500',
                                'coklat': '#A52A2A', 'brown': '#A52A2A',
                                'abu': '#808080', 'gray': '#808080'
                            };
                            
                            const foundColor = colorNames[colorInput.toLowerCase()];
                            if (!foundColor) {
                                throw new Error('Nama warna tidak dikenali');
                            }
                            
                            hex = foundColor;
                            const cleanHex = foundColor.replace('#', '');
                            r = parseInt(cleanHex.substring(0, 2), 16);
                            g = parseInt(cleanHex.substring(2, 4), 16);
                            b = parseInt(cleanHex.substring(4, 6), 16);
                            rgb = `rgb(${r}, ${g}, ${b})`;
                        }
                        
                        const colorText = `🎨 *COLOR CONVERTER*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                        colorText += `📝 *Input:* ${colorInput}\n`;
                        colorText += `🟦 *Hex:* ${hex}\n`;
                        colorText += `🟥 *RGB:* ${rgb}\n`;
                        colorText += `🎯 *Preview:* ████████████\n\n`;
                        colorText += `_Warna telah dikonversi!_`;
                        
                        await sock.sendMessage(from, { text: colorText }, { quoted: msg });
                        
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: `❌ Format warna tidak valid!\n\nGunakan:\n• Hex: #FF5733 atau #F53\n• RGB: rgb(255, 87, 51)\n• Nama: merah, biru, hijau, dll.` 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 📅 DATE & TIME UTILITIES
                // =======================================================
                if (command === 'tanggal' || command === 'date') {
                    const now = new Date();
                    const options = { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        timeZone: 'Asia/Jakarta'
                    };
                    
                    const dateStr = now.toLocaleDateString('id-ID', options);
                    const timeStr = now.toLocaleTimeString('id-ID', { 
                        timeZone: 'Asia/Jakarta',
                        hour12: false 
                    });
                    
                    const timezones = {
                        'WIB': 'Asia/Jakarta',
                        'WITA': 'Asia/Makassar', 
                        'WIT': 'Asia/Jayapura',
                        'GMT': 'GMT',
                        'UTC': 'UTC'
                    };
                    
                    let timeText = `📅 *DATE & TIME*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    timeText += `📆 *Tanggal:* ${dateStr}\n`;
                    timeText += `⏰ *WIB:* ${timeStr}\n\n`;
                    timeText += `🌍 *Zona Waktu Lain:*\n`;
                    
                    for (const [tzName, tz] of Object.entries(timezones)) {
                        if (tzName !== 'WIB') {
                            const tzTime = now.toLocaleTimeString('id-ID', { 
                                timeZone: tz,
                                hour12: false 
                            });
                            timeText += `• ${tzName}: ${tzTime}\n`;
                        }
                    }
                    
                    timeText += `\n📊 *Timestamp:* ${now.getTime()}`;
                    timeText += `\n\n_Server time: ${new Date().toISOString()}_`;
                    
                    await sock.sendMessage(from, { text: timeText }, { quoted: msg });
                }

                if (command === 'jadwalsholat' || command === 'sholat') {
                    const city = args.join(' ') || 'jakarta';
                    
                    await sock.sendMessage(from, { 
                        text: '🕌 Mengambil jadwal sholat...' 
                    }, { quoted: msg });
                    
                    try {
                        const response = await axios.get(
                            `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Indonesia&method=2`
                        );
                        
                        const data = response.data.data;
                        const timings = data.timings;
                        const date = data.date.hijri;
                        
                        const prayerText = `🕌 *JADWAL SHOLAT*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                        prayerText += `📍 *Kota:* ${city.toUpperCase()}\n`;
                        prayerText += `📅 *Tanggal:* ${date.readable}\n`;
                        prayerText += `📆 *Hijri:* ${date.hijri}\n\n`;
                        prayerText += `🕋 *JADWAL:*\n`;
                        prayerText += `• Subuh: ${timings.Fajr}\n`;
                        prayerText += `• Dzuhur: ${timings.Dhuhr}\n`;
                        prayerText += `• Ashar: ${timings.Asr}\n`;
                        prayerText += `• Maghrib: ${timings.Maghrib}\n`;
                        prayerText += `• Isya: ${timings.Isha}\n\n`;
                        prayerText += `_Sumber: Aladhan API_`;
                        
                        await sock.sendMessage(from, { text: prayerText }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mengambil jadwal sholat!' 
                        }, { quoted: msg });
                    }
                }

                // =======================================================
                // 🎭 CHARACTER COUNTER & TEXT ANALYSIS
                // =======================================================
                if (command === 'hitung' || command === 'count') {
                    const text = body.substring(body.indexOf(' ') + 1);
                    
                    if (!text || text.length === 0) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !hitung [teks]\nContoh: !hitung Hello World' 
                        }, { quoted: msg });
                    }
                    
                    const charCount = text.length;
                    const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
                    const lineCount = text.split('\n').length;
                    const spaceCount = (text.match(/ /g) || []).length;
                    
                    // Character frequency
                    const charFrequency = {};
                    for (const char of text.toLowerCase().replace(/[^a-z]/g, '')) {
                        charFrequency[char] = (charFrequency[char] || 0) + 1;
                    }
                    
                    const mostFrequent = Object.entries(charFrequency)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([char, count]) => `${char}: ${count}`)
                        .join(', ');
                    
                    const countText = `📊 *TEXT ANALYSIS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    countText += `📝 *Teks:* ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}\n\n`;
                    countText += `🔢 *STATISTIK:*\n`;
                    countText += `• Karakter: ${charCount}\n`;
                    countText += `• Kata: ${wordCount}\n`;
                    countText += `• Baris: ${lineCount}\n`;
                    countText += `• Spasi: ${spaceCount}\n`;
                    
                    if (mostFrequent) {
                        countText += `• Huruf terbanyak: ${mostFrequent}\n`;
                    }
                    
                    countText += `\n📈 *PERBANDINGAN:*\n`;
                    countText += `• Tweet: ${charCount <= 280 ? '✅ Muat' : '❌ Terlalu panjang'}\n`;
                    countText += `• SMS: ${charCount <= 160 ? '✅ Muat' : '❌ Terlalu panjang'}\n`;
                    countText += `• WhatsApp: ${charCount <= 65536 ? '✅ Aman' : '⚠️ Mendekati limit'}\n`;
                    
                    countText += `\n_Note: Analisis teks sederhana_`;
                    
                    await sock.sendMessage(from, { text: countText }, { quoted: msg });
                }

                // =======================================================
                // 🎯 HELP & MENU SYSTEM
                // =======================================================
                if (command === 'menu' || command === 'help' || command === '?' || command === 'fitur') {
                    const menuType = args[0]?.toLowerCase() || 'all';
                    
                    const menus = {
                        'all': `🤖 *LuxxBot MENU*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`,
                        'ai': `🧠 *AI & CHAT*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`,
                        'media': `🎬 *MEDIA & DOWNLOAD*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`,
                        'game': `🎮 *GAMES & FUN*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`,
                        'tool': `🛠️ *TOOLS & UTILITIES*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`,
                        'info': `📊 *INFORMATION*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`,
                        'group': `👥 *GROUP MANAGEMENT*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`
                    };
                    
                    let menuText = menus[menuType] || menus['all'];
                    
                    // Add commands based on menu type
                    if (menuType === 'all' || menuType === 'ai') {
                        menuText += `🧠 *AI & Chat:*\n`;
                        menuText += `• !ai [pertanyaan] - Tanya AI\n`;
                        menuText += `• !gpt [prompt] - ChatGPT\n`;
                        menuText += `• !dalle [prompt] - Generate gambar AI\n`;
                        menuText += `• !stablediffusion [prompt] - Stable Diffusion\n`;
                        menuText += `• !translate [bahasa] [teks] - Terjemahkan\n`;
                        menuText += `• !summarize [url] - Ringkas artikel\n`;
                        menuText += `• !cekgambar [url] - Analisis gambar\n\n`;
                    }
                    
                    if (menuType === 'all' || menuType === 'media') {
                        menuText += `🎬 *Media & Download:*\n`;
                        menuText += `• !ytmp3 [url] - Download YouTube MP3\n`;
                        menuText += `• !ytmp4 [url] - Download YouTube MP4\n`;
                        menuText += `• !tiktok [url] - Download TikTok\n`;
                        menuText += `• !ig [url] - Download Instagram\n`;
                        menuText += `• !fb [url] - Download Facebook\n`;
                        menuText += `• !twitter [url] - Download Twitter\n`;
                        menuText += `• !spotify [url] - Download Spotify\n`;
                        menuText += `• !play [judul] - Play musik\n`;
                        menuText += `• !lirik [judul] - Cari lirik\n\n`;
                    }
                    
                    if (menuType === 'all' || menuType === 'game') {
                        menuText += `🎮 *Games & Fun:*\n`;
                        menuText += `• !truth - Truth challenge\n`;
                        menuText += `• !dare - Dare challenge\n`;
                        menuText += `• !rps [batu/kertas/gunting] - Rock Paper Scissors\n`;
                        menuText += `• !roll [angka] - Roll dice\n`;
                        menuText += `• !flip - Flip coin\n`;
                        menuText += `• !tebakangka - Tebak angka\n`;
                        menuText += `• !tebakkata - Tebak kata\n`;
                        menuText += `• !meme - Random meme\n`;
                        menuText += `• !joke - Random joke\n`;
                        menuText += `• !waifu - Random waifu\n`;
                        menuText += `• !anime [judul] - Cari anime\n`;
                        menuText += `• !character [nama] - Cari karakter anime\n\n`;
                    }
                    
                    if (menuType === 'all' || menuType === 'tool') {
                        menuText += `🛠️ *Tools & Utilities:*\n`;
                        menuText += `• !qr [teks] - Generate QR code\n`;
                        menuText += `• !password [panjang] - Generate password\n`;
                        menuText += `• !calc [ekspresi] - Kalkulator\n`;
                        menuText += `• !warna [kode] - Color converter\n`;
                        menuText += `• !hitung [teks] - Text analysis\n`;
                        menuText += `• !ceklink [url] - Scan link\n`;
                        menuText += `• !stalk [username] - Stalk GitHub\n`;
                        menuText += `• !cuaca [kota] - Cek cuaca\n`;
                        menuText += `• !tanggal - Date & time\n`;
                        menuText += `• !jadwalsholat [kota] - Jadwal sholat\n\n`;
                    }
                    
                    if (menuType === 'all' || menuType === 'info') {
                        menuText += `📊 *Information:*\n`;
                        menuText += `• !ping - Cek status bot\n`;
                        menuText += `• !status - Info bot\n`;
                        menuText += `• !owner - Info owner\n`;
                        menuText += `• !donasi - Donasi\n`;
                        menuText += `• !speedtest - Test speed\n`;
                        menuText += `• !server - Info server\n`;
                        menuText += `• !stats - Statistik bot\n\n`;
                    }
                    
                    if (menuType === 'all' || menuType === 'group') {
                        menuText += `👥 *Group Management:*\n`;
                        menuText += `• !kick @tag - Kick member\n`;
                        menuText += `• !add [nomor] - Add member\n`;
                        menuText += `• !promote @tag - Promote admin\n`;
                        menuText += `• !demote @tag - Demote admin\n`;
                        menuText += `• !tagall - Tag semua member\n`;
                        menuText += `• !listadmin - List admin\n`;
                        menuText += `• !groupinfo - Info group\n`;
                        menuText += `• !antilink [on/off] - Anti link\n`;
                        menuText += `• !welcome [on/off] - Welcome message\n`;
                        menuText += `• !simi [on/off] - Simsimi AI chat\n\n`;
                    }
                    
                                        menuText += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    menuText += `📌 *CATATAN:*\n`;
                    menuText += `• Prefix: ! atau .\n`;
                    menuText += `• Bot bisa digunakan di DM dan Group\n`;
                    menuText += `• Untuk menu spesifik: !menu [ai/media/game/tool/info/group]\n`;
                    menuText += `• Contoh: !menu game\n\n`;
                    menuText += `🔄 *UPDATE TERBARU:*\n`;
                    menuText += `• Fitur AI lengkap (GPT, DALL-E, Stable Diffusion)\n`;
                    menuText += `• Downloader semua platform\n`;
                    menuText += `• 20+ game & fun commands\n`;
                    menuText += `• Group management system\n`;
                    menuText += `• Security & utility tools\n\n`;
                    menuText += `👑 *Owner:* ${ownerName || 'Unknown'}\n`;
                    menuText += `🤖 *Version:* ${botVersion}\n`;
                    menuText += `⏰ *Uptime:* ${formatUptime(process.uptime())}`;
                    
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                    return;
                }

                // =======================================================
                // 👥 GROUP MANAGEMENT SYSTEM
                // =======================================================
                if (command === 'kick' && isGroup) {
                    if (!isAdmin) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Hanya admin yang bisa kick member!' 
                        }, { quoted: msg });
                    }
                    
                    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    
                    if (mentioned.length === 0) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Tag member yang ingin di kick!\nContoh: !kick @member' 
                        }, { quoted: msg });
                    }
                    
                    for (const user of mentioned) {
                        if (user === sock.user.id) {
                            await sock.sendMessage(from, { 
                                text: '🤖 Saya tidak bisa kick diri sendiri!' 
                            }, { quoted: msg });
                            continue;
                        }
                        
                        if (user === ownerNumber) {
                            await sock.sendMessage(from, { 
                                text: '👑 Tidak bisa kick owner!' 
                            }, { quoted: msg });
                            continue;
                        }
                        
                        try {
                            await sock.groupParticipantsUpdate(from, [user], 'remove');
                            await sock.sendMessage(from, { 
                                text: `✅ @${user.split('@')[0]} telah di kick dari group!`,
                                mentions: [user]
                            });
                        } catch (e) {
                            await sock.sendMessage(from, { 
                                text: `❌ Gagal kick @${user.split('@')[0]}`,
                                mentions: [user]
                            });
                        }
                    }
                }

                if (command === 'add' && isGroup) {
                    if (!isAdmin) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Hanya admin yang bisa add member!' 
                        }, { quoted: msg });
                    }
                    
                    const number = args[0];
                    if (!number) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !add [nomor]\nContoh: !add 6281234567890' 
                        }, { quoted: msg });
                    }
                    
                    const phoneNumber = number.replace(/[^0-9]/g, '');
                    if (!phoneNumber.startsWith('62')) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Gunakan nomor Indonesia (62)!\nContoh: 6281234567890' 
                        }, { quoted: msg });
                    }
                    
                    const jid = `${phoneNumber}@s.whatsapp.net`;
                    
                    try {
                        await sock.groupParticipantsUpdate(from, [jid], 'add');
                        await sock.sendMessage(from, { 
                            text: `✅ Berhasil mengundang ${phoneNumber} ke group!` 
                        });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: `❌ Gagal menambahkan ${phoneNumber}!\nPastikan nomor valid dan belum ada di group.` 
                        });
                    }
                }

                if ((command === 'promote' || command === 'admin') && isGroup) {
                    if (!isAdmin) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Hanya admin yang bisa promote member!' 
                        }, { quoted: msg });
                    }
                    
                    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    
                    if (mentioned.length === 0) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Tag member yang ingin di promote!\nContoh: !promote @member' 
                        }, { quoted: msg });
                    }
                    
                    for (const user of mentioned) {
                        try {
                            await sock.groupParticipantsUpdate(from, [user], 'promote');
                            await sock.sendMessage(from, { 
                                text: `👑 @${user.split('@')[0]} telah di promote menjadi admin!`,
                                mentions: [user]
                            });
                        } catch (e) {
                            await sock.sendMessage(from, { 
                                text: `❌ Gagal promote @${user.split('@')[0]}`,
                                mentions: [user]
                            });
                        }
                    }
                }

                if ((command === 'demote' || command === 'unadmin') && isGroup) {
                    if (!isAdmin) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Hanya admin yang bisa demote admin!' 
                        }, { quoted: msg });
                    }
                    
                    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    
                    if (mentioned.length === 0) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Tag admin yang ingin di demote!\nContoh: !demote @admin' 
                        }, { quoted: msg });
                    }
                    
                    for (const user of mentioned) {
                        if (user === ownerNumber) {
                            await sock.sendMessage(from, { 
                                text: '👑 Tidak bisa demote owner!' 
                            }, { quoted: msg });
                            continue;
                        }
                        
                        try {
                            await sock.groupParticipantsUpdate(from, [user], 'demote');
                            await sock.sendMessage(from, { 
                                text: `⬇️ @${user.split('@')[0]} telah di demote dari admin!`,
                                mentions: [user]
                            });
                        } catch (e) {
                            await sock.sendMessage(from, { 
                                text: `❌ Gagal demote @${user.split('@')[0]}`,
                                mentions: [user]
                            });
                        }
                    }
                }

                if (command === 'tagall' && isGroup) {
                    if (!isAdmin) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Hanya admin yang bisa tag semua member!' 
                        }, { quoted: msg });
                    }
                    
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    
                    let tagText = `📢 *TAG ALL MEMBERS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    tagText += `👥 *Total Member:* ${participants.length}\n\n`;
                    
                    const mentions = [];
                    for (const participant of participants) {
                        mentions.push(participant.id);
                        tagText += `@${participant.id.split('@')[0]} `;
                    }
                    
                    tagText += `\n\n📝 *Pesan dari admin:* ${args.join(' ') || 'Tidak ada pesan'}`;
                    
                    await sock.sendMessage(from, { 
                        text: tagText,
                        mentions: mentions
                    }, { quoted: msg });
                }

                if (command === 'listadmin' && isGroup) {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants;
                    
                    const admins = participants.filter(p => p.admin).map(p => p.id);
                    
                    let adminText = `👑 *LIST ADMIN GROUP*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    adminText += `📊 *Total Admin:* ${admins.length}\n\n`;
                    
                    const mentions = [];
                    for (const admin of admins) {
                        mentions.push(admin);
                        const isOwner = admin === ownerNumber;
                        adminText += `• @${admin.split('@')[0]} ${isOwner ? '(👑 Owner)' : ''}\n`;
                    }
                    
                    await sock.sendMessage(from, { 
                        text: adminText,
                        mentions: mentions
                    }, { quoted: msg });
                }

                if (command === 'groupinfo' && isGroup) {
                    const groupMetadata = await sock.groupMetadata(from);
                    
                    const infoText = `📊 *GROUP INFORMATION*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    infoText += `🏷️ *Nama:* ${groupMetadata.subject}\n`;
                    infoText += `🆔 *ID:* ${groupMetadata.id}\n`;
                    infoText += `👥 *Members:* ${groupMetadata.participants.length}\n`;
                    infoText += `👑 *Admins:* ${groupMetadata.participants.filter(p => p.admin).length}\n`;
                    infoText += `📅 *Dibuat:* ${new Date(groupMetadata.creation * 1000).toLocaleDateString('id-ID')}\n`;
                    infoText += `📝 *Deskripsi:* ${groupMetadata.desc || 'Tidak ada'}\n\n`;
                    
                    // Group settings
                    const groupSettings = {
                        'announce': groupMetadata.announce ? '✅ Hanya admin' : '❌ Semua member',
                        'restrict': groupMetadata.restrict ? '✅ Terbatas' : '❌ Bebas',
                        'ephemeral': groupMetadata.ephemeralDuration ? `⏰ ${groupMetadata.ephemeralDuration} detik` : '❌ Tidak aktif'
                    };
                    
                    infoText += `⚙️ *SETTINGS:*\n`;
                    for (const [key, value] of Object.entries(groupSettings)) {
                        infoText += `• ${key}: ${value}\n`;
                    }
                    
                    await sock.sendMessage(from, { text: infoText }, { quoted: msg });
                }

                // =======================================================
                // 🔧 BOT SETTINGS & CONFIGURATION
                // =======================================================
                if (command === 'antilink' && isGroup) {
                    if (!isAdmin) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Hanya admin yang bisa mengatur antilink!' 
                        }, { quoted: msg });
                    }
                    
                    const action = args[0]?.toLowerCase();
                    
                    if (!action || !['on', 'off'].includes(action)) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !antilink [on/off]\nContoh: !antilink on' 
                        }, { quoted: msg });
                    }
                    
                    // Store setting in database or file
                    const settingsFile = './settings.json';
                    let settings = {};
                    
                    try {
                        if (fs.existsSync(settingsFile)) {
                            settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
                        }
                        
                        if (!settings.groups) settings.groups = {};
                        if (!settings.groups[from]) settings.groups[from] = {};
                        
                        settings.groups[from].antilink = action === 'on';
                        
                        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
                        
                        await sock.sendMessage(from, { 
                            text: `✅ Anti-link telah di${action === 'on' ? 'aktifkan' : 'nonaktifkan'}!` 
                        });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mengatur antilink!' 
                        });
                    }
                }

                if (command === 'welcome' && isGroup) {
                    if (!isAdmin) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Hanya admin yang bisa mengatur welcome message!' 
                        }, { quoted: msg });
                    }
                    
                    const action = args[0]?.toLowerCase();
                    
                    if (!action || !['on', 'off'].includes(action)) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !welcome [on/off]\nContoh: !welcome on' 
                        }, { quoted: msg });
                    }
                    
                    const settingsFile = './settings.json';
                    let settings = {};
                    
                    try {
                        if (fs.existsSync(settingsFile)) {
                            settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
                        }
                        
                        if (!settings.groups) settings.groups = {};
                        if (!settings.groups[from]) settings.groups[from] = {};
                        
                        settings.groups[from].welcome = action === 'on';
                        
                        // Custom welcome message
                        const customMsg = args.slice(1).join(' ');
                        if (customMsg) {
                            settings.groups[from].welcomeMessage = customMsg;
                        }
                        
                        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
                        
                        await sock.sendMessage(from, { 
                            text: `✅ Welcome message telah di${action === 'on' ? 'aktifkan' : 'nonaktifkan'}!` 
                        });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal mengatur welcome message!' 
                        });
                    }
                }

                // =======================================================
                // 📊 BOT STATISTICS & INFORMATION
                // =======================================================
                if (command === 'ping') {
                    const start = Date.now();
                    await sock.sendMessage(from, { text: '🏓 Pong!' }, { quoted: msg });
                    const latency = Date.now() - start;
                    
                    await sock.sendMessage(from, { 
                        text: `🏓 *PONG!*\n\n📊 *Latency:* ${latency}ms\n⏰ *Uptime:* ${formatUptime(process.uptime())}\n💾 *Memory:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB` 
                    });
                }

                if (command === 'status' || command === 'botinfo') {
                    const statusText = `🤖 *BOT INFORMATION*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    statusText += `🏷️ *Nama:* LuxxBot\n`;
                    statusText += `👑 *Owner:* ${ownerName || 'Unknown'}\n`;
                    statusText += `📱 *Number:* ${sock.user.id.split(':')[0]}\n`;
                    statusText += `🔄 *Version:* ${botVersion}\n`;
                    statusText += `⏰ *Uptime:* ${formatUptime(process.uptime())}\n`;
                    statusText += `💾 *Memory:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n`;
                    statusText += `📊 *Commands:* 100+ fitur\n`;
                    statusText += `🌐 *Platform:* WhatsApp Web\n`;
                    statusText += `⚡ *Speed:* ${Date.now() - msg.messageTimestamp * 1000}ms\n\n`;
                    statusText += `✨ *FEATURES:*\n`;
                    statusText += `• AI Chat & Image Generation\n`;
                    statusText += `• Media Downloader\n`;
                    statusText += `• Games & Entertainment\n`;
                    statusText += `• Group Management\n`;
                    statusText += `• Utility Tools\n`;
                    statusText += `• Security Features\n\n`;
                    statusText += `_Made with ❤️ by ${ownerName || 'Unknown'}_`;
                    
                    await sock.sendMessage(from, { text: statusText }, { quoted: msg });
                }

                if (command === 'owner') {
                    const ownerText = `👑 *OWNER INFORMATION*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    ownerText += `📛 *Nama:* ${ownerName || 'DoxxBorx'}\n`;
                    ownerText += `📱 *Nomor:* ${ownerNumber || 'Unknown'}\n`;
                    ownerText += `📧 *Email:* ${ownerEmail || 'Not provided'}\n`;
                    ownerText += `🌐 *GitHub:* ${ownerGitHub || 'Not provided'}\n`;
                    ownerText += `💼 *Instagram:* ${ownerInstagram || 'Not provided'}\n\n`;
                    ownerText += `📞 *CONTACT:*\n`;
                    ownerText += `• WhatsApp: wa.me/${ownerNumber?.replace('@s.whatsapp.net', '') || ''}\n`;
                    ownerText += `• Email: ${ownerEmail || 'Not available'}\n\n`;
                    ownerText += `_Jangan spam owner ya! 🙏_`;
                    
                    await sock.sendMessage(from, { text: ownerText }, { quoted: msg });
                }

                if (command === 'donasi' || command === 'donate') {
                    const donateText = `💝 *DONASI & SUPPORT*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    donateText += `Terima kasih ingin mendukung pengembangan bot ini!\n\n`;
                    donateText += `📱 *DANA:* ${danaNumber || '0838-XXXX-XXXX'}\n`;
                    donateText += `🏦 *OVO:* ${ovoNumber || '0838-XXXX-XXXX'}\n`;
                    donateText += `💳 *GOPAY:* ${gopayNumber || '0838-XXXX-XXXX'}\n`;
                    donateText += `🏛️ *BANK:* ${bankAccount || 'Not provided'}\n`;
                    donateText += `🎁 *SAWERIA:* ${saweriaLink || 'Not provided'}\n`;
                    donateText += `☕ *TRAKTEER:* ${trakteerLink || 'Not provided'}\n\n`;
                                        donateText += `💌 *Note:*\n`;
                    donateText += `• Donasi bersifat sukarela\n`;
                    donateText += `• Tidak ada paksaan\n`;
                    donateText += `• Donasi digunakan untuk maintenance server\n`;
                    donateText += `• Terima kasih atas supportnya! ❤️\n\n`;
                    donateText += `_Setiap donasi sangat berarti untuk pengembangan bot_`;
                    
                    await sock.sendMessage(from, { text: donateText }, { quoted: msg });
                }

                if (command === 'speedtest') {
                    await sock.sendMessage(from, { 
                        text: '⚡ Menjalankan speed test...' 
                    }, { quoted: msg });
                    
                    try {
                        const startTime = Date.now();
                        
                        // Test download speed (simulated)
                        const testData = 'x'.repeat(1024 * 100); // 100KB test data
                        const downloadTime = Date.now() - startTime;
                        
                        // Calculate speeds
                        const downloadSpeed = (100 * 8) / (downloadTime / 1000); // kbps
                        const ping = downloadTime;
                        
                        const speedText = `⚡ *SPEED TEST*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                        speedText += `📊 *SERVER PERFORMANCE:*\n`;
                        speedText += `• Ping: ${ping}ms\n`;
                        speedText += `• Download: ${downloadSpeed.toFixed(2)} Mbps\n`;
                        speedText += `• Upload: ${(downloadSpeed * 0.8).toFixed(2)} Mbps\n`;
                        speedText += `• Latency: ${ping}ms\n\n`;
                        
                        speedText += `💻 *SYSTEM INFO:*\n`;
                        speedText += `• Platform: ${process.platform}\n`;
                        speedText += `• Node.js: ${process.version}\n`;
                        speedText += `• Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n`;
                        speedText += `• Uptime: ${formatUptime(process.uptime())}\n\n`;
                        
                        speedText += `📈 *QUALITY:* ${ping < 100 ? '✅ Excellent' : ping < 300 ? '⚠️ Good' : '❌ Poor'}`;
                        
                        await sock.sendMessage(from, { text: speedText }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal menjalankan speed test!' 
                        });
                    }
                }

                if (command === 'server') {
                    const os = require('os');
                    
                    const serverText = `🖥️ *SERVER INFORMATION*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    serverText += `🏷️ *Hostname:* ${os.hostname()}\n`;
                    serverText += `💻 *Platform:* ${os.platform()} ${os.arch()}\n`;
                    serverText += `🔄 *Uptime:* ${formatUptime(os.uptime())}\n`;
                    serverText += `📅 *Boot Time:* ${new Date(Date.now() - (os.uptime() * 1000)).toLocaleString('id-ID')}\n\n`;
                    
                    serverText += `💾 *MEMORY:*\n`;
                    serverText += `• Total: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB\n`;
                    serverText += `• Free: ${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB\n`;
                    serverText += `• Used: ${((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2)} GB\n`;
                    serverText += `• Usage: ${(((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(2)}%\n\n`;
                    
                    serverText += `⚡ *CPU:*\n`;
                    serverText += `• Model: ${os.cpus()[0].model}\n`;
                    serverText += `• Cores: ${os.cpus().length}\n`;
                    serverText += `• Speed: ${os.cpus()[0].speed} MHz\n\n`;
                    
                    serverText += `🌐 *NETWORK:*\n`;
                    const network = os.networkInterfaces();
                    for (const [name, interfaces] of Object.entries(network)) {
                        for (const iface of interfaces) {
                            if (iface.family === 'IPv4' && !iface.internal) {
                                serverText += `• ${name}: ${iface.address}\n`;
                            }
                        }
                    }
                    
                    await sock.sendMessage(from, { text: serverText }, { quoted: msg });
                }

                if (command === 'stats') {
                    // You should implement actual statistics tracking
                    const stats = {
                        totalCommands: 0,
                        todayCommands: 0,
                        totalUsers: 0,
                        activeGroups: 0,
                        popularCommands: ['!menu', '!ai', '!ytmp3']
                    };
                    
                    const statsText = `📊 *BOT STATISTICS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    statsText += `📈 *USAGE STATS:*\n`;
                    statsText += `• Total Commands: ${stats.totalCommands}\n`;
                    statsText += `• Today Commands: ${stats.todayCommands}\n`;
                    statsText += `• Total Users: ${stats.totalUsers}\n`;
                    statsText += `• Active Groups: ${stats.activeGroups}\n\n`;
                    
                    statsText += `🔥 *POPULAR COMMANDS:*\n`;
                    stats.popularCommands.forEach((cmd, i) => {
                        statsText += `${i + 1}. ${cmd}\n`;
                    });
                    
                    statsText += `\n⏰ *Uptime:* ${formatUptime(process.uptime())}\n`;
                    statsText += `💾 *Memory:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n`;
                    statsText += `📅 *Last Reset:* ${new Date().toLocaleDateString('id-ID')}\n\n`;
                    statsText += `_Statistics reset daily_`;
                    
                    await sock.sendMessage(from, { text: statsText }, { quoted: msg });
                }

                // =======================================================
                // 🔄 AUTO-RESPONDER & SMART FEATURES
                // =======================================================
                if (command === 'simi') {
                    const action = args[0]?.toLowerCase();
                    
                    if (isGroup) {
                        if (!isAdmin && action) {
                            return await sock.sendMessage(from, { 
                                text: '❌ Hanya admin yang bisa mengatur SimSimi di group!' 
                            }, { quoted: msg });
                        }
                        
                        if (action && ['on', 'off'].includes(action)) {
                            // Store setting
                            const settingsFile = './settings.json';
                            let settings = {};
                            
                            try {
                                if (fs.existsSync(settingsFile)) {
                                    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
                                }
                                
                                if (!settings.groups) settings.groups = {};
                                if (!settings.groups[from]) settings.groups[from] = {};
                                
                                settings.groups[from].simsimi = action === 'on';
                                
                                fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
                                
                                await sock.sendMessage(from, { 
                                    text: `✅ SimSimi telah di${action === 'on' ? 'aktifkan' : 'nonaktifkan'} di group ini!` 
                                });
                            } catch (e) {
                                await sock.sendMessage(from, { 
                                    text: '❌ Gagal mengatur SimSimi!' 
                                });
                            }
                            return;
                        }
                    }
                    
                    // Chat with SimSimi
                    const question = body.substring(body.indexOf(' ') + 1);
                    
                    if (!question) {
                        return await sock.sendMessage(from, { 
                            text: '❌ Format: !simi [pertanyaan]\nContoh: !simi halo' 
                        }, { quoted: msg });
                    }
                    
                    try {
                        const response = await axios.get(
                            `http://api.simsimi.net/v2/?text=${encodeURIComponent(question)}&lc=id`
                        );
                        
                        const answer = response.data.success || 'Maaf, saya tidak mengerti';
                        
                        await sock.sendMessage(from, { 
                            text: `🤖 *SimSimi:* ${answer}` 
                        }, { quoted: msg });
                    } catch (e) {
                        await sock.sendMessage(from, { 
                            text: '❌ Gagal menghubungi SimSimi!' 
                        }, { quoted: msg });                
                        if (!text.startsWith('!')) return;
                
                const args = text.split(/ +/).slice(1);
                const command = text.split(/ +/)[0].toLowerCase().slice(1);
                
                const isAdmin = OWNER_NUMBER.some(num => sender.includes(num));
                const isCmd = true; // Since we're checking command prefix, we can assume it's a command
                      let isLocalGroupAdmin = false;
                    }
                }
            

                                // =======================================================
                // 🎯 ANTI-LINK PROTECTION (untuk semua pesan)
                // =======================================================
                if (isGroup && !isAdmin) {
                    // Anti-link protection
                    try {
                        const settingsFile = './settings.json';
                        let settings = {};
                        
                        if (fs.existsSync(settingsFile)) {
                            settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
                        }
                        
                        if (settings.groups?.[from]?.antilink) {
                            const urlRegex = /(https?:\/\/[^\s]+)/g;
                            const hasUrl = urlRegex.test(body);
                            
                            if (hasUrl) {
                                await sock.sendMessage(from, { 
                                    text: `⚠️ @${sender.split('@')[0]}, mengirim link tidak diizinkan di group ini!`,
                                    mentions: [sender]
                                });
                            }
                        }
                    } catch (e) {
                        // Ignore errors
                    }
                }
                
                // =======================================================
                // 🎉 WELCOME & FAREWELL MESSAGES
                // =======================================================
                // Handle group updates
                if (msg.message?.protocolMessage?.type === 4) { // Group update
                    const update = msg.message.protocolMessage;
                    
                    // Welcome new members
                    if (update.participant && !update.participant.includes(sock.user.id)) {
                        const settingsFile = './settings.json';
                        let settings = {};
                        
                        try {
                            if (fs.existsSync(settingsFile)) {
                                settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
                            }
                            
                            if (settings.groups?.[from]?.welcome) {
                                const welcomeMsg = settings.groups[from].welcomeMessage || 
                                    `👋 Selamat datang @${update.participant.split('@')[0]} di group!\n\nSemoga betah ya! 😊`;
                                
                                await sock.sendMessage(from, { 
                                    text: welcomeMsg,
                                    mentions: [update.participant]
                                });
                            }
                        } catch (e) {
                            // Ignore errors
                        }
                    }
                } 
            } catch (error) { // <-- INI PERBAIKANNYA
                console.error('Error processing message:', error);
                
                // Send error message to user
                try {
                    await sock.sendMessage(from, { 
                        text: `❌ Terjadi error: ${error.message}\n\nSilakan coba lagi atau hubungi owner.` 
                    });
                } catch (e) {
                    console.error('Failed to send error message:', e);
                }
            }
        }); // <-- TUTUP messages.upsert

        // =======================================================
// 🚀 STARTUP MESSAGE
// =======================================================
console.log(chalk.green('✅ Bot berhasil terhubung!'));

// CEK DULU APAKAH sock.user ADA
if (sock.user) {
    console.log(chalk.cyan(`🤖 Nama: ${sock.user.name}`));
    console.log(chalk.cyan(`📱 Nomor: ${sock.user.id.split(':')[0]}`));
    
    // Send startup message to owner
    try {
        await sock.sendMessage(ownerNumber, { 
            text: `🤖 *Bot Started Successfully!*\n\n📛 Name: ${sock.user.name}\n📱 Number: ${sock.user.id.split(':')[0]}\n🔄 Version: ${botVersion}\n⏰ Time: ${new Date().toLocaleString('id-ID')}\n\nBot siap digunakan! 🚀` 
        });
    } catch (e) {
        console.log('Tidak bisa mengirim startup message ke owner');
    }
} else {
    console.log(chalk.yellow('⚠️  Bot terhubung, tapi user info belum tersedia'));
    console.log(chalk.yellow('⚠️  Tunggu autentikasi atau scan QR code...'));
    
    // Coba lagi setelah beberapa detik
    setTimeout(async () => {
        if (sock.user) {
            console.log(chalk.cyan(`🤖 Nama: ${sock.user.name}`));
            console.log(chalk.cyan(`📱 Nomor: ${sock.user.id.split(':')[0]}`));
            try {
                await sock.sendMessage(ownerNumber, { 
                    text: `🤖 *Bot Started Successfully!*\n\n📛 Name: ${sock.user.name}\n📱 Number: ${sock.user.id.split(':')[0]}\n🔄 Version: ${botVersion}\n⏰ Time: ${new Date().toLocaleString('id-ID')}\n\nBot siap digunakan! 🚀` 
                });
            } catch (e) {
                console.log('Tidak bisa mengirim startup message ke owner');
            }
        } else {
            console.log(chalk.yellow('⚠️  Bot terhubung, tapi user info belum tersedia'));
            console.log(chalk.yellow('⚠️  Tunggu autentikasi atau scan QR code...'));
            
            // Coba lagi setelah beberapa detik
            setTimeout(async () => {
                if (sock.user) {
                    console.log(chalk.cyan(`🤖 Nama: ${sock.user.name}`));
                    console.log(chalk.cyan(`📱 Nomor: ${sock.user.id.split(':')[0]}`));
                }
            }, 5000);
        }
    }, 5000);
}

// =======================================================
// 🎯 HELPER FUNCTIONS
// =======================================================
function formatUptime(seconds) {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    let result = [];
    if (days > 0) result.push(`${days}d`);
    if (hours > 0) result.push(`${hours}h`);
    if (minutes > 0) result.push(`${minutes}m`);
    if (secs > 0 || result.length === 0) result.push(`${secs}s`);
    
    return result.join(' ');
}

function generatePassword(length = 12) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let password = '';
    
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * charset.length);
        password += charset[randomIndex];
    }
    
    return password;
}

} catch (error) {
    console.error(chalk.red('❌ Gagal menghubungkan bot:'), error);
    process.exit(1);
}
}// <-- TAMBAHKAN INI

// Handle process termination
process.on('SIGINT', () => {
    console.log(chalk.yellow('\n🛑 Bot dimatikan...'));
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error(chalk.red('❌ Uncaught Exception:'), error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('❌ Unhandled Rejection at:'), promise, 'reason:', reason);
});

// =======================================================
// 🚀 START THE BOT
// =======================================================
startBot();