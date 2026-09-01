# Code ownership and collision prevention

Ownership is assigned per active task, not by permanent developer branch. The task owner may be Kacper, Bartek, Mieszko, or an explicitly assigned coding agent acting for one of them.

## Practical boundaries

- Native shell, screens, host/pairing flows, and bridges: `App.tsx` and `src/`.
- WebView source: `webui/`.
- Generated WebView artifact: `src/webui-html.ts`, owned by the bundling script output.
- Sync and build automation: `scripts/`.
- Expo/EAS configuration and repository automation: `app.json`, `eas.json`, and `.github/`.

These are review boundaries, not permission to bypass the task owner or the PR process. A change crossing boundaries must call out the coupling and validation.

Before substantial work, inspect active branches and PRs for overlapping files, shared types, bridge contracts, host protocols, and runtime changes. If two tasks collide, coordinate one owner for the shared files or split the work into ordered PRs. Never have independent write-capable agents edit the same worktree concurrently.
