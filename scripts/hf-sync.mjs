#!/usr/bin/env node
/**
 * hf-sync.mjs — Hugging Face Hub storage sync untuk LuxxBot
 *
 * Usage:
 *   node scripts/hf-sync.mjs pull   ← download session/data dari HF ke local
 *   node scripts/hf-sync.mjs push   ← upload session/data dari local ke HF
 *   node scripts/hf-sync.mjs status ← cek file di HF repo
 *
 * Env vars yang dibutuhkan:
 *   HF_TOKEN   = hf_xxxxxxxxxxxx  (Hugging Face access token, read+write)
 *   HF_REPO    = username/repo-name  (misal: degraY234/luxxbot-session)
 *   HF_BRANCH  = main (opsional, default: main)
 *   LOCAL_DIR  = /app  (opsional, default: /app)
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// ─── Config ───────────────────────────────────────────────────────────────────

const HF_TOKEN  = process.env.HF_TOKEN  || '';
const HF_REPO   = process.env.HF_REPO   || '';
const HF_BRANCH = process.env.HF_BRANCH || 'main';
const LOCAL_DIR = process.env.LOCAL_DIR  || '/app';

// File/folder yang disync ke HF (relatif dari LOCAL_DIR)
const SYNC_PATHS = [
  'session',           // session WA (creds.json, keys, dll)
  'data',              // youtube-cookies, dll
];

// File yang TIDAK disync (pattern substring match)
const EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  'temp/',
  '.tmp',
  '.log',
  'wa-qr.png',
  'wa-qr-meta.json',
];

const HF_API = 'https://huggingface.co';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg)  { process.stdout.write(`[hf-sync] ${msg}\n`); }
function warn(msg) { process.stderr.write(`[hf-sync] ⚠️  ${msg}\n`); }
function err(msg)  { process.stderr.write(`[hf-sync] ❌ ${msg}\n`); }

function shouldExclude(filePath) {
  return EXCLUDE_PATTERNS.some(pat => filePath.includes(pat));
}

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

/** Collect semua file di dir secara rekursif */
function collectFiles(dir, baseDir = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel  = path.relative(baseDir, full).replace(/\\/g, '/');
    if (shouldExclude(rel)) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      results.push(...collectFiles(full, baseDir));
    } else if (st.isFile()) {
      results.push({ full, rel, size: st.size });
    }
  }
  return results;
}

// ─── HF API calls ────────────────────────────────────────────────────────────

async function hfFetch(url, opts = {}) {
  if (!HF_TOKEN) throw new Error('HF_TOKEN tidak di-set!');
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      ...(opts.headers || {}),
    },
  });
  return res;
}

/** Ambil list file di HF repo (dataset tree) */
async function listHfFiles(subfolder = '') {
  const url = `${HF_API}/api/datasets/${HF_REPO}/tree/${HF_BRANCH}${subfolder ? '/' + subfolder : ''}?recursive=true`;
  const res = await hfFetch(url);
  if (res.status === 404) return [];
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HF list error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  // filter hanya file (bukan folder)
  return data.filter(x => x.type === 'file').map(x => x.path);
}

/** Download satu file dari HF ke local */
async function pullFile(hfPath, localPath) {
  const url = `${HF_API}/datasets/${HF_REPO}/resolve/${HF_BRANCH}/${hfPath}`;
  const res = await hfFetch(url);
  if (res.status === 404) {
    warn(`File tidak ditemukan di HF: ${hfPath}`);
    return false;
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HF download ${hfPath} error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, buf);
  return true;
}

