// scripts/test-harness.mjs — Mock Baileys WASocket and message fixtures for offline testing

export function createMockSocket(options = {}) {
    const sentMessages = [];
    const groupUpdates = [];
    const groupSettings = [];

    const sock = {
        user: {
            id: options.botId || '628999999999:1@s.whatsapp.net',
            name: 'LuxxBot'
        },
        sentMessages,
        groupUpdates,
        groupSettings,

        async sendMessage(jid, content, opts = {}) {
            const record = {
                jid,
                content,
                opts,
                timestamp: Date.now()
            };
            sentMessages.push(record);
            return {
                key: {
                    remoteJid: jid,
                    fromMe: true,
                    id: 'MOCK_MSG_' + Math.random().toString(36).substring(2, 9)
                },
                message: content
            };
        },

        async groupMetadata(jid) {
            if (options.groupMetadata) {
                return options.groupMetadata(jid);
            }
            return {
                id: jid,
                subject: 'Mock Group Test',
                participants: [
                    { id: '628999999999@s.whatsapp.net', admin: 'admin' }, // bot
                    { id: '628111111111@s.whatsapp.net', admin: 'admin' }, // admin user
                    { id: '628222222222@s.whatsapp.net', admin: null },    // regular member
                    { id: '628333333333@s.whatsapp.net', admin: null }     // regular member
                ]
            };
        },

        async groupParticipantsUpdate(jid, participants, action) {
            groupUpdates.push({ jid, participants, action });
            return participants.map(p => ({ status: '200', jid: p }));
        },

        async groupInviteCode(jid) {
            return 'AbCdEf12345';
        },

        async groupSettingUpdate(jid, setting) {
            groupSettings.push({ jid, setting });
            return true;
        },

        async groupFetchAllParticipating() {
            return {
                '120363000000000001@g.us': { subject: 'Group A' },
                '120363000000000002@g.us': { subject: 'Group B' }
            };
        }
    };

    return sock;
}

export function createMockMessage({
    text = '',
    sender = '628111111111@s.whatsapp.net',
    from = '120363000000000001@g.us',
    isGroup = true,
    quoted = null,
    sticker = null
} = {}) {
    const remoteJid = isGroup ? from : sender;
    const msg = {
        key: {
            remoteJid,
            fromMe: false,
            id: 'MOCK_INCOMING_' + Math.random().toString(36).substring(2, 9),
            participant: isGroup ? sender : undefined
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: {}
    };

    if (text) {
        msg.message.conversation = text;
    }

    if (quoted) {
        msg.message.extendedTextMessage = {
            text,
            contextInfo: {
                quotedMessage: quoted,
                participant: quoted.sender || '628222222222@s.whatsapp.net',
                mentionedJid: quoted.mentionedJid || []
            }
        };
    }

    if (sticker) {
        msg.message.stickerMessage = sticker;
    }

    return msg;
}
