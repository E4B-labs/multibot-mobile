# MultiBot Mobile

MultiBot Mobile is the Expo client for a self-hosted MultiBot workspace. It
connects to a MultiBot host, keeps host credentials in the device secure
store, and displays the shared MultiBot interface inside a native WebView.

The mobile app does not contain a server. A host must be running locally or
on infrastructure chosen by the operator.

## Features

- First run offers two choices: set up a server on this phone, or sign in to one
- Native sign-in with the server's address, name and password
- Trust-on-first-use pinning for the server's self-signed certificate
- Native notifications and foreground registration
- OTA JavaScript updates through Expo Updates
- In-app discovery of signed native Android installers
- Full MultiBot interface: bots, sections, chat history, team rooms, tools,
  routines, model picker, settings, and agent collaboration

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | Native Expo shell, host management, updates, and notifications |
| `webui/` | Mobile build of the React MultiBot interface |
| `src/webui-html.ts` | Generated WebView bundle |
| `scripts/bundle-webui.mjs` | Packages `webui/` into the native shell |

The generated WebView bundle is rebuilt from `webui/`; do not edit it by hand.

## Development

Requirements: Node.js 20+, npm, and an Expo-compatible Android or iOS setup.

```sh
npm install
npm start
```

After changing `webui/`:

```sh
npm run webui
npm run typecheck
npm --prefix webui run typecheck
```

## Builds and updates

JavaScript-only changes can use an Expo OTA update after committing the
source. Changes to native modules, permissions, SDK, or the update mechanism
require a new native build and an increased runtime version.

```sh
npx eas-cli@latest update --branch production -m "describe change"
npx eas-cli@latest build --platform android --profile production
```

Configure your own Expo/EAS project for new public distributions. Keep
deployment identifiers and signing credentials outside source control. Never
commit `google-services.json`, signing keys, push credentials, or tokens.

## First run and TLS

MultiBot servers listen on HTTPS only, with a certificate they generate
themselves, so nothing about them is verifiable through a public certificate
authority. The app therefore trusts a server the way SSH trusts a host: on the
first sign-in it opens a bare TLS handshake (no HTTP request), records the
SHA-256 of the certificate it is offered, and from then on accepts only that
exact certificate — a changed one stops the sign-in with "certificate changed"
until the user explicitly trusts the new one. The store lives natively
(`modules/multibot-tls`) and is read by the WebView and by React Native's own
`fetch` through the prebuild patches in `plugins/with-tls-pinning.js`, because
neither offers a hook for this; a native build is required, an OTA update is
not enough. Signing in also happens natively — React Native has no CORS, so the
shell can reach a server it is not loaded from: it trades the server name and
password for a single-use join grant and hands the grant to the web UI in the
`#join=` fragment. The server password is never stored. On Android the other
card, "Set up a server", installs Termux, copies the one-line installer to the
clipboard, opens Termux and then watches `127.0.0.1:8799` until the server
answers; iOS shows sign-in only.

## WebView bridge

The web UI runs inside the WebView and talks to the shell with
`postMessage`; replies come back as a `message` event, the same shape a
browser would deliver, so one page serves the Electron, browser and phone
shells.

| Page sends | Shell does | Shell replies |
| --- | --- | --- |
| `{type:"host.join", url, serverName, serverPassword}` | Resolves the address, pins the certificate, trades the credentials for a join grant, swaps hosts and reloads from the new origin | nothing on success (the page is gone); `{type:"host.join.result", ok:false, error, message}` on failure |
| `{type:"tls.forget", url}` | Drops the pinned fingerprint so the next sign-in trusts the certificate on offer | none |
| `{type:"push.request"}` | Asks the OS for notification permission and mints an Expo push token | `{type:"push.token", token, platform, deviceName}` — `token` is `null` when the user declined or the token could not be minted |

The shell no longer registers the push token itself: since 0.4.0 it holds no
host credential, so the page calls `POST /api/devices/:id/push` with its own
session.

## Security

The app stores the host address locally and sends the server password only to
the host being signed in to, once. Do not use unknown hosts or paste credentials into issue reports. Read
[`SECURITY.md`](SECURITY.md) before exposing a host outside a trusted network.

## Related projects

- [MultiBot Desktop and server](https://github.com/E4B-labs/multibot-desktop)
- [MultiBot Desktop Releases](https://github.com/E4B-labs/multibot-desktop-releases)

## Contributors

- [SlafyGH](https://github.com/SlafyGH)

## License

MIT. See [`LICENSE`](LICENSE).
