#!/usr/bin/env bash
# Rebuild the site on a VPS without downtime: build into dist-next, then swap it
# in for dist/. Run as the app user from anywhere:
#   scripts/deploy.sh          refresh the leaderboard + news snapshots (cron)
#   scripts/deploy.sh --pull   also fetch the latest code first; restart the
#                              service afterwards: systemctl restart dty
set -euo pipefail
cd "$(dirname "$0")/.."

exec 9>.deploy.lock
flock -n 9 || { echo "Deploy lain sedang berjalan; dilewati."; exit 0; }

if [[ "${1:-}" == "--pull" ]]; then
  git pull --ff-only
  npm ci --no-audit --no-fund
fi

rm -rf dist-next
OUT_DIR=dist-next npm run build
rm -rf dist-old
if [[ -d dist ]]; then mv dist dist-old; fi
mv dist-next dist
echo "Build selesai $(date '+%Y-%m-%d %H:%M:%S')"
