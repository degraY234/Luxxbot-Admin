/**
 * Aktifkan domain custom setelah DNS siap.
 * Usage: node scripts/enable-portfolio-domain.mjs doxxborxportofolio.com
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const domain = process.argv[2]?.trim().toLowerCase();
if (!domain || domain.includes('/') || domain.includes('github')) {
    console.error('Usage: node scripts/enable-portfolio-domain.mjs doxxborxportofolio.com');
    process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cnamePath = path.join(root, 'portfolio', 'CNAME');
const out = 'C:/Users/DoxxBorx/PortoDoxxborx';

fs.writeFileSync(cnamePath, domain + '\n', 'utf8');
console.log(`✅ CNAME ditulis: ${domain}`);

execSync('node scripts/sync-portfolio-repo.mjs', { cwd: root, stdio: 'inherit', shell: true });

console.log('');
console.log('Di GitHub → PortoDoxxborx → Settings → Pages → Custom domain →', domain);
console.log('DNS di registrar domain (pilih salah satu):');
console.log('');
console.log('  Opsi A — 4 record A:');
console.log('    185.199.108.153');
console.log('    185.199.109.153');
console.log('    185.199.110.153');
console.log('    185.199.111.153');
console.log('');
console.log('  Opsi B — CNAME:');
console.log('    degray234.github.io');
console.log('');