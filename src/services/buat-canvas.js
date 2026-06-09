/** Lazy-load canvas — modul native bisa gagal di Windows & mematikan seluruh bot */

import { renderTextCard } from './card-image.js';

const COLOR_MAP = {
    oranye: '#ff8c32', orange: '#ff8c32', merah: '#e74c3c', red: '#e74c3c',
    biru: '#3498db', blue: '#3498db', hijau: '#2ecc71', green: '#2ecc71',
    kuning: '#f1c40f', yellow: '#f1c40f', ungu: '#9b59b6', purple: '#9b59b6',
    pink: '#ff69b4', putih: '#ecf0f1', white: '#ecf0f1', hitam: '#2c3e50', black: '#2c3e50',
    coklat: '#8B4513', brown: '#8B4513', abu: '#95a5a6', gray: '#95a5a6'
};

const SUBJECT_MAP = {
    kucing: 'cat', cat: 'cat', anjing: 'dog', dog: 'dog', burung: 'bird', bird: 'bird',
    kelinci: 'rabbit', rabbit: 'rabbit', panda: 'panda', robot: 'robot', manusia: 'person', orang: 'person'
};

let canvasModule = null;
let canvasLoadFailed = false;

async function getCanvas() {
    if (canvasLoadFailed) return null;
    if (canvasModule) return canvasModule;
    try {
        canvasModule = await import('canvas');
        return canvasModule;
    } catch (e) {
        canvasLoadFailed = true;
        console.log('canvas module tidak tersedia:', e.message);
        return null;
    }
}

