import axios from 'axios';
import { ai, openai, BOT_NAME, getGroqApiKey, GEMINI_TEXT_MODELS } from '../config.js';
import { aiQueue, state } from '../state.js';
import { getUserContext, addToContext } from '../utils/cooldown.js';
import { askGrok, grokChat } from './xai.js';
import { ABOUT_META } from '../commands/aboutlux.js';
import { buildPersonaSystem, getAITemperature } from './ai-persona.js';
import { wrapQueryWithMeta } from './ai-context.js';

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

async function askGroqCom(prompt, system, temperature = 0.85) {
    const apiKey = getGroqApiKey();
    if (!apiKey) return null;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
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
                }
            }
        );
        return response.data.choices[0].message.content;
    } catch (err) {
        console.log('GROQ.com ERROR:', err.response?.data || err.message);
        return null;
    }
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

export async function tanyakanAI(query, type = 'tanya', isAdmin = false, fromId = 'global', meta = null) {
    const creatorReply = tryCreatorReply(query);
    if (creatorReply) return creatorReply;

    const wrappedQuery = wrapQueryWithMeta(query, meta);
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
        addToContext(fromId, 'user', wrappedQuery);
        addToContext(fromId, 'model', geminiText);
        return geminiText;
    }

    const groqFirst = await askGroqCom(wrappedQuery, systemInstruction, temperature);
    if (groqFirst?.trim()) {
        addToContext(fromId, 'user', wrappedQuery);
        addToContext(fromId, 'model', groqFirst);
        return groqFirst;
    }

    try {
        const grok = await askGrok(wrappedQuery, systemInstruction, { temperature });
        if (grok?.trim()) {
            addToContext(fromId, 'user', wrappedQuery);
            addToContext(fromId, 'model', grok);
            return grok;
        }
    } catch (e1) {
        console.log('Grok fallback skip:', e1?.message || e1);
    }

    const oai = await askOpenAI(wrappedQuery, systemInstruction, temperature);
    if (oai?.trim()) {
        addToContext(fromId, 'user', wrappedQuery);
        addToContext(fromId, 'model', oai);
        return oai;
    }

    return '❌ AI lagi penuh / limit habis. Coba lagi nanti atau hubungi owner buat isi ulang kuota.';
}