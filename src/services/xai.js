import OpenAI from 'openai';
import axios from 'axios';
import { BOT_NAME, getXaiApiKey } from '../config.js';

let xaiClient = null;
let xaiClientKey = null;

export function getXaiClient() {
    const key = getXaiApiKey();
    if (!key) return null;
    if (!xaiClient || xaiClientKey !== key) {
        xaiClient = new OpenAI({ apiKey: key, baseURL: 'https://api.x.ai/v1' });
        xaiClientKey = key;
    }
    return xaiClient;
}

export async function askGrok(text, system, options = {}) {
    const client = getXaiClient();
    if (!client) throw new Error('Grok API key tidak dikonfigurasi');

    const res = await client.chat.completions.create({
        model: options.model || 'grok-3-mini',
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: text }
        ],
        max_tokens: options.max_tokens ?? 2000,
        temperature: options.temperature ?? 0.7
    });
    return res.choices[0]?.message?.content || '';
}

/** Untuk perintah yang sebelumnya memanggil groqAI (darkjokes, cerpen, dll.) */
export async function grokChat(prompt, options = {}) {
    try {
        return await askGrok(
            prompt,
            options.system || `Kamu asisten ${BOT_NAME}. Jawab dalam Bahasa Indonesia, santai dan jelas.`,
            { max_tokens: options.max_tokens ?? 1200, model: options.model }
        );
    } catch (err) {
        const msg = err?.error || err?.message || err;
        console.log('GROK ERROR:', typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200));
        return null;
    }
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
}

/** Generate gambar untuk !buat via Grok Imagine */
export async function generateGrokImage(prompt, options = {}) {
    const client = getXaiClient();
    if (!client) return null;

    const imagePrompt = prompt.length > 900 ? prompt.slice(0, 900) : prompt;
    const timeoutMs = options.timeoutMs ?? 6000;
    const models = options.fast
        ? ['grok-imagine-image']
        : ['grok-imagine-image-quality', 'grok-2-image', 'grok-imagine-image'];

    for (const model of models) {
        try {
            const result = await withTimeout(
                client.images.generate({
                    model,
                    prompt: imagePrompt,
                    n: 1,
                    response_format: 'b64_json',
                    extra_body: { aspect_ratio: '1:1', resolution: '1k' }
                }),
                timeoutMs
            );

            const b64 = result.data?.[0]?.b64_json;
            if (b64) {
                console.log(`GROK image OK: ${model}`);
                return Buffer.from(b64, 'base64');
            }

            const url = result.data?.[0]?.url;
            if (url) {
                const res = await axios.get(url, {
                    responseType: 'arraybuffer',
                    timeout: 90000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                console.log(`GROK image OK (url): ${model}`);
                return Buffer.from(res.data);
            }
        } catch (err) {
            const msg = err?.error || err?.message || err;
            console.log(`GROK image skip ${model}:`, typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200));
        }
    }
    return null;
}