// multibot: zdjęcie profilowe — parser odpowiedzi POST/DELETE /api/profile/avatar.
//
// Serwer (wspólny z desktopem) odpowiada wrapperem `{user:{id,username,
// displayName,role,email,avatar}}` — NIE profilem. Czysta funkcja mieszka tu,
// a nie w Sidebarze, żeby dało się ją testować jednostkowo (vitest bez jsdom).

export interface StoreProfile {
  name: string;
  email: string;
  avatar?: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const avatarOf = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Mapuje body odpowiedzi avatarowej na profil dla store'u.
 *
 * Obsługiwane kształty: `{user:{displayName,email,avatar}}` (właściwy kontrakt),
 * `{profile:{name,email,avatar}}` oraz goły profil `{name,email,avatar}`.
 * Nierozpoznane body zwraca `null` — wtedy wołający nie dotyka configu
 * (świeży profil i tak przyjdzie z GET /api/config).
 */
export function profileFromAvatarResponse(body: unknown): StoreProfile | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  const user = record.user;
  if (user && typeof user === "object") {
    const u = user as Record<string, unknown>;
    return { name: str(u.displayName), email: str(u.email), avatar: avatarOf(u.avatar) };
  }

  const profile = record.profile;
  if (profile && typeof profile === "object") {
    const p = profile as Record<string, unknown>;
    return { name: str(p.name), email: str(p.email), avatar: avatarOf(p.avatar) };
  }

  if ("name" in record || "email" in record || "avatar" in record) {
    return { name: str(record.name), email: str(record.email), avatar: avatarOf(record.avatar) };
  }

  return null;
}
