const GATEWAY = '/home/ken/Documents/openclaw-gateway-main';

module.exports = {
    apps: [
        {
            name: 'mission-control',
            cwd: '/home/ken/.openclaw/workspace/mission-control',
            script: 'npm',
            args: 'run dev',
            watch: false,
            env: {
                NODE_ENV: 'development',
            },
        },
        {
            name: 'openclaw-backend',
            cwd: `${GATEWAY}/backend`,
            script: 'npm',
            args: 'run dev',
            watch: false,
            env: {
                NODE_ENV: 'development',
            },
        },
        {
            name: 'openclaw-frontend',
            cwd: `${GATEWAY}/frontend`,
            script: 'npm',
            args: 'run dev',
            watch: false,
            env: {
                NODE_ENV: 'development',
            },
        },
        {
            name: 'openclaw-batch-worker',
            cwd: `${GATEWAY}/batch-worker`,
            script: 'npm',
            args: 'run dev',
            watch: false,
            env: {
                NODE_ENV: 'development',
            },
        },
    ],
};
