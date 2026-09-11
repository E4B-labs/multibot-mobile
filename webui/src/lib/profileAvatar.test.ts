import { describe, expect, it } from "vitest";
import { profileFromAvatarResponse } from "./profileAvatar";

// multibot: POST/DELETE /api/profile/avatar odpowiada wrapperem
// {user:{id,username,displayName,role,email,avatar}} — regresja: parser brał
// `record.profile ?? record` i wpisywał CAŁY wrapper jako config.profile.
describe("profileFromAvatarResponse", () => {
  it("rozpakowuje wrapper {user} i mapuje displayName→name", () => {
    expect(
      profileFromAvatarResponse({
        user: {
          id: "u1",
          username: "romek",
          displayName: "Romek K",
          role: "admin",
          email: "romek@example.com",
          avatar: "data:image/webp;base64,xyz",
        },
      }),
    ).toEqual({ name: "Romek K", email: "romek@example.com", avatar: "data:image/webp;base64,xyz" });
  });

  it("po DELETE avatar w {user} bywa null/pusty — wychodzi null", () => {
    expect(profileFromAvatarResponse({ user: { displayName: "R", email: "r@e", avatar: null } })).toEqual({
      name: "R",
      email: "r@e",
      avatar: null,
    });
    expect(profileFromAvatarResponse({ user: { displayName: "R", email: "r@e", avatar: "" } })?.avatar).toBeNull();
  });

  it("brakujące pola w {user} nie dają undefined w store", () => {
    expect(profileFromAvatarResponse({ user: {} })).toEqual({ name: "", email: "", avatar: null });
  });

  it("obsługuje też {profile} i goły profil", () => {
    expect(profileFromAvatarResponse({ profile: { name: "A", email: "a@e", avatar: "x" } })).toEqual({
      name: "A",
      email: "a@e",
      avatar: "x",
    });
    expect(profileFromAvatarResponse({ name: "B", email: "b@e" })).toEqual({ name: "B", email: "b@e", avatar: null });
  });

  it("nierozpoznane body zwraca null — wołający nie dotyka configu", () => {
    expect(profileFromAvatarResponse(null)).toBeNull();
    expect(profileFromAvatarResponse("ok")).toBeNull();
    expect(profileFromAvatarResponse({ status: "ok" })).toBeNull();
  });
});
