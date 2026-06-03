const fs = require('fs');
const { exec } = require('child_process');

// Cek dan restore session
if (!fs.existsSync('./session')) {
    console.log('Session folder missing!');
    
    // Cari backup terbaru
    const backups = fs.readdirSync('.').filter(f => f.startsWith('session_backup'));
    if (backups.length > 0) {
        const latestBackup = backups.sort().reverse()[0];
        console.log(`Restoring from ${latestBackup}...`);
        fs.cpSync(latestBackup, './session', { recursive: true });
    }
}