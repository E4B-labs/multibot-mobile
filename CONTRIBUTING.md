# Contributing to MultiBot Mobile

## Development

```sh
npm install
npm run typecheck
npm --prefix webui run typecheck
npm run webui
```

Keep pull requests focused. Add tests for non-trivial native or WebView
behavior. Do not commit host addresses, account data, credentials, signing
files, push configuration, or generated local build output.

Native changes include permissions, Expo modules, update handling, and
notification registration. They need a new native build and a runtime-version
review. WebView-only changes need the generated bundle rebuilt and checked.

## Pull request checklist

- [ ] native and WebView typechecks pass
- [ ] relevant tests pass
- [ ] generated bundle is up to date when `webui/` changed
- [ ] no secrets or private environment data are included
- [ ] update/build impact is documented
