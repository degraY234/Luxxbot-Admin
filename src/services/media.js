import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import { ai, openai, GEMINI_API_KEY } from '../config.js';

const STICKER_SIZE = 512;
const TEXT_BAND_H = 54;

const STYLE_TEXT = {
    premium: { fill: 'white', border: 'black' },
    neon: { fill: 'white', border: '0x00FFFF' },
    gold: { fill: '0xFFD700', border: 'black' },
    anime: { fill: 'white', border: '0xFF1493' },
    waifu: { fill: '0xFFB6C1', border: '0xFF1493' },
    manga: { fill: 'white', border: 'black' },
    meme: { fill: 'white', border: 'black' },
    glow: { fill: 'white', border: '0x00FF88' },
    cyber: { fill: '0x00FFFF', border: 'black' },
    vaporwave: { fill: '0xFF71CE', border: '0x01CDFE' },
    retro: { fill: '0xFFE66D', border: '0xFF006E' },
    love: { fill: '0xFFB6C1', border: '0xFF1493' },
    fire: { fill: 'white', border: '0xFF4500' },
    pastel: { fill: '0xFFF0F5', border: '0xDDA0DD' },
    dark: { fill: '0xE0E0E0', border: '0x333333' },
    minimal: { fill: 'white', border: '0x666666' }
};

function escapeDrawtext(text) {
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:')
        .replace(/%/g, '\\%');
}

/** Bingkai tipis di pinggir — tidak menutupi foto */
function getBorderFilters(style) {
    const thin = (color) => [
        `drawbox=x=0:y=0:w=iw:h=3:color=${color}`,
        `drawbox=x=0:y=ih-3:w=iw:h=3:color=${color}`,
        `drawbox=x=0:y=0:w=3:h=ih:color=${color}`,
        `drawbox=x=iw-3:y=0:w=3:h=ih:color=${color}`
    ];
    switch (style) {
        case 'waifu':
        case 'love':
            return thin('0xFF69B4@0.85');
        case 'cyber':
        case 'neon':
            return thin('0x00FFFF@0.9');
        case 'fire':
            return thin('0xFF4500@0.9');
        case 'gold':
        case 'premium':
            return thin('0xFFD700@0.85');
        case 'vaporwave':
            return thin('0xFF71CE@0.8');
        case 'pastel':
            return thin('0xDDA0DD@0.7');
        case 'dark':
            return thin('0x444444@0.9');
        default:
            return [];
    }
}

function fitFontSize(text, bandH) {
    const len = String(text || '').length;
    const base = Math.floor(bandH * 0.62);
    if (len > 28) return Math.max(20, base - 14);
    if (len > 18) return Math.max(22, base - 8);
    if (len > 12) return Math.max(24, base - 4);
    return Math.min(40, base);
}

function buildDrawtext(text, yPx, style, bandH) {
    const colors = STYLE_TEXT[style] || STYLE_TEXT.premium;
    const size = fitFontSize(text, bandH);
    return [
        `drawtext=text='${escapeDrawtext(text)}'`,
        `fontsize=${size}`,
        `fontcolor=${colors.fill}`,
        'borderw=3',
        `bordercolor=${colors.border}`,
        'box=1',
        'boxcolor=black@0.35',
        'boxborderw=6',
        'x=(w-text_w)/2',
        `y=${yPx}`
    ].join(':');
}

