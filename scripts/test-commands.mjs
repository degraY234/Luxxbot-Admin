// scripts/test-commands.mjs — Offline unit tests for command handlers with Mock Baileys
import assert from 'node:assert/strict';
import { createMockSocket, createMockMessage } from './test-harness.mjs';
import { handleSholatCommand, handleQuranCommand } from '../src/commands/islami.js';
import { handleAnimeCommand } from '../src/commands/anime.js';
import { handleGroupAdminCommand } from '../src/commands/group-admin.js';
import { handleBroadcastCommand } from '../src/commands/broadcast.js';

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`  ✅ PASS: ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(err);
        failed++;
    }
}

console.log('\n🧪 Running Command Handlers Offline Tests...\n');

// 1. Sholat Command
await runTest('islami: !sholat fetches and formats prayer times', async () => {
    const sock = createMockSocket();
    const msg = createMockMessage({ text: '!sholat Bandung' });
    await handleSholatCommand({ sock, from: msg.key.remoteJid, msg, args: ['Bandung'] });

    assert.ok(sock.sentMessages.length >= 2, 'Should send waiting message and result');
    const resultMsg = sock.sentMessages[sock.sentMessages.length - 1];
    assert.ok(resultMsg.content.text.includes('JADWAL SHOLAT'));
    assert.ok(resultMsg.content.text.includes('Subuh'));
    assert.ok(resultMsg.content.text.includes('Maghrib'));
});

// 2. Quran Command
await runTest('islami: !quran fetches surah and ayah', async () => {
    const sock = createMockSocket();
    const msg = createMockMessage({ text: '!quran 1 1' });
    await handleQuranCommand({ sock, from: msg.key.remoteJid, msg, args: ['1', '1'] });

    assert.ok(sock.sentMessages.length >= 1);
    const resultMsg = sock.sentMessages[0];
    assert.ok(resultMsg.content.text.includes('AL-QUR\'AN'));
    assert.ok(resultMsg.content.text.includes('Ayat 1'));
    assert.ok(resultMsg.content.text.includes('Dengan nama Allah') || resultMsg.content.text.includes('Dengan menyebut nama Allah'));
});

// 3. Anime Command (Fast AniList)
await runTest('anime: !anime search retrieves title and synopsis', async () => {
    const sock = createMockSocket();
    const msg = createMockMessage({ text: '!anime naruto' });
    await handleAnimeCommand({ sock, from: msg.key.remoteJid, msg, args: ['naruto'] });

    assert.ok(sock.sentMessages.length >= 2);
    const resultMsg = sock.sentMessages[sock.sentMessages.length - 1];
    const textContent = resultMsg.content.caption || resultMsg.content.text || '';
    assert.ok(textContent.toLowerCase().includes('naruto'));
});

// 4. Group Admin: Permission Guard
await runTest('group-admin: non-admin sender is rejected', async () => {
    const sock = createMockSocket();
    const msg = createMockMessage({
        text: '!kick 628222222222',
        sender: '628333333333@s.whatsapp.net', // not admin
        isGroup: true
    });

    await handleGroupAdminCommand({
        sock,
        from: msg.key.remoteJid,
        msg,
        sender: '628333333333@s.whatsapp.net',
        command: 'kick',
        args: ['628222222222'],
        isGroup: true,
        isAdmin: false,
        isGroupAdmin: false
    });

    const lastMsg = sock.sentMessages[sock.sentMessages.length - 1];
    assert.ok(lastMsg.content.text.includes('khusus untuk *Admin Grup*'));
    assert.equal(sock.groupUpdates.length, 0, 'No participant update should occur');
});

// 5. Group Admin: Successful Kick
await runTest('group-admin: admin can kick participant', async () => {
    const sock = createMockSocket();
    const msg = createMockMessage({
        text: '!kick 628222222222',
        sender: '628111111111@s.whatsapp.net', // admin
        isGroup: true
    });

    await handleGroupAdminCommand({
        sock,
        from: msg.key.remoteJid,
        msg,
        sender: '628111111111@s.whatsapp.net',
        command: 'kick',
        args: ['628222222222'],
        isGroup: true,
        isAdmin: false,
        isGroupAdmin: true
    });

    assert.equal(sock.groupUpdates.length, 1);
    assert.equal(sock.groupUpdates[0].action, 'remove');
    assert.deepEqual(sock.groupUpdates[0].participants, ['628222222222@s.whatsapp.net']);
});

// 6. Group Admin: Hidetag & Tagall
await runTest('group-admin: hidetag and tagall mention participants', async () => {
    const sock = createMockSocket();
    const msg = createMockMessage({ text: '!hidetag Panggilan!', sender: '628111111111@s.whatsapp.net' });

    await handleGroupAdminCommand({
        sock,
        from: msg.key.remoteJid,
        msg,
        sender: '628111111111@s.whatsapp.net',
        command: 'hidetag',
        args: ['Panggilan!'],
        isGroup: true,
        isAdmin: false,
        isGroupAdmin: true
    });

    const hidetagMsg = sock.sentMessages[sock.sentMessages.length - 1];
    assert.ok(hidetagMsg.content.mentions && hidetagMsg.content.mentions.length > 0);

    await handleGroupAdminCommand({
        sock,
        from: msg.key.remoteJid,
        msg,
        sender: '628111111111@s.whatsapp.net',
        command: 'tagall',
        args: ['Halo semua'],
        isGroup: true,
        isAdmin: false,
        isGroupAdmin: true
    });

    const tagallMsg = sock.sentMessages[sock.sentMessages.length - 1];
    assert.ok(tagallMsg.content.text.includes('TAG ALL'));
    assert.ok(tagallMsg.content.mentions && tagallMsg.content.mentions.length > 0);
});

// 7. Group Admin: Linkgc & Group Open/Close
await runTest('group-admin: linkgc and group settings update', async () => {
    const sock = createMockSocket();
    const msg = createMockMessage({ text: '!linkgc', sender: '628111111111@s.whatsapp.net' });

    await handleGroupAdminCommand({
        sock,
        from: msg.key.remoteJid,
        msg,
        sender: '628111111111@s.whatsapp.net',
        command: 'linkgc',
        args: [],
        isGroup: true,
        isAdmin: false,
        isGroupAdmin: true
    });

    const linkMsg = sock.sentMessages[sock.sentMessages.length - 1];
    assert.ok(linkMsg.content.text.includes('https://chat.whatsapp.com/AbCdEf12345'));

    await handleGroupAdminCommand({
        sock,
        from: msg.key.remoteJid,
        msg,
        sender: '628111111111@s.whatsapp.net',
        command: 'group',
        args: ['tutup'],
        isGroup: true,
        isAdmin: false,
        isGroupAdmin: true
    });

    assert.equal(sock.groupSettings.length, 1);
    assert.equal(sock.groupSettings[0].setting, 'announcement');
});

// 8. Broadcast Command
await runTest('broadcast: owner can broadcast to groups', async () => {
    const sock = createMockSocket();
    const msg = createMockMessage({ text: '!bc Halo semua group' });

    await handleBroadcastCommand({
        sock,
        from: msg.key.remoteJid,
        msg,
        args: ['Halo', 'semua', 'group'],
        isAdmin: true
    });

    assert.ok(sock.sentMessages.length >= 4);
    const summaryMsg = sock.sentMessages[sock.sentMessages.length - 1];
    assert.ok(summaryMsg.content.text.includes('Siaran Selesai'));
    assert.ok(summaryMsg.content.text.includes('Berhasil terkirim: *2* grup'));
});

console.log(`\nCommand Tests Finished: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
