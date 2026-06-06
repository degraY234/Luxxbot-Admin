import fs from 'fs';
import path from 'path';
import { getConfiguredPublicBaseUrl } from '../utils/radio-url.js';
import { getPairLink } from '../utils/startup-banner.js';

function isRailwayOrPublicDeploy() {
    if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN) return true;
    return Boolean(getConfiguredPublicBaseUrl());
}

const QR_FILE = path.resolve('./temp/wa-qr.png');
const QR_TTL_MS = 90_000;

let latestQr = null;
let qrGeneratedAt = 0;
let routesRegistered = false;

export function getPairPageUrl() {
    return getPairLink();
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
<style>
:root{--bg:#0c0a14;--card:#16121f;--line:rgba(255,255,255,.1);--pink:#ff6b9d;--violet:#a855f7;--text:#f4f0fa;--muted:#a89bb8}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:system-ui,Segoe UI,sans-serif;background:radial-gradient(ellipse 120% 80% at 50% -20%,#2d1b4e,var(--bg));color:var(--text)}
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
<p class="lead">Buka halaman ini di <b>laptop</b>, lalu scan QR-nya pakai <b>HP</b>.</p>
<div class="steps">
<div class="step"><span class="step-num">1</span><div><b>Buka di laptop</b><span>Copy link → paste di browser Chrome/Edge.</span></div></div>
<div class="step"><span class="step-num">2</span><div><b>Scan dari HP</b><span>WhatsApp → Perangkat tertaut → Tautkan perangkat.</span></div></div>
</div>
<div class="url-box">
<input id="pairUrl" readonly value="${url}">
<button type="button" id="copyBtn">📋 Salin link</button>
</div>
${body}
<footer>LuxxBot pair · route aktif</footer>
</div>
<script>
document.getElementById('copyBtn')?.addEventListener('click',()=>{
  const el=document.getElementById('pairUrl');
  const done=()=>{const b=document.getElementById('copyBtn');const t=b.textContent;b.textContent='✓ Tersalin!';setTimeout(()=>b.textContent=t,2000);};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(el.value).then(done).catch(()=>{el.select();document.execCommand('copy');done();});}
  else{el.select();document.execCommand('copy');done();}
});
${script}
</script></body></html>`;
}

function pairHtmlReady() {
    const ts = Date.now();
    const body = `<div class="grid">
<div class="qr-panel">
<div class="qr-frame"><img id="qrImg" src="/pair/qr.png?t=${ts}" alt="QR WhatsApp" width="360" height="360"></div>
<p class="timer" id="timer">QR aktif</p>
</div>
<aside class="side">
<ol>
<li>Di <b>HP</b>, buka <b>WhatsApp</b></li>
<li><b>Perangkat tertaut</b> → <b>Tautkan perangkat</b></li>
<li>Scan <b>QR di layar laptop</b></li>
</ol>
<div class="tip"><b>QR kedaluwarsa ~90 detik</b> — halaman refresh otomatis.</div>
</aside></div>`;
    const script = `
let left=${qrExpiresInSec()};
const timer=document.getElementById('timer');
const tick=()=>{if(left<=0){location.reload();return}timer.textContent='QR aktif · '+left+' detik lagi';left--;};
tick();setInterval(tick,1000);
setInterval(()=>fetch('/pair/status').then(r=>r.json()).then(d=>{if(!d.ready)location.reload()}).catch(()=>{}),5000);
`;
    return pairPageShell({ title: 'LuxxBot — Scan QR', body, script });
}

function pairHtmlWaiting() {
    const body = `<div class="grid">
<div class="qr-panel">
<div class="qr-wait"><div class="spinner"></div><p><b>Menunggu QR dari bot...</b></p><p style="font-size:.9rem">Refresh otomatis tiap 3 detik.</p></div>
</div>
<aside class="side"><p style="color:var(--muted);line-height:1.6;margin:0">Halaman ini sudah benar. Tunggu bot generate QR (biasanya &lt; 1 menit setelah deploy).</p></aside></div>`;
    const script = `setInterval(()=>fetch('/pair/status').then(r=>r.json()).then(d=>{if(d.ready)location.reload()}).catch(()=>{}),3000);`;
    return pairPageShell({ title: 'LuxxBot — Menunggu QR', body, script });
}

function pairHtml() {
    return qrIsReady() ? pairHtmlReady() : pairHtmlWaiting();
}

async function loadQrEncoder() {
    const mod = await import('qrcode');
    return mod.default;
}

/** Simpan QR + log link /pair */
export async function publishWaQr(qrString) {
    latestQr = qrString;
    qrGeneratedAt = Date.now();

    fs.mkdirSync(path.dirname(QR_FILE), { recursive: true });
    const QRCode = await loadQrEncoder();
    await QRCode.toFile(QR_FILE, qrString, {
        width: 480,
        margin: 2,
        errorCorrectionLevel: 'M'
    });

    console.log(`\x1b[33m🔄 QR baru — refresh di laptop lalu scan HP: ${getPairLink()}\x1b[0m`);

    if (!isRailwayOrPublicDeploy()) {
        const { default: qrcodeTerminal } = await import('qrcode-terminal');
        qrcodeTerminal.generate(qrString, { small: true });
    }
}

export function registerWaQrRoutes(app) {
    if (routesRegistered) return;
    routesRegistered = true;

    const servePairPage = (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(pairHtml());
    };

    app.get('/pair', servePairPage);
    app.get('/pair/', servePairPage);

    app.get('/pair/status', (_req, res) => {
        res.json({
            ok: true,
            ready: qrIsReady(),
            expiresIn: qrExpiresInSec(),
            url: getPairPageUrl()
        });
    });

    app.get('/pair/qr.png', (_req, res) => {
        if (!fs.existsSync(QR_FILE) || !qrIsReady()) {
            return res.status(404).type('text/plain').send('QR belum siap');
        }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        return res.sendFile(QR_FILE);
    });

    console.log(`\x1b[32m✅ Route /pair aktif\x1b[0m`);
}