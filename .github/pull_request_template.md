## Summary

<!-- Describe user-visible behavior and why the change is needed. -->

## Affected modules

<!-- List native shell, WebView, scripts, configuration, APIs, or runtime boundaries touched. -->

## Risk

- Risk level: low / medium / high
- User-visible behavior:
- Rollback or recovery/update notes:

## Validation

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm ci --prefix webui`
- [ ] `npm --prefix webui run typecheck`
- [ ] `npm run test:webui`
- [ ] `npm run webui` and generated bundle reviewed, when WebView changes
- [ ] Native EAS build and device testing, when native/runtime changes

## Impact review

- Migration or database impact: none / describe
- API, bridge, or host protocol impact: none / describe
- Authentication/security impact: none / describe
- Native runtime, permissions, SDK, or EAS impact: none / describe
- Lockfile or generated-artifact changes: none / describe

## Screenshots or device evidence

<!-- Required for UI changes; otherwise write “Not applicable”. -->

## Known limitations and review notes

<!-- Mention platform limits, follow-up work, or “None”. -->
