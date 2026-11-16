#!/usr/bin/env bash
set -euo pipefail

# 1. Refresh $0.00 local GPU swarm telemetry
python3 /Users/patricklinden/Desktop/railcall-continuous-improvements/mozart_local_swarm.py >/dev/null

# 2. Push isolated `delegated/continuous-improvements` branches ONLY (never `main`) so Sami can inspect diffs
for repo in /Users/patricklinden/mozart-delegated-lane/linden /Users/patricklinden/mozart-delegated-lane/railcall-chat /Users/patricklinden/mozart-delegated-lane/railcall-website; do
  branch="$(git -C "$repo" branch --show-current)"
  if [ "$branch" = "delegated/continuous-improvements" ]; then
    git -C "$repo" push origin delegated/continuous-improvements
  fi
done

# 3. Commit & push the live shared dashboard to GitHub + GitHub Pages (https://patl4588.github.io/project-mozart/)
cd /Users/patricklinden/Desktop/railcall-continuous-improvements
git add index.html README.md local_swarm_telemetry.json mozart_local_swarm.py publish_hourly.sh
if ! git diff --cached --quiet; then
  git commit -m "chore(mozart-hourly): auto-upload hourly telemetry & staged commits ($(date -u +'%Y-%m-%d %H:%M UTC'))"
  git push origin main
fi
