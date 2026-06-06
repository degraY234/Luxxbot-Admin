import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portfolioDir = path.resolve(__dirname, '../../portfolio');
const defaultPhoto = path.resolve(__dirname, '../../assets/aboutlux-creator.jpg');
const customPhoto = path.join(portfolioDir, 'img', 'profile.jpg');

function portfolioPublicUrl() {
    const port = Number(process.env.RADIO_PORT || 3920);
    const base = process.env.RADIO_PUBLIC_URL?.replace(/\/$/, '') || `http://localhost:${port}`;
    return `${base}/portfolio`;
}

function resolveProfilePhoto() {
    try {
        if (fs.existsSync(customPhoto) && fs.statSync(customPhoto).size > 512) return customPhoto;
    } catch (_) { /* ignore */ }
    if (fs.existsSync(defaultPhoto)) return defaultPhoto;
    return null;
}

function sendPortfolio(_req, res) {
    res.sendFile(path.join(portfolioDir, 'index.html'));
}

export function mountPortfolioServer(app) {
    app.get('/portfolio/img/profile.jpg', (req, res) => {
        const photo = resolveProfilePhoto();
        if (!photo) return res.status(404).end();
        res.type('image/jpeg');
        return res.sendFile(photo);
    });

    app.get('/portfolio', sendPortfolio);
    app.get('/portfolio/', sendPortfolio);
    app.use('/portfolio', express.static(portfolioDir, { index: false, redirect: false }));

    console.log(`\x1b[36m🌐 Portfolio: ${portfolioPublicUrl()}\x1b[0m`);
}