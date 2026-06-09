import {
    discoverLivePublicBase,
    getRadioListenUrlAsync,
    getRadioUrlHint,
    invalidateRadioUrlCache
} from './radio-url.js';

const PREVIEW_MS = 6000;

async function getLinkBody() {
    const { radio, isRadioPlaying } = await import('../services/radio-server.js');
    if (radio.isPreparing) return '⏳ Sedang memuat lagu...';
    if (isRadioPlaying()) {
        return `▶️ ${radio.current.title} — ${radio.current.author}`;
    }
    if (radio.queue.length) {
        return `⏸️ ${radio.queue[0].title} — klik Putar di web`;
    }
    return 'Ketuk link untuk buka player & dengar musik';
}

async function sendTapLink(sock, from, { text, url, title, description }) {
    try {
        await Promise.race([
            sock.sendMessage(from, {
                text,
                linkPreview: {
                    'canonical-url': url,
                    'matched-text': url,
                    title,
                    description
                },
                contextInfo: {
                    externalAdReply: {
                        title,
                        body: description,
                        sourceUrl: url,
                        mediaType: 1,
                        renderLargerThumbnail: true
                    }
                }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('linkPreview timeout')), PREVIEW_MS))
        ]);
    } catch (e) {
        console.log('tap link fallback:', e?.message || e);
        await sock.sendMessage(from, { text });
    }
}

/**
 * Kirim status + link radio yang bisa diketuk di WhatsApp.
 */
export async function sendWaRadioLink(sock, from, options = {}) {
    invalidateRadioUrlCache();
    const status = await discoverLivePublicBase();
    const base = (status.base || `http://127.0.0.1:3920`).replace(/\/$/, '');
    const url = `${base}/portfolio/radio`;
    const title = '📻 LuxxBot Radio';
    const body = await getLinkBody();
    const hint = getRadioUrlHint(base, status);

    if (options.statusText) {
        await sock.sendMessage(from, {
            text: options.statusText + hint
        }, options.quoted ? { quoted: options.quoted } : {});
    }

    const linkText = `${title}\n${body}\n\n🔗 ${url}`;
    await sendTapLink(sock, from, { text: linkText, url, title, description: body });
}

export async function formatRadioUrlLine() {
    const url = await getRadioListenUrlAsync();
    const status = await discoverLivePublicBase();
    const base = status.base || url.replace(/\/portfolio\/radio$/, '').replace(/\/radio$/, '');
    return `🔗 ${url}${getRadioUrlHint(base, status)}`;
}