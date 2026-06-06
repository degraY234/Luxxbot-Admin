import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import { ai, openai, GEMINI_API_KEY } from '../config.js';

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

function getBorderFilters(style) {
    switch (style) {
        case 'waifu':
        case 'love':
            return ['drawbox=x=0:y=0:w=iw:h=ih:color=0xFF69B4@0.35:t=18'];
        case 'cyber':
        case 'vaporwave':
            return ['drawbox=x=16:y=16:w=iw-32:h=ih-32:color=0x00FFFF@0.5:t=6'];
        case 'fire':
            return ['drawbox=x=8:y=8:w=iw-16:h=ih-16:color=0xFF4500@0.6:t=12'];
        case 'premium':
        case 'gold':
            return ['drawbox=x=6:y=6:w=iw-12:h=ih-12:color=0xFFD700@0.45:t=10'];
        case 'dark':
            return ['drawbox=x=0:y=0:w=iw:h=ih:color=black@0.25:t=9999'];
        case 'pastel':
            return ['drawbox=x=0:y=0:w=iw:h=ih:color=0xFFB6C1@0.2:t=9999'];
        default:
            return [];
    }
}

function buildDrawtext(text, yExpr, style) {
    const colors = STYLE_TEXT[style] || STYLE_TEXT.premium;
    const size = Math.min(72, Math.max(36, Math.floor(text.length > 20 ? 40 : 52)));
    return [
        `drawtext=text='${escapeDrawtext(text)}'`,
        `fontsize=${size}`,
        `fontcolor=${colors.fill}`,
        'borderw=5',
        `bordercolor=${colors.border}`,
        'box=1',
        'boxcolor=black@0.45',
        'boxborderw=10',
        'x=(w-text_w)/2',
        `y=${yExpr}`
    ].join(':');
}

export function videoToSticker(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions(['-vf', 'scale=512:512:force_original_aspect_ratio=cover,fps=15', '-loop', '0', '-ss', '0', '-t', '6'])
            .toFormat('webp')
            .save(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', reject);
    });
}

export function videoToStickerWithText(inputPath, outputPath, text) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .outputOptions([
                '-vf',
                `scale=512:512:force_original_aspect_ratio=cover,fps=15,drawtext=text='${text.replace(/'/g, "\\'")}':fontcolor=white:fontsize=28:box=1:boxcolor=black@0.5:boxborderw=5:x=(w-text_w)/2:y=h-80`
            ])
            .toFormat('webp')
            .save(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', reject);
    });
}

export const STICKER_STYLES = {
    premium: { label: 'Premium', pack: '🌸 Luxx Premium', defaultBottom: '' },
    neon: { label: 'Neon', pack: '💠 Neon Luxx', defaultBottom: 'NEON VIBES' },
    gold: { label: 'Gold', pack: '👑 Gold Edition', defaultBottom: 'GOLDEN' },
    anime: { label: 'Anime', pack: '🎌 Anime Luxx', defaultBottom: 'ANIME MODE' },
    waifu: { label: 'Waifu', pack: '💖 Waifu Pack', defaultBottom: 'BEST WAIFU' },
    manga: { label: 'Manga', pack: '📖 Manga Panel', defaultBottom: 'MANGA PANEL' },
    meme: { label: 'Meme', pack: '😂 Meme Lord', defaultBottom: 'LUXX MEME' },
    glow: { label: 'Glow', pack: '✨ Glow Effect', defaultBottom: 'GLOW UP' },
    cyber: { label: 'Cyber', pack: '🤖 Cyber Luxx', defaultBottom: 'SYSTEM ONLINE' },
    vaporwave: { label: 'Vaporwave', pack: '🌴 Vaporwave', defaultBottom: 'A E S T H E T I C' },
    retro: { label: 'Retro', pack: '📼 Retro Wave', defaultBottom: 'RETRO 90s' },
    love: { label: 'Love', pack: '💕 Love Sticker', defaultBottom: 'SEND LOVE' },
    fire: { label: 'Fire', pack: '🔥 Fire Mode', defaultBottom: 'TOO HOT' },
    pastel: { label: 'Pastel', pack: '🧁 Pastel Soft', defaultBottom: 'SOFT VIBES' },
    dark: { label: 'Dark', pack: '🖤 Dark Luxx', defaultBottom: 'DARK MODE' },
    minimal: { label: 'Minimal', pack: '⚪ Minimal', defaultBottom: '' }
};

export const STYLE_KEYS = Object.keys(STICKER_STYLES);

export function getStickerHelpText() {
    let t = `🎨 *STICKER LUXX* — reply gambar/video\n\n`;
    t += `📝 *Teks:*\n`;
    t += `\`!s atas|Teks atas\`\n\`!s bawah|Teks bawah\`\n\`!s dua|Atas|Bawah\`\n\n`;
    t += `✨ *Tema (${STYLE_KEYS.length} style):*\n`;
    t += `\`!s random|caption acak\`\n`;
    t += STYLE_KEYS.map((k) => `\`!s ${k}|caption\``).join('\n');
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
        bottomText = parts[1]?.trim() || STICKER_STYLES[style].defaultBottom || '';
    } else if (STYLE_KEYS.includes(firstLower)) {
        style = firstLower;
        if (style === 'meme' && parts.length >= 3) {
            topText = parts[1]?.trim() || 'TOP TEXT';
            bottomText = parts[2]?.trim() || 'BOTTOM TEXT';
        } else {
            bottomText = parts[1]?.trim() || STICKER_STYLES[style].defaultBottom || '';
            if (style === 'meme' && !parts[1]) {
                topText = 'TOP TEXT';
                bottomText = 'BOTTOM TEXT';
            }
        }
    } else {
        bottomText = rawText;
    }

    return { style, topText, bottomText, help: false };
}

/** Render teks + border tema via ffmpeg (tanpa canvas — aman di PM2 Windows) */
export async function addTextToImageV3(buffer, topText = '', bottomText = '', style = 'premium') {
    const hasText = Boolean(topText || bottomText);
    const hasBorder = getBorderFilters(style).length > 0;
    if (!hasText && !hasBorder) return buffer;

    if (!fs.existsSync('./temp')) fs.mkdirSync('./temp', { recursive: true });

    const id = Date.now();
    const inPath = path.join('./temp', `st-in-${id}.jpg`);
    const outPath = path.join('./temp', `st-out-${id}.png`);
    fs.writeFileSync(inPath, buffer);

    const filters = [...getBorderFilters(style)];
    if (topText) filters.push(buildDrawtext(topText, '48', style));
    if (bottomText) filters.push(buildDrawtext(bottomText, 'h-th-72', style));

    const vf = filters.join(',');

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
                model: 'gemini-1.5-flash',
                contents: `Perbaiki teks ini jadi aesthetic, pendek, keren untuk sticker (max 40 karakter):\n"${text}"`
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
        ]);
        return result.text?.trim()?.slice(0, 80) || text;
    } catch {
        return text;
    }
}