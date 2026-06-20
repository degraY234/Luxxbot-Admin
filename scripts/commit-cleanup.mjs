/**
 * Stage + commit perubahan cleanup repo (tanpa butuh powershell di PATH).
 * Jalankan: node scripts/commit-cleanup.mjs
 * Atau:     npm run cleanup:commit
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        ...opts
    });
    const out = [r.stdout, r.stderr].filter(Boolean).join('').trim();
    if (r.status !== 0) {
        console.error(out);
        process.exit(r.status ?? 1);
    }
    return out;
}

function git(...args) {
    const out = run('git', args);
    if (out) console.log(out);
    return out;
}

console.log('=== Git commit cleanup ===\n');

git('add', '.gitignore', 'README.md', 'package.json', 'scripts/cleanup-repo.ps1', 'scripts/commit-cleanup.mjs');
git('add', '-u', '--', '.',
    ':!.env', ':!session', ':!session/*',
    ':!node_modules', ':!node_modules/*',
    ':!temp', ':!temp/*',
    ':!dist-pages', ':!dist-pages/*',
    ':!terminals', ':!terminals/*',
    ':!.kiro', ':!.kiro/*'
);

git('commit',
    '-m', 'chore: rapikan struktur repo + hapus clutter',
    '-m', '- Hapus 71+ script probe/test/diag di scripts/',
    '-m', '- Bersihkan runtime cache (temp, terminals, dist-pages, .kiro)',
    '-m', '- Hapus file sampah root (dasu.response, w2g_room.json, restore.js)',
    '-m', '- Perbarui .gitignore, README struktur folder, cleanup-repo.ps1 (preserve session/)'
);

console.log('\n=== Git log (3 terakhir) ===');
console.log(git('log', '--oneline', '-3'));

console.log('\n=== Git status ===');
const status = git('status', '--short');
console.log(status || '(clean)');