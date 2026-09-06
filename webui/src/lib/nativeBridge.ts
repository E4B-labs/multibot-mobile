export type NativePhotoPurpose = "attachment" | "avatar";

export type NativePhoto = {
  requestId: string;
  purpose: NativePhotoPurpose;
  dataUrl: string;
  fileName: string;
};

// Camera and clipboard, the two message types only the phone has. Everything
// they send goes out through `shellPost` in `@/lib/shell` — there is no second
// bridge helper here on purpose: the shell drops any privileged message
// arriving without `window.__MB_BRIDGE_NONCE__` (src/screens/WebViewScreen.tsx,
// `PRIVILEGED`), and a local `postMessage` would silently lose `app.update.*`.
import { shellPost } from "@/lib/shell";

export function requestNativeCamera(requestId: string, purpose: NativePhotoPurpose): boolean {
  return shellPost({ type: "native.camera.request", requestId, purpose });
}

export function requestNativeClipboardImage(requestId: string): boolean {
  return shellPost({ type: "native.clipboard.image", requestId, purpose: "attachment" });
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
