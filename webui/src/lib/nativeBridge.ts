export type NativePhotoPurpose = "attachment" | "avatar";

export type NativePhoto = {
  requestId: string;
  purpose: NativePhotoPurpose;
  dataUrl: string;
  fileName: string;
};

type ReactNativeWebView = { postMessage(message: string): void };

function reactNativeWebView(): ReactNativeWebView | null {
  const bridge = (window as unknown as { ReactNativeWebView?: ReactNativeWebView }).ReactNativeWebView;
  return bridge && typeof bridge.postMessage === "function" ? bridge : null;
}

export function hasNativeWebView(): boolean {
  return reactNativeWebView() !== null;
}

export function postNativeMessage(message: Record<string, unknown>): boolean {
  const bridge = reactNativeWebView();
  if (!bridge) return false;
  bridge.postMessage(JSON.stringify(message));
  return true;
}

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
