# Operation Mozart — 6-Hour Infrastructure, QA Gatekeeper & Test Hub (Patrick & Sami)

Live shared dashboard & QA scorecard (updated every 6 hours at `0 */6 * * *` — `00:00`, `06:00`, `12:00`, `18:00`):
- **Live Test Hub & QA Scorecard:** https://patl4588.github.io/project-mozart/
- **Marketplace Backend Test Branch (`patl4588/railcall-marketplace`):** https://github.com/patl4588/railcall-marketplace/tree/delegated/continuous-improvements
- **Website Test Branch (`patl4588/railcall-website`):** https://github.com/patl4588/railcall-website/tree/delegated/continuous-improvements
- **Desktop Test Branch (`SamyBchaalia/railcall-chat`):** https://github.com/SamyBchaalia/railcall-chat/tree/delegated/continuous-improvements
- **Monorepo Worker Branch (`patl4588/linden`):** https://github.com/patl4588/linden/tree/delegated/continuous-improvements

## Ironclad Governance (Sami Owns `main` & Production)
1. **Isolated Test Branch Only (`delegated/continuous-improvements`):** Mozart **never** pushes to `main` and **never** touches Render or the live VPS droplet.
2. **Sync First (`origin/main` -> `delegated/continuous-improvements`):** Before each 6-hour wave, Mozart fetches and rebases onto Sami's latest `origin/main` so diffs stay conflict-free.
3. **Fail-Closed 5-Squad QA Gate (`qa-gate/run-qa-gate.mjs`):** Zero commits are pushed to `delegated/continuous-improvements` unless all 5 real-world QA suites pass on the exact `HEAD` commit SHAs (`qa_gate_scorecard.json`).
