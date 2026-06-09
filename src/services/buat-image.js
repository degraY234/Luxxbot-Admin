import axios from 'axios';
import { ai, openai, getXaiApiKey, GEMINI_API_KEY } from '../config.js';
import { imageCache } from '../state.js';
import { generateGrokImage } from './xai.js';
import { enhanceBuatPrompt } from './buat-prompt.js';

const CACHE_MAX = 50;
const CLOUD_BUDGET_MS = Number(process.env.BUAT_CLOUD_MS) || 45000;
const PROVIDER_COOLDOWN_MS = 20 * 60 * 1000;
const POLLINATIONS_TIMEOUT = 90000;
const HORDE_TIMEOUT_MS = Number(process.env.BUAT_HORDE_MS) || 90000;
const HORDE_POLL_MS = 2000;
const MODEL_ARK_KEY = process.env.MODEL_ARK_API_KEY?.trim()
    || process.env.MODELARK_API_KEY?.trim()
    || process.env.MODEL_ARK?.trim()
    || process.env.MODEL_ARk?.trim()
    || null;
const MODEL_ARK_BASE = (process.env.MODEL_ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, '');
const MODEL_ARK_TIMEOUT = Number(process.env.MODEL_ARK_TIMEOUT_MS) || 120000;
const MODEL_ARK_MODELS = [
    process.env.MODEL_ARK_IMAGE_MODEL?.trim(),
    'seedream-5-0-260128',
    'seedream-4-5-251128',
    'seedream-4-0-250828',
    'seedream-3-0-t2i-250415'
].filter(Boolean);
const POLLINATIONS_KEY = process.env.POLLINATIONS_KEY?.trim()
    || process.env.POLLINATIONS_API_KEY?.trim()
    || null;
const POLLINATIONS_SIZE = Number(process.env.BUAT_POLLINATIONS_SIZE) || 1024;
const HORDE_SIZES = [512, 768, 832];

/** Model Pollinations — hemat dulu, lalu premium */
const POLLINATIONS_PHOTO_MODELS = [
    { model: 'klein', quality: 'high' },
    { model: 'gptimage', quality: 'high' },
    { model: 'flux', quality: 'hd' },
    { model: 'zimage', quality: 'hd', negative: true },
    { model: 'gptimage-large', quality: 'high' },
    { model: 'seedream', quality: 'high' },
    { model: 'seedream-pro', quality: 'high' }
];

const GEMINI_IMAGE_MODELS = [
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image'
];
const PHOTO_SUFFIX = ', ultra detailed, 8K UHD, photorealistic, DSLR, sharp focus, natural lighting, not cartoon, not anime';
const PHOTO_NEGATIVE = 'cartoon, anime, illustration, painting, sketch, cel shaded, 3d render, low quality, blurry, watermark, text, logo, deformed, ugly, bad anatomy';
const OPENAI_IMAGE_MODELS = [
    { model: 'gpt-image-1', size: '1024x1024', quality: 'high' },
    { model: 'dall-e-3', size: '1024x1024', quality: 'hd' }
];
const HORDE_HEADERS = {
    'Content-Type': 'application/json',
    apikey: process.env.STABLE_HORDE_API_KEY || '0000000000',
    'Client-Agent': 'LuxxBot:3.1:doxxborx'
};

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
    if (name === 'stablehorde' && (msg.includes('kudos') || code === 403)) return;
    const noCredit =
        msg.includes('credit') || msg.includes('billing') || msg.includes('quota') ||
        msg.includes('insufficient balance') || msg.includes('pollen') ||
        msg.includes('licenses') || code === 402 || code === 429;
    if (noCredit) providerCooldown.set(name, Date.now() + PROVIDER_COOLDOWN_MS);
}

