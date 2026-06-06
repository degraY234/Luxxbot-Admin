#!/bin/sh
set -e

PERSIST="${PERSIST_DIR:-/app/persist}"
mkdir -p "$PERSIST/session" "$PERSIST/data" "$PERSIST/temp"

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

# Railway: WAJIB listen di $PORT (bukan 3920) — kalau RADIO_PORT=3920 di Variables, proxy 502
if [ -n "$RAILWAY_ENVIRONMENT" ] || [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
    if [ -n "$PORT" ]; then
        export RADIO_PORT="$PORT"
    fi
elif [ -n "$PORT" ] && [ -z "$RADIO_PORT" ]; then
    export RADIO_PORT="$PORT"
fi

if [ -n "$RAILWAY_ENVIRONMENT" ] && [ -z "$NODE_OPTIONS" ]; then
    export NODE_OPTIONS="--max-old-space-size=768"
fi

if [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
    case "$RAILWAY_PUBLIC_DOMAIN" in
        http://*|https://*) export RADIO_PUBLIC_URL="${RAILWAY_PUBLIC_DOMAIN}" ;;
        *) export RADIO_PUBLIC_URL="https://${RAILWAY_PUBLIC_DOMAIN}" ;;
    esac
elif [ -n "$RAILWAY_STATIC_URL" ] && [ -z "$RADIO_PUBLIC_URL" ]; then
    export RADIO_PUBLIC_URL="$RAILWAY_STATIC_URL"
fi

echo "LuxxBot starting (listen ${RADIO_PORT:-3920}, railway PORT=${PORT:-n/a})"
if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  echo "PAIR (buka di laptop): https://${RAILWAY_PUBLIC_DOMAIN}/pair"
elif [ -n "${RADIO_PUBLIC_URL:-}" ]; then
  echo "PAIR (buka di laptop): ${RADIO_PUBLIC_URL%/}/pair"
fi
exec "$@"