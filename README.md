# Operation Mozart v2 — Isolated Autonomous Engineering, $0 Qwen/Ollama Sub-Agent Swarm & QA Hub

Live shared dashboard, architecture & QA scorecard:
- **Live Command Hub, Telemetry & Inline Commit Diffs:** https://patl4588.github.io/project-mozart/
- **Isolated Marketplace Fork (`patl4588/mozart-railcall-marketplace` · branch `mozart/v2-autonomous`):** https://github.com/patl4588/mozart-railcall-marketplace/tree/mozart/v2-autonomous
- **Isolated Website Fork (`patl4588/mozart-railcall-website` · branch `mozart/v2-autonomous`):** https://github.com/patl4588/mozart-railcall-website/tree/mozart/v2-autonomous
- **Isolated Desktop Fork (`patl4588/mozart-railcall-chat` · branch `mozart/v2-autonomous`):** https://github.com/patl4588/mozart-railcall-chat/tree/mozart/v2-autonomous
- **Isolated Monorepo Fork (`patl4588/mozart-linden` · branch `mozart/v2-autonomous`):** https://github.com/patl4588/mozart-linden/tree/mozart/v2-autonomous

## Ironclad Fork Isolation & Governance
1. **Zero Pollution of Original Repos:** All 4 repositories push **exclusively** to `patl4588/mozart-*` on branch `mozart/v2-autonomous`. Every checkout locks `upstream` with `git remote set-url --push upstream DISABLED` so Sami's production repos (`patl4588/linden`, `patl4588/railcall-marketplace`, `patl4588/railcall-website`, `SamyBchaalia/railcall-chat`) are never written to.
2. **Read-Only Upstream Rebase (`upstream/main` -> `mozart/v2-autonomous`):** Before each autonomous wave, Mozart fetches `upstream/main` and rebases cleanly so Sami can cherry-pick or fast-forward merge verified upgrades anytime.
3. **$0.00 RailCall + Qwen/Ollama 5-Tier Local Sub-Agent Fleet (`mozart_local_swarm.py`):** Offloads routing triage (`railcall-router` 0.8B), lint/selector sweeps (`railcall-fast` 4B), security fuzzing (`gpt-oss:20b`), feature/test scaffolding (`railcall-core` Qwen3-Coder 30.5B), and deep 262K-context audits (`railcall-coder` Qwen3-Coder-Next 79.7B) to local Apple Silicon GPU at `$0.00`.
4. **Fail-Closed 5-Squad QA Gate (`qa-gate/run-qa-gate.mjs`):** Zero commits are pushed to `mozart/v2-autonomous` unless all 5 adversarial QA suites pass on exact `HEAD` commit SHAs (`qa_gate_scorecard.json`).
