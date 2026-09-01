# Mobile architecture

This document records the current boundaries. Changes should fit these boundaries or explain why a boundary must move.

## Application layers

- `App.tsx` and `src/` contain the Expo native shell, screens, host/pairing flows, native bridges, and mobile-owned behavior.
- `webui/` is the WebView UI source with its own package manifest and lockfile. It is not an independent desktop application.
- `scripts/bundle-webui.mjs` builds the WebView source into the generated `src/webui-html.ts`; `scripts/sync-webui.mjs` synchronizes selected shared UI while preserving mobile-owned files.
- `src/webui-html.ts` is generated output. Rebuild it with the repository script and review drift; do not hand-edit it.
- `app.json`, `eas.json`, and Expo configuration define native identity, runtime, update channel, permissions, and build behavior.
- `.github/` contains CI and repository automation.

## WebView and mobile ownership boundary

The WebView bundle can share behavior with desktop, but mobile layout, touch targets, navigation, keyboard behavior, safe areas, and native integrations must remain mobile-appropriate. A sync from another client is never a reason to overwrite mobile-owned files blindly. Before and after `scripts/sync-webui.mjs`, inspect the three-way diff and preserve deliberate mobile changes.

## Native, update, and security boundaries

Native code, permissions, SDK versions, config plugins, app configuration, and anything that changes the runtime contract require a native EAS build and device/runtime review. JavaScript and WebView-only changes can use an EAS update only after the committed bundle and compatibility have been validated.

Host credentials, pairing data, authentication tokens, deep links, WebView-to-native messages, and remote host connections are trust boundaries. Keep secrets out of logs and generated artifacts, validate bridge inputs, and preserve the existing authentication and host lifecycle behavior.