function isPollenExhausted(err) {
    const body = err?.response?.data;
    const msg = JSON.stringify(body?.error || body || err?.message || '').toLowerCase();
    return err?.response?.status === 402 && (
        msg.includes('insufficient balance') ||
        msg.includes('payment_required') ||
        msg.includes('available balance is 0')
    );
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

function buildEnginePrompt(enginePrompt) {
    return `${enginePrompt}${PHOTO_SUFFIX}`.slice(0, 1200);
}

async function fetchImageBuffer(url, timeout = POLLINATIONS_TIMEOUT, extraHeaders = {}) {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        maxRedirects: 5,
        validateStatus: (s) => s === 200,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            Accept: 'image/*',
            ...extraHeaders
        }
    });
    const buffer = Buffer.from(response.data);
    if (buffer.length < 2000) throw new Error('Response bukan gambar valid');
    return buffer;
}

function pollinationsHeaders() {
    if (!POLLINATIONS_KEY) return {};
    return { Authorization: `Bearer ${POLLINATIONS_KEY}` };
}

function modelArkHeaders() {
    return { Authorization: `Bearer ${MODEL_ARK_KEY}`, 'Content-Type': 'application/json' };
}

function isModelArkSkippable(err) {
    const body = err?.response?.data?.error || err?.response?.data || {};
    const code = body.code || '';
    const msg = String(body.message || err?.message || '').toLowerCase();
    return (
        code === 'ModelNotOpen' ||
        code === 'InvalidEndpointOrModel.NotFound' ||
        msg.includes('not activated') ||
        msg.includes('does not exist')
    );
}

/** BytePlus ModelArk — Seedream HD (prioritas utama) */
async function tryModelArk(prompt) {
    if (!MODEL_ARK_KEY || isProviderCooling('modelark')) return null;

    const full = buildEnginePrompt(prompt);
    const sizes = ['2K', '1024x1024'];

    for (const model of [...new Set(MODEL_ARK_MODELS)]) {
        for (const size of sizes) {
            try {
                const { data } = await withTimeout(
                    axios.post(
                        `${MODEL_ARK_BASE}/images/generations`,
                        {
                            model,
                            prompt: full,
                            size,
                            response_format: 'b64_json',
                            n: 1,
                            watermark: false
                        },
                        { headers: modelArkHeaders(), timeout: MODEL_ARK_TIMEOUT, validateStatus: (s) => s === 200 }
                    ),
                    MODEL_ARK_TIMEOUT,
                    `modelark-${model}`
                );

                const b64 = data?.data?.[0]?.b64_json;
                if (b64) {
                    const buffer = Buffer.from(b64, 'base64');
                    if (buffer.length > 2000) {
                        console.log(`ModelArk OK: ${model} ${size} (${buffer.length} bytes)`);
                        return { buffer, source: `modelark/${model}`, aiGenerated: true };
                    }
                }

                const url = data?.data?.[0]?.url;
                if (url) {
                    const buffer = await fetchImageBuffer(url, 30000);
                    console.log(`ModelArk OK: ${model} ${size} url (${buffer.length} bytes)`);
                    return { buffer, source: `modelark/${model}`, aiGenerated: true };
                }
            } catch (e) {
                if (isModelArkSkippable(e)) {
                    console.log(`ModelArk skip ${model}:`, (e.response?.data?.error?.message || e.message || '').slice(0, 90));
                    break;
                }
                console.log(`ModelArk err ${model}:`, (e.response?.data?.error?.message || e.message || '').slice(0, 90));
            }
        }
    }

    return null;
}

