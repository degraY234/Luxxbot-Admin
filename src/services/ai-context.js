/**
 * @typedef {Object} AIChatMeta
 * @property {boolean} isGroup
 * @property {string} chatId
 * @property {string} senderName
 * @property {string} [senderJid]
 * @property {string} [groupName]
 * @property {number} [memberCount]
 */

/**
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {{ from: string, sender: string, isGroup: boolean }} opts
 * @returns {Promise<AIChatMeta>}
 */
export async function buildAIChatMeta(sock, { from, sender, isGroup }) {
    const senderNum = String(sender || '').split('@')[0];
    const meta = {
        isGroup: !!isGroup,
        chatId: from,
        senderName: senderNum,
        senderJid: sender
    };

    if (!isGroup) return meta;

    try {
        const gm = await sock.groupMetadata(from);
        meta.groupName = gm.subject || 'grup ini';
        meta.memberCount = gm.participants?.length || 0;
    } catch (_) {
        meta.groupName = 'grup ini';
        meta.memberCount = 0;
    }

    return meta;
}

/**
 * @param {string} chatId
 * @param {AIChatMeta|null} meta
 * @param {string} type
 */
export function resolveContextKey(chatId, meta, type) {
    if (type === 'chat_context') return chatId;
    if (meta?.isGroup && meta.senderJid) return `${chatId}|${meta.senderJid}`;
    return chatId;
}

/**
 * @param {string} query
 * @param {AIChatMeta|null} meta
 */
export function wrapQueryWithMeta(query, meta) {
    if (!meta?.isGroup) return query;
    const who = meta.senderName ? `@${meta.senderName}` : 'member';
    const grp = meta.groupName || 'grup ini';
    const members = meta.memberCount ? `${meta.memberCount} member` : 'grup WA';
    return `[Konteks grup: "${grp}" · ${members} · pengirim: ${who}]\n\n${query}`;
}

/**
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} from
 * @param {string} sender
 * @param {boolean} isGroup
 * @param {boolean} isAdmin
 * @param {string} query
 * @param {string} type
 */
export async function askLuxxAI(sock, from, sender, isGroup, isAdmin, query, type) {
    const { runAIQueue } = await import('./ai.js');
    const meta = await buildAIChatMeta(sock, { from, sender, isGroup });
    const ctxKey = resolveContextKey(from, meta, type);
    try {
        await sock.sendPresenceUpdate('composing', from);
    } catch (_) { /* presence opsional */ }
    return runAIQueue(query, type, isAdmin, ctxKey, meta);
}