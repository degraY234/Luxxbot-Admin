import axios from 'axios';
import { ai, GEMINI_API_KEY, getGroqApiKey } from '../config.js';
import { translatePromptLocal } from './buat-canvas.js';

const ENHANCE_MODEL = 'gemini-2.5-flash-lite';
const GROQ_ENHANCE_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

function wantsStylized(raw) {
    return /anime|kartun|cartoon|ghibli|manga|chibi|pixel|ilustrasi|illustration|comic|stylized/i.test(raw);
}

function buildEnhanceInstruction(raw, stylized) {
    const styleRule = stylized
        ? '- User asked stylized art — match their style (anime/cartoon/etc.) but keep clean HD output\n'
        : '- DEFAULT photorealistic: real photo look, DSLR, 85mm lens, natural skin, real textures\n' +
          '- FORBID: cartoon, anime, illustration, painting, 3d render, cel-shaded unless user asked\n';
    return (
        `Expert image-prompt engineer. Convert Indonesian request → ONE English image prompt.\n` +
        `Rules:\n` +
        `- Output ONLY prompt text\n` +
        `- Max 95 words\n` +
        `${styleRule}` +
        `- Include: subject, environment, lighting, camera, mood\n` +
        `- End with: ultra detailed, 8K UHD, sharp focus, photorealistic, professional photography, no watermark, no text\n\n` +
        `User: ${raw}`
    );
}

function polishEnhancedPrompt(text, stylized) {
    if (!text || text.length < 12) return null;
    let out = text.replace(/^["']|["']$/g, '').trim();
    if (!stylized && !/photoreal|realistic|photograph/i.test(out)) {
        out += ', photorealistic, ultra HD, DSLR quality, not cartoon';
    }
    return out;
}

async function enhanceViaGroq(instruction) {
    const apiKey = getGroqApiKey();
    if (!apiKey) return null;
    for (const model of GROQ_ENHANCE_MODELS) {
        try {
            const { data } = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model,
                    messages: [
                        { role: 'system', content: 'You write concise English image prompts. Output prompt text only.' },
                        { role: 'user', content: instruction }
                    ],
                    temperature: 0.4,
                    max_tokens: 220
                },
                {
                    timeout: 10000,
                    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
                }
            );
            const text = data?.choices?.[0]?.message?.content?.trim();
            if (text) return text;
        } catch (e) {
            console.log(`!buat groq enhance skip ${model}:`, (e.response?.status || e.message || '').toString().slice(0, 60));
        }
    }
    return null;
}

export async function enhanceBuatPrompt(userInput) {
    const raw = String(userInput || '').trim();
    if (!raw) return translatePromptLocal(raw);

    const stylized = wantsStylized(raw);
    const instruction = buildEnhanceInstruction(raw, stylized);

    if (GEMINI_API_KEY) {
        try {
            const result = await Promise.race([
                ai.models.generateContent({ model: ENHANCE_MODEL, contents: instruction }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('enhance timeout')), 8000))
            ]);
            const polished = polishEnhancedPrompt(result.text?.trim(), stylized);
            if (polished) return polished;
        } catch (e) {
            console.log('!buat prompt enhance skip:', (e.message || '').slice(0, 80));
        }
    }

    const groq = polishEnhancedPrompt(await enhanceViaGroq(instruction), stylized);
    if (groq) return groq;

    const local = translatePromptLocal(raw);
    if (!stylized) return local;
    return local;
}