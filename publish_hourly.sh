#!/usr/bin/env bash
set -euo pipefail

DASH_DIR="/Users/patricklinden/Desktop/railcall-continuous-improvements"
SCORECARD="$DASH_DIR/qa_gate_scorecard.json"
COMMITS_FEED="$DASH_DIR/repo_commits_feed.json"
TELEMETRY_SUMMARY="$DASH_DIR/telemetry/product_telemetry_summary.json"
GATE_RUNNER="$DASH_DIR/qa-gate/run-qa-gate.mjs"
COMMITS_BUILDER="$DASH_DIR/qa-gate/build-repo-commits-feed.mjs"
TELEMETRY_REFRESHER="$DASH_DIR/qa-gate/refresh-product-telemetry.mjs"

export GIT_TERMINAL_PROMPT=0

# 1. Refresh $0.00 local GPU swarm telemetry (bounded 15s cap so QA gate never stalls if Ollama sleeps)
perl -e 'alarm 15; exec @ARGV' python3 "$DASH_DIR/mozart_local_swarm.py" >/dev/null 2>&1 || true

# 2. Refresh real product telemetry summary (strictly zero-PII aggregates, non-destructive merge, bounded 25s cap)
if [ -f "$TELEMETRY_REFRESHER" ]; then
  perl -e 'alarm 25; exec @ARGV' node "$TELEMETRY_REFRESHER" --out "$TELEMETRY_SUMMARY" >/dev/null 2>&1 || true
fi

# 3. Enforce Fail-Closed Mozart 5-Squad QA Gatekeeper Suite (bounded 540s outer watchdog so cron never wedges)
GATE_OK=0
if [ -f "$GATE_RUNNER" ]; then
  if perl -e 'alarm 540; exec @ARGV' node "$GATE_RUNNER" --out "$SCORECARD" --commits-out "$COMMITS_FEED"; then
    GATE_OK=1
  fi
else
  echo "[QA-GATE] HARD BLOCK: $GATE_RUNNER not yet present; skipping code push until QA Gatekeeper passes." >&2
fi

# 4. Push isolated `delegated/continuous-improvements` branches ONLY when QA Gate passed on exact HEAD SHA
#    Strictly pushes ONLY to delegated/continuous-improvements on the shared test git repos (NEVER main!)
if [ "$GATE_OK" -eq 1 ] && [ -f "$SCORECARD" ]; then
  for repo in /Users/patricklinden/mozart-delegated-lane/railcall-marketplace \
              /Users/patricklinden/mozart-delegated-lane/railcall-website \
              /Users/patricklinden/mozart-delegated-lane/railcall-chat \
              /Users/patricklinden/mozart-delegated-lane/linden; do
    [ -d "$repo/.git" ] || continue
    name="$(basename "$repo")"
    branch="$(git -C "$repo" branch --show-current)"
    head_sha="$(git -C "$repo" rev-parse HEAD)"
    verified_sha="$(python3 -c "import json; d=json.load(open('$SCORECARD')); print(d.get('verified_commits',{}).get('$name','') if d.get('gate_passed') else '')" 2>/dev/null || true)"
    if [ "$branch" = "delegated/continuous-improvements" ] && [ -n "$verified_sha" ] && [ "$head_sha" = "$verified_sha" ]; then
      perl -e 'alarm 60; exec @ARGV' git -C "$repo" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 push --force-with-lease -u origin delegated/continuous-improvements
    else
      echo "[QA-GATE] BLOCKED push for $name (branch=$branch head=$head_sha verified=$verified_sha)" >&2
    fi
  done
else
  echo "[QA-GATE] Zero code commits pushed to delegated/continuous-improvements (awaiting green QA Gatekeeper scorecard)." >&2
fi

# 5. Refresh inline 4-repo commits & diff feed (`repo_commits_feed.json`) so GitHub Pages always mirrors latest SHAs & stats
if [ -f "$COMMITS_BUILDER" ]; then
  perl -e 'alarm 20; exec @ARGV' node "$COMMITS_BUILDER" --out "$COMMITS_FEED" >/dev/null 2>&1 || true
fi

# 6. Commit & push the live Command Center + telemetry + inline commit feed + QA scorecard + website screenshots to GitHub Pages
cd "$DASH_DIR"
git add -A
if ! git diff --cached --quiet; then
  git commit -m "chore(mozart-6h-gate): QA gate $( [ "$GATE_OK" -eq 1 ] && echo PASS || echo BLOCKED ), telemetry & inline repo feed ($(date -u +'%Y-%m-%d %H:%M UTC'))"
  perl -e 'alarm 60; exec @ARGV' git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 push origin main
fi
