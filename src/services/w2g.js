import fs from 'fs';
import axios from 'axios';
import { W2G_API_KEY, W2G_ROOM_FILE } from '../config.js';

function loadRoomData() {
    try {
        if (fs.existsSync(W2G_ROOM_FILE)) {
            return JSON.parse(fs.readFileSync(W2G_ROOM_FILE, 'utf8'));
        }
    } catch (e) { /* silent */ }
    return null;
}

function saveRoomData(data) {
    try {
        fs.writeFileSync(W2G_ROOM_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Gagal simpan room data:', e.message);
    }
}

export async function createW2GRoom() {
    const res = await axios.post('https://api.w2g.tv/rooms/create.json', {
        w2g_api_key: W2G_API_KEY,
        share: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        bg_color: '#00ff00',
        bg_opacity: '50'
    });
    const streamKey = res.data.streamkey;
    const roomUrl = `https://w2g.tv/rooms/${streamKey}`;
    const roomData = { streamkey: streamKey, url: roomUrl, created_at: new Date().toISOString() };
    saveRoomData(roomData);
    return roomData;
}

export async function getOrCreateRoom() {
    const existing = loadRoomData();
    if (existing && existing.streamkey) return existing;
    return await createW2GRoom();
}

export async function addVideoToRoom(streamkey, youtubeUrl, title = '') {
    try {
        const response = await axios.post(
            `https://api.w2g.tv/rooms/${streamkey}/playlists/current/mediaitems`,
            {
                w2g_api_key: W2G_API_KEY,
                add_items: [{ url: youtubeUrl, title }]
            },
            { headers: { 'Content-Type': 'application/json' } }
        );
        console.log(`✅ Video berhasil masuk W2G playlist: ${title}`);
        return response.data;
    } catch (e) {
        console.error('❌ W2G API Error:', e.response?.status, e.response?.data || e.message);
        throw e;
    }
}