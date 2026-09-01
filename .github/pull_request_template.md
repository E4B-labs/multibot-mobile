## What changed

<!-- Describe user-visible behavior and the reason for the change. -->

## Checks

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `node scripts/selfhost-check.mjs` (installer/runtime changes)
- [ ] Engine pytest (engine changes)

## Safety

- [ ] No secrets, `.env`, generated user data, or `dist-server/` churn
- [ ] HTTP/WS authentication and loopback engine boundary unchanged or tested
- [ ] Existing `~/.openmausbot` migration paths preserved

## Review notes

<!-- Mention migration, platform limits, screenshots, or follow-up work. -->