async function pollinationsGenerate(model, prompt, quality = 'high') {
    const { data } = await withTimeout(
        axios.post(
            'https://gen.pollinations.ai/v1/images/generations',
            {
                model,
                prompt,
                n: 1,
                size: `${POLLINATIONS_SIZE}x${POLLINATIONS_SIZE}`,
                quality,
                response_format: 'b64_json'
            },
            {
                timeout: POLLINATIONS_TIMEOUT,
                headers: {
                    Authorization: `Bearer ${POLLINATIONS_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        ),
        POLLINATIONS_TIMEOUT,
        `pollinations-${model}`
    );
    const b64 = data?.data?.[0]?.b64_json;
    if (b64) return Buffer.from(b64, 'base64');
    const url = data?.data?.[0]?.url;
    if (url) return await fetchImageBuffer(url, 20000, pollinationsHeaders());
    throw new Error('Pollinations tidak mengembalikan gambar');
}

async function pollinationsGet(model, prompt, seed, useNegative = false) {
    const encoded = encodeURIComponent(prompt);
    const neg = useNegative ? `&negative_prompt=${encodeURIComponent(PHOTO_NEGATIVE)}` : '';
    const url =
        `https://gen.pollinations.ai/image/${encoded}` +
        `?model=${model}&width=${POLLINATIONS_SIZE}&height=${POLLINATIONS_SIZE}` +
        `&seed=${seed}&enhance=true${neg}`;
    return await fetchImageBuffer(url, POLLINATIONS_TIMEOUT, pollinationsHeaders());
}

/** Engine utama !buat — Pollinations HD dengan model terbaik */
async function tryPollinationsBest(prompt, seed) {
    if (!POLLINATIONS_KEY || isProviderCooling('pollinations')) return { pollenExhausted: false };

    const full = buildEnginePrompt(prompt);
    let pollenExhausted = false;

    for (const cfg of POLLINATIONS_PHOTO_MODELS) {
        try {
            const buffer = await pollinationsGenerate(cfg.model, full, cfg.quality);
            console.log(`Pollinations OK: ${cfg.model} (${buffer.length} bytes)`);
            return { buffer, source: `pollinations/${cfg.model}`, aiGenerated: true, pollenExhausted: false };
        } catch (e) {
            if (isPollenExhausted(e)) {
                pollenExhausted = true;
                console.log('Pollinations: saldo pollen habis (0)');
                break;
            }
            const status = e.response?.status;
            console.log(`Pollinations OAI skip ${cfg.model} (${status || 'err'}):`, (e.message || '').slice(0, 70));
            try {
                const buffer = await pollinationsGet(cfg.model, full, seed, cfg.negative);
                console.log(`Pollinations GET OK: ${cfg.model} (${buffer.length} bytes)`);
                return { buffer, source: `pollinations/${cfg.model}`, aiGenerated: true, pollenExhausted: false };
            } catch (e2) {
                if (isPollenExhausted(e2)) {
                    pollenExhausted = true;
                    console.log('Pollinations GET: saldo pollen habis (0)');
                    break;
                }
                console.log(`Pollinations GET skip ${cfg.model}:`, (e2.message || '').slice(0, 70));
            }
        }
    }

    if (!pollenExhausted) markProviderCooldown('pollinations', new Error('pollinations exhausted'));
    return { pollenExhausted };
}

async function tryGeminiImage(prompt) {
    if (!GEMINI_API_KEY || isProviderCooling('gemini-image')) return null;

    const imagePrompt =
        `Generate one photorealistic square photograph (NOT cartoon, NOT illustration) matching:\n${prompt}\n` +
        `Style: ultra HD DSLR photo, natural lighting, sharp focus, realistic textures.`;
    for (const model of GEMINI_IMAGE_MODELS) {
        try {
            const response = await withTimeout(
                ai.models.generateContent({
                    model,
                    contents: imagePrompt,
                    config: { responseModalities: ['TEXT', 'IMAGE'] }
                }),
                55000,
                'gemini-image'
            );
            const parts = response.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
                const data = part.inlineData?.data;
                if (!data) continue;
                const buffer = Buffer.from(data, 'base64');
                if (buffer.length > 2000) {
                    console.log(`Gemini image OK: ${model}`);
                    return { buffer, source: model, aiGenerated: true };
                }
            }
        } catch (e) {
            markProviderCooldown('gemini-image', e);
            console.log(`Gemini image skip ${model}:`, (e.message || '').slice(0, 80));
        }
    }
    return null;
}

async function tryOpenAI(prompt) {
    if (!process.env.OPENAI_API_KEY || isProviderCooling('openai')) return null;

    for (const cfg of OPENAI_IMAGE_MODELS) {
        try {
            const payload = {
                model: cfg.model,
                prompt: buildEnginePrompt(prompt),
                n: 1,
                size: cfg.size
            };
            if (cfg.quality) payload.quality = cfg.quality;

            const result = await withTimeout(openai.images.generate(payload), 45000, 'openai');
            const b64 = result.data?.[0]?.b64_json;
            if (b64) return { buffer: Buffer.from(b64, 'base64'), source: cfg.model, aiGenerated: true };
            const url = result.data?.[0]?.url;
            if (url) return { buffer: await fetchImageBuffer(url, 15000), source: cfg.model, aiGenerated: true };
        } catch (e) {
            markProviderCooldown('openai', e);
            console.log(`OpenAI skip ${cfg.model}:`, e.message?.slice(0, 80));
        }
    }
    return null;
}

async function tryHuggingFace(prompt) {
    const token = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim();
    if (!token || isProviderCooling('huggingface')) return null;

    try {
        const { data } = await withTimeout(
            axios.post(
                'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-dev',
                { inputs: prompt.slice(0, 500) },
                {
                    responseType: 'arraybuffer',
                    timeout: 90000,
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'LuxxBot/3.1'
                    }
                }
            ),
            90000,
            'huggingface'
        );
        if (data?.byteLength > 2000) return { buffer: Buffer.from(data), source: 'huggingface', aiGenerated: true };
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
                    model: 'black-forest-labs/FLUX.1-dev',
                    prompt: buildEnginePrompt(prompt),
                    width: 1024,
                    height: 1024,
                    n: 1,
                    response_format: 'b64_json'
                },
                {
                    timeout: 30000,
                    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
                }
            ),
            30000,
            'together'
        );
        const b64 = data?.data?.[0]?.b64_json;
        if (b64) return { buffer: Buffer.from(b64, 'base64'), source: 'together', aiGenerated: true };
        const url = data?.data?.[0]?.url;
        if (url) return { buffer: await fetchImageBuffer(url, 12000), source: 'together', aiGenerated: true };
    } catch (e) {
        markProviderCooldown('together', e);
        console.log('Together skip:', e.response?.data?.error?.message || e.message);
    }
    return null;
}

