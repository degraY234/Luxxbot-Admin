import fs from 'fs';
import { downloadYoutubeToMp3 } from '../src/utils/ytdlp-download.js';
import { addTrackToRadio, radio } from '../src/services/radio-server.js';

const out = './temp/radio/e2e-test.mp3';
const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

console.log('1) direct download...');
await downloadYoutubeToMp3(url, out);
console.log('   OK', fs.statSync(out).size, 'bytes');

console.log('2) addTrackToRadio...');
await addTrackToRadio({ title: 'E2E Test', url }, 'test-script');

for (let i = 0; i < 120; i++) {
    if (radio.current && !radio.isPreparing) break;
    if (radio.lastPrepareError) {
        console.error('FAIL prepare:', radio.lastPrepareError);
        process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
    process.stdout.write('.');
}

console.log('\n3) result:', {
    current: radio.current?.title,
    queue: radio.queue.length,
    error: radio.lastPrepareError
});

if (!radio.current) process.exit(1);
console.log('PASS');