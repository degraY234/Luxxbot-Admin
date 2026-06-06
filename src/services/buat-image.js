import axios from 'axios';
import { openai, getXaiApiKey } from '../config.js';
import { imageCache } from '../state.js';
import { generateGrokImage } from './xai.js';
import {
    generateCanvasBuatImage,
    generateFfmpegBuatImage,
    translatePromptLocal
} from './buat-canvas.js';

const CACHE_MAX = 50;
const CLOUD_BUDGET_MS = Number(process.env.BUAT_CLOUD_MS) || 8000;
const CLOUD_QUICK_MS = Number(process.env.BUAT_CLOUD_QUICK_MS) || 2500;
const PROVIDER_COOLDOWN_MS = 20 * 60 * 1000;
const POLLINATIONS_TIMEOUT = 8000;
const HORDE_TIMEOUT_MS = 35000;
const HORDE_POLL_MS = 2500;
const HORDE_HEADERS = {
    'Content-Type': 'application/json',
    apikey: process.env.STABLE_HORDE_API_KEY || '0000000000',
    'Client-Agent': 'LuxxBot:3.1:doxxborx'
};

/** Provider yang baru gagal (no credit / billing) — jangan tunggu lagi 20 menit */
const providerCooldown = new Map();

function withTimeout(promise, ms, label = 'op') {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
        )
    ]);
}

function markProviderCooldown(name, err) {
    const msg = String(err?.message || err || '').toLowerCase();
    const code = err?.response?.status;
    const noCredit =
        msg.includes('credit') || msg.includes('billing') || msg.includes('quota') ||
        msg.includes('licenses') || code === 402 || code === 403 || code === 429;
    if (noCredit) providerCooldown.set(name, Date.now() + PROVIDER_COOLDOWN_MS);
}

function isProviderCooling(name) {
    const until = providerCooldown.get(name);
    if (!until) return false;
    if (Date.now() >= until) {
        providerCooldown.delete(name);
        return false;
    }
    return true;
}

function cacheSet(key, buffer) {
    if (imageCache.size >= CACHE_MAX) {
        const oldest = imageCache.keys().next().value;
        imageCache.delete(oldest);
    }
    imageCache.set(key, buffer);
}

function buildBuatPrompt(userInput) {
    return translatePromptLocal(userInput);
}

async function fetchImageBuffer(url, timeout = POLLINATIONS_TIMEOUT) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxRedirects: 5,
        validateStatus: (s) => s === 200,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'image/*' }
    });
    const buffer = Buffer.from(response.data);
    if (buffer.length < 2000) throw new Error('Response bukan gambar valid');
    return buffer;
}

