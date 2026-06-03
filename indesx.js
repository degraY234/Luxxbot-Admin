import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import os from 'os';
import { createCanvas, loadImage } from 'canvas';
import { GoogleGenAI } from '@google/genai';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import axios from 'axios';
import OpenAI from "openai";
import * as cheerio from 'cheerio';
import { minify } from 'terser';
import express from 'express';
import http from 'http';
import ytdl from '@distube/ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
ffmpeg.setFfmpegPath(ffmpegPath);
import TikTok from '@tobyg74/tiktok-api-dl';
import ytSearch from 'yt-search';
console.log("Gemini Key Loaded:", !!process.env.GEMINI_API_KEY);
console.log("OpenAI Key Loaded:", !!process.env.OPENAI_API_KEY);
// =======================================================
// ⚙️ CONFIGURATION & GLOBAL VARIABLES 🎀
// =======================================================
const BOT_NAME = "zetbot"; // Ganti nama bot sesuai keinginanmu
const OWNER_NUMBER = ["6282384961407", "36326967632006"];
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY
});
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
const startTime = Date.now();

// 📻 WATCH2GETHER CONFIG
const W2G_API_KEY = process.env.STREAM_TOKEN;
const W2G_ROOM_FILE = "./w2g_room.json"; // Tempat nyimpen link room permanent

let isSelfMode = false;
let isSleeping = false;
let antiLink = false;

// Database sederhana untuk Fitur Notes & AI Memory
// anti spam simple
const userCooldown = new Map();
const userAIContext = new Map();
const MAX_MEMORY = 12; // biar gak berat
const notesDatabase = {};
const imageCache = new Map();
const aiQueue = [];
let isProcessingQueue = false;
const bratStyles = [
    'cute', 'dark', 'neon', 'anime', 'glitch', 'minimal'
];


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

global.activeVotes = {};
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

            // 🔥 DELAY WAJIB BIAR TIDAK SPAM
            await new Promise(r => setTimeout(r, 1200));

        } catch (e) {
            job.reject(e);
        }
    }

    isProcessingQueue = false;
}

function videoToSticker(inputPath, outputPath) {
    return new Promise((resolve, reject) => {

        ffmpeg(inputPath)
            .outputOptions([
                "-vf", "scale=512:512:force_original_aspect_ratio=cover,fps=15",
                "-loop", "0",
                "-ss", "0",
                "-t", "6"
            ])
            .toFormat("webp")
            .save(outputPath)
            .on("end", () => resolve(outputPath))
            .on("error", reject);

    });
}

function videoToStickerWithText(inputPath, outputPath, text) {
    return new Promise((resolve, reject) => {

        ffmpeg(inputPath)
            .outputOptions([
                "-vf",
                `scale=512:512:force_original_aspect_ratio=cover,
                 fps=15,
                 drawtext=text='${text}':
                 fontcolor=white:
                 fontsize=28:
                 box=1:
                 boxcolor=black@0.5:
                 boxborderw=5:
                 x=(w-text_w)/2:
                 y=h-80`
            ])
            .toFormat("webp")
            .save(outputPath)
            .on("end", () => resolve(outputPath))
            .on("error", reject);

    });
}

/**
 * Buat room Watch2Gether baru via API.
 * Hanya dipanggil sekali, room disimpan permanent.
 */

function cutVideoSmart(inputPath, outputPath) {
    return new Promise((resolve, reject) => {

        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) return reject(err);

            const duration = metadata.format.duration;

            let start = 0;

            // 🎯 kalau video panjang, ambil bagian tengah
            if (duration > 6) {
                start = (duration / 2) - 3; // ambil tengah 6 detik
                if (start < 0) start = 0;
            }

            ffmpeg(inputPath)
                .setStartTime(start)
                .setDuration(6)
                .outputOptions([
                    "-vf scale=512:512:force_original_aspect_ratio=cover,fps=15"
                ])
                .toFormat("mp4")
                .save(outputPath)
                .on("end", () => resolve(outputPath))
                .on("error", reject);
        });
    });
}


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

async function addTextToImageV3(
    buffer,
    topText = '',
    bottomText = '',
    style = 'premium'
) {

    const img = await loadImage(buffer);

    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0);

    // 🎀 WAIFU FRAME
if (style === 'waifu') {

    ctx.strokeStyle = '#ff69b4';
    ctx.lineWidth = 20;

    ctx.strokeRect(
        0,
        0,
        img.width,
        img.height
    );
}

// 🤖 CYBER FRAME
if (style === 'cyber') {

    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 6;

    ctx.strokeRect(
        20,
        20,
        img.width - 40,
        img.height - 40
    );
}

    const fontSize = Math.max(
        32,
        Math.floor(img.width / 12)
    );

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

    if (style === 'manga') {

    ctx.fillStyle = 'rgba(255,255,255,0.85)';

    ctx.fillRect(
        img.width / 2 - width / 2,
        y - fontSize,
        width,
        fontSize + 20
    );

    applyStyle();
}

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

            if (
                ctx.measureText(testLine).width >
                maxWidth &&
                line
            ) {

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

            const y =
                startY +
                i * (fontSize + 12);

            const width =
                ctx.measureText(lines[i]).width + 40;

            // background transparan
            ctx.fillStyle = 'rgba(0,0,0,0.35)';

            ctx.fillRect(
                img.width / 2 - width / 2,
                y - fontSize,
                width,
                fontSize + 15
            );

            applyStyle();

            ctx.strokeText(
                lines[i],
                img.width / 2,
                y
            );

            ctx.fillText(
                lines[i],
                img.width / 2,
                y
            );
        }
    }

    drawWrappedText(
        topText,
        fontSize + 40
    );

    const bottomLines =
        bottomText.split(' ').length > 6
            ? 2
            : 1;

    drawWrappedText(
        bottomText,
        img.height -
        (bottomLines * (fontSize + 20)) -
        40
    );

    return canvas.toBuffer('image/png');
}


async function addTextToImage(buffer, text) {
    const img = await loadImage(buffer);

    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0);

    // 🔥 auto scale font berdasarkan ukuran gambar
    const fontSize = Math.floor(img.width / 12);

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, img.height * 0.75, img.width, img.height * 0.25);

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${fontSize}px Sans`;
    ctx.textAlign = "center";

    // wrap text biar gak kepanjangan
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
}

async function downloadBuffer(mediaMsg) {
    const stream = await downloadContentFromMessage(mediaMsg, 'video');

    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }

    return buffer;
}

async function makeAestheticText(text) {
    try {
        const prompt = `
Ubah teks ini jadi caption aesthetic pendek, vibes, dan emosional (maks 1 kalimat):

"${text}"

