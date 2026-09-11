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
import { getAuthToken } from "@/lib/auth";
import { shellPost, type ShellHost } from "@/lib/shell";

/** Otwarcie pliku w powłoce telefonu. W Android WebView `<a download>` i
 * `window.open` są martwe: nie ma DownloadListenera, a blob i tak nie wychodzi
 * poza dokument — klik w „Pobierz" po prostu nic nie robił. Powłoka pobiera
 * plik sama i oddaje go systemowemu podglądowi.
 *
 * `url` to ŚCIEŻKA na serwerze (`/api/bots/:id/attachments/:fileId`), nie blob
 * i nie adres bezwzględny: powłoka dokleja ją do hosta, którego pilnuje, i
 * odrzuca wszystko spoza niego (`fileOpenRequestOf` w mobile
 * `src/lib/host-logic.ts`). Nagłówki jadą stąd, bo token dostępu żyje na tej
 * stronie, a nie w powłoce.
 *
 * Zwraca `false` poza WebView — wołający zostawia wtedy zwykły `<a download>`,
 * który w przeglądarce i w Electronie działa jak działał. */
export function openFileViaShell(
  url: string,
  name: string,
  mime: string,
  // Ostatni na końcu, jak w `@/lib/shell`: to szew dla testu, nie parametr
  // dla wołających.
  host?: ShellHost,
): boolean {
  const token = getAuthToken();
  const message = {
    type: "file.open",
    url,
    name,
    mime,
    headers: {
      "x-multibot-protocol": "2",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  };
  return host ? shellPost(message, host) : shellPost(message);
}

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
