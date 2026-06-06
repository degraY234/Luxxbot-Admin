import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import { getConfiguredPublicBaseUrl } from '../utils/radio-url.js';

function isRailwayOrPublicDeploy() {
    if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN) return true;
    return Boolean(getConfiguredPublicBaseUrl());
}

const QR_FILE = path.resolve('./temp/wa-qr.png');
const QR_TTL_MS = 90_000;

let latestQr = null;
let qrGeneratedAt = 0;

export function getPairPageUrl() {
    const base = getConfiguredPublicBaseUrl();
    if (base) return `${base.replace(/\/$/, '')}/pair`;
    const port = process.env.RADIO_PORT || process.env.PORT || 3920;
    return `http://127.0.0.1:${port}/pair`;
}

function qrIsReady() {
    return Boolean(latestQr && Date.now() - qrGeneratedAt <= QR_TTL_MS);
}

function qrExpiresInSec() {
    if (!latestQr) return 0;
    return Math.max(0, Math.ceil((qrGeneratedAt + QR_TTL_MS - Date.now()) / 1000));
}

function pairPageShell({ title, body, script = '' }) {
    const url = getPairPageUrl();
    return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0c0a14;--card:#16121f;--line:rgba(255,255,255,.1);--pink:#ff6b9d;--violet:#a855f7;--text:#f4f0fa;--muted:#a89bb8}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Outfit,system-ui,sans-serif;background:radial-gradient(ellipse 120% 80% at 50% -20%,#2d1b4e,var(--bg));color:var(--text)}
.wrap{max-width:880px;margin:0 auto;padding:32px 20px 48px}
.badge{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,var(--pink),var(--violet));color:#fff;font-size:.75rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:6px 14px;border-radius:999px;margin-bottom:16px}
h1{margin:0 0 8px;font-size:clamp(1.5rem,4vw,2rem);font-weight:700}
.lead{color:var(--muted);margin:0 0 28px;line-height:1.6;font-size:1.05rem}
.steps{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:28px}
@media(max-width:640px){.steps{grid-template-columns:1fr}}
.step{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start}
.step-num{flex-shrink:0;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--pink),var(--violet));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem}
.step b{display:block;margin-bottom:4px}
.step span{color:var(--muted);font-size:.9rem;line-height:1.45}
.url-box{display:flex;gap:8px;margin-bottom:28px;flex-wrap:wrap}
.url-box input{flex:1;min-width:200px;background:#0a0810;border:1px solid var(--line);color:var(--text);border-radius:12px;padding:14px 16px;font:inherit;font-size:.95rem}
.url-box button{background:linear-gradient(135deg,var(--pink),var(--violet));border:0;color:#fff;font:inherit;font-weight:600;padding:14px 22px;border-radius:12px;cursor:pointer;white-space:nowrap}
.url-box button:hover{filter:brightness(1.08)}
.grid{display:grid;grid-template-columns:1fr 280px;gap:28px;align-items:start}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
.qr-panel{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;text-align:center}
.qr-frame{background:#fff;border-radius:16px;padding:20px;display:inline-block;box-shadow:0 12px 40px rgba(0,0,0,.35)}
.qr-frame img{display:block;width:min(360px,100%);height:auto}
.qr-wait{min-height:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--muted)}
.spinner{width:40px;height:40px;border:3px solid var(--line);border-top-color:var(--pink);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.timer{font-size:.85rem;color:var(--muted);margin-top:14px}
.side ol{margin:0;padding-left:20px;color:var(--muted);line-height:1.7;font-size:.95rem}
.side li{margin:8px 0}
.side li b{color:var(--text)}
.tip{margin-top:20px;padding:14px 16px;background:rgba(168,85,247,.12);border:1px solid rgba(168,85,247,.25);border-radius:12px;font-size:.88rem;color:var(--muted);line-height:1.5}
.tip b{color:var(--text)}
footer{margin-top:32px;text-align:center;font-size:.8rem;color:var(--muted)}
</style></head><body>
<div class="wrap">
<span class="badge">LuxxBot · Pair WhatsApp</span>
<h1>🔗 Tautkan Bot ke WhatsApp</h1>
<p class="lead">Buka halaman ini di <b>laptop/PC</b>, lalu scan QR-nya pakai <b>HP</b>. Jangan scan QR dari log Railway — pakai link di bawah.</p>
<div class="steps">
<div class="step"><span class="step-num">1</span><div><b>Buka di laptop</b><span>Copy link → paste di browser Chrome/Edge di komputer kamu.</span></div></div>
<div class="step"><span class="step-num">2</span><div><b>Scan dari HP</b><span>WhatsApp → Perangkat tertaut → Tautkan perangkat → arahkan ke QR di layar laptop.</span></div></div>
</div>
<div class="url-box">
<input id="pairUrl" readonly value="${url}">
<button type="button" id="copyBtn">📋 Salin link</button>
</div>
${body}
<footer>LuxxBot · halaman pair aman untuk dibuka di browser laptop</footer>
</div>
<script>
document.getElementById('copyBtn')?.addEventListener('click',()=>{
  const el=document.getElementById('pairUrl');
  navigator.clipboard.writeText(el.value).then(()=>{
    const b=document.getElementById('copyBtn');const t=b.textContent;b.textContent='✓ Tersalin!';setTimeout(()=>b.textContent=t,2000);
  }).catch(()=>{el.select();document.execCommand('copy');});
});
${script}
</script></body></html>`;
}

function pairHtmlReady() {
    const ts = Date.now();
    const body = `<div class="grid">
<div class="qr-panel">
<div class="qr-frame"><img id="qrImg" src="/pair/qr.png?t=${ts}" alt="QR WhatsApp LuxxBot" width="360" height="360"></div>
<p class="timer" id="timer">QR aktif — refresh otomatis sebelum kedaluwarsa</p>
</div>
<aside class="side">
<ol>
<li>Di <b>HP</b>, buka aplikasi <b>WhatsApp</b></li>
<li>Tap <b>⋮</b> (Android) atau <b>Pengaturan</b> (iPhone)</li>
<li>Pilih <b>Perangkat tertaut</b></li>
<li>Tap <b>Tautkan perangkat</b></li>
<li>Arahkan kamera HP ke <b>QR di layar laptop</b> ini</li>
</ol>
<div class="tip"><b>Tips:</b> Layar laptop harus terang & QR tidak ketutup. Kalau gagal, tunggu QR baru (halaman refresh sendiri).</div>
</aside></div>`;
    const script = `
let left=${qrExpiresInSec()};
const timer=document.getElementById('timer');
const tick=()=>{if(left<=0){location.reload();return}timer.textContent='QR aktif · kedaluwarsa dalam '+left+' detik';left--;};
tick();setInterval(tick,1000);
setInterval(()=>fetch('/pair/status').then(r=>r.json()).then(d=>{if(!d.ready)location.reload()}),8000);
`;
    return pairPageShell({ title: 'LuxxBot — Scan QR (buka di laptop)', body, script });
}

function pairHtmlWaiting() {
    const body = `<div class="grid">
<div class="qr-panel">
<div class="qr-wait"><div class="spinner"></div><p><b>Menunggu QR dari bot...</b></p><p style="font-size:.9rem">Bot sedang startup. Halaman ini refresh otomatis.</p></div>
</div>
<aside class="side">
<p style="color:var(--muted);line-height:1.6;margin:0">Setelah bot siap, QR akan muncul di sini. Kamu tidak perlu buka log Railway — cukup tunggu di halaman ini.</p>
<div class="tip" style="margin-top:16px"><b>Sudah lama kosong?</b> Cek Railway Logs apakah bot crash, atau redeploy lalu buka link ini lagi.</div>
</aside></div>`;
    const script = `
setInterval(()=>fetch('/pair/status').then(r=>r.json()).then(d=>{if(d.ready)location.reload()}),3000);
`;
    return pairPageShell({ title: 'LuxxBot — Menunggu QR', body, script });
}

function pairHtml() {
    return qrIsReady() ? pairHtmlReady() : pairHtmlWaiting();
}

/** Simpan QR + tampilkan link /pair untuk dibuka di laptop */
export async function publishWaQr(qrString) {
    latestQr = qrString;
    qrGeneratedAt = Date.now();

    fs.mkdirSync(path.dirname(QR_FILE), { recursive: true });
    await QRCode.toFile(QR_FILE, qrString, {
        width: 480,
        margin: 2,
        errorCorrectionLevel: 'M'
    });

    const url = getPairPageUrl();
    console.log('\n\x1b[35m╔══════════════════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[33m║  📱 PAIR WHATSAPP — BUKA LINK INI DI LAPTOP (browser)   ║\x1b[0m');
    console.log('\x1b[32m║\x1b[0m');
    console.log(`\x1b[32m║  ${url}\x1b[0m`);
    console.log('\x1b[32m║\x1b[0m');
    console.log('\x1b[36m║  Lalu scan QR di layar laptop pakai WhatsApp di HP kamu  ║\x1b[0m');
    console.log('\x1b[35m╚══════════════════════════════════════════════════════════╝\x1b[0m\n');

    if (!isRailwayOrPublicDeploy()) {
        qrcodeTerminal.generate(qrString, { small: true });
    }
}

export function registerWaQrRoutes(app) {
    app.get('/pair', (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(pairHtml());
    });

    app.get('/pair/status', (_req, res) => {
        res.json({
            ready: qrIsReady(),
            expiresIn: qrExpiresInSec(),
            url: getPairPageUrl()
        });
    });

    app.get('/pair/qr.png', (_req, res) => {
        if (!fs.existsSync(QR_FILE) || !qrIsReady()) {
            return res.status(404).send('QR expired');
        }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(QR_FILE);
    });
}