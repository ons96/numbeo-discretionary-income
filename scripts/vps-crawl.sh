#!/usr/bin/env bash
# Runs on a machine with a residential IP (a VPS only if it is not on a
# datacenter range - numbeo blocks those). Crawls a slice, commits, pushes.
# GitHub Pages rebuilds itself from the push.
#
#   GITHUB_TOKEN=ghp_xxx ./scripts/vps-crawl.sh 400
#
# Put it in cron for a slow, steady refresh:
#   17 4 * * * cd /srv/numbeo && GITHUB_TOKEN=xxx ./scripts/vps-crawl.sh 400 >> crawl.log 2>&1

set -euo pipefail

BUDGET="${1:-400}"
REPO_URL="${REPO_URL:-https://github.com/ons96/numbeo-discretionary-income.git}"
WORKDIR="${WORKDIR:-/srv/numbeo}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-30}"

cd "$WORKDIR"
git pull --rebase --autostash -q

status=$(node scraper/probe.mjs | grep -c "^200" || true)
if [ "$status" -eq 0 ]; then
  echo "numbeo is not reachable from this IP - aborting"
  node scraper/probe.mjs
  exit 1
fi

node scraper/crawl-lists.mjs || true   # no-op cost is 235 requests; comment out if you run it monthly
node scraper/crawl-cities.mjs --budget="$BUDGET" --max-age-days="$MAX_AGE_DAYS"
node scraper/merge.mjs

git add data/
if git diff --quiet --cached; then
  echo "nothing new"
  exit 0
fi

git -c user.name="numbeo-crawler" -c user.email="crawler@localhost" commit -q -m "data: crawl $(date -u +%Y-%m-%d)"
git push -q "https://x-access-token:${GITHUB_TOKEN}@github.com/ons96/numbeo-discretionary-income.git" HEAD:main
echo "pushed $(node -e "console.log(require('./data/cities.json').count)") cities"
