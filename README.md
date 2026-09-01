# MultiBot Mobile

MultiBot Mobile is the Expo client for a self-hosted MultiBot workspace. It
connects to a MultiBot host, keeps host credentials in the device secure
store, and displays the shared MultiBot interface inside a native WebView.

The mobile app does not contain a server. A host must be running locally or
on infrastructure chosen by the operator.

## Features

- Connect to one or more MultiBot hosts
- Native onboarding and host management
- Secure local storage for host credentials
- Camera-based pairing when enabled by the host
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

## Security

The app stores host credentials locally and sends them only to the configured
host. Do not use unknown hosts or paste credentials into issue reports. Read
[`SECURITY.md`](SECURITY.md) before exposing a host outside a trusted network.

## Related projects

- [MultiBot Desktop and server](https://github.com/E4B-labs/multibot-desktop)
- [MultiBot Desktop Releases](https://github.com/E4B-labs/multibot-desktop-releases)

## License

MIT. See [`LICENSE`](LICENSE).