function parseBuatPrompt(text) {
    const t = text.toLowerCase();
    const meta = {
        subject: 'cat',
        subjectColor: '#ff8c32',
        object: null,
        objectColor: '#3498db',
        style: 'cartoon',
        softLight: false
    };

    for (const [id, en] of Object.entries(SUBJECT_MAP)) {
        if (t.includes(id)) { meta.subject = en; break; }
    }
    if (t.includes('sofa')) meta.object = 'sofa';
    if (t.includes('meja') || t.includes('table')) meta.object = 'table';
    if (t.includes('kartun') || t.includes('cartoon')) meta.style = 'cartoon';
    if (t.includes('3d')) meta.style = '3d';
    if (t.includes('anime')) meta.style = 'anime';
    if (t.includes('cahaya lembut') || t.includes('soft light')) meta.softLight = true;

    if (t.includes('oranye') || t.includes('orange')) meta.subjectColor = COLOR_MAP.orange;
    if (t.includes('biru') || t.includes('blue') && t.includes('sofa')) meta.objectColor = COLOR_MAP.blue;

    return meta;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawSofa(ctx, color, x, y, scale) {
    const s = scale;
    ctx.fillStyle = color;
    roundRect(ctx, x, y + 40 * s, 420 * s, 120 * s, 30 * s);
    ctx.fill();
    ctx.fillStyle = shadeColor(color, -25);
    roundRect(ctx, x - 20 * s, y, 80 * s, 200 * s, 25 * s);
    ctx.fill();
    roundRect(ctx, x + 360 * s, y, 80 * s, 200 * s, 25 * s);
    ctx.fill();
    ctx.fillStyle = shadeColor(color, 15);
    roundRect(ctx, x + 40 * s, y + 20 * s, 340 * s, 90 * s, 20 * s);
    ctx.fill();
}

function shadeColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + percent));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + percent));
    const b = Math.min(255, Math.max(0, (num & 0xff) + percent));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function drawCat(ctx, color, x, y, scale) {
    const s = scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x + 120 * s, y + 100 * s, 90 * s, 70 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 180 * s, y + 55 * s, 55 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shadeColor(color, -30);
    ctx.beginPath();
    ctx.moveTo(x + 140 * s, y + 20 * s);
    ctx.lineTo(x + 165 * s, y - 25 * s);
    ctx.lineTo(x + 190 * s, y + 25 * s);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 200 * s, y + 20 * s);
    ctx.lineTo(x + 225 * s, y - 25 * s);
    ctx.lineTo(x + 250 * s, y + 25 * s);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + 168 * s, y + 50 * s, 12 * s, 0, Math.PI * 2);
    ctx.arc(x + 208 * s, y + 50 * s, 12 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(x + 170 * s, y + 50 * s, 6 * s, 0, Math.PI * 2);
    ctx.arc(x + 210 * s, y + 50 * s, 6 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = shadeColor(color, -40);
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(x + 155 * s, y + 72 * s);
    ctx.quadraticCurveTo(x + 190 * s, y + 85 * s, x + 225 * s, y + 72 * s);
    ctx.stroke();
}

function drawBackground(ctx, w, h, soft) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    if (soft) {
        g.addColorStop(0, '#ffeef8');
        g.addColorStop(0.5, '#e8f4fc');
        g.addColorStop(1, '#fff5e6');
    } else {
        g.addColorStop(0, '#667eea');
        g.addColorStop(1, '#764ba2');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (soft) {
        const glow = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, w * 0.6);
        glow.addColorStop(0, 'rgba(255,255,255,0.45)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
    }
}

/**
 * Ilustrasi lokal — async, tidak crash bot jika canvas.dll rusak.
 */
export async function generateCanvasBuatImage(userPrompt) {
    const canvas = await getCanvas();
    if (!canvas?.createCanvas) return null;

    const { createCanvas } = canvas;
    const meta = parseBuatPrompt(userPrompt);
    const w = 1024;
    const h = 1024;
    const cvs = createCanvas(w, h);
    const ctx = cvs.getContext('2d');

    drawBackground(ctx, w, h, meta.softLight);

    if (meta.object === 'sofa') {
        drawSofa(ctx, meta.objectColor, 280, 520, 1);
    }

    drawCat(ctx, meta.subjectColor, meta.object === 'sofa' ? 320 : 350, meta.object === 'sofa' ? 430 : 480, meta.style === '3d' ? 1.15 : 1);

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '22px sans-serif';
    ctx.fillText('LuxxBot · ilustrasi sesuai prompt', 24, h - 28);

    return {
        buffer: cvs.toBuffer('image/png'),
        source: 'luxx-canvas',
        meta
    };
}

const SUBJECT_LABEL = {
    cat: '🐱 Kucing', dog: '🐶 Anjing', bird: '🐦 Burung', rabbit: '🐰 Kelinci',
    panda: '🐼 Panda', robot: '🤖 Robot', person: '🧑 Orang'
};

function hexToFfmpegColor(hex) {
    const h = String(hex || '#FF69B4').replace('#', '');
    return `0x${h.length === 6 ? h : 'FF69B4'}`;
}

/**
 * Kartu ilustrasi via ffmpeg (tanpa node-canvas) — selalu jalan di Windows/PM2.
 */
export async function generateFfmpegBuatImage(userPrompt) {
    const meta = parseBuatPrompt(userPrompt);
    const promptLines = userPrompt
        .replace(/\s+/g, ' ')
        .trim()
        .match(/.{1,36}/g) || [userPrompt.slice(0, 36)];

    const lines = [
        '🎨 ILUSTRASI LUXXBOT',
        '━━━━━━━━━━━━━━━━',
        '',
        ...promptLines.slice(0, 6),
        '',
        SUBJECT_LABEL[meta.subject] || `🎭 ${meta.subject}`,
        meta.object ? `🛋️ ${meta.object}` : null,
        `Gaya: ${meta.style}${meta.softLight ? ' · cahaya lembut' : ''}`,
        '',
        '_API gambar AI habis kredit —',
        '_kartu dari deskripsi prompt kamu_',
        '',
        '💎 LuxxBot'
    ].filter(Boolean);

    const buffer = await renderTextCard({
        width: 1024,
        height: 1024,
        bg: meta.softLight ? '0x2d3436' : '0x1a1a2e',
        lines,
        accent: hexToFfmpegColor(meta.subjectColor)
    });

    return { buffer, source: 'luxx-ffmpeg', meta };
}

export async function generateBuatArtCard(userPrompt, enginePrompt) {
    const idLines = (userPrompt.replace(/\s+/g, ' ').trim().match(/.{1,34}/g) || [userPrompt]).slice(0, 3);
    const enLines = (enginePrompt.replace(/\s+/g, ' ').trim().match(/.{1,40}/g) || [enginePrompt]).slice(0, 6);
    const lines = [
        '✨ LUXXBOT !buat',
        '━━━━━━━━━━━━━━━━',
        '📝 Prompt kamu:',
        ...idLines,
        '',
        '🤖 Diterjemahkan AI:',
        ...enLines,
        '',
        '⏳ Mesin gambar sedang sibuk.',
        'Prompt sudah dioptimalkan —',
        'coba lagi 1–2 menit untuk',
        'hasil gambar AI penuh.',
        '',
        '💎 LuxxBot'
    ];

    const buffer = await renderTextCard({
        width: 1024,
        height: 1024,
        bg: '0x0a1420',
        lines,
        accent: '0x1E90FF'
    });

    return { buffer, source: 'luxx-artcard' };
}

export function translatePromptLocal(userInput) {
    let t = userInput.trim();
    const pairs = [
        [/kucing/gi, 'cat'], [/anjing/gi, 'dog'], [/burung/gi, 'bird'], [/panda/gi, 'panda'],
        [/oranye/gi, 'orange'], [/merah/gi, 'red'], [/biru/gi, 'blue'], [/hijau/gi, 'green'],
        [/ungu/gi, 'purple'], [/kuning/gi, 'yellow'], [/putih/gi, 'white'], [/hitam/gi, 'black'],
        [/kacamata/gi, 'glasses'], [/topi/gi, 'hat'], [/mobil/gi, 'car'], [/motor/gi, 'motorcycle'],
        [/pemandangan/gi, 'landscape'], [/gunung/gi, 'mountain'], [/pantai/gi, 'beach'],
        [/kartun/gi, 'cartoon'], [/anime/gi, 'anime'], [/realistis/gi, 'photorealistic'],
        [/cahaya lembut/gi, 'soft lighting'], [/malam/gi, 'night'], [/siang/gi, 'daytime'],
        [/duduk/gi, 'sitting'], [/berdiri/gi, 'standing'], [/lucu/gi, 'cute'], [/keren/gi, 'cool'],
        [/pakai/gi, 'wearing'], [/dengan/gi, 'with'], [/di /gi, 'on ']
    ];
    for (const [re, rep] of pairs) t = t.replace(re, rep);
    return (
        `${t}, photorealistic photograph, natural lighting, ` +
        'sharp focus, realistic textures, DSLR 85mm, ultra HD 8K, no watermark, no text, not cartoon, not illustration.'
    );
}