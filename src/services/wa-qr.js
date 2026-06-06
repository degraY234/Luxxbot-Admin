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

function pairPageUrl() {
    const base = getConfiguredPublicBaseUrl();
    if (base) return `${base}/pair`;
    const port = process.env.RADIO_PORT || process.env.PORT || 3920;
    return `http://127.0.0.1:${port}/pair`;
}

function pairHtml() {
    const expired = !latestQr || Date.now() - qrGeneratedAt > QR_TTL_MS;
    if (expired) {
        return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LuxxBot — Pair WA</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f0f14;color:#eee;margin:0;padding:24px;text-align:center}
.box{max-width:360px;margin:40px auto;padding:24px;background:#1a1a24;border-radius:16px}
</style></head><body>
<div class="box"><h2>⏳ Menunggu QR...</h2>
<p>Bot sedang startup. Refresh halaman ini dalam beberapa detik.</p>
<p><small>Cek Railway Logs kalau lama tidak muncul.</small></p></div>
<script>setTimeout(()=>location.reload(),5000)</script>
</body></html>`;
    }

    const ts = Date.now();
    return `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LuxxBot — Scan WhatsApp</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:linear-gradient(160deg,#1a0a2e,#16213e);color:#fff;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{max-width:380px;width:100%;background:rgba(255,255,255,.08);border-radius:20px;padding:28px 20px;text-align:center;backdrop-filter:blur(8px)}
img{width:min(280px,85vw);height:auto;border-radius:12px;background:#fff;padding:12px}
h1{font-size:1.25rem;margin:0 0 8px}
p{color:#ccc;font-size:.9rem;line-height:1.5}
ol{text-align:left;margin:16px auto;max-width:280px;padding-left:20px}
li{margin:6px 0}
</style></head><body>
<div class="card">
<h1>📱 Pair LuxxBot</h1>
<p>Scan QR ini dari WhatsApp di HP kamu</p>
<img src="/pair/qr.png?t=${ts}" alt="QR WhatsApp" width="280" height="280">
<ol>
<li>Buka <b>WhatsApp</b> → ⚙️ <b>Perangkat tertaut</b></li>
<li><b>Tautkan perangkat</b> → scan QR di atas</li>
</ol>
<p><small>QR kedaluwarsa ~60 detik — refresh halaman kalau gagal</small></p>
</div>
<script>setTimeout(()=>location.reload(),45000)</script>
</body></html>`;
}

/** Simpan QR + tampilkan link /pair (cocok Railway & HP) */
export async function publishWaQr(qrString) {
    latestQr = qrString;
    qrGeneratedAt = Date.now();

    fs.mkdirSync(path.dirname(QR_FILE), { recursive: true });
    await QRCode.toFile(QR_FILE, qrString, {
        width: 280,
        margin: 1,
        errorCorrectionLevel: 'M'
    });

    const url = pairPageUrl();
    console.log('\n\x1b[36m════════════════════════════════════════\x1b[0m');
    console.log('\x1b[33m📱 PAIR WHATSAPP — buka link ini di HP:\x1b[0m');
    console.log(`\x1b[32m🔗 ${url}\x1b[0m`);
    console.log('\x1b[36m   (buka di HP — QR di log Railway sering terpotong)\x1b[0m');
    console.log('\x1b[36m════════════════════════════════════════\x1b[0m\n');

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

    app.get('/pair/qr.png', (_req, res) => {
        if (!fs.existsSync(QR_FILE) || !latestQr || Date.now() - qrGeneratedAt > QR_TTL_MS) {
            return res.status(404).send('QR expired');
        }
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(QR_FILE);
    });
}