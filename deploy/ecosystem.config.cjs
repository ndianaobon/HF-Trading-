// PM2 process file for the production server (see DEPLOY.md).
// One instance only: the background jobs (order matching, copy trading, the
// automated trading bot) run inside the app process and must not run twice.
module.exports = {
  apps: [
    {
      name: "harborfinance",
      cwd: __dirname + "/..",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "1500M",
      env: { NODE_ENV: "production" },
      out_file: "/var/log/harborfinance/out.log",
      error_file: "/var/log/harborfinance/error.log",
      time: true,
    },
  ],
};
