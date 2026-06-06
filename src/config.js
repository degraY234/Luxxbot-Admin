import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegPath);

export const BOT_NAME = 'LuxxBot';
export const PM2_APP_NAME = process.env.name || process.env.PM2_APP_NAME || 'luxx';
export const OWNER_NUMBER = ['6282384961407', '36326967632006'];
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const W2G_API_KEY = process.env.STREAM_TOKEN;
export const W2G_ROOM_FILE = './w2g_room.json';
export const MAX_MEMORY = 12;
export const bratStyles = ['cute', 'dark', 'neon', 'anime', 'glitch', 'minimal'];

export const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const startTime = Date.now();

/** API key xAI / Grok (format xai-...) */
export function getXaiApiKey() {
    return process.env.GROK_API_KEY
        || process.env.XAI_API_KEY
        || (process.env.GROQ_API_KEY?.startsWith('xai-') ? process.env.GROQ_API_KEY : null)
        || null;
}

/** API key Groq.com asli (format gsk_...) — jangan pakai slot GROQ_API_KEY kalau isinya key xAI */
export function getGroqApiKey() {
    const key = process.env.GROQ_API_KEY;
    if (key?.startsWith('gsk_')) return key;
    return process.env.GROQ_API_KEY_ALT || null;
}

console.log('Gemini Key Loaded:', !!process.env.GEMINI_API_KEY);
console.log('OpenAI Key Loaded:', !!process.env.OPENAI_API_KEY);
console.log('Grok (xAI) Key Loaded:', !!getXaiApiKey());
console.log('Groq.com Key Loaded:', !!getGroqApiKey());