/** Foto di tengah (contain), teks di jalur atas/bawah — tidak menimpa gambar */
function buildStickerComposeFilters(topText = '', bottomText = '', style = 'premium') {
    const topH = topText ? TEXT_BAND_H : 0;
    const bottomH = bottomText ? TEXT_BAND_H : 0;
    const contentH = STICKER_SIZE - topH - bottomH;
    const filters = [
        `scale=512:${contentH}:force_original_aspect_ratio=decrease`,
        `pad=512:${contentH}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
        `pad=512:${STICKER_SIZE}:0:${topH}:color=0x00000000`,
        ...getBorderFilters(style)
    ];

    if (topText) {
        const y = Math.max(6, Math.floor((topH - fitFontSize(topText, topH)) / 2));
        filters.push(buildDrawtext(topText, y, style, topH));
    }
    if (bottomText) {
        const fs = fitFontSize(bottomText, bottomH);
        const y = STICKER_SIZE - bottomH + Math.max(6, Math.floor((bottomH - fs) / 2));
        filters.push(buildDrawtext(bottomText, y, style, bottomH));
    }

    return filters.join(',');
}

export function videoToSticker(inputPath, outputPath) {
    const vf = `scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15`;
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions(['-vf', vf, '-loop', '0', '-ss', '0', '-t', '6'])
            .toFormat('webp')
            .save(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', reject);
    });
}

export function videoToStickerWithText(inputPath, outputPath, topText = '', bottomText = '') {
    const vf = `${buildStickerComposeFilters(topText, bottomText, 'premium')},fps=15`;
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions(['-vf', vf, '-loop', '0', '-ss', '0', '-t', '6'])
            .toFormat('webp')
            .save(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', reject);
    });
}

export const STICKER_STYLES = {
    premium: { label: 'Premium', pack: '🌸 Luxx Premium', defaultBottom: '' },
    neon: { label: 'Neon', pack: '💠 Neon Luxx', defaultBottom: '' },
    gold: { label: 'Gold', pack: '👑 Gold Edition', defaultBottom: '' },
    anime: { label: 'Anime', pack: '🎌 Anime Luxx', defaultBottom: '' },
    waifu: { label: 'Waifu', pack: '💖 Waifu Pack', defaultBottom: '' },
    manga: { label: 'Manga', pack: '📖 Manga Panel', defaultBottom: '' },
    meme: { label: 'Meme', pack: '😂 Meme Lord', defaultBottom: '' },
    glow: { label: 'Glow', pack: '✨ Glow Effect', defaultBottom: '' },
    cyber: { label: 'Cyber', pack: '🤖 Cyber Luxx', defaultBottom: '' },
    vaporwave: { label: 'Vaporwave', pack: '🌴 Vaporwave', defaultBottom: '' },
    retro: { label: 'Retro', pack: '📼 Retro Wave', defaultBottom: '' },
    love: { label: 'Love', pack: '💕 Love Sticker', defaultBottom: '' },
    fire: { label: 'Fire', pack: '🔥 Fire Mode', defaultBottom: '' },
    pastel: { label: 'Pastel', pack: '🧁 Pastel Soft', defaultBottom: '' },
    dark: { label: 'Dark', pack: '🖤 Dark Luxx', defaultBottom: '' },
    minimal: { label: 'Minimal', pack: '⚪ Minimal', defaultBottom: '' }
};

export const STYLE_KEYS = Object.keys(STICKER_STYLES);

export function getStickerHelpText() {
    let t = `🎨 *!s — STICKER* (reply gambar/video)\n`;
    t += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    t += `📌 Foto tetap utuh di tengah, teks di jalur atas/bawah.\n\n`;
    t += `\`!s\` → polos (tanpa teks)\n`;
    t += `\`!s love|Kawaii\` → tema + teks bawah\n`;
    t += `\`!s neon|Halo\` · \`!s gold|Luxx\`\n\n`;
    t += `📝 *Posisi teks:*\n`;
    t += `\`!s atas|Teks\` · \`!s bawah|Teks\`\n`;
    t += `\`!s dua|Atas|Bawah\` · \`!s meme|TOP|BOTTOM\`\n\n`;
    t += `✨ *Tema:* ${STYLE_KEYS.join(', ')}\n`;
    t += `_Format: \`!s <tema>|<teks>\`_`;
    return t;
}

export function parseStickerArgs(args) {
    const rawText = args.join(' ').trim();
    let style = 'premium';
    let topText = '';
    let bottomText = '';

    if (!rawText) return { style, topText, bottomText, help: false };

    if (rawText.toLowerCase() === 'help' || rawText.toLowerCase() === 'menu') {
        return { style, topText, bottomText, help: true };
    }

    const parts = rawText.split('|');
    const firstLower = parts[0]?.toLowerCase().trim();

    if (firstLower === 'atas') topText = parts[1]?.trim() || '';
    else if (firstLower === 'bawah') bottomText = parts[1]?.trim() || '';
    else if (firstLower === 'dua') {
        topText = parts[1]?.trim() || '';
        bottomText = parts[2]?.trim() || '';
    } else if (firstLower === 'random') {
        const pool = STYLE_KEYS.filter((k) => k !== 'minimal');
        style = pool[Math.floor(Math.random() * pool.length)];
        bottomText = parts[1]?.trim() || '';
    } else if (firstLower === 'caption' || firstLower === 'teks') {
        bottomText = parts.slice(1).join('|').trim() || parts[1]?.trim() || '';
    } else if (STYLE_KEYS.includes(firstLower)) {
        style = firstLower;
        if (style === 'meme' && parts.length >= 3) {
            topText = parts[1]?.trim() || 'TOP TEXT';
            bottomText = parts[2]?.trim() || 'BOTTOM TEXT';
        } else if (parts.length >= 3 && !parts[1]?.includes(' ')) {
            topText = parts[1]?.trim() || '';
            bottomText = parts.slice(2).join('|').trim() || parts[2]?.trim() || '';
        } else {
            bottomText = parts.slice(1).join('|').trim() || '';
            if (style === 'meme' && !parts[1]) {
                topText = 'TOP TEXT';
                bottomText = 'BOTTOM TEXT';
            }
        }
    } else if (parts.length >= 2) {
        topText = parts[0]?.trim() || '';
        bottomText = parts.slice(1).join('|').trim() || '';
    } else {
        bottomText = rawText;
    }

    return { style, topText, bottomText, help: false };
}

export async function addTextToImageV3(buffer, topText = '', bottomText = '', style = 'premium') {
    const hasText = Boolean(topText || bottomText);
    const hasBorder = getBorderFilters(style).length > 0;
    if (!hasText && !hasBorder) {
        return composePlainSticker(buffer);
    }

    if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });

    const id = Date.now();
    const inPath = path.join('./temp', `st-in-${id}.jpg`);
    const outPath = path.join('./temp', `st-out-${id}.png`);
    fs.writeFileSync(inPath, buffer);

    const vf = buildStickerComposeFilters(topText, bottomText, style);

    return new Promise((resolve, reject) => {
        ffmpeg(inPath)
            .outputOptions(['-vf', vf, '-frames:v', '1'])
            .output(outPath)
            .on('end', () => {
                try {
                    resolve(fs.readFileSync(outPath));
                } finally {
                    try { fs.unlinkSync(inPath); fs.unlinkSync(outPath); } catch (_) {}
                }
            })
            .on('error', (err) => {
                try { fs.unlinkSync(inPath); } catch (_) {}
                reject(err);
            })
            .run();
    });
}

