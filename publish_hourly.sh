#!/usr/bin/env bash
set -euo pipefail

DASH_DIR="/Users/patricklinden/Desktop/railcall-continuous-improvements"
SCORECARD="$DASH_DIR/qa_gate_scorecard.json"
GATE_RUNNER="/Users/patricklinden/mozart-delegated-lane/linden/tests/qa-gate/run-qa-gate.mjs"

# 1. Refresh $0.00 local GPU swarm telemetry
python3 "$DASH_DIR/mozart_local_swarm.py" >/dev/null || true

# 2. Enforce Fail-Closed Mozart QA Gatekeeper Suite (zero unverified pushes allowed)
GATE_OK=0
if [ -f "$GATE_RUNNER" ]; then
  if node "$GATE_RUNNER" --out "$SCORECARD"; then
    GATE_OK=1
  fi
else
  echo "[QA-GATE] HARD BLOCK: $GATE_RUNNER not yet present; skipping code push until QA Gatekeeper passes." >&2
fi

# 3. Push isolated `delegated/continuous-improvements` branches ONLY when QA Gate passed on exact HEAD SHA
if [ "$GATE_OK" -eq 1 ] && [ -f "$SCORECARD" ]; then
  for repo in /Users/patricklinden/mozart-delegated-lane/linden \
              /Users/patricklinden/mozart-delegated-lane/railcall-chat \
              /Users/patricklinden/mozart-delegated-lane/railcall-website; do
    name="$(basename "$repo")"
    branch="$(git -C "$repo" branch --show-current)"
    head_sha="$(git -C "$repo" rev-parse HEAD)"
    verified_sha="$(python3 -c "import json; d=json.load(open('$SCORECARD')); print(d.get('verified_commits',{}).get('$name','') if d.get('gate_passed') else '')" 2>/dev/null || true)"
    if [ "$branch" = "delegated/continuous-improvements" ] && [ -n "$verified_sha" ] && [ "$head_sha" = "$verified_sha" ]; then
      git -C "$repo" push origin delegated/continuous-improvements
    else
      echo "[QA-GATE] BLOCKED push for $name (branch=$branch head=$head_sha verified=$verified_sha)" >&2
    fi
  done
else
  echo "[QA-GATE] Zero code commits pushed to delegated/continuous-improvements (awaiting green QA Gatekeeper scorecard)." >&2
fi

# 4. Commit & push the live shared dashboard + QA scorecard to GitHub Pages (https://patl4588.github.io/project-mozart/)
cd "$DASH_DIR"
git add index.html README.md local_swarm_telemetry.json mozart_local_swarm.py publish_hourly.sh
[ -f "$SCORECARD" ] && git add "$SCORECARD"
if ! git diff --cached --quiet; then
  git commit -m "chore(mozart-hourly): QA gate $( [ "$GATE_OK" -eq 1 ] && echo PASS || echo STANDBY ) & telemetry ($(date -u +'%Y-%m-%d %H:%M UTC'))"
  git push origin main
fi
