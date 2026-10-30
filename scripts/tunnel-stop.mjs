/** Hentikan loop tunnel + restart luxx saja. */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pm2(...args) {
    const r = spawnSync('pm2', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return r.status ?? 1;
}

console.log('=== Stop luxx-tunnel + restart luxx ===\n');
pm2('stop', 'luxx-tunnel');
pm2('restart', 'luxx', '--update-env');
pm2('status');
console.log('\nSelesai. Cek !ping di WA.');
console.log('Tunnel lagi: npm run tunnel:start');