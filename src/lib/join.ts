// Pure logic for "Sign in to a server". No expo or react-native imports here on
// purpose: it runs under plain `node` in join-flow.test.ts. The native half
// (TLS probe, pinning, the actual request) lives in tls.ts.
//
// Server contract (desktop `server/identity.ts`, 0.4.0):
//   POST /api/auth/join { serverName, serverPassword }
//     200 { joinGrant, expiresAt, hasUsers, server }
//     401 { error: "wrong_server_name" | "wrong_server_password" }
//     404 { error: "server_not_set_up" }
//     429 rate limited
// The grant is single-use, expires in five minutes and is handed to the web UI
// in the `#join=` fragment, which registers or logs in with it.

export type JoinField = "address" | "serverName" | "serverPassword" | "form";

export type JoinErrorCode =
  // address
  | "invalid_address"
  | "unreachable"
  | "timeout"
  | "not_multibot"
  | "server_not_set_up"
  | "certificate_changed"
  // credentials
  | "wrong_server_name"
  | "wrong_server_password"
  // whole form
  | "rate_limited"
  | "failed";

const FIELDS: Record<JoinErrorCode, JoinField> = {
  invalid_address: "address",
  unreachable: "address",
  timeout: "address",
  not_multibot: "address",
  server_not_set_up: "address",
  certificate_changed: "address",
  wrong_server_name: "serverName",
  wrong_server_password: "serverPassword",
  rate_limited: "form",
  failed: "form",
};

const MESSAGES: Record<JoinErrorCode, string> = {
  invalid_address: "Enter a valid address, for example 192.168.1.42:8799.",
  unreachable: "No answer from this address. Check the address and that the phone is on the same network.",
  timeout: "This address did not answer in time.",
  not_multibot: "Something answers here, but it is not a MultiBot server.",
  server_not_set_up: "That server has not been set up yet. Run setup on the server device first.",
  certificate_changed: "This server's certificate changed since you last trusted it.",
  wrong_server_name: "No server with that name here.",
  wrong_server_password: "Wrong server password.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  failed: "The server refused the sign-in.",
};

export function joinErrorField(code: JoinErrorCode): JoinField {
  return FIELDS[code] ?? "form";
}

export function joinErrorMessage(code: JoinErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.failed;
}

export type JoinResponse =
  | { ok: true; joinGrant: string; hasUsers: boolean }
  | { ok: false; error: JoinErrorCode };

const KNOWN_SERVER_ERRORS = new Set<string>(["wrong_server_name", "wrong_server_password", "server_not_set_up"]);

/** Turns the join endpoint's status + body into one code the UI can place. */
export function parseJoinResponse(status: number, body: unknown): JoinResponse {
  const payload = (body ?? {}) as { joinGrant?: unknown; hasUsers?: unknown; error?: unknown };
  if (status === 200) {
    return typeof payload.joinGrant === "string" && payload.joinGrant
      ? { ok: true, joinGrant: payload.joinGrant, hasUsers: payload.hasUsers === true }
      : { ok: false, error: "not_multibot" };
  }
  if (status === 429) return { ok: false, error: "rate_limited" };
  const error = typeof payload.error === "string" ? payload.error : "";
  if (KNOWN_SERVER_ERRORS.has(error)) return { ok: false, error: error as JoinErrorCode };
  // A 404 without the documented body is some other web server, not a MultiBot
  // one that lost its setup.
  if (status === 404) return { ok: false, error: "not_multibot" };
  return { ok: false, error: "failed" };
}

/** The web UI takes over at `#join=<grant>` and asks for a profile there. */
export function joinFragment(joinGrant: string): string {
  return `#join=${encodeURIComponent(joinGrant)}`;
}

// ── remembered sign-in ─────────────────────────────────────────────────────
// One tap has to skip the profile form too, so the shell spends the grant
// itself:
//   POST /api/auth/login { joinGrant, username, password }
//     200 { accessToken, sessionToken }        (x-multibot-client: native)
//     401 { error: "wrong_profile_password" }
//     404 { error: "no_such_profile" }
// The web UI is then handed a ready session in the fragment. `sessionToken` is
// not optional in practice: a WebView keeps no cookie, so without it the first
// token expiry fifteen minutes later would be a logout.

export type LoginErrorCode = "no_such_profile" | "wrong_profile_password" | "join_grant_invalid" | "rate_limited" | "failed";

export type LoginResponse =
  | { ok: true; accessToken: string; sessionToken: string }
  | { ok: false; error: LoginErrorCode };

const KNOWN_LOGIN_ERRORS = new Set<string>(["no_such_profile", "wrong_profile_password", "join_grant_invalid"]);

const LOGIN_MESSAGES: Record<LoginErrorCode, string> = {
  no_such_profile: "That profile no longer exists on this server.",
  wrong_profile_password: "The saved profile password no longer works. Sign in again.",
  join_grant_invalid: "The sign-in expired. Try again.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  failed: "The server refused the sign-in.",
};

export function loginErrorMessage(code: LoginErrorCode): string {
  return LOGIN_MESSAGES[code] ?? LOGIN_MESSAGES.failed;
}

export function parseLoginResponse(status: number, body: unknown): LoginResponse {
  const payload = (body ?? {}) as { accessToken?: unknown; sessionToken?: unknown; error?: unknown };
  if (status === 200 && typeof payload.accessToken === "string" && payload.accessToken) {
    return { ok: true, accessToken: payload.accessToken, sessionToken: typeof payload.sessionToken === "string" ? payload.sessionToken : "" };
  }
  if (status === 429) return { ok: false, error: "rate_limited" };
  const error = typeof payload.error === "string" ? payload.error : "";
  if (KNOWN_LOGIN_ERRORS.has(error)) return { ok: false, error: error as LoginErrorCode };
  return { ok: false, error: "failed" };
}

/** What the shell hands a page it has already signed in. `src/lib/auth.ts`
 * reads both keys out of the hash and erases them before first paint. */
export function sessionFragment(accessToken: string, sessionToken: string): string {
  const parts = [`access_token=${encodeURIComponent(accessToken)}`];
  if (sessionToken) parts.push(`session=${encodeURIComponent(sessionToken)}`);
  return `#${parts.join("&")}`;
}
