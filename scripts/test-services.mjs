// scripts/test-services.mjs — Unit tests for bot core services and persistence
import assert from 'node:assert/strict';
import { pruneExpiredNotes, pruneExpiredReminders, pruneExpiredCooldowns, pruneExpiredAIContext } from '../src/state.js';
import {
    setUserTier,
    getUserTier,
    isPremiumUser,
    getAllUsers,
    removeUser,
    getPremiumUsers
} from '../src/services/premium-users.js';
import { checkUsageLimit, trackUsage, getUserUsage } from '../src/services/usage-tracker.js';
import { initPersistence, getJson, setJson, deleteKey, closePersistence } from '../src/utils/persistence.js';
import { formatPaymentMessage } from '../src/services/payment-gateway.js';

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

console.log('\n🧪 Running Services & Persistence Tests...\n');

// 1. Test state.js pruning on plain objects without throwing
await runTest('state.js: pruneExpiredNotes with plain object', () => {
    global.notes = {
        'user1@s.whatsapp.net': [
            { text: 'Old note', updated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
            { text: 'Fresh note', updated: new Date().toISOString() }
        ]
    };
    pruneExpiredNotes();
    assert.equal(global.notes['user1@s.whatsapp.net'].length, 1);
    assert.equal(global.notes['user1@s.whatsapp.net'][0].text, 'Fresh note');
});

await runTest('state.js: pruneExpiredReminders with plain object', () => {
    global.reminders = {
        'user1@s.whatsapp.net': [
            { text: 'Past reminder', time: Date.now() - 10000 },
            { text: 'Future reminder', time: Date.now() + 100000 }
        ]
    };
    pruneExpiredReminders();
    assert.equal(global.reminders['user1@s.whatsapp.net'].length, 1);
    assert.equal(global.reminders['user1@s.whatsapp.net'][0].text, 'Future reminder');
});

await runTest('state.js: pruneExpiredCooldowns and AI context safely', () => {
    assert.doesNotThrow(() => {
        pruneExpiredCooldowns();
        pruneExpiredAIContext();
    });
});

// 2. Test premium-users.js service
await runTest('premium-users.js: user tier management', () => {
    const testUser = '628999888777';
    const setRes = setUserTier(testUser, 'premium', Date.now() + 86400000);
    assert.equal(setRes.ok, true);
    assert.equal(getUserTier(testUser), 'premium');
    assert.equal(isPremiumUser(testUser), true);

    const allUsers = getAllUsers();
    assert.ok(allUsers.includes(testUser));

    const premiumUsers = getPremiumUsers();
    assert.ok(premiumUsers.includes(testUser));

    const removed = removeUser(testUser);
    assert.equal(removed, true);
    assert.equal(isPremiumUser(testUser), false);
});

// 3. Test usage-tracker.js service
await runTest('usage-tracker.js: usage limits and recording', () => {
    const testUser = '628111222333';
    trackUsage(testUser, 'play');
    const usage = getUserUsage(testUser);
    assert.ok(usage.daily >= 1);

    const limitCheck = checkUsageLimit(testUser, 'free');
    assert.equal(typeof limitCheck.allowed, 'boolean');
    assert.ok(limitCheck.remaining >= 0);
    assert.ok(limitCheck.resetAt instanceof Date);
});

// 4. Test persistence.js sqlite storage
await runTest('persistence.js: setJson, getJson, and deleteKey', async () => {
    process.env.SQLITE_PATH = './temp/test_luxxbot.sqlite3';
    await initPersistence();

    await setJson('test_key_luxx', { foo: 'bar', number: 42 });
    const val = await getJson('test_key_luxx');
    assert.deepEqual(val, { foo: 'bar', number: 42 });

    await deleteKey('test_key_luxx');
    const deletedVal = await getJson('test_key_luxx');
    assert.equal(deletedVal, null);

    await closePersistence();
});

// 5. Test payment-gateway.js formatting
await runTest('payment-gateway.js: formatPaymentMessage', () => {
    const msgSuccess = formatPaymentMessage({
        success: true,
        qrisUrl: 'https://example.com/qr.png',
        amount: 25000,
        expiresAt: new Date().toISOString()
    }, 'premium');
    assert.ok(msgSuccess.includes('PAYMENT: PREMIUM'));
    assert.ok(msgSuccess.includes('25.000'));

    const msgErr = formatPaymentMessage({
        success: false,
        message: 'Network timeout'
    }, 'vip');
    assert.ok(msgErr.includes('Payment Error'));
});

console.log(`\nServices Tests Finished: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
