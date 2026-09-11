/** Foreground safeguard. Background pushes must also be filtered by the host:
 * Android/iOS display those without running the application's JS handler. */
export function shouldPresentNotification(
  data: Record<string, unknown> | undefined,
  visibleBotId: string | null,
  remote: boolean,
): boolean {
  // Local diagnostics (for example missing push setup) are not bot activity.
  if (!remote) return true;
  if (data?.kind !== "notify" && data?.kind !== "reminder") return false;
  // A user-requested alarm is meaningful even when its bot is on screen.
  if (data.kind === "reminder") return true;
  return typeof data.botId !== "string" || data.botId !== visibleBotId;
}