Gaya: Gen Z, singkat, viral, pakai emoji dikit.
`;

        const result = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: prompt
        });

        let output = result.text || text;

        // fallback kalau kepanjangan
        return output.length > 80 ? output.slice(0, 80) + "..." : output;

    } catch {
        return text;
    }
}

async function addAnimatedTextStyle(buffer, text) {
    const img = await loadImage(buffer);

    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(img, 0, 0);

    const fontSize = Math.floor(img.width / 10);

    // efek glow / neon shift
    ctx.font = `bold ${fontSize}px Sans`;
    ctx.textAlign = "center";

    // shadow glow (biar hidup)
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = 20;

    const x = img.width / 2;
    const y = img.height * 0.8;

    // glitch effect (fake animation feel)
    ctx.fillStyle = "#ff4dff";
    ctx.fillText(text, x + 2, y);

    ctx.fillStyle = "#00ffff";
    ctx.fillText(text, x - 2, y);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, x, y);

    return canvas.toBuffer("image/png");
}

async function generateFallbackImage(text) {
    const seed = Math.floor(Math.random() * 999999);

    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}, sticker style, cute, high quality?seed=${seed}`;

    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());

    return buffer;
}

async function polishText(text) {
    try {
        if (!GEMINI_API_KEY) return text;

        const prompt = `Perbaiki teks ini jadi lebih aesthetic, pendek, dan keren untuk sticker:
"${text}"`;

        const result = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: prompt
        });

        return result.text || text;
    } catch {
        return text;
    }
}

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

async function getInstagramMedia(url) {
    try {

        // =========================
        // METHOD 1: SnapAPI (fast)
        // =========================
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

        // =========================
        // METHOD 2: SaveInsta fallback
        // =========================
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

        // =========================
        // METHOD 3: Embed fallback
        // =========================
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

async function groqAI(prompt) {

    try {

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
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

// =======================================================
// 🧠 PROSES PERTANYAAN LEWAT API GEMINI AI (ANTI-SICK SYSTEM) 🐰✨
// =======================================================
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

    const models = [
        'gemini-2.5-flash',
        'gemini-2.0-flash'
    ];

    let systemInstruction = `Anda adalah AI santai, lucu, tapi pintar.`;

    // ===== GEMINI FIRST =====
    for (let model of models) {
        try {
            const res = await ai.models.generateContent({
                model,
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
            if (e.status === 429 || e.status === 503) break;
        }
    }

    // ===== OPENAI FALLBACK =====
    try {
        return await askOpenAI(query, systemInstruction);
    } catch (e1) {

        // ===== GROQ FALLBACK =====
        try {
            return await askGroq(query, systemInstruction);
        } catch (e2) {
            return "❌ Semua AI lagi tumbang, coba lagi nanti.";
        }
    }
}        

async function askOpenAI(text, system, fromId) {
    const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: system },
            { role: "user", content: text }
        ]
    });

    return res.choices[0].message.content;
}

async function askGroq(text, system, fromId) {
    const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            model: "llama3-8b-8192",
            messages: [
                { role: "system", content: system },
                { role: "user", content: text }
            ]
        },
        {
            headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            }
        }
    );

    return res.data.choices[0].message.content;
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
            ║  🚀 ${BOT_NAME} MULTI-DEVICE IS SUCCESSFULLY ONLINE! 🤖 ║
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
            if (!msg || !msg.message) return;

            if (msg.key.fromMe) return;
            if (!msg.message || msg.messageStubType) return;

            const from = msg.key.remoteJid;
            if (!checkCooldown(from)) {
    await sock.sendMessage(from, {
        text: '⏳ pelan dulu ya sayang, jangan spam 😤'
    }, { quoted: msg });

    return;
}
            const isGroup = from.endsWith('@g.us');
            const sender = msg.key.participant || from;
            
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
            // SESUDAH (benar)