async function tryPollinations(prompt, seed) {
    const encoded = encodeURIComponent(prompt.slice(0, 500));
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&seed=${seed}&nologo=true`;
    try {
        return await fetchImageBuffer(url, POLLINATIONS_TIMEOUT);
    } catch (e) {
        markProviderCooldown('pollinations', e);
        console.log(`Pollinations skip (${e.response?.status || 'err'}):`, e.message);
        return null;
    }
}

async function tryOpenAI(prompt) {
    if (!process.env.OPENAI_API_KEY || isProviderCooling('openai')) return null;

    try {
        const result = await withTimeout(
            openai.images.generate({
                model: 'dall-e-2',
                prompt: prompt.slice(0, 1000),
                n: 1,
                size: '512x512'
            }),
            6000,
            'openai'
        );
        const url = result.data?.[0]?.url;
        if (url) return { buffer: await fetchImageBuffer(url, 8000), source: 'dall-e-2' };
    } catch (e) {
        markProviderCooldown('openai', e);
        console.log('OpenAI skip:', e.message?.slice(0, 80));
    }
    return null;
}

async function tryHuggingFace(prompt) {
    const token = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim();
    if (!token || isProviderCooling('huggingface')) return null;

    try {
        const { data } = await withTimeout(
            axios.post(
                'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
                { inputs: prompt.slice(0, 500) },
                {
                    responseType: 'arraybuffer',
                    timeout: 8000,
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'LuxxBot/3.1'
                    }
                }
            ),
            8000,
            'huggingface'
        );
        if (data?.byteLength > 2000) return { buffer: Buffer.from(data), source: 'huggingface' };
    } catch (e) {
        markProviderCooldown('huggingface', e);
        console.log('HF skip:', e.response?.status || e.message);
    }
    return null;
}

async function tryTogether(prompt) {
    const key = process.env.TOGETHER_API_KEY?.trim();
    if (!key || isProviderCooling('together')) return null;

    try {
        const { data } = await withTimeout(
            axios.post(
                'https://api.together.xyz/v1/images/generations',
                {
                    model: 'black-forest-labs/FLUX.1-schnell',
                    prompt: prompt.slice(0, 800),
                    width: 768,
                    height: 768,
                    n: 1,
                    response_format: 'b64_json'
                },
                {
                    timeout: 8000,
                    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
                }
            ),
            8000,
            'together'
        );
        const b64 = data?.data?.[0]?.b64_json;
        if (b64) return { buffer: Buffer.from(b64, 'base64'), source: 'together' };
        const url = data?.data?.[0]?.url;
        if (url) return { buffer: await fetchImageBuffer(url, 8000), source: 'together' };
    } catch (e) {
        markProviderCooldown('together', e);
        console.log('Together skip:', e.response?.data?.error?.message || e.message);
    }
    return null;
}

async function stableHordeGenerate(prompt) {
    const { data: job } = await axios.post(
        'https://stablehorde.net/api/v2/generate/async',
        {
            prompt,
            params: { width: 768, height: 768, steps: 20, cfg_scale: 7.5 },
            nsfw: false,
            censor_nsfw: true
        },
        { headers: HORDE_HEADERS, timeout: 15000 }
    );

    if (!job?.id) throw new Error('Stable Horde tidak merespons');

    const deadline = Date.now() + HORDE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, HORDE_POLL_MS));
        const { data: check } = await axios.get(`https://stablehorde.net/api/v2/generate/check/${job.id}`, {
            timeout: 8000,
            headers: { apikey: HORDE_HEADERS.apikey, 'Client-Agent': HORDE_HEADERS['Client-Agent'] }
        });
        if (!check.done) continue;

        const { data: status } = await axios.get(`https://stablehorde.net/api/v2/generate/status/${job.id}`, {
            timeout: 8000,
            headers: { apikey: HORDE_HEADERS.apikey, 'Client-Agent': HORDE_HEADERS['Client-Agent'] }
        });
        const img = status.generations?.[0]?.img;
        if (!img) throw new Error('Stable Horde tidak mengembalikan gambar');

        if (img.startsWith('http')) return await fetchImageBuffer(img, 15000);
        return Buffer.from(img, 'base64');
    }
    throw new Error('Stable Horde timeout');
}

async function tryCloudParallel(enginePrompt, userPrompt, seed) {
    if (process.env.BUAT_FAST_LOCAL === '1' || process.env.BUAT_FAST_LOCAL === 'true') {
        return null;
    }

    const grokPrompt = `${userPrompt}. ${enginePrompt}`.slice(0, 900);
    const tasks = [];

    if (!isProviderCooling('grok') && getXaiApiKey()) {
        tasks.push(
            (async () => {
                try {
                    const buf = await generateGrokImage(grokPrompt, { fast: true, timeoutMs: 5500 });
                    if (buf) return { buffer: buf, source: 'grok-imagine', aiGenerated: true };
                } catch (e) {
                    markProviderCooldown('grok', e);
                }
                return null;
            })()
        );
    }

    if (process.env.OPENAI_API_KEY) {
        tasks.push(
            (async () => {
                const r = await tryOpenAI(enginePrompt);
                return r ? { ...r, aiGenerated: true } : null;
            })()
        );
    }

    if (process.env.TOGETHER_API_KEY?.trim()) {
        tasks.push(
            (async () => {
                const r = await tryTogether(enginePrompt);
                return r ? { ...r, aiGenerated: true } : null;
            })()
        );
    }

    const hfToken = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim();
    if (hfToken) {
        tasks.push(
            (async () => {
                const r = await tryHuggingFace(enginePrompt);
                return r ? { ...r, aiGenerated: true } : null;
            })()
        );
    }

    if (
        (process.env.POLLINATIONS_ENABLED === '1' || process.env.POLLINATIONS_ENABLED === 'true') &&
        !isProviderCooling('pollinations')
    ) {
        tasks.push(
            (async () => {
                const buf = await tryPollinations(enginePrompt, seed);
                return buf ? { buffer: buf, source: 'pollinations', aiGenerated: true } : null;
            })()
        );
    }

    const hordeKey = process.env.STABLE_HORDE_API_KEY?.trim();
    if (hordeKey && hordeKey !== '0000000000' && !isProviderCooling('stablehorde')) {
        tasks.push(
            (async () => {
                try {
                    const buf = await withTimeout(stableHordeGenerate(enginePrompt), 12000, 'horde');
                    return { buffer: buf, source: 'stablehorde', aiGenerated: true };
                } catch (e) {
                    markProviderCooldown('stablehorde', e);
                    return null;
                }
            })()
        );
    }

    if (!tasks.length) return null;

    const wrapped = tasks.map((t) =>
        t.then((r) => (r?.buffer ? r : Promise.reject(new Error('empty'))))
    );

    try {
        return await withTimeout(Promise.any(wrapped), CLOUD_BUDGET_MS, 'cloud');
    } catch {
        const settled = await Promise.allSettled(wrapped);
        for (const s of settled) {
            if (s.status === 'fulfilled' && s.value?.buffer) return s.value;
        }
        return null;
    }
}

