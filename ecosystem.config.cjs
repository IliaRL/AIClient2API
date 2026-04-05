module.exports = {
  apps: [
    {
      name: 'aiclient-2-api',
      script: './src/core/master.js',
      cwd: '/root/.openclaw/workspace/projects/AIClient-2-API',
      interpreter: '/usr/bin/node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      merge_logs: true
    }
  ]
}
