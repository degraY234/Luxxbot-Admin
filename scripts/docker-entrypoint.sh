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

if [ -n "$PORT" ] && [ -z "$RADIO_PORT" ]; then
    export RADIO_PORT="$PORT"
fi

if [ -n "$RAILWAY_PUBLIC_DOMAIN" ] && [ -z "$RADIO_PUBLIC_URL" ]; then
    export RADIO_PUBLIC_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
fi

echo "=============================================="
echo "  LuxxBot Docker / Railway"
echo "=============================================="
echo "PORT=${RADIO_PORT:-3920} | persist=${PERSIST}"
if [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  echo "Public : https://${RAILWAY_PUBLIC_DOMAIN}"
  echo "Pair   : https://${RAILWAY_PUBLIC_DOMAIN}/pair"
fi
if [ -n "${RADIO_PUBLIC_URL:-}" ]; then
  echo "RADIO_PUBLIC_URL=${RADIO_PUBLIC_URL}"
fi
echo "=============================================="
exec "$@"