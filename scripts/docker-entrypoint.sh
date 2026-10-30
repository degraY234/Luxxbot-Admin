#!/bin/sh
set -e

PERSIST="${PERSIST_DIR:-/app/persist}"
mkdir -p "$PERSIST/session" "$PERSIST/session-backup" "$PERSIST/data" "$PERSIST/temp"

link_dir() {
    target="$1"
    name="$2"
    if [ -L "$target" ]; then rm -f "$target"; fi
    if [ -d "$target" ] && [ ! -L "$target" ]; then
        cp -a "$target/." "$PERSIST/$name/" 2>/dev/null || true
        rm -rf "$target"
    fi
    ln -sfn "$PERSIST/$name" "$target"
}

link_dir /app/session session
link_dir /app/data data
mkdir -p /app/temp
link_dir /app/temp temp

# Port handling: Render, Railway, atau container cloud lain WAJIB listen di $PORT
if [ -n "$RENDER" ] || [ -n "$RENDER_SERVICE_ID" ] || [ -n "$RAILWAY_ENVIRONMENT" ] || [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
    if [ -n "$PORT" ]; then
        export RADIO_PORT="$PORT"
    fi
elif [ -n "$PORT" ] && [ -z "$RADIO_PORT" ]; then
    export RADIO_PORT="$PORT"
fi

if [ -z "$NODE_OPTIONS" ]; then
    export NODE_OPTIONS="--max-old-space-size=1024"
fi

if [ -z "$FFMPEG_PATH" ] && [ -x /usr/bin/ffmpeg ]; then
    export FFMPEG_PATH=/usr/bin/ffmpeg
fi

# Deteksi domain publik: Render / Railway
if [ -n "$RENDER_EXTERNAL_URL" ]; then
    export RADIO_PUBLIC_URL="${RENDER_EXTERNAL_URL}"
elif [ -n "$RENDER_EXTERNAL_HOSTNAME" ] && [ -z "$RADIO_PUBLIC_URL" ]; then
    export RADIO_PUBLIC_URL="https://${RENDER_EXTERNAL_HOSTNAME}"
elif [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
    case "$RAILWAY_PUBLIC_DOMAIN" in
        http://*|https://*) export RADIO_PUBLIC_URL="${RAILWAY_PUBLIC_DOMAIN}" ;;
        *) export RADIO_PUBLIC_URL="https://${RAILWAY_PUBLIC_DOMAIN}" ;;
    esac
elif [ -n "$RAILWAY_STATIC_URL" ] && [ -z "$RADIO_PUBLIC_URL" ]; then
    export RADIO_PUBLIC_URL="$RAILWAY_STATIC_URL"
fi

COOKIES_FILE="$PERSIST/data/youtube-cookies.txt"
export YTDLP_COOKIES_FILE="${YTDLP_COOKIES_FILE:-$COOKIES_FILE}"

# â”€â”€â”€ Hugging Face Storage: Pull session saat startup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if [ -n "$HF_TOKEN" ] && [ -n "$HF_REPO" ]; then
    echo "â˜ï¸  Hugging Face storage aktif: $HF_REPO"
    echo "ðŸ“¥ Pulling session & data dari HF..."
    node --input-type=module scripts/hf-sync.mjs pull 2>&1 || {
        echo "âš ï¸  HF pull gagal, coba lanjut dengan local state..."
    }
    # Setelah pull, link ulang supaya symlink ke /app/session tetap valid
    if [ -f "$PERSIST/session/creds.json" ]; then
        echo "âœ… Session WA berhasil di-pull dari HF"
    fi
else
    echo "â„¹ï¸  HF_TOKEN/HF_REPO tidak diset â€” storage lokal saja"
fi

# â”€â”€â”€ Cek status session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if [ -f "$PERSIST/session/creds.json" ]; then
    echo "âœ… Session WA ada â€” redeploy tanpa scan QR"
    echo "   creds size: $(wc -c < "$PERSIST/session/creds.json" 2>/dev/null || echo 0) bytes"
elif [ -f "$PERSIST/session-backup/creds.json" ]; then
    echo "ðŸ”„ Session backup ada â€” restore ke session"
    cp -a "$PERSIST/session-backup/." "$PERSIST/session/" 2>/dev/null || true
elif [ -f "$PERSIST/data/wa-creds.json" ]; then
    echo "ðŸ”„ Snapshot wa-creds.json ada â€” restore session"
    mkdir -p "$PERSIST/session"
    cp -f "$PERSIST/data/wa-creds.json" "$PERSIST/session/creds.json"
    cp -a "$PERSIST/session-backup/." "$PERSIST/session/" 2>/dev/null || true
else
    echo "âš ï¸  SESSION KOSONG â€” wajib:"
    if [ -n "$HF_TOKEN" ] && [ -n "$HF_REPO" ]; then
        echo "   â†’ HF aktif: buka /pair â†’ scan QR â†’ session otomatis tersimpan ke HF"
    else
        echo "   1) Set HF_TOKEN + HF_REPO di env vars Render"
        echo "   2) Buka /pair â†’ scan QR sekali"
    fi
fi

if [ -f "$COOKIES_FILE" ] && [ "$(wc -c < "$COOKIES_FILE" 2>/dev/null || echo 0)" -gt 80 ]; then
    echo "âœ… YouTube cookies: $COOKIES_FILE ($(wc -c < "$COOKIES_FILE") bytes)"
else
    echo "âš ï¸  YouTube cookies belum ada â€” jalankan scripts/export-youtube-cookies.ps1 di PC"
fi

ls -la "$PERSIST/session" 2>/dev/null | head -5 || true

if command -v yt-dlp > /dev/null 2>&1; then
    echo "yt-dlp: $(yt-dlp --version 2>/dev/null || echo unknown)"
fi

echo "LuxxBot starting (listen ${RADIO_PORT:-3920}, PORT=${PORT:-n/a})"

if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
    echo "PAIR (buka di laptop): ${RENDER_EXTERNAL_URL%/}/pair"
elif [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
    echo "PAIR (buka di laptop): https://${RAILWAY_PUBLIC_DOMAIN}/pair"
elif [ -n "${RADIO_PUBLIC_URL:-}" ]; then
    echo "PAIR (buka di laptop): ${RADIO_PUBLIC_URL%/}/pair"
fi

exec "$@"