/** Stiker polos 512×512 — foto contain, tidak crop wajah */
function composePlainSticker(buffer) {
    if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });
    const id = Date.now();
    const inPath = path.join('./temp', `st-plain-${id}.jpg`);
    const outPath = path.join('./temp', `st-plain-out-${id}.png`);
    fs.writeFileSync(inPath, buffer);
    const vf = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';

    return new Promise((resolve, reject) => {
        ffmpeg(inPath)
            .outputOptions(['-vf', vf, '-frames:v', '1'])
            .output(outPath)
            .on('end', () => {
                try {
                    resolve(fs.readFileSync(outPath));
                } finally {
                    try { fs.unlinkSync(inPath); fs.unlinkSync(outPath); } catch (_) {}
                }
            })
            .on('error', (err) => {
                try { fs.unlinkSync(inPath); } catch (_) {}
                reject(err);
            })
            .run();
    });
}

export async function generateFallbackImage(text) {
    try {
        if (process.env.OPENAI_API_KEY) {
            try {
                const result = await openai.images.generate({
                    model: 'dall-e-2',
                    prompt: text,
                    n: 1,
                    size: '512x512',
                    response_format: 'b64_json'
                });
                const b64 = result.data?.[0]?.b64_json;
                if (b64) return Buffer.from(b64, 'base64');
            } catch (openErr) {
                console.log('OpenAI image failed, fallback to Pollinations:', openErr.message);
            }
        }

        try {
            const seed = Math.floor(Math.random() * 999999);
            const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?seed=${seed}`;
            const response = await axios.get(pollUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' }
            });
            if (response.status === 200 && response.data?.length > 0) return Buffer.from(response.data);
        } catch (pollErr) {
            console.log('Pollinations failed:', pollErr.message);
        }

        throw new Error('All image endpoints failed');
    } catch (error) {
        console.error('generateFallbackImage error:', error.message);
        return Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64'
        );
    }
}

export async function polishText(text, timeoutMs = 4000) {
    if (!text || !GEMINI_API_KEY) return text;
    try {
        const result = await Promise.race([
            ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: `Perbaiki teks ini jadi aesthetic, pendek, keren untuk sticker (max 40 karakter):\n"${text}"`
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
        ]);
        return result.text?.trim()?.slice(0, 80) || text;
    } catch {
        return text;
    }
}