const path = require('path');

const root = __dirname;

module.exports = {
    apps: [
        {
            name: 'luxx',
            script: 'index.js',
            cwd: root,
            interpreter: 'node',
            autorestart: true,
            max_restarts: 100,
            min_uptime: '10s',
            restart_delay: 4000,
            watch: false,
            exp_backoff_restart_delay: 2000,
            env: {
                NODE_ENV: 'production',
                PM2_APP_NAME: 'luxx'
            }
        }
    ]
};