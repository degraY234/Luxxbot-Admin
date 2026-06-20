# LuxxBot — WhatsApp Bot Premium

Bot WhatsApp multi-fitur (AI, musik, radio, stiker, sastra, gambar HD) oleh DoxxBorx.

## Struktur proyek

```
├── index.js              # Entry point HTTP + boot WA/radio
├── menu.js               # Menu !menu
├── ecosystem.config.cjs  # PM2 (lokal & VPS/Zelpstore)
├── src/
│   ├── luxx-bot.js       # Koneksi Baileys
│   ├── handlers/         # messages, group-events
│   ├── commands/         # Perintah (!buat, !play, !watch, dll.)
│   ├── services/         # AI, radio, media, admin API, LK21
│   └── utils/            # session, cookies, ffmpeg, dll.
├── admin/                # Panel admin web
├── watch/                # Web player film (!watch / LK21)
├── portfolio/            # Portofolio + radio web
├── data/                 # changelog, group-settings (runtime)
├── config/               # cloudflared example (credentials lokal)
├── scripts/              # deploy, PM2, build-pages (bukan probe/test)
├── session/              # Jangan commit — login WA
├── temp/                 # Cache runtime (auto, di .gitignore)
└── .env.example          # Template env (copy → .env)
```

**Bersihkan clutter lokal:** `.\scripts\cleanup-repo.ps1` · **Commit cleanup:** `npm run cleanup:commit`

## Setup lokal (PC + PM2)

```bash
npm install
cp .env.example .env   # isi API key
npm run pm2:start
npm run pm2:restart
```

## GitHub

| Item | Nilai |
|------|--------|
| Repo | `https://github.com/degraY234/Luxxbot-Admin` |
| Branch deploy | `feature/railway-deploy` |

**Jangan push:** `.env`, `session/`, `persist/`, `node_modules/`

## Deploy Zelpstore / VPS (sama seperti PM2)

```bash
# Di VPS (sekali)
git clone -b feature/railway-deploy https://github.com/degraY234/Luxxbot-Admin.git ~/luxxbot
cd ~/luxxbot
chmod +x scripts/zelpstore-deploy.sh
./scripts/zelpstore-deploy.sh

# Isi API key
nano .env
pm2 restart luxx --update-env

# Pair WA: http://IP_VPS:3920/pair
```

Checklist lengkap: `scripts/zelpstore-setup-checklist.txt`

## Update setelah deploy

```bash
# Di PC: push perubahan ke GitHub
git push origin feature/railway-deploy

# Di VPS:
cd ~/luxxbot && ./scripts/luxx-ctl.sh update
```

## Railway (opsional)

Dockerfile + `railway.toml` sudah ada. Pakai volume `/app/persist` untuk session.

## Perintah owner

- `!pingsan` — matikan bot
- `pm2 restart luxx` — nyalakan lagi

## Versi

3.1.0 Premium Edition