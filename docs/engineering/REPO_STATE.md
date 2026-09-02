# Repository state snapshot

Audit date: 2026-09-01. This is a baseline for governance migration; live GitHub state and the current commit are authoritative.

- Repository: `E4B-labs/multibot-mobile`
- Remote: `https://github.com/E4B-labs/multibot-mobile`
- Default branch: `main`
- Observed branches during audit: `main` and `feature/plugins-and-bot-routines`; branch lists may change after this snapshot.
- Package manager: npm with root `package-lock.json` and a separate `webui/package-lock.json`.
- CI: `.github/workflows/ci.yml` retains a three-OS matrix and now validates the root package plus the nested WebView package and generated bundle.
- Native delivery: Expo/EAS configuration is present; the production update channel is configured in `eas.json`.
- Protection at audit time: no GitHub main branch protection or ruleset was detected.
- Reviewer integration at audit time: no working `multibot/review` or `multibot/merge-gate` check was detected, so the governance setup documents them without making them required.

Unknown or time-sensitive facts must be checked with Git, GitHub, EAS, and CI rather than inferred from this snapshot.
