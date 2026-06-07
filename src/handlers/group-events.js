import { getGroupSettings, formatWelcomeMessage } from '../services/group-welcome.js';

let boundGroupSock = null;

export function registerGroupEventHandler(sock) {
    if (boundGroupSock === sock) return;
    if (boundGroupSock?.ev) {
        try { boundGroupSock.ev.removeAllListeners('group-participants.update'); } catch { /* ignore */ }
    }
    boundGroupSock = sock;

    sock.ev.on('group-participants.update', async (update) => {
        try {
            const { id: groupId, participants, action } = update;
            if (!groupId?.endsWith('@g.us')) return;

            const cfg = getGroupSettings(groupId);
            if (!cfg.welcome) return;

            if (action === 'add') {
                let groupName = 'grup ini';
                try {
                    const meta = await sock.groupMetadata(groupId);
                    groupName = meta.subject || groupName;
                } catch (_) {}

                for (const jid of participants) {
                    const text = formatWelcomeMessage(cfg.message, jid, groupName);
                    await sock.sendMessage(groupId, {
                        text,
                        mentions: [jid]
                    });
                }
            }
        } catch (e) {
            console.error('Welcome event error:', e.message);
        }
    });
}