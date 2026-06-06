#!/bin/bash
# Kontrol LuxxBot dari SSH — cocok dipakai lewat Termius/JuiceSSH di Android
# Usage: ./scripts/luxx-ctl.sh <status|start|stop|restart|logs|save|update>

set -euo pipefail
cd "$(dirname "$0")/.."

CMD="${1:-status}"

case "$CMD" in
  status)
    pm2 status luxx
    curl -sf "http://127.0.0.1:${RADIO_PORT:-3920}/health" 2>/dev/null | head -c 200 || echo "(radio health: offline)"
    ;;
  start)
    pm2 start ecosystem.config.cjs --update-env
    pm2 save
    ;;
  stop)
    pm2 stop luxx
    pm2 save
    ;;
  restart)
    pm2 restart luxx --update-env
    pm2 save
    ;;
  logs)
    pm2 logs luxx --lines 80
    ;;
  save)
    pm2 save
    ;;
  update)
    git pull
    npm install --omit=dev
    pm2 restart luxx --update-env
    pm2 save
    echo "Update selesai."
    ;;
  *)
    echo "Perintah: status | start | stop | restart | logs | save | update"
    exit 1
    ;;
esac