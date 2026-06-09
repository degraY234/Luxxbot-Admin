#!/bin/bash
# LuxxBot — deploy di Zelpstore / VPS (Ubuntu, sama seperti PM2 lokal)
# Jalankan setelah git clone:
#   chmod +x scripts/zelpstore-deploy.sh && ./scripts/zelpstore-deploy.sh
#
# Atau clone otomatis:
#   REPO_URL=https://github.com/degraY234/Luxxbot-Admin.git \
#   REPO_BRANCH=feature/railway-deploy \
#   ./scripts/zelpstore-deploy.sh

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/luxxbot}"
REPO_URL="${REPO_URL:-}"
REPO_BRANCH="${REPO_BRANCH:-feature/railway-deploy}"

echo "=============================================="
echo "  LuxxBot — Zelpstore / VPS Deploy"
echo "=============================================="

sudo apt-get update -y
sudo apt-get install -y curl git ffmpeg ca-certificates build-essential \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    libpixman-1-dev libfreetype6-dev fontconfig libopus-dev pkg-config python3

if ! command -v yt-dlp &>/dev/null; then
  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp
  sudo chmod a+rx /usr/local/bin/yt-dlp
fi

if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Node: $(node -v) | npm: $(npm -v)"

if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
fi

if [[ -n "$REPO_URL" && ! -d "$APP_DIR/.git" ]]; then
  git clone -b "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "ERROR: package.json tidak ada di $APP_DIR"
  exit 1
fi

cd "$APP_DIR"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

mkdir -p persist/session persist/session-backup persist/data persist/temp session temp data

PUBLIC_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || hostname -I | awk '{print $1}')

if [[ ! -f .env ]]; then
  cp .env.example .env
  {
    echo ""
    echo "PERSIST_DIR=$APP_DIR/persist"
    echo "RADIO_PUBLIC_URL=http://${PUBLIC_IP}:3920"
    echo "RADIO_BIND_HOST=0.0.0.0"
  } >> .env
  echo ">>> .env dibuat — edit API key: nano .env"
fi

grep -q '^PERSIST_DIR=' .env || echo "PERSIST_DIR=$APP_DIR/persist" >> .env

if command -v ufw &>/dev/null; then
  sudo ufw allow OpenSSH 2>/dev/null || sudo ufw allow 22/tcp
  sudo ufw allow 3920/tcp 2>/dev/null || true
  echo "y" | sudo ufw enable 2>/dev/null || true
fi

pm2 delete luxx 2>/dev/null || true
pm2 start ecosystem.config.cjs --update-env
pm2 save

STARTUP_CMD=$(pm2 startup systemd -u "$USER" --hp "$HOME" | grep -E '^sudo' || true)
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD"
fi
pm2 save

chmod +x scripts/luxx-ctl.sh scripts/oracle-deploy.sh 2>/dev/null || true

echo ""
echo "=============================================="
echo "  DEPLOY SELESAI — perilaku sama seperti PM2"
echo "=============================================="
echo "Status : pm2 status"
echo "Log    : pm2 logs luxx"
echo "Update : ./scripts/luxx-ctl.sh update"
echo "Pair WA: http://${PUBLIC_IP}:3920/pair"
echo "Admin  : http://${PUBLIC_IP}:3920/admin"
echo "Radio  : http://${PUBLIC_IP}:3920/radio"
echo ""
echo "PENTING:"
echo "  1) Isi .env (API key dari PC) lalu: pm2 restart luxx --update-env"
echo "  2) Copy folder session/ dari PC atau scan QR di /pair"
echo "  3) Buka port 3920 di firewall panel Zelpstore"
echo "=============================================="