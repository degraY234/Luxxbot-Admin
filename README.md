# LuxxBot — WhatsApp Bot Premium

Bot WhatsApp multi-fitur (AI, musik W2G, stiker, games) oleh DoxxBorx.

## Struktur proyek

```
├── index.js              # Entry point
├── menu.js               # Teks menu (!menu) — jangan ubah tampilan tanpa izin
├── bot-commands.js       # Re-export musik (kompatibilitas)
├── src/
│   ├── bot.js            # Koneksi Baileys + lifecycle
│   ├── config.js         # Env & konstanta
│   ├── state.js          # State runtime bot
│   ├── globals.js        # global.* (notes, radio, votes)
│   ├── handlers/
│   │   └── messages.js   # Semua handler perintah
│   ├── commands/
│   │   └── music.js      # !play, !radio, !queue, dll.
│   ├── services/
│   │   ├── ai.js         # Gemini / OpenAI / Groq
│   │   ├── media.js      # Stiker, gambar, ffmpeg
│   │   └── w2g.js        # Watch2Gether API
│   └── utils/
│       ├── cooldown.js
│       └── runtime.js
├── session/              # Jangan commit (gitignore)
├── backup/               # File lama (indesx.js, dsd.js)
└── .env.example
```

## Setup lokal

1. `npm install`
2. Salin `.env.example` → `.env` dan isi API key
3. `npm start` atau `pm2 start index.js --name luxx`

## Deploy (Zelpstore / VPS)

1. Push repo ke GitHub (tanpa `session/`, `.env`, `node_modules/`)
2. Clone di server, `npm install --production`
3. Upload / generate session WA di folder `session/`
4. `pm2 start index.js --name luxx && pm2 save`

## Perintah owner

- `!pingsan` — matikan bot + PM2 (`pm2 stop luxx`)
- `pm2 start luxx` — nyalakan lagi

## Versi

3.0.0 Premium Edition