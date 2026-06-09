import dotenv from 'dotenv';

dotenv.config({ override: true });
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import { configureFluentFfmpeg } from './utils/ffmpeg-path.js';

configureFluentFfmpeg(ffmpeg);

export const BOT_NAME = 'LuxxBot';
export const PM2_APP_NAME = process.env.name || process.env.PM2_APP_NAME || 'luxx';
export const OWNER_NUMBER = ['6282384961407', '36326967632006'];
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
export const W2G_API_KEY = process.env.STREAM_TOKEN;
export const W2G_ROOM_FILE = './w2g_room.json';
export const MAX_MEMORY = 18;
/** Model teks — flash utama (lite sering 429 di free tier) */
export const GEMINI_TEXT_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite'
];

/** Model vision (OCR, !lihat) — sama lite biar hemat kuota */
export const GEMINI_VISION_MODEL = 'gemini-2.5-flash-lite';

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
console.log('Pollinations Key Loaded:', !!(process.env.POLLINATIONS_KEY || process.env.POLLINATIONS_API_KEY));
console.log('ModelArk Key Loaded:', !!(process.env.MODEL_ARK_API_KEY || process.env.MODELARK_API_KEY || process.env.MODEL_ARK || process.env.MODEL_ARk));