async function stableHordeGenerate(prompt, size) {
    const { data: job } = await axios.post(
        'https://stablehorde.net/api/v2/generate/async',
        {
            prompt,
            negative_prompt: PHOTO_NEGATIVE,
            params: { width: size, height: size, steps: 28, cfg_scale: 7.5, karras: true },
            nsfw: false,
            censor_nsfw: true
        },
        { headers: HORDE_HEADERS, timeout: 35000, validateStatus: () => true }
    );

    if (job?.rc === 'KudosUpfront' || job?.message?.includes('kudos')) {
        throw new Error(`Horde butuh kudos untuk ${size}px`);
    }
    if (!job?.id) throw new Error(job?.message || 'Stable Horde tidak merespons');

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

        if (img.startsWith('http')) return { buffer: await fetchImageBuffer(img, 20000), size };
        return { buffer: Buffer.from(img, 'base64'), size };
    }
    throw new Error('Stable Horde timeout');
}

async function tryStableHorde(prompt) {
    if (isProviderCooling('stablehorde')) return null;
    const full = buildEnginePrompt(prompt);

    for (const size of HORDE_SIZES) {
        try {
            const { buffer } = await stableHordeGenerate(full, size);
            console.log(`Stable Horde OK: ${size}px (${buffer.length} bytes)`);
            return { buffer, source: `stablehorde/${size}`, aiGenerated: true };
        } catch (e) {
            const msg = e.message || '';
            console.log(`Stable Horde skip ${size}px:`, msg.slice(0, 90));
            if (/kudos|timeout|tidak merespons/i.test(msg)) continue;
            markProviderCooldown('stablehorde', e);
            return null;
        }
    }
    return null;
}

