# 🚀 Panduan & Checklist Deployment 24/7 LuxxBot

Panduan ini merangkum langkah setup dan verifikasi untuk menjalankan bot WhatsApp LuxxBot 24/7 di **Railway (Cloud Hosting)** atau **PM2 (PC Lokal / VPS)**.

---

## 📋 Ringkasan Arsitektur 24/7

- **Runtime:** Node.js 20 (Bookworm slim / Native build tools)
- **Engine WA:** `@whiskeysockets/baileys` (Multi-device QR Pairing)
- **Voice / Media:** `@discordjs/opus`, `sodium-native`, `canvas`, `yt-dlp`, `ffmpeg`
- **Session Persistence:** Folder `session/` (Lokal) atau `/app/persist/session` (Railway Volume)
- **Web Services:** Admin Panel (`/admin`), Radio Streaming (`/radio`), Luxx Watch (`/watch`), QR Pairing UI (`/pair`), Health Check (`/health`)

---

## ☁️ Opsi A: Deployment 24/7 di Railway (Rekomendasi Cloud)

### 1. Checklist Persiapan Repositori
- [x] `Dockerfile` multi-stage/native dependencies siap (`ffmpeg`, `libcairo2`, `yt-dlp`).
- [x] `railway.toml` tervalidasi dengan restart policy `ON_FAILURE`.
- [x] `railway.json` tervalidasi.
- [x] `scripts/docker-entrypoint.sh` siap memetakan `/app/persist` ke session & data.

### 2. Langkah Deploy di Railway Dashboard
1. **Daftar / Login:** Buka [railway.app](https://railway.app).
2. **Buat Project:** Klik **New Project** → **Deploy from GitHub repo**.
3. **Pilih Branch:** Pilih repo `Project Bot Wa` dan branch `feature/railway-deploy`.
4. **Setup Persistent Volume (WAJIB):**
   - Masuk ke dashboard service → **Settings** → **Volumes**.
   - Klik **Add Volume** → Mount Path: `/app/persist`.
   - Ukuran: 1 GB (sangat cukup untuk session WA & cache).
   > ⚠️ *PENTING: Tanpa Volume, session login WA akan terhapus tiap kali container redeploy / restart.*
5. **Konfigurasi Environment Variables:**
   Buka tab **Variables** dan tambahkan:
   ```env
   NODE_ENV=production
   PERSIST_DIR=/app/persist
   RADIO_BIND_HOST=0.0.0.0
   GEMINI_API_KEY=your_gemini_api_key
   GROK_API_KEY=your_grok_api_key
   DISCORD_BOT_TOKEN=your_discord_token
   DISCORD_GUILD_ID=your_discord_guild_id
   ADMIN_API_TOKEN=your_secure_random_token
   ```
   > ⚠️ *CATATAN PORT: JANGAN menambahkan `RADIO_PORT=3920` di Railway Variables. Biarkan Railway menyuntikkan variabel `PORT` dinamis secara otomatis.*
6. **Generate Public Domain:**
   - Masuk ke **Settings** → **Networking** → Klik **Generate Domain** (contoh: `luxxbot-production.up.railway.app`).
   - Salin domain tersebut dan tambahkan ke Variables:
     ```env
     RADIO_PUBLIC_URL=https://luxxbot-production.up.railway.app
     ```
7. **Pairing WhatsApp:**
   - Buka browser laptop ke: `https://<domain-railway-kamu>/pair`
   - Buka WhatsApp di HP → **Perangkat Tertaut** → **Tautkan Perangkat**.
   - Scan QR code yang tampil di layar laptop.
   - Selesai! Bot langsung aktif 24/7.

---

## 💻 Opsi B: Deployment 24/7 di PC Lokal / VPS (PM2)

### 1. Jalankan Semua Layanan
Jalankan satu perintah untuk start bot + tunnel Cloudflare + sync environment:
```powershell
npm run pm2:start:all
```

### 2. Pasang Auto-Start Windows (Reboot Resilience)
Agar PM2 otomatis menyala saat Windows login atau setelah restart PC:
```powershell
npm run pm2:install-startup
```
*(Untuk mencopot autorun, jalankan `npm run pm2:disable-startup`)*

### 3. Monitoring & Pengendalian PM2
- **Cek Status:** `npm run pm2:status` (pastikan status `luxx` dan `luxx-tunnel` adalah `online`).
- **Restart Bot:** `npm run pm2:restart`
- **Simpan Konfigurasi:** `npm run pm2:save`
- **Reset Tunnel (jika error 530):** `npm run tunnel:reset`

---

## 🔍 Verifikasi & Uji Kesehatan (Smoke Test)

Jalankan pengujian endpoint lokal/remote:
```bash
npm run test:smoke
```

Atau uji manual via HTTP:
- Health check: `GET /health` (mengembalikan status HTTP server, status Baileys WA, uptime)
- QR Pair page: `GET /pair` (antarmuka scan QR interaktif)
- Admin dashboard: `GET /admin`
- Radio config: `GET /radio/api/config`
