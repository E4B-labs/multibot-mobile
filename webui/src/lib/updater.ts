// Shared hook over the preload's updater bridge. Returns null in the
// browser / when the bridge is absent (dev) — callers render nothing then.
// onState emits the current state immediately on subscribe, so a component
// mounted after the download finished still sees "downloaded".
import { useEffect, useState } from "react";
import type { UpdaterState } from "@/types/ogb";
import { postNativeMessage } from "@/lib/nativeBridge";

export type { UpdaterState };

export type UpdaterBridge = {
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  onState(cb: (s: UpdaterState) => void): () => void;
};

function nativeUpdater(): UpdaterBridge | null {
  if (!window.ReactNativeWebView) return null;
  return {
    check: async () => { postNativeMessage({ type: "app.update.check" }); },
    download: async () => { postNativeMessage({ type: "app.update.download" }); },
    install: async () => { postNativeMessage({ type: "app.update.install" }); },
    onState: (cb) => {
      const handler = (event: Event) => {
        const state = (event as CustomEvent<UpdaterState>).detail;
        if (state && typeof state.status === "string") cb(state);
      };
      window.addEventListener("mb:app-update-state", handler);
      cb({ status: "idle" });
      return () => window.removeEventListener("mb:app-update-state", handler);
    },
  };
}

export function getUpdater(): UpdaterBridge | null {
  return window.ogb?.updater ?? nativeUpdater();
}

export function useUpdaterState(): UpdaterState | null {
  const [state, setState] = useState<UpdaterState | null>(null);
  useEffect(() => getUpdater()?.onState(setState), []);
  return getUpdater() ? state : null;
}