async function generateLocalBuat(userPrompt) {
    const canvas = await generateCanvasBuatImage(userPrompt);
    if (canvas?.buffer) return { buffer: canvas.buffer, source: canvas.source };

    const ffmpegImg = await generateFfmpegBuatImage(userPrompt);
    if (ffmpegImg?.buffer) return { buffer: ffmpegImg.buffer, source: ffmpegImg.source };

    return null;
}

/**
 * Generate gambar !buat — cloud paralel (max ~10s), lalu ilustrasi lokal cepat.
 */
export async function generateBuatImage(deskripsi) {
    const userPrompt = deskripsi.trim();
    if (!userPrompt) throw new Error('Prompt kosong');

    const enginePrompt = buildBuatPrompt(userPrompt);
    const cacheKey = `${userPrompt.toLowerCase()}|buat-v2`;

    if (imageCache.has(cacheKey)) {
        const cached = imageCache.get(cacheKey);
        return {
            buffer: cached.buffer,
            source: cached.source,
            seed: null,
            userPrompt,
            enginePrompt,
            aiGenerated: cached.aiGenerated
        };
    }

    const seed = Math.floor(Math.random() * 999999);
    const failures = [];
    const t0 = Date.now();

    const cloudP = tryCloudParallel(enginePrompt, userPrompt, seed);
    let cloud = await Promise.race([
        cloudP,
        new Promise((resolve) => setTimeout(() => resolve(null), CLOUD_QUICK_MS))
    ]);

    if (!cloud?.buffer) {
        const localQuick = await generateLocalBuat(userPrompt);
        if (localQuick?.buffer) {
            cloud = null;
            const out = {
                buffer: localQuick.buffer,
                source: localQuick.source,
                seed: null,
                userPrompt,
                enginePrompt,
                aiGenerated: false,
                failures: ['Cloud: belum siap — ilustrasi lokal dulu']
            };
            cacheSet(cacheKey, { buffer: out.buffer, source: out.source, aiGenerated: false });
            console.log(`!buat cepat (${localQuick.source}) ${Date.now() - t0}ms`);
            cloudP.catch(() => {});
            return out;
        }
        cloud = await cloudP;
    }

    if (cloud?.buffer) {
        const out = {
            buffer: cloud.buffer,
            source: cloud.source,
            seed: cloud.source === 'pollinations' ? seed : null,
            userPrompt,
            enginePrompt,
            aiGenerated: true
        };
        cacheSet(cacheKey, { buffer: out.buffer, source: out.source, aiGenerated: true });
        console.log(`!buat cloud OK (${cloud.source}) ${Date.now() - t0}ms`);
        return out;
    }

    failures.push('Cloud: timeout / kredit habis');

    const local = await generateLocalBuat(userPrompt);
    if (local?.buffer) {
        const out = {
            buffer: local.buffer,
            source: local.source,
            seed: null,
            userPrompt,
            enginePrompt,
            aiGenerated: false,
            failures
        };
        cacheSet(cacheKey, { buffer: out.buffer, source: out.source, aiGenerated: false });
        console.log(`!buat lokal OK (${local.source}) ${Date.now() - t0}ms`);
        return out;
    }

    throw new Error('Gagal render gambar. Cek ffmpeg atau top-up kredit Grok/OpenAI.');
}