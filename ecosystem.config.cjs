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
        },
        {
            name: 'luxx-tunnel',
            script: 'scripts/radio-tunnel-daemon.mjs',
            cwd: root,
            interpreter: 'node',
            autorestart: true,
            max_restarts: 50,
            min_uptime: '5s',
            restart_delay: 8000,
            watch: false,
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};