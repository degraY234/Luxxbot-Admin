import { radio } from '../services/radio-server.js';
import { getRadioListenUrlAsync, getRadioUrlHint, resolveRadioBaseUrl } from './radio-url.js';

function getLinkBody() {
    if (radio.isPreparing) return '⏳ Sedang memuat lagu...';
    if (radio.current) {
        return `▶️ ${radio.current.title} — ${radio.current.author}`;
    }
    return 'Ketuk link untuk buka player & dengar musik';
}

/**
 * Kirim status + link radio yang bisa diketuk di WhatsApp.
 */
export async function sendWaRadioLink(sock, from, options = {}) {
    const base = await resolveRadioBaseUrl();
    const url = `${base}/radio`;
    const title = '📻 LuxxBot Radio';
    const body = getLinkBody();
    const hint = getRadioUrlHint(base);

    if (options.statusText) {
        await sock.sendMessage(from, {
            text: options.statusText + hint
        }, options.quoted ? { quoted: options.quoted } : {});
    }

    const linkText = `${title}\n${body}\n\n🔗 ${url}`;

    try {
        await sock.sendMessage(from, {
            text: linkText,
            linkPreview: {
                'canonical-url': url,
                'matched-text': url,
                title,
                description: body
            },
            contextInfo: {
                externalAdReply: {
                    title,
                    body,
                    sourceUrl: url,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        });
    } catch (e) {
        console.log('linkPreview skip:', e.message);
        await sock.sendMessage(from, { text: linkText });
    }
}

export async function formatRadioUrlLine() {
    const url = await getRadioListenUrlAsync();
    const base = await resolveRadioBaseUrl();
    return `🔗 ${url}${getRadioUrlHint(base)}`;
}