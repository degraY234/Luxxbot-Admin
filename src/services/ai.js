import axios from 'axios';
import { ai, openai, BOT_NAME, getGroqApiKey } from '../config.js';
import { aiQueue, state } from '../state.js';
import { getUserContext, addToContext } from '../utils/cooldown.js';
import { askGrok, grokChat } from './xai.js';

export function runAIQueue(text, type, isAdmin, fromId) {
    return new Promise((resolve, reject) => {
        aiQueue.push({ text, type, isAdmin, fromId, resolve, reject });
        processQueue();
    });
}

async function processQueue() {
    if (state.isProcessingQueue) return;
    state.isProcessingQueue = true;
    while (aiQueue.length > 0) {
        const job = aiQueue.shift();
        try {
            const res = await tanyakanAI(job.text, job.type, job.isAdmin, job.fromId);
            job.resolve(res);
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            job.reject(e);
        }
    }
    state.isProcessingQueue = false;
}

async function askGroqCom(prompt, system) {
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
                temperature: 0.9,
                max_tokens: 1000
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
    return await askGroqCom(prompt, `Kamu asisten ${BOT_NAME}. Jawab Bahasa Indonesia.`);
}

async function askOpenAI(text, system) {
    const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: text }
        ]
    });
    return res.choices[0].message.content;
}

export async function tanyakanAI(query, type = 'tanya', isAdmin = false, fromId = 'global') {
    const context = getUserContext(fromId);
    let contentsPayload = query;

    if (type === 'chat_context') {
        context.push({ role: 'user', text: query });
        contentsPayload = context.map(c => ({
            role: c.role === 'user' ? 'user' : 'model',
            parts: [{ text: c.text }]
        }));
    }

    const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    const systemInstruction = `Anda adalah AI santai, lucu, tapi pintar bernama ${BOT_NAME}. Jawab dalam Bahasa Indonesia.`;

    for (const model of models) {
        try {
            const res = await ai.models.generateContent({
                model,
                contents: contentsPayload,
                config: { systemInstruction, temperature: 0.7 }
            });
            addToContext(fromId, 'user', query);
            addToContext(fromId, 'model', res.text);
            return res.text;
        } catch (e) {
            if (e.status === 429 || e.status === 503) break;
        }
    }

    try {
        const grok = await askGrok(query, systemInstruction);
        addToContext(fromId, 'user', query);
        addToContext(fromId, 'model', grok);
        return grok;
    } catch (e1) {
        console.log('Grok fallback skip:', e1?.message || e1);
    }

    try {
        return await askOpenAI(query, systemInstruction);
    } catch (e2) {
        const groq = await askGroqCom(query, systemInstruction);
        if (groq) return groq;
        return '❌ Semua AI lagi tumbang, coba lagi nanti.\n_Tip: cek kredit Grok di console.x.ai atau API key Gemini/OpenAI._';
    }
}