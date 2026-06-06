#!/bin/bash
# LuxxBot — deploy otomatis di Oracle Cloud (Ubuntu 22/24)
# Jalankan di VPS sebagai user ubuntu (bukan root):
#   chmod +x scripts/oracle-deploy.sh && ./scripts/oracle-deploy.sh
#
# SEBELUM JALANKAN (di Oracle Console → Networking → Security List):
#   - TCP 22  (SSH) dari 0.0.0.0/0 atau IP kamu
#   - TCP 3920 (radio, opsional) dari 0.0.0.0/0

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/luxxbot}"
REPO_URL="${REPO_URL:-}"

echo "=============================================="
echo "  LuxxBot — Oracle Cloud Deploy"
echo "=============================================="

# --- Sistem ---
sudo apt-get update -y
sudo apt-get install -y curl git ffmpeg ca-certificates gnupg

# yt-dlp
if ! command -v yt-dlp &>/dev/null; then
  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp
  sudo chmod a+rx /usr/local/bin/yt-dlp
fi

# Node.js 20 LTS
if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Node: $(node -v) | npm: $(npm -v)"

# PM2
if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
fi

# --- Kode bot ---
if [[ -n "$REPO_URL" && ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
fi

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "ERROR: package.json tidak ada di $APP_DIR"
  echo "Set REPO_URL atau clone manual: git clone <repo> $APP_DIR"
  exit 1
fi

cd "$APP_DIR"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# --- .env ---
if [[ ! -f .env ]]; then
  cp .env.example .env
  PUBLIC_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || hostname -I | awk '{print $1}')
  sed -i "s|RADIO_PUBLIC_URL=.*|RADIO_PUBLIC_URL=http://${PUBLIC_IP}:3920|" .env
  echo ""
  echo ">>> .env dibuat dari .env.example"
  echo ">>> Edit API key: nano .env"
  echo ">>> RADIO_PUBLIC_URL sudah diset ke http://${PUBLIC_IP}:3920"
fi

# --- Firewall ringan (jika ufw ada) ---
if command -v ufw &>/dev/null; then
  sudo ufw allow OpenSSH 2>/dev/null || sudo ufw allow 22/tcp
  sudo ufw allow 3920/tcp 2>/dev/null || true
  echo "y" | sudo ufw enable 2>/dev/null || true
fi

# --- PM2 ---
pm2 delete luxx 2>/dev/null || true
pm2 start ecosystem.config.cjs --update-env
pm2 save

# Auto-start saat VPS reboot
STARTUP_CMD=$(pm2 startup systemd -u "$USER" --hp "$HOME" | grep -E '^sudo' || true)
if [[ -n "$STARTUP_CMD" ]]; then
  eval "$STARTUP_CMD"
fi
pm2 save

chmod +x scripts/luxx-ctl.sh 2>/dev/null || true

PUBLIC_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "IP-PUBLIK-VPS")

echo ""
echo "=============================================="
echo "  DEPLOY SELESAI"
echo "=============================================="
echo "Status : pm2 status"
echo "Log    : pm2 logs luxx"
echo "Pair WA: http://${PUBLIC_IP}:3920/pair  (buka di laptop, scan dari HP)"
echo "Admin  : http://${PUBLIC_IP}:3920/admin"
echo "Radio  : http://${PUBLIC_IP}:3920/radio"
echo "Watch  : http://${PUBLIC_IP}:3920/watch"
echo "Health : http://${PUBLIC_IP}:3920/health"
echo ""
echo "Kontrol dari Android (SSH):"
echo "  cd $APP_DIR && ./scripts/luxx-ctl.sh status"
echo "  cd $APP_DIR && ./scripts/luxx-ctl.sh restart"
echo ""
echo "PENTING:"
echo "  1) Isi .env (API key) lalu: pm2 restart luxx --update-env"
echo "  2) Copy folder session/ dari PC jika tidak mau scan QR lagi"
echo "  3) Buka port 3920 di Oracle Security List untuk radio"
echo "=============================================="