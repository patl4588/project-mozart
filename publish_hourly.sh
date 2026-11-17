#!/usr/bin/env bash
set -euo pipefail

DASH_DIR="/Users/patricklinden/Desktop/railcall-continuous-improvements"
SCORECARD="$DASH_DIR/qa_gate_scorecard.json"
GATE_RUNNER="$DASH_DIR/qa-gate/run-qa-gate.mjs"

# 1. Refresh $0.00 local GPU swarm telemetry (bounded 15s cap so QA gate never stalls if Ollama sleeps)
perl -e 'alarm 15; exec @ARGV' python3 "$DASH_DIR/mozart_local_swarm.py" >/dev/null 2>&1 || true

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
      git -C "$repo" push --force-with-lease -u origin delegated/continuous-improvements
    else
      echo "[QA-GATE] BLOCKED push for $name (branch=$branch head=$head_sha verified=$verified_sha)" >&2
    fi
  done
else
  echo "[QA-GATE] Zero code commits pushed to delegated/continuous-improvements (awaiting green QA Gatekeeper scorecard)." >&2
fi

# 4. Commit & push the live shared test link + QA scorecard + website screenshots to GitHub Pages (https://patl4588.github.io/project-mozart/)
cd "$DASH_DIR"
git add -A
if ! git diff --cached --quiet; then
  git commit -m "chore(mozart-qa-gate): QA gate $( [ "$GATE_OK" -eq 1 ] && echo PASS || echo BLOCKED ) & live proof ($(date -u +'%Y-%m-%d %H:%M UTC'))"
  git push origin main
fi