async function tryFallbackProviders(enginePrompt, userPrompt, seed) {
    const grokPrompt = `${userPrompt}. ${enginePrompt}`.slice(0, 900);
    const tasks = [];

    if (process.env.OPENAI_API_KEY) {
        tasks.push(tryOpenAI(enginePrompt));
    }
    if (process.env.TOGETHER_API_KEY?.trim()) {
        tasks.push(tryTogether(enginePrompt));
    }
    const hfToken = process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim();
    if (hfToken) {
        tasks.push(tryHuggingFace(enginePrompt));
    }
    if (!isProviderCooling('grok') && getXaiApiKey()) {
        tasks.push((async () => {
            try {
                const buf = await generateGrokImage(grokPrompt, { fast: false, timeoutMs: 20000 });
                return buf ? { buffer: buf, source: 'grok-imagine', aiGenerated: true } : null;
            } catch (e) {
                markProviderCooldown('grok', e);
                return null;
            }
        })());
    }

    if (!tasks.length) return null;

    const wrapped = tasks.map((t) =>
        t.then((r) => (r?.buffer ? r : Promise.reject(new Error('empty'))))
    );

    try {
        return await withTimeout(Promise.any(wrapped), CLOUD_BUDGET_MS, 'fallback');
    } catch {
        const settled = await Promise.allSettled(wrapped);
        for (const s of settled) {
            if (s.status === 'fulfilled' && s.value?.buffer) return s.value;
        }
        return null;
    }
}

function packBuatResult({ buffer, source, seed, userPrompt, enginePrompt, aiGenerated, failures }) {
    return { buffer, source, seed: seed ?? null, userPrompt, enginePrompt, aiGenerated, failures };
}

function saveBuatCache(cacheKey, out) {
    cacheSet(cacheKey, { buffer: out.buffer, source: out.source, aiGenerated: out.aiGenerated });
}

export async function generateBuatImage(deskripsi) {
    const userPrompt = deskripsi.trim();
    if (!userPrompt) throw new Error('Prompt kosong');

    const enginePrompt = await enhanceBuatPrompt(userPrompt);
    const cacheKey = `${userPrompt.toLowerCase()}|${enginePrompt.slice(0, 80)}|buat-v9`;

    if (imageCache.has(cacheKey)) {
        const cached = imageCache.get(cacheKey);
        return packBuatResult({
            buffer: cached.buffer,
            source: cached.source,
            userPrompt,
            enginePrompt,
            aiGenerated: cached.aiGenerated
        });
    }

    const seed = Math.floor(Math.random() * 999999);
    const failures = [];
    const t0 = Date.now();

    const finish = (out) => {
        saveBuatCache(cacheKey, out);
        console.log(`!buat OK (${out.source}) ${Date.now() - t0}ms ai=${out.aiGenerated}`);
        return out;
    };

    const engineFull = buildEnginePrompt(enginePrompt);

    let pollenExhausted = false;

    const modelArk = await tryModelArk(engineFull);
    if (modelArk?.buffer) {
        return finish(packBuatResult({ ...modelArk, userPrompt, enginePrompt }));
    }
    if (MODEL_ARK_KEY) failures.push('ModelArk: model belum diaktifkan di console');

    if (POLLINATIONS_KEY) {
        const poll = await tryPollinationsBest(engineFull, seed);
        if (poll?.buffer) {
            return finish(packBuatResult({ ...poll, seed, userPrompt, enginePrompt }));
        }
        pollenExhausted = !!poll?.pollenExhausted;
        if (pollenExhausted) failures.push('Pollinations: saldo habis');
        else failures.push('Pollinations: sibuk');
    }

    const horde = await tryStableHorde(engineFull);
    if (horde?.buffer) {
        return finish(packBuatResult({ ...horde, userPrompt, enginePrompt }));
    }
    failures.push('Horde: antrean penuh');

    const aiTasks = [
        tryGeminiImage(engineFull),
        tryFallbackProviders(engineFull, userPrompt, seed)
    ].map((task) =>
        task.then((r) => (r?.buffer ? r : Promise.reject(new Error('empty'))))
    );

    try {
        const winner = await withTimeout(Promise.any(aiTasks), CLOUD_BUDGET_MS, 'buat-ai');
        return finish(packBuatResult({ ...winner, userPrompt, enginePrompt }));
    } catch {
        const settled = await Promise.allSettled(aiTasks);
        for (const s of settled) {
            if (s.status === 'fulfilled' && s.value?.buffer) {
                return finish(packBuatResult({ ...s.value, userPrompt, enginePrompt }));
            }
        }
        failures.push('AI cadangan: kuota habis');
    }

    throw new Error(
        'Gagal membuat gambar — semua mesin sedang sibuk atau kuota habis.\n' +
        'Coba lagi 1–2 menit dengan prompt lebih detail.'
    );
}