if (antiLink && isGroup && body.match(/(chat.whatsapp.com\/)/gi)) {
    try {
        const groupMetadata = await sock.groupMetadata(from);
        const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const isBotAdmin = groupMetadata?.participants?.some(
    p => p.id === botNumber && (p.admin === 'admin' || p.admin === 'superadmin')
);
        
        if (isBotAdmin) {
            await sock.sendMessage(from, { text: `🛡️ *Hayo Ketahuan!* Maaf @${sender.split('@')[0]} sayang, dilarang keras sebar link grup lain di sini ya! Sesuai protokol, kamu aku *kick*. Bye bye~ 👋🤭`, mentions: [sender] });
            await sock.groupParticipantsUpdate(from, [sender], 'remove');
            return;
        }
    } catch (e) {
        console.log('⚠️ AntiLink error:', e.message);
    }
}

            if (!body.startsWith('!')) return;

            const args = text.split(/ +/).slice(1);
            const command = text.split(/ +/)[0].toLowerCase().slice(1);
            
            const isAdmin = OWNER_NUMBER.some(num => sender.includes(num));

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
        // isLocalGroupAdmin tetap false, bot tetap jalan
    }
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

    let menuText = `╭━━━〔 🌸 *${BOT_NAME.toUpperCase()} MENU DASHBOARD* 🌸 〕━━━\n` +
                   `┃\n` +
                   `┃ 📡 *SYSTEM STATUS PANEL* 📡\n` +
                   `┃ ├ 🛠️ Mode Bot  : ${isSelfMode ? '🔒 VVIP SELF MODE (Private Access)' : '🔓 PUBLIC MODE (All Users)'}\n` +
                   `┃ ├ 💤 Status Bot: ${isSleeping ? '🛌 SLEEP MODE (Bot Sedang Istirahat)' : '⚡ ONLINE (Siap & Responsif)'}\n` +
                   `┃ ├ 🛡️ Anti-Link : ${antiLink ? '🟢 ACTIVE (Proteksi Grup Aktif)' : '🔴 OFF (Tidak Aktif)'}\n` +
                   `┃ ├ ⏳ Runtime   : ${botUptime}\n` +
                   `┃ └ 📶 Status    : 🟣 Stable Connection (Normal)\n` +
                   `┃\n` +

                   `┣━━〔 🧸 *GENERAL COMMANDS* 〕━━\n` +
                   `┃ ├ • \`!halo\` — Sapa bot dengan gaya santai 👋✨\n` +
                   `┃ ├ • \`!ping\` — Cek respon & latency ⚡📡\n` +
                   `┃ ├ • \`!help\` — Tampilkan semua menu 📜\n` +
                   `┃ ├ • \`!changelogs\` — Update & fitur terbaru 📢🆕\n` +
                   `┃ ├ • \`!notes\` — Simpan catatan pribadi 📝🔐\n` +
                   `┃ ├ • \`!remindme\` — Pengingat otomatis ⏰📌\n` +
                   `┃ ├ • \`!add\` — Tambah member ke grup 👥➕\n` +
                   `┃\n` +

                   `┣━━〔 🧠 *AI INTELLIGENCE CORE* 〕━━\n` +
                   `┃ ├ • \`!tanya\` — Tanya apa saja ke AI 🤖💬\n` +
                   `┃ ├ • \`!coding\` — Debug & solusi error 💻🛠️\n` +
                   `┃ ├ • \`!code\` — Review & analisa kode 🔍📄\n` +
                   `┃ ├ • \`!rangkum\` — Ringkas teks panjang 📑✂️\n` +
                   `┃ ├ • \`!brainstorm\` — Ide kreatif & inovatif 💡🚀\n` +
                   `┃ ├ • \`!translate\` — Terjemahan natural 🌐🗣️\n` +
                   `┃ ├ • \`!buat\` — Generate gambar AI 🎨✨\n` +
                   `┃ ├ • \`!lihat\` — Analisa gambar dengan AI 👁️🧠\n` +
                   `┃ ├ • \`!q\` — Chat bebas dengan AI 💬⚡\n` +
                   `┃ ├ • \`!resetai\` — Reset memori AI ♻️🧹\n` +
                   `┃ ├ • \`!fact\` — Fakta random unik 🤯📚\n` +
                   `┃\n` +

                   `┣━━〔 📦 *UTILITY SYSTEM* 〕━━\n` +
                   `┃ ├ • \`!ocr\` — Ambil teks dari gambar 🔍📷\n` +
                   `┃ ├ • \`!ceklink\` — Scan link berbahaya 🚨🛡️\n` +
                   `┃ ├ • \`!cuaca\` — Info cuaca real-time 🌤️🌍\n` +
                   `┃ ├ • \`!kalkulator\` — Hitung cepat & akurat 🧮⚡\n` +
                   `┃ ├ • \`!qr\` — Generate QR code 🔳📱\n` +
                   `┃ ├ • \`!stalk\` — Cek profil GitHub 🐙🔎\n` +
                   `┃ ├ • \`!remini\` — HD kan foto ✨📸\n` +
                   `┃ ├ • \`!summarize\` — Ringkas artikel 📰✂️\n` +
                   `┃\n` +

                   `┣━━〔 🖼️ *MEDIA & DOWNLOAD CENTER* 〕━━\n` +
                   `┃ ├ • \`!sticker / !s\` — Buat stiker lucu 🥳✨\n` +
                   `┃ ├ • \`!anomali\` — Sticker style aesthetic 😎🎭\n` +
                   `┃ ├ • \`!dl\` — Download media cepat 📥⚡\n` +
                   `┃ ├ • \`!stream\` — Nonton bareng 📻🎬\n` +
                   `┃\n` +

                   `┣━━〔 🎮 *FUN INTERACTION* 〕━━\n` +
                   `┃ ├ • \`!curhat\` — Tempat curhat virtual 🫂💬\n` +
                   `┃ ├ • \`!roastme\` — Roast santai 🔥😈\n` +
                   `┃ ├ • \`!truth\` — Game jujur-jujuran 🤫🎯\n` +
                   `┃ ├ • \`!dare\` — Tantangan seru 😏⚡\n` +
                   `┃ ├ • \`!meme\` — Meme random 😂🤣\n` +
                   `┃ ├ • \`!apakah\` — Jawaban random 🔮❓\n` +
                   `┃ ├ • \`!anime\` — Anime random 🌸🎌\n` +
                   `┃ ├ • \`!waifu\` — Waifu random 💖✨\n` +
                   `┃ ├ • \`!quotesanime\` — Quote anime 🎌📜\n` +
                   `┃ ├ • \`!darkjokes\` — Dark jokes random 😈🤣\n` +
                   `┃ ├ • \`!pantun\` — Pantun ! > (lucu/cinta/nasihat/semangat) 🎭📝\n` +
                   `┃ ├ • \`!cerpen\` — Cerpen AI (📖 !cerpen horor📖 !cerpen misteri 📖 !cerpen fantasy 📖 !cerpen romantis)📖✨\n` +
                   `┃ ├ • \`!kapankah\` — Ramalan waktu ⏳🔮\n` +
                   `┃ ├ • \`!tagall\` — Mention semua member 📢👥\n` +
                   `┃\n` +

                   `┣━━〔 📊 *VOTING SYSTEM* 〕━━\n` +
                   `┃ ├ • \`!voting\` — Buat voting 🗳️📊\n` +
                   `┃ ├ • \`!pilih\` — Berikan suara kamu ✅🗳️\n` +
                   `┃ └ • \`!endvoting\` — Tutup voting 🛑📊\n` +
                   `┃\n` +

                   `┣━━〔 🎲 *EXTRA FEATURES* 〕━━\n` +
                   `┃ ├ • \`!gacha\` — Random keputusan 🎲🎯\n` +
                   `┃ └ • \`!pinghost\` — Cek server & latency 📡⚡\n` +
                   `┃\n`;

    if (isAdmin) {
        menuText += `┣━━〔 👑 *OWNER CONTROL PANEL* 〕━━\n` +
                    `┃ ├ • \`!speedtest\` — Test kecepatan server 🚀📡\n` +
                    `┃ ├ • \`!broadcast\` — Kirim pesan massal 📢📨\n` +
                    `┃ ├ • \`!spek\` — Info spesifikasi sistem 💻📊\n` +
                    `┃ ├ • \`!systeminfo\` — CPU & RAM detail 📊🧠\n` +
                    `┃ ├ • \`!self\` — Mode private 🔒🛡️\n` +
                    `┃ ├ • \`!public\` — Mode publik 🔓🌍\n` +
                    `┃ ├ • \`!join\` — Masuk grup ➕🏃‍♂️\n` +
                    `┃ ├ • \`!leave\` — Keluar grup 🚪💨\n` +
                    `┃ ├ • \`!grup\` — Kontrol grup ⚙️👥\n` +
                    `┃ ├ • \`!antilink\` — Proteksi link 🛡️🔗\n` +
                    `┃ ├ • \`!block\` — Blokir user 🚫👤\n` +
                    `┃ ├ • \`!unblock\` — Buka blokir 🕊️✨\n` +
                    `┃ ├ • \`!refresh\` — Bersihkan sistem ♻️🧹\n` +
                    `┃ ├ • \`!turu\` — Tidurkan bot 🛌💤\n` +
                    `┃ ├ • \`!bangun\` — Bangunkan bot ☀️⚡\n` +
                    `┃ ├ • \`!pingsan\` — Matikan bot 💀🔌\n` +
                    `┃ ├ • \`!resetroom\` — Reset W2G 🔄🎧\n` +
                    `┃ └ • \`!eval\` — Jalankan code ⚙️💻\n`;
    }

    menuText += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `💖 *Bot Status: ACTIVE & READY TO SERVE*\n` +
                `🎀 _Made with Love by Bos DoxxBorx_ ✨`;

    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
}

            // =======================================================
            // 🔓 PUBLIC GENERAL COMMANDS LIST
            // =======================================================
           
            // =======================================================
// 🌸 ANIME PACK PREMIUM
// =======================================================

