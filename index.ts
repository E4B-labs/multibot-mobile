// Standard Expo entry (registerRootComponent works for Expo Go, native dev
// builds, and web) — used instead of pointing package.json#main at
// "expo/AppEntry.js" directly, since that internal path has moved between
// SDK versions before.
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
