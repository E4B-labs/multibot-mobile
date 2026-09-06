export type NativePhotoPurpose = "attachment" | "avatar";

export type NativePhoto = {
  requestId: string;
  purpose: NativePhotoPurpose;
  dataUrl: string;
  fileName: string;
};

// Camera and clipboard sit on top of the ONE bridge in `@/lib/shell`. There is
// deliberately no second `postMessage` here: the shell drops every privileged
// message that arrives without `window.__MB_BRIDGE_NONCE__`, and a helper that
// posted on its own would silently lose `app.update.*` (src/screens/
// WebViewScreen.tsx, `PRIVILEGED`).
import { isReactNativeShell, shellPost } from "@/lib/shell";

export function hasNativeWebView(): boolean {
  return isReactNativeShell();
}

export const postNativeMessage = shellPost;

export function requestNativeCamera(requestId: string, purpose: NativePhotoPurpose): boolean {
  return postNativeMessage({ type: "native.camera.request", requestId, purpose });
}

export function requestNativeClipboardImage(requestId: string): boolean {
  return postNativeMessage({ type: "native.clipboard.image", requestId, purpose: "attachment" });
}

export function onNativePhoto(listener: (photo: NativePhoto) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<NativePhoto>).detail;
    if (!detail || typeof detail.requestId !== "string" || typeof detail.dataUrl !== "string") return;
    if (detail.purpose !== "attachment" && detail.purpose !== "avatar") return;
    listener(detail);
  };
  window.addEventListener("mb:native-photo", handler);
  return () => window.removeEventListener("mb:native-photo", handler);
}

export function nativeDataUrlToFile(dataUrl: string, fileName: string): File | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], fileName, { type: match[1] });
  } catch {
    return null;
  }
}