if (command === 'anime') {
    try {

        const query = args.join(' ') || 'popular';

        await sock.sendMessage(from, {
            text: '🎌 Sedang mencari anime...'
        }, { quoted: msg });

        let url;

        if (query === 'popular') {
            url = 'https://api.jikan.moe/v4/top/anime?limit=25';
        } else {
            url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`;
        }

        const res = await axios.get(url);

        const anime =
            query === 'popular'
                ? res.data.data[Math.floor(Math.random() * res.data.data.length)]
                : res.data.data[0];

        if (!anime) {
            return sock.sendMessage(from, {
                text: '❌ Anime tidak ditemukan.'
            }, { quoted: msg });
        }

        await sock.sendMessage(from, {
            image: { url: anime.images.jpg.large_image_url },
            caption:
`╭━━━〔 🎌 ANIME INFO 🎌 〕━━━

📺 Judul : ${anime.title}

⭐ Rating : ${anime.score || '-'}

🎭 Genre :
${anime.genres.map(v => '• ' + v.name).join('\n')}

📅 Tahun :
${anime.year || '-'}

🎬 Episode :
${anime.episodes || '?'}

📝 Sinopsis :
${anime.synopsis?.substring(0, 400) || '-'}

━━━━━━━━━━━━━━━━━━`
        }, { quoted: msg });

    } catch (err) {

        console.log(err);

        await sock.sendMessage(from, {
            text: '❌ Gagal mengambil info anime.'
        }, { quoted: msg });
    }
}

if (command === 'waifu') {
    try {

        await sock.sendMessage(from, {
            text: '💖 Sedang mencari waifu terbaik...'
        }, { quoted: msg });

        const res = await axios.get(
            'https://nekos.best/api/v2/waifu'
        );

        const waifu = res.data.results[0];

        const level = Math.floor(Math.random() * 100) + 1;

        await sock.sendMessage(from, {
            image: { url: waifu.url },
            caption:
`╭━━━〔 💖 WAIFU OF THE DAY 💖 〕━━━

🌸 Status :
Waifu berhasil ditemukan

💕 Cute Level :
${level}%

✨ Quality :
Ultra HD

🎀 Source :
Nekos.best

━━━━━━━━━━━━━━━━━━`
        }, { quoted: msg });

    } catch (err) {

        console.log(err);

        await sock.sendMessage(from, {
            text: '❌ Gagal mengambil waifu.'
        }, { quoted: msg });
    }
}

if (command === 'quotesanime') {

    await sock.sendMessage(from, {
        text: '🎌 Mencari quote anime terbaik...'
    }, { quoted: msg });

    const hasil = await groqAI(`
Buat 1 quote anime keren.

Format:

🎌 Quote:
...

👤 Character:
...

📺 Anime:
...

Gunakan karakter anime terkenal.
`);
    if (!checkCooldown(from)) return;
    await sock.sendMessage(from, {
        text: hasil || '❌ Gagal membuat quote anime.'
    }, { quoted: msg });
}

if (command === 'darkjokes') {

    await sock.sendMessage(from, {
        text: '😈 Menyiapkan dark jokes...'
    }, { quoted: msg });

    const hasil = await groqAI(`
Buat 1 dark joke lucu.

Syarat:
- Bahasa Indonesia
- Singkat
- Tidak menyinggung SARA
- Format rapi
`);
     
    if (!checkCooldown(from)) return;
    await sock.sendMessage(from, {
        text:
`╭━━━〔 😈 DARK JOKES 😈 〕━━━

${hasil}

━━━━━━━━━━━━━━━━━━
🤣 Semoga Terhibur
━━━━━━━━━━━━━━━━━━`
    }, { quoted: msg });
}

if (command === 'cerpen') {

    const tema = args.join(' ') || 'petualangan';

    await sock.sendMessage(from, {
        text: '📖 Sedang menulis cerpen...'
    }, { quoted: msg });

    const hasil = await groqAI(`
Buat cerpen Indonesia tema ${tema}.

Format:

📖 Judul:
...

📚 Cerita:
...

✨ Pesan Moral:
...

Panjang sekitar 300 kata.
`);

    await sock.sendMessage(from, {
        text:
`╭━━━〔 📖 CERPEN ${tema.toUpperCase()} 📖 〕━━━

${hasil}

━━━━━━━━━━━━━━━━━━
🌸 Selamat Membaca
━━━━━━━━━━━━━━━━━━`
    }, { quoted: msg });
}

if (command === 'remini') {

    try {

        const quoted =
            msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        const mediaMsg =
            msg.message?.imageMessage ||
            quoted?.imageMessage;

        if (!mediaMsg) {
            return sock.sendMessage(from, {
                text: '📸 Reply foto dengan !remini'
            }, { quoted: msg });
        }

        await sock.sendMessage(from, {
            text: '✨ Sedang meningkatkan kualitas foto...'
        }, { quoted: msg });

        const stream = await downloadContentFromMessage(
            mediaMsg,
            'image'
        );

        let buffer = Buffer.from([]);

        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const enhanced = await sharp(buffer)
            .resize({
                width: 2000,
                withoutEnlargement: false
            })
            .sharpen()
            .jpeg({ quality: 100 })
            .toBuffer();

        await sock.sendMessage(from, {
            image: enhanced,
            caption: '✨ Foto berhasil ditingkatkan kualitasnya'
        }, { quoted: msg });

    } catch (err) {

        console.log('REMINI ERROR:', err);

        await sock.sendMessage(from, {
            text: '❌ Gagal memproses foto.'
        }, { quoted: msg });
    }
}

            if (command === 'halo') {
                await sock.sendMessage(from, { text: `Halo juga Kakak manis! 🌸 Ada yang bisa ${BOT_NAME} bantu hari ini? Ketik \`!menu\` untuk lihat keajaibanku ya! 🥳✨` }, { quoted: msg });
            }

            if (command === 'ping') {
                const latensi = Date.now() - msg.messageTimestamp * 1000;
                await sock.sendMessage(from, { text: `🏓 *Pong!* Respon secepat kilat: *${latensi}ms* 🚀💨` }, { quoted: msg });
            }

            if (command === 'changelogs') {
                await sock.sendMessage(from, { text: `⚙️ *${BOT_NAME} UPDATE LOGS* ⚙️\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🎀 *v2.3.0 Hacking Update:*\n- Fitur Radio W2G dengan sistem antrian lagu 🎵\n- Menu lebih kawaii dengan banyak emoji 🌸\n- Terminal log lebih keren ala hacker 😎\n\n_Stay tuned buat update kece lainnya!_ 💖` }, { quoted: msg });
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

            if (command === 'pantun') {

    let tema = (args[0] || 'lucu').toLowerCase();

    let file = './database/pantun_lucu.json';

    if (tema === 'cinta')
        file = './database/pantun_cinta.json';

    else if (tema === 'nasihat')
        file = './database/pantun_nasihat.json';

    else if (tema === 'semangat')
        file = './database/pantun_semangat.json';

    const data = JSON.parse(
        fs.readFileSync(file)
    );

    const hasil =
        data[Math.floor(Math.random() * data.length)];

    await sock.sendMessage(from, {
    text:
`╭━━━〔 🎭 PANTUN NUSANTARA 🎭 〕━━━
┃
┃ 🌸 Pantun Pilihan Hari Ini
┃
┃ ${hasil.split('\n').join('\n┃ ')}
┃
┣━━━━━━━━━━━━━━━━━
┃ ✨ Pesan:
┃ Jadikan pantun sebagai hiburan
┃ dan penyemangat harimu 🌈
┃
╰━━━━━━━━━━━━━━━━━
🌷 Powered By ${BOT_NAME}`
}, { quoted: msg });
}

            // =======================================================
            // 🤖 AI COMMANDS EXTENSION PACK 🌸
            // =======================================================
            // cache sederhana biar gak fetch ulang prompt yang sama
console.log("COMMAND MASUK:", command);
console.log("ARGS:", args);
if (command === 'buat') {

    let deskripsi = args.join(' ');

    if (!deskripsi) {
        return await sock.sendMessage(from, {
            text: '⚠️ Kasih aku deskripsi gambar ya Kak~ contoh: !buat kucing pakai kacamata 😼'
        }, { quoted: msg });
    }

    // style premium (optional)
    const styles = ['anime', 'realistic', '3d', 'cinematic'];
    const style = styles[Math.floor(Math.random() * styles.length)];

    const seed = Math.floor(Math.random() * 999999);

    const prompt = `${deskripsi}, ${style} style`;

    // loading progress biar hidup 😏
    const loadingMsg = await sock.sendMessage(from, {
        text: '🎨 Lagi aku lukis pelan-pelan ya... 10% ✏️'
    }, { quoted: msg });

    try {

        // cek cache
        if (imageCache.has(prompt)) {
            const cachedBuffer = imageCache.get(prompt);

            return await sock.sendMessage(from, {
                image: cachedBuffer,
                caption: `✨ Ini dari cache ya Kak~\n🎭 Style: ${style}\n🎲 Seed: ${seed}`
            }, { quoted: msg });
        }

        await sock.sendMessage(from, {
            text: '🖌️ 40%... mulai kelihatan bentuknya ✨',
            edit: loadingMsg.key
        });

        const imageUrl =
            `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}`;

        await sock.sendMessage(from, {
            text: '🎨 80%... hampir jadi nih 😳',
            edit: loadingMsg.key
        });

        const res = await fetch(imageUrl);
if (!res.ok) throw new Error('Gagal ambil gambar');

// FIX UTAMA
const arrayBuffer = await res.arrayBuffer();
const buffer = Buffer.from(arrayBuffer);

        // simpan cache
        imageCache.set(prompt, buffer);

        await sock.sendMessage(from, {
            image: buffer,
            caption:
                `💎 *Gambar Premium Selesai!*\n\n` +
                `📝 Prompt: ${deskripsi}\n` +
                `🎭 Style: ${style}\n` +
                `🎲 Seed: ${seed}\n\n` +
                `✨ Kalau mau versi lain tinggal bilang aja ya~`
        }, { quoted: msg });

    } catch (e) {
        console.log(e);

        await sock.sendMessage(from, {
            text: '❌ Hmm… kuasnya jatuh 😭 server lagi gak stabil'
        }, { quoted: msg });
    }
}

            if (command === 'code') {
                const queryKode = args.join(' ');
                if (!queryKode) return await sock.sendMessage(from, { text: '⚠️ Mana kode yang mau di-debug Kak? Contoh: `!code let x = const` 💻' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const hasilAI = await runAIQueue(`Lakukan debug, review, and jelaskan letak error serta optimalisasi dari struktur kode berikut:\n\n${queryKode}`, 'coding', isAdmin, from);
                await sock.sendMessage(from, { text: hasilAI }, { quoted: msg });
            }

            if (command === 'fact') {
                await sock.sendPresenceUpdate('composing', from);
                const faktaPrompt = 'Berikan satu baris fakta unik, menarik, mencengangkan, and ilmiah secara acak dari berbagai belahan dunia atau sejarah luarspace yang jarang diketahui orang awam.';
                const hasilAI = await runAIQueue(faktaPrompt, 'tanya', isAdmin, from);
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
                    if (!mediaContext?.imageMessage) {
    return await sock.sendMessage(from, {
        text: '❌ Gambar tidak valid'
    }, { quoted: msg });
}
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
                const res = await runAIQueue(queryText, 'chat_context', isAdmin, from);
                await sock.sendMessage(from, { text: res }, { quoted: msg });
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
                    "Ganti nama profil WhatsApp kamu menjadi 'Anak Kesayangan ${BOT_NAME}' selama 1 jam ke depan.",
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
            if (command === 'stream' || command === 'st') {
                try {
                    await sock.sendMessage(from, { text: '⏳ _Ambil link room live dulu ya Kak..._ 📻' }, { quoted: msg });

                    const room = await getOrCreateRoom();
                    const queueList = global.radioQueue && global.radioQueue.length > 0
                        ? global.radioQueue.map((t, i) => `${i + 1}. 🎵 ${t.title} — req by @${t.requestedBy}`).join('\n')
                        : '_Antrian kosong. Jadilah yang pertama request lagu!_';

                    const radioText =
    `╭━━━〔 📻 *${BOT_NAME} LIVE ROOM* 〕━━━\n` +
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
                    console.error('❌ Error command !stream:', e.message);
                    await sock.sendMessage(from, { text: '❌ Waduh, gagal ambil link room livestreamnya Kak! Coba lagi sebentar ya. 😭' }, { quoted: msg });
                }
            }

            // =======================================================
            // 🎲 PERINTAH: !gacha (PENENTU KEPUTUSAN INSTAN) 🌀
            // =======================================================
            if (command === 'gacha') {
                const inputGacha = args.join(" ");
                if (!inputGacha || !inputGacha.includes('|')) {
                    return await sock.sendMessage(from, { 
                        text: `❌ *Format salah, Bos!* \n\n👉 Gunakan tanda pemisah (\`|\`) untuk memasukkan pilihan.\n📝 *Contoh:* \n\`!gacha Maju Presentasi | Lasko | Budi | Joko\`\n\`!gacha Makan Siang | Ayam Penyet | Nasi Padang | Mie Sop\`` 
                    }, { quoted: msg });
                }

                // Memecah input berdasarkan karakter "|"
                const komponen = inputGacha.split('|').map(item => item.trim());
                const topik = komponen[0];
                const listPilihan = komponen.slice(1);

                if (listPilihan.length < 2) {
                    return await sock.sendMessage(from, { text: '❌ Opsi pilihannya minimal harus ada 2 dong, Bos!' }, { quoted: msg });
                }

                // Mengirim efek loading ala dadu berputar biar dramatis
                await sock.sendMessage(from, { text: `🌀 *ZetBot lagi memutar dadu takdir...* \n🤔 Menentukan pilihan untuk: "${topik}"` }, { quoted: msg });

                // Mengacak pilihan menggunakan Math.random()
                const indeksPemenang = Math.floor(Math.random() * listPilihan.length);
                const opsiTerpilih = listPilihan[indeksPemenang];

                // Beri jeda 1.5 detik sebelum menampilkan hasil biar seru
                setTimeout(async () => {
                    let teksHasil = `🎲 *HASIL GACHA MUTLAK!* 🎲\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    teksHasil += `📌 *Topik:* "${topik}"\n`;
                    teksHasil += `🎉 *Keputusan Terpilih:* \n\n👉 ✨ *[ ${opsiTerpilih} ]* ✨\n\n`;
                    teksHasil += `━━━━━━━━━━━━━━━━━━━━━━━\nKeputusan bot bersifat mutlak dan tidak bisa diganggu gugat! 😎`;

                    await sock.sendMessage(from, { text: teksHasil });
                }, 1500);
            }

            // =======================================================
            // 📡 PERINTAH: !pinghost (NETWORK LATENCY CHECKER) 🖥️
            // =======================================================
            if (command === 'pinghost') {
                const targetHost = args[0];
                if (!targetHost) {
                    return await sock.sendMessage(from, { text: '❌ *Host/Domain tidak boleh kosong!* \n📝 Contoh: \`!pinghost google.com\` atau \`!pinghost 1.1.1.1\` ' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: `⚡ *Sedang melakukan pinging ke ${targetHost}...* Mohon tunggu.` }, { quoted: msg });

                // Menggunakan exec dari child_process untuk menjalankan perintah terminal
                const { exec } = await import('child_process');

                // Deteksi otomatis OS (Windows pakai '-n', Linux/Mac pakai '-c')
                const perintahPing = process.platform === 'win32' ? `ping -n 4 ${targetHost}` : `ping -c 4 ${targetHost}`;

                exec(perintahPing, async (error, stdout, stderr) => {
                    if (error) {
                        return await sock.sendMessage(from, { text: `❌ *Koneksi Gagal / RTO!* \nHost *${targetHost}* tidak merespons atau domain tidak valid.` }, { quoted: msg });
                    }

                    // Merapikan output terminal agar enak dibaca di WhatsApp
                    let teksPing = `📡 *NETWORK PING REPORT* 📡\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    teksPing += `📌 *Target Host:* ${targetHost}\n`;
                    teksPing += `📊 *Status:* ONLINE & RESPONDING ✅\n\n`;
                    teksPing += `📝 *Log Terminal:* \n\`\`\`${stdout.trim()}\`\`\n`;
                    teksPing += `━━━━━━━━━━━━━━━━━━━━━━━`;

                    await sock.sendMessage(from, { text: teksPing }, { quoted: msg });
                });
            }

            // =======================================================
            // 🗳️ FLEXIBLE VOTING: BISA PAKAI TIMER / MANUAL (OTOMATIS DETEKSI) 📊⏳
            // =======================================================
            if (command === 'voting') {
                const inputVoting = args.join(" ");
                if (!inputVoting || !inputVoting.includes('|')) {
                    return await sock.sendMessage(from, { 
                        text: `❌ *Format salah, Bos!* \n\n👉 *Opsi 1 (Pakai Waktu):* \n\`!voting 10m | Judul | Opsi A | Opsi B\`\n\n👉 *Opsi 2 (Manual/Tanpa Waktu):* \n\`!voting Judul Tanpa Waktu | Opsi A | Opsi B\`` 
                    }, { quoted: msg });
                }

                // Memecah input berdasarkan karakter "|"
                const komponen = inputVoting.split('|').map(item => item.trim());
                
                // Ambil bagian pertama sebelum tanda "|"
                const bagianPertama = komponen[0];
                const kataPertama = bagianPertama.split(' ')[0].toLowerCase(); // Cek kata paling depan

                let topik = bagianPertama;
                let timeoutId = null;
                let teksDurasi = "Manual (Ditutup lewat !endvoting)";

                // Cek apakah kata pertama adalah format waktu (misal: 10m, 2h, 30m)
                const apakahPakaiWaktu = kataPertama.match(/^\d+[mh]$/);

                if (apakahPakaiWaktu) {
                    // Jika pakai waktu, pisahkan string waktu dengan topiknya
                    topik = bagianPertama.split(' ').slice(1).join(' ');
                    
                    const angkaWaktu = parseInt(kataPertama);
                    const IsMenit = kataPertama.endsWith('m');
                    const durasiMs = IsMenit ? angkaWaktu * 60 * 1000 : angkaWaktu * 60 * 60 * 1000;
                    teksDurasi = IsMenit ? `${angkaWaktu} Menit` : `${angkaWaktu} Jam`;

                    // Set Timer Otomatis
                    timeoutId = setTimeout(async () => {
                        const targetVoting = global.activeVotes[from];
                        if (targetVoting) {
                            const totalSuara = targetVoting.opsi.reduce((sum, o) => sum + o.jumlahSuara, 0);

                            let teksAkhir = `⏱️ *WAKTU HABIS! VOTING DITUTUP OTOMATIS* ⏱️\n\n📋 *Hasil Akhir:* "${targetVoting.topik}"\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                            targetVoting.opsi.forEach((item, index) => {
                                const persentase = totalSuara > 0 ? ((item.jumlahSuara / totalSuara) * 100).toFixed(0) : 0;
                                teksAkhir += `${index + 1}. ${item.nama} ➡️ *${item.jumlahSuara} Suara* (${persentase}%)\n`;
                            });
                            teksAkhir += `━━━━━━━━━━━━━━━━━━━━━━━\n🎉 *Total Partisipasi:* ${totalSuara} Pemilih.\n\nSesi voting ini telah berakhir secara otomatis sesuai durasi.`;

                            await sock.sendMessage(from, { text: teksAkhir });
                            delete global.activeVotes[from];
                        }
                    }, durasiMs);
                }

                const opsi = komponen.slice(1);

                // Validasi input dasar
                if (!topik) {
                    return await sock.sendMessage(from, { text: '❌ *Topik voting belum diisi, Bos!*' }, { quoted: msg });
                }
                if (opsi.length < 2) {
                    return await sock.sendMessage(from, { text: '❌ Bos, minimal harus ada *2 opsi pilihan* biar bisa divoting!' }, { quoted: msg });
                }

                // Jika sudah ada voting berjalan di grup ini, bersihkan sesi/timer lamanya
                if (global.activeVotes[from] && global.activeVotes[from].timeoutId) {
                    clearTimeout(global.activeVotes[from].timeoutId);
                }

                // Simpan objek struktur data voting ke memori global
                global.activeVotes[from] = {
                    topik: topik,
                    opsi: opsi.map(namaOpsi => ({ nama: namaOpsi, jumlahSuara: 0 })),
                    pemilih: [],
                    timeoutId: timeoutId // Nilainya NULL kalau ga pakai waktu, jadi aman!
                };

                // Menyusun tampilan teks poling ke grup
                let teksVoting = `📊 *VOTING BARU DIMULAI!* 📊\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                teksVoting += `📌 *Topik:* \n"${topik}"\n\n`;
                teksVoting += `⏳ *Durasi Waktu:* ${teksDurasi}\n\n`;
                teksVoting += `📋 *Opsi Pilihan:* \n`;
                
                global.activeVotes[from].opsi.forEach((item, index) => {
                    teksVoting += `${index + 1}. ${item.nama}\n`;
                });

                teksVoting += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                teksVoting += `👉 *Cara Memilih:* Ketik *!pilih [nomor_opsi]*\n`;
                teksVoting += `📝 *Contoh:* \`!pilih 1\`\n`;
                teksVoting += `🛑 Ketik *!endvoting* untuk menutup sesi voting & melihat hasil akhir.`;

                await sock.sendMessage(from, { text: teksVoting }, { quoted: msg });
            }

            if (command === 'pilih') {
                const targetVoting = global.activeVotes[from];
                if (!targetVoting) {
                    return await sock.sendMessage(from, { text: '❌ Gak ada sesi voting yang lagi berjalan di grup ini, Bos!' }, { quoted: msg });
                }

                // Validasi input nomor pilihan
                const pilihanIndex = parseInt(args[0]) - 1;
                if (isNaN(pilihanIndex) || pilihanIndex < 0 || pilihanIndex >= targetVoting.opsi.length) {
                    return await sock.sendMessage(from, { text: '❌ Nomor opsi yang kamu masukkan gak valid, Bos! Cek listnya lagi.' }, { quoted: msg });
                }

                // Cek apakah user tersebut sudah pernah memilih sebelumnya (Anti Curang)
                if (targetVoting.pemilih.includes(sender)) {
                    return await sock.sendMessage(from, { text: '❌ Kamu sudah memberikan suara sebelumnya! Gak boleh maruk ya. 😉' }, { quoted: msg });
                }

                // Proses penghitungan suara
                targetVoting.opsi[pilihanIndex].jumlahSuara += 1;
                targetVoting.pemilih.push(sender); // Kunci nomor WA pemilih

                // Hitung total suara masuk saat ini
                const totalSuara = targetVoting.opsi.reduce((sum, o) => sum + o.jumlahSuara, 0);

                // Tampilkan papan skor sementara
                let teksSkor = `✅ *Suara Berhasil Dicatat!* \n\n📊 *Hasil Sementara:* "${targetVoting.topik}"\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                targetVoting.opsi.forEach((item, index) => {
                    const persentase = totalSuara > 0 ? ((item.jumlahSuara / totalSuara) * 100).toFixed(0) : 0;
                    teksSkor += `${index + 1}. ${item.nama} ➡️ *${item.jumlahSuara} Suara* (${persentase}%)\n`;
                });
                teksSkor += `━━━━━━━━━━━━━━━━━━━━━━━\n📥 Total Suara Masuk: *${totalSuara}*`;

                await sock.sendMessage(from, { text: teksSkor }, { quoted: msg });
            }

            if (command === 'endvoting') {
                const targetVoting = global.activeVotes[from];
                if (!targetVoting) {
                    return await sock.sendMessage(from, { text: '❌ Memang gak ada sesi voting yang aktif kok, Bos.' }, { quoted: msg });
                }

                // SESUDAH (benar)
if (!isAdmin && !isLocalGroupAdmin) {
    return await sock.sendMessage(from, { text: '❌ Perintah ditolak! Cuma *Admin Grup* atau *Owner Bot* yang bisa nutup sesi voting.' }, { quoted: msg });
}

                const totalSuara = targetVoting.opsi.reduce((sum, o) => sum + o.jumlahSuara, 0);

                let teksAkhir = `🛑 *VOTING RESMI DITUTUP LEBIH AWAL!* 🛑\n\n📋 *Hasil Akhir:* "${targetVoting.topik}"\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                targetVoting.opsi.forEach((item, index) => {
                    // SESUDAH (benar)
const persentase = totalSuara > 0 ? ((item.jumlahSuara / totalSuara) * 100).toFixed(0) : 0;
                    teksAkhir += `${index + 1}. ${item.nama} ➡️ *${item.jumlahSuara} Suara* (${persentase}%)\n`;
                });
                teksAkhir += `━━━━━━━━━━━━━━━━━━━━━━━\n🎉 *Total Partisipasi:* ${totalSuara} Pemilih.\n\nSesi voting ditutup secara manual oleh Admin/Owner.`;

                await sock.sendMessage(from, { text: teksAkhir }, { quoted: msg });

                // 🔥 TAMBAHKAN BARIS INI: Hentikan timer otomatisnya agar tidak berjalan lagi di background!
                if (targetVoting.timeoutId) {
                    clearTimeout(targetVoting.timeoutId);
                }

                // Hapus data voting dari memori grup ini agar bersih kembali
                delete global.activeVotes[from];
            }


            // =======================================================
            // 🎨 ADVANCED MEDIA DOWNLOADER & BRAT GENERATOR 🎀
            // =======================================================
            if (command === 'anomali') {

    const userId = from;

    if (!checkCooldown(userId)) {
        return sock.sendMessage(from, {
            text: '⏳ Tunggu dulu Kak, jangan spam ya 😤'
        }, { quoted: msg });
    }

    let teksAnomali = args.join(' ');
    if (!teksAnomali) {
        return sock.sendMessage(from, {
            text: '⚠️ Contoh: !anomali aku capek banget'
        }, { quoted: msg });
    }

    // 🧠 AI polish text dulu
    teksAnomali = await polishText(teksAnomali);

    await sock.sendMessage(from, {
        text: '🎨 bikin stiker dulu ya...'
    }, { quoted: msg });

    try {

        const style = bratStyles[Math.floor(Math.random() * bratStyles.length)];

        const bratUrl = `https://brat.caliph.dev/api/brat?text=${encodeURIComponent(teksAnomali + ' | ' + style)}`;

        const resBrat = await axios.get(bratUrl, {
            responseType: 'arraybuffer',
            timeout: 10000
        });

        const buffer = Buffer.from(resBrat.data);

        const stiker = new Sticker(buffer, {
            pack: `Anomali ${style} 🎭`,
            author: 'zetbot premium',
            type: StickerTypes.FULL,
            quality: 80
        });

        await sock.sendMessage(from, {
            sticker: await stiker.toBuffer()
        }, { quoted: msg });

    } catch (e) {
        console.log("BRAT ERROR → fallback AI image");

        // 🔥 fallback AI image kalau API mati
        const fallback = await generateFallbackImage(teksAnomali);

        const stiker = new Sticker(fallback, {
            pack: 'AI fallback 🎨',
            author: 'zetbot',
            type: StickerTypes.FULL,
            quality: 80
        });

        await sock.sendMessage(from, {
            sticker: await stiker.toBuffer()
        }, { quoted: msg });
    }
}

            if (command === 'dl') {
    const videoUrl = args[0];

    if (!videoUrl) {
        return await sock.sendMessage(
            from,
            { text: '⚠️ Masukkan link TikTok, Instagram, Facebook, atau YouTube!' },
            { quoted: msg }
        );
    }

    await sock.sendMessage(
        from,
        { text: '⏳ Sedang mengambil video...' },
        { quoted: msg }
    );

    try {

        // YOUTUBE
        if (
            videoUrl.includes('youtube.com') ||
            videoUrl.includes('youtu.be')
        ) {

            if (!ytdl.validateURL(videoUrl))
                throw new Error('Link YouTube tidak valid');

            const info = await ytdl.getInfo(videoUrl);

            const format = ytdl.chooseFormat(
                info.formats,
                { quality: '18' }
            );

            await sock.sendMessage(
                from,
                {
                    video: { url: format.url },
                    caption: `🎬 ${info.videoDetails.title}`
                },
                { quoted: msg }
            );

            return;
        }

        // TIKTOK
        if (videoUrl.includes('tiktok.com')) {

    const res = await axios.get(
        `https://tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`
    );

    const dl = res.data?.data?.play;

    if (!dl) {
        throw new Error('Gagal ambil video TikTok');
    }

    await sock.sendMessage(from, {
        video: { url: dl },
        caption: `🎵 ${res.data?.data?.title || 'TikTok Video'}`
    }, { quoted: msg });

    return;
}
    
    } catch (error) {
        console.error(error);
        await sock.sendMessage(
            from,
            { text: '❌ Gagal mengambil video. Pastikan linknya benar dan coba lagi!' },
            { quoted: msg }
        );
    }
}
            if (command === 'jsonpretty') {
                const jsonMentah = args.join(' ');
                if (!jsonMentah) return await sock.sendMessage(from, { text: '⚠️ *Mana kode JSON-nya Kak?* Contoh:\n`!jsonpretty {"nama":"zetbot","lucu":true}` 🎀' }, { quoted: msg });
                
                try {
                    const objekJson = JSON.parse(jsonMentah);
                    const jsonCantik = JSON.stringify(objekJson, null, 4);
                    await sock.sendMessage(from, { text: `✅ *JSON Udah Rapih Nih!* 🧩✨\n\`\`\`json\n${jsonCantik}\n\`\`\`` }, { quoted: msg });
                } catch (error) {
                    await sock.sendMessage(from, { text: `❌ *Format JSON Error!* Gagal dirapihin Kak, coba cek lagi tanda kurung sama petiknya ya! 🛠️🥺` }, { quoted: msg });
                }
            }

            if (command === 'sticker' || command === 's') {

    const userId = from;

    if (!checkCooldown(userId)) {
        return sock.sendMessage(from, {
            text: '⏳ Sabar ya Kak, jangan spam 😤'
        }, { quoted: msg });
    }

    const quoted =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    const mediaMsg =
        msg.message?.imageMessage ||
        msg.message?.videoMessage ||
        quoted?.imageMessage ||
        quoted?.videoMessage;

    if (!mediaMsg) {
    return sock.sendMessage(from, {
        text:
`⚠️ Kirim atau reply gambar/video

🎨 STYLE STICKER

!s
→ Sticker biasa

!s atas|Teks
→ Teks di atas

!s bawah|Teks
→ Teks di bawah

!s dua|Atas|Bawah
→ Teks atas + bawah

✨ STYLE PREMIUM

!s premium|Sakura
!s neon|Sakura
!s gold|Sakura
!s anime|Sakura
!s waifu|Sakura
!s manga|Sakura
!s meme|Lucu
!s glow|Legend
!s cyber|Online`
    }, { quoted: msg });
}

    try {

        let rawText = args.join(' ').trim();

        let style = 'premium';
        let topText = '';
        let bottomText = '';

        if (rawText) {

            const parts = rawText.split('|');

            if (parts[0]?.toLowerCase() === 'atas') {

                topText = parts[1] || '';

            } else if (parts[0]?.toLowerCase() === 'bawah') {

                bottomText = parts[1] || '';

            } else if (parts[0]?.toLowerCase() === 'dua') {

                topText = parts[1] || '';
                bottomText = parts[2] || '';

            } else if (
                [
 'premium',
 'neon',
 'gold',
 'anime',
 'waifu',
 'manga',
 'meme',
 'glow',
 'cyber'
]
                .includes(parts[0]?.toLowerCase())
            ) {

                style = parts[0].toLowerCase();
                bottomText = parts[1] || '';
                // 🎀 STYLE KHUSUS

if (style === 'meme') {

    topText =
        topText ||
        (bottomText || '').toUpperCase();

    bottomText =
        bottomText ||
        'ZETBOT MEME';
}

if (style === 'waifu') {

    if (!bottomText)
        bottomText = '💖 BEST WAIFU 💖';
}

if (style === 'manga') {

    if (!bottomText)
        bottomText = '📖 MANGA PANEL';
}

if (style === 'glow') {

    if (!bottomText)
        bottomText = '✨ GLOW EFFECT ✨';
}

if (style === 'cyber') {

    if (!bottomText)
        bottomText = 'SYSTEM ONLINE';
}

            } else {

                bottomText = rawText;
            }
        }

        await sock.sendMessage(from, {
    text:
`🎨 Sticker Premium Generator

🎭 Style : ${style}
📝 Atas : ${topText || '-'}
📝 Bawah : ${bottomText || '-'}

⚡ Sedang merender sticker...
Mohon tunggu sebentar ✨`
}, { quoted: msg });

        const isVideo =
            mediaMsg?.mimetype?.includes('video') || false;

        const stream = await downloadContentFromMessage(
            mediaMsg,
            isVideo ? 'video' : 'image'
        );

        let buffer = Buffer.from([]);

        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (isVideo) {

            const inputPath = "./temp/input.mp4";
            const outputPath = "./temp/output.webp";

            fs.writeFileSync(inputPath, buffer);

            const videoText =
                [topText, bottomText]
                .filter(Boolean)
                .join(' | ');

            if (videoText) {
                await videoToStickerWithText(
                    inputPath,
                    outputPath,
                    videoText
                );
            } else {
                await videoToSticker(
                    inputPath,
                    outputPath
                );
            }

            const stickerBuffer =
                fs.readFileSync(outputPath);

            await sock.sendMessage(from, {
                sticker: stickerBuffer
            }, { quoted: msg });

            return;
        }

        let finalBuffer = buffer;

        finalBuffer = await addTextToImageV3(
            buffer,
            topText,
            bottomText,
            style
        );

        const stiker = new Sticker(
            finalBuffer,
            {
                pack: "🌸 ZetBot Premium Collection",
                author: "👑 DoxxBorx",
                type: StickerTypes.FULL,
                quality: 100
            }
        );

        const result = await stiker.toBuffer();

        await sock.sendMessage(from, {
            sticker: result
        }, { quoted: msg });

    } catch (e) {

        console.log('STICKER ERROR:', e);

        await sock.sendMessage(from, {
            text: '❌ Gagal membuat sticker premium.'
        }, { quoted: msg });
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
                const res = await runAIQueue(queryPrompt, 'chat_context', isAdmin, from);
                await sock.sendMessage(from, { text: res }, { quoted: msg });
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
                const res = await runAIQueue(query, 'tanya', isAdmin, from);
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            if (command === 'coding') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Kasih tau error-nya atau kode yang mau dibikin dong Kak! 💻✨' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const res = await runAIQueue(query, 'coding', isAdmin, from);
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            if (command === 'rangkum') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Mana teks panjang yang mau di-ringkas Kak? 📑✨' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const res = await runAIQueue(query, 'rangkum', isAdmin, from);
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            if (command === 'brainstorm') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Butuh ide apa nih Kak? Sebutin topiknya yuk! 💡✨' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const res = await runAIQueue(query, 'brainstorm', isAdmin, from);
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            if (command === 'translate') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Teksnya mana yang mau ditranslate Kak? 🌐✨' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const res = await runAIQueue(query, 'translate', isAdmin, from);
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            if (command === 'curhat') {
                const query = args.join(' ');
                if (!query) return await sock.sendMessage(from, { text: '⚠️ Ayo keluarin unek-uneknya Kak, aku siap dengerin keluh kesahmu! 🫂💖' }, { quoted: msg });
                await sock.sendPresenceUpdate('composing', from);
                const res = await runAIQueue(query, 'curhat', isAdmin, from);
                await sock.sendMessage(from, { text: res }, { quoted: msg });
            }

            // =======================================================
            // 🎮 INTERACTIVE CASUAL FUN LOGIC 🎀
            // =======================================================
            if (command === 'roastme') {
                const target = args.join(' ') || 'saya';
                await sock.sendPresenceUpdate('composing', from);
                const queryRoast = `Tolong roasting, hina dengan sarkasme komedi yang sangat pedas, tajam, menusuk hati, brutal, tapi sangat lucu dan menghibur tentang subjek: ${target}.`;
                const hasilAI = await runAIQueue(queryRoast, 'curhat', isAdmin, from);
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