/** Upload satu file ke HF via commit API */
async function pushFile(localPath, hfPath) {
  const content = fs.readFileSync(localPath);
  const b64 = content.toString('base64');

  const url = `${HF_API}/api/datasets/${HF_REPO}/commit/${HF_BRANCH}`;
  const body = JSON.stringify({
    commitTitle: `[hf-sync] update ${hfPath}`,
    commitDescription: `Auto-sync dari LuxxBot pada ${new Date().toISOString()}`,
    files: [
      {
        path: hfPath,
        content: b64,
        encoding: 'base64',
      },
    ],
  });

  const res = await hfFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HF push ${hfPath} error ${res.status}: ${txt.slice(0, 300)}`);
  }
  return true;
}

/** Push banyak file sekaligus dalam 1 commit (lebih efisien) */
async function pushFiles(fileMap) {
  // fileMap = [{ localPath, hfPath }, ...]
  if (fileMap.length === 0) return;

  const files = fileMap.map(({ localPath, hfPath }) => {
    const content = fs.readFileSync(localPath);
    return {
      path: hfPath,
      content: content.toString('base64'),
      encoding: 'base64',
    };
  });

  const url = `${HF_API}/api/datasets/${HF_REPO}/commit/${HF_BRANCH}`;
  const body = JSON.stringify({
    commitTitle: `[hf-sync] bulk push ${files.length} file`,
    commitDescription: `Auto-sync dari LuxxBot pada ${new Date().toISOString()}`,
    files,
  });

  const res = await hfFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    // Kalau gagal bulk, fallback ke satu-satu
    warn(`Bulk push gagal (${res.status}), coba satu-satu... ${txt.slice(0,100)}`);
    for (const { localPath, hfPath } of fileMap) {
      try {
        await pushFile(localPath, hfPath);
        log(`  pushed: ${hfPath}`);
      } catch (e) {
        err(`  gagal push ${hfPath}: ${e.message}`);
      }
    }
    return;
  }
  log(`✅ Pushed ${files.length} file ke HF (1 commit)`);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdPull() {
  if (!HF_TOKEN || !HF_REPO) {
    warn('HF_TOKEN atau HF_REPO tidak di-set. Skip pull.');
    process.exit(0);
  }

  log(`📥 Pull dari HF: ${HF_REPO} (branch: ${HF_BRANCH})`);

  let totalPulled = 0;
  let totalSkipped = 0;

  for (const syncPath of SYNC_PATHS) {
    log(`  Checking folder: ${syncPath}/`);
    let hfFiles;
    try {
      hfFiles = await listHfFiles(syncPath);
    } catch (e) {
      warn(`  Gagal list ${syncPath}/: ${e.message}`);
      continue;
    }

    if (hfFiles.length === 0) {
      log(`  (kosong di HF, skip)`);
      continue;
    }

    for (const hfPath of hfFiles) {
      if (shouldExclude(hfPath)) continue;
      const localPath = path.join(LOCAL_DIR, hfPath);
      try {
        const ok = await pullFile(hfPath, localPath);
        if (ok) {
          log(`  ✅ pulled: ${hfPath} → ${localPath}`);
          totalPulled++;
        } else {
          totalSkipped++;
        }
      } catch (e) {
        err(`  Gagal pull ${hfPath}: ${e.message}`);
        totalSkipped++;
      }
    }
  }

  log(`📥 Pull selesai: ${totalPulled} file didownload, ${totalSkipped} dilewati`);
}

async function cmdPush() {
  if (!HF_TOKEN || !HF_REPO) {
    warn('HF_TOKEN atau HF_REPO tidak di-set. Skip push.');
    process.exit(0);
  }

  log(`📤 Push ke HF: ${HF_REPO} (branch: ${HF_BRANCH})`);

  const toUpload = [];
  for (const syncPath of SYNC_PATHS) {
    const localDir = path.join(LOCAL_DIR, syncPath);
    const files = collectFiles(localDir, LOCAL_DIR);
    if (files.length === 0) {
      log(`  ${syncPath}/: tidak ada file lokal`);
      continue;
    }
    for (const { full, rel } of files) {
      toUpload.push({ localPath: full, hfPath: rel });
    }
  }

  if (toUpload.length === 0) {
    log('Tidak ada file untuk di-push.');
    return;
  }

  log(`  Total ${toUpload.length} file akan di-push...`);
  for (const f of toUpload) {
    log(`    → ${f.hfPath} (${fs.statSync(f.localPath).size} bytes)`);
  }

  // Batch per 10 file (HF commit size limit)
  const BATCH = 10;
  for (let i = 0; i < toUpload.length; i += BATCH) {
    const batch = toUpload.slice(i, i + BATCH);
    await pushFiles(batch);
  }

  log(`📤 Push selesai: ${toUpload.length} file ke HF`);
}

async function cmdStatus() {
  if (!HF_TOKEN || !HF_REPO) {
    warn('HF_TOKEN atau HF_REPO tidak di-set.');
    process.exit(1);
  }

  log(`🔍 Status HF repo: ${HF_REPO}`);
  for (const syncPath of SYNC_PATHS) {
    let hfFiles;
    try {
      hfFiles = await listHfFiles(syncPath);
    } catch (e) {
      warn(`  Gagal list ${syncPath}/: ${e.message}`);
      continue;
    }
    log(`  ${syncPath}/: ${hfFiles.length} file di HF`);
    for (const f of hfFiles) {
      const localPath = path.join(LOCAL_DIR, f);
      const localExists = fs.existsSync(localPath);
      log(`    ${localExists ? '✅' : '❓'} ${f}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'pull';
try {
  if      (cmd === 'pull')   await cmdPull();
  else if (cmd === 'push')   await cmdPush();
  else if (cmd === 'status') await cmdStatus();
  else {
    err(`Command tidak dikenal: ${cmd}. Gunakan: pull | push | status`);
    process.exit(1);
  }
} catch (e) {
  err(`Fatal: ${e.message}`);
  process.exit(1);
}
