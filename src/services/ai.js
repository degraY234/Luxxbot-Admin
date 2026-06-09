import axios from 'axios';
import { ai, openai, BOT_NAME, getGroqApiKey, GEMINI_TEXT_MODELS } from '../config.js';
import { aiQueue, state } from '../state.js';
import { getUserContext, addToContext } from '../utils/cooldown.js';
import { askGrok, grokChat } from './xai.js';
import { ABOUT_META } from '../commands/aboutlux.js';
import { buildPersonaSystem, getAITemperature } from './ai-persona.js';
import { wrapQueryWithMeta } from './ai-context.js';
import { buildGroupBotIntel } from './group-bot-context.js';

const CREATOR_REPLY =
    `👑 *${ABOUT_META.creator}* — ${ABOUT_META.education.toLowerCase()}, arsitek di balik ${BOT_NAME}.\n\n` +
    `Satu orang, banyak fitur. Detail lengkap? \`!aboutlux\` 🌸`;

const CREATOR_QUESTION_RE =
    /siapa\s+(yang\s+)?(buat|membuat|bikin|develop|menciptakan|punya|own)|pembuat(nya)?|creator|developer|owner\s+bot|who\s+(made|created|built|owns)|doxxborx|luxxbot\s+dibuat|bot\s+ini\s+(buat|dibuat)/i;

export function tryCreatorReply(query) {
    if (!query || !CREATOR_QUESTION_RE.test(query)) return null;
    return CREATOR_REPLY;
}

export function runAIQueue(text, type, isAdmin, fromId, meta = null) {
    return new Promise((resolve, reject) => {
        aiQueue.push({ text, type, isAdmin, fromId, meta, resolve, reject });
        processQueue();
    });
}

async function processQueue() {
    if (state.isProcessingQueue) return;
    state.isProcessingQueue = true;
    while (aiQueue.length > 0) {
        const job = aiQueue.shift();
        try {
            const res = await tanyakanAI(job.text, job.type, job.isAdmin, job.fromId, job.meta);
            job.resolve(res);
            await new Promise((r) => setTimeout(r, 2000));
        } catch (e) {
            job.reject(e);
        }
    }
    state.isProcessingQueue = false;
}

const GROQ_TEXT_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it'
];

async function askGroqCom(prompt, system, temperature = 0.85) {
    const apiKey = getGroqApiKey();
    if (!apiKey) return null;

    for (const model of GROQ_TEXT_MODELS) {
        try {
            const response = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: prompt }
                    ],
                    temperature,
                    max_tokens: 1200
                },
                {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 25000
                }
            );
            const text = response.data?.choices?.[0]?.message?.content?.trim();
            if (text) return text;
        } catch (err) {
            console.log(`GROQ ${model} skip:`, err.response?.status || err.response?.data?.error?.message || err.message);
        }
    }
    return null;
}

async function askPollinations(prompt, system, temperature = 0.85) {
    if (process.env.POLLINATIONS_TEXT_ENABLED === '0' || process.env.POLLINATIONS_TEXT_ENABLED === 'false') {
        return null;
    }
    try {
        const response = await axios.post(
            'https://text.pollinations.ai/openai',
            {
                model: 'openai',
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: prompt }
                ],
                temperature
            },
            { timeout: 35000, headers: { 'Content-Type': 'application/json' } }
        );
        const text = response.data?.choices?.[0]?.message?.content?.trim()
            || (typeof response.data === 'string' ? response.data.trim() : null);
        if (text) return text;
    } catch (err) {
        console.log('Pollinations text skip:', err.response?.status || err.message);
    }
    return null;
}

/** Grok dulu, lalu Groq.com — untuk darkjokes, cerpen, dll. */
export async function groqAI(prompt) {
    const grok = await grokChat(prompt);
    if (grok) return grok;
    return await askGroqCom(prompt, `Kamu ${BOT_NAME}, asisten santai Bahasa Indonesia.`);
}

async function askOpenAI(text, system, temperature = 0.85) {
    if (!process.env.OPENAI_API_KEY) return null;
    try {
        const res = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: text }
            ],
            temperature,
            max_tokens: 1200
        });
        return res.choices[0].message.content;
    } catch (err) {
        console.log('OpenAI skip:', err?.status || err?.message || err);
        return null;
    }
}

function geminiErrorStatus(err) {
    return err?.status || err?.error?.code || err?.cause?.status;
}

async function askGemini(contentsPayload, systemInstruction, temperature, models = GEMINI_TEXT_MODELS) {
    for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const res = await ai.models.generateContent({
                    model,
                    contents: contentsPayload,
                    config: { systemInstruction, temperature }
                });
                const text = res?.text?.trim();
                if (text) return text;
            } catch (e) {
                const status = geminiErrorStatus(e);
                console.log(`Gemini ${model} skip:`, status || e?.message || e);
                if (status === 401 || status === 403) return null;
                if (status === 429 && attempt === 0) {
                    await new Promise((r) => setTimeout(r, 3500));
                    continue;
                }
                break;
            }
        }
    }
    return null;
}

function saveAIReply(fromId, wrappedQuery, reply) {
    addToContext(fromId, 'user', wrappedQuery);
    addToContext(fromId, 'model', reply);
}

export async function tanyakanAI(query, type = 'tanya', isAdmin = false, fromId = 'global', meta = null) {
    try {
        const creatorReply = tryCreatorReply(query);
        if (creatorReply) return creatorReply;

        let wrappedQuery = wrapQueryWithMeta(query, meta);
        if (meta?.isGroup && meta.chatId && (type === 'tanya' || type === 'chat_context')) {
            const intel = buildGroupBotIntel(meta.chatId, query);
            if (intel) wrappedQuery = `${wrappedQuery}\n\n${intel}`;
        }
        const context = getUserContext(fromId);
        let contentsPayload = wrappedQuery;
        const temperature = getAITemperature(type);
        const systemInstruction = buildPersonaSystem(type, meta);

        if (type === 'chat_context') {
            context.push({ role: 'user', text: wrappedQuery });
            contentsPayload = context.map((c) => ({
                role: c.role === 'user' ? 'user' : 'model',
                parts: [{ text: c.text }]
            }));
        }

        const geminiText = await askGemini(contentsPayload, systemInstruction, temperature);
        if (geminiText) {
            saveAIReply(fromId, wrappedQuery, geminiText);
            return geminiText;
        }

        const groqFirst = await askGroqCom(wrappedQuery, systemInstruction, temperature);
        if (groqFirst?.trim()) {
            saveAIReply(fromId, wrappedQuery, groqFirst);
            return groqFirst;
        }

        try {
            const grok = await askGrok(wrappedQuery, systemInstruction, { temperature });
            if (grok?.trim()) {
                saveAIReply(fromId, wrappedQuery, grok);
                return grok;
            }
        } catch (e1) {
            console.log('Grok fallback skip:', e1?.message || e1);
        }

        const oai = await askOpenAI(wrappedQuery, systemInstruction, temperature);
        if (oai?.trim()) {
            saveAIReply(fromId, wrappedQuery, oai);
            return oai;
        }

        const poll = await askPollinations(wrappedQuery, systemInstruction, temperature);
        if (poll?.trim()) {
            saveAIReply(fromId, wrappedQuery, poll);
            return poll;
        }

        return '❌ AI lagi penuh / limit habis (Gemini, Groq, Grok, OpenAI). Coba lagi nanti atau hubungi owner buat isi ulang kuota.';
    } catch (err) {
        console.error('tanyakanAI error:', err?.message || err);
        return '❌ Gagal memproses pertanyaan. Coba lagi sebentar.';
    }
}