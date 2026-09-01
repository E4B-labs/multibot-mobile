# Development workflow

The source of truth is GitHub, not a shared local directory. Local clone paths, operating systems, and disks may differ.

## Lifecycle

`task → current origin/main → task branch → isolated worktree when needed → inspect → implement → generated-bundle review → validation → push → pull request → CI → independent review → merge`

Before starting, fetch `origin`, inspect `git status`, confirm the task branch, and check active PRs for file or API collisions. Before a PR, reconcile with current `origin/main` according to the branch policy and rerun validation.

Do not push or normally commit on `main`. If an urgent recovery requires bypassing protection, record the reason and restore the normal PR path immediately afterward.

## Mobile validation

Install the native-shell dependencies with `npm ci`. Run `npm run typecheck` and `npm test`. Install WebView dependencies separately with `npm ci --prefix webui`, then run `npm --prefix webui run typecheck`, `npm run test:webui`, and `npm run webui` when the WebView or generated bundle is affected. Confirm `src/webui-html.ts` has no unexpected drift.

## EAS boundary

Use an EAS update only for JavaScript/WebView changes compatible with the installed native runtime. Native, permission, SDK, configuration, or runtime-contract changes need a native EAS build and explicit device testing. Record the channel, runtime assumptions, and rollback path in the PR.

## Multi-machine and multi-agent work

GitHub synchronizes independent computers. On one computer, independent write-capable agents must use different branches and worktrees. One task has one write-owner. A reviewer or research agent may inspect and propose changes but must not mutate the owner's worktree.
