// scripts/test-all.mjs — Master automated test runner for Luxx WhatsApp Bot
import { spawn } from 'node:child_process';
import path from 'node:path';

const suites = [
    { name: 'Core Services & Persistence', file: 'scripts/test-services.mjs' },
    { name: 'Command Handlers & Offline Harness', file: 'scripts/test-commands.mjs' }
];

console.log('====================================================');
console.log('🚀 LUXX BOT AUTOMATED VERIFICATION SUITE');
console.log('====================================================');

let allPassed = true;

for (const suite of suites) {
    console.log(`\n▶ Running Suite: ${suite.name} (${suite.file})`);
    const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, [path.resolve(process.cwd(), suite.file)], {
            stdio: 'inherit'
        });
        child.on('close', resolve);
    });

    if (code !== 0) {
        allPassed = false;
        console.error(`❌ Suite failed with exit code ${code}: ${suite.name}`);
    }
}

console.log('\n====================================================');
if (allPassed) {
    console.log('✨ ALL TEST SUITES PASSED CLEANLY (100% VERIFIED)');
    console.log('====================================================\n');
    process.exit(0);
} else {
    console.error('💥 SOME TEST SUITES FAILED');
    console.log('====================================================\n');
    process.exit(1);
}
