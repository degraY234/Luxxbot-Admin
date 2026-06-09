# LuxxBot — WhatsApp Bot Premium

Bot WhatsApp multi-fitur (AI, musik, radio, stiker, sastra, gambar HD) oleh DoxxBorx.

## Struktur proyek

```
├── index.js              # Entry point
├── menu.js               # Menu !menu
├── ecosystem.config.cjs  # PM2 (lokal & VPS/Zelpstore)
├── src/
│   ├── luxx-bot.js       # Koneksi Baileys
│   ├── handlers/messages.js
│   ├── commands/         # Perintah (!buat, !play, dll.)
│   └── services/         # AI, radio, media, admin API
├── admin/                # Panel admin (bisa /admin di server)
├── portfolio/            # Portofolio + radio web
├── scripts/
│   ├── zelpstore-deploy.sh
│   └── luxx-ctl.sh       # status | restart | update
├── session/              # Jangan commit — login WA
└── .env.example          # Template env (copy → .env)
```

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