FROM node:20-bookworm-slim

# Native deps untuk canvas, sharp, @discordjs/opus (fallback compile kalau prebuild 404)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    build-essential \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    libfreetype6-dev \
    fontconfig \
    libopus-dev \
    curl \
    ca-certificates \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
        -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=2048
ENV npm_config_foreground_scripts=true

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
RUN sed -i 's/\r$//' scripts/docker-entrypoint.sh && chmod +x scripts/docker-entrypoint.sh

# Gagal cepat kalau modul native tidak bisa diload (bukan error runtime di deploy)
RUN node --input-type=module -e "const check=async(n,m)=>{try{await m();console.log('ok',n)}catch(e){console.error(n,e.message);process.exit(1)}}; await check('canvas',()=>import('canvas')); await check('opus',()=>import('@discordjs/opus')); await check('sodium',()=>import('sodium-native')); await check('sharp',()=>import('sharp')); console.log('native-deps-ok');"

ENV PM2_APP_NAME=luxx

EXPOSE 3920

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "index.js"]