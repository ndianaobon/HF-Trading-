#!/usr/bin/env bash
# Deploys the latest code on the server: run from the app folder as the app user.
#   cd /var/www/harborfinance && ./deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ Pulling latest code"
git pull --ff-only

echo "→ Installing dependencies"
npm ci

echo "→ Applying database migrations"
npx prisma migrate deploy

echo "→ Building"
npm run build

echo "→ Restarting"
pm2 reload deploy/ecosystem.config.cjs --update-env
pm2 save

echo "✓ Deployed $(git rev-parse --short HEAD)"
