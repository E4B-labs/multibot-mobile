// Outage state machine for the phone-local server (Termux on the same phone).
// Pure: no React Native here, so `node --test` drives it with a fake clock.
//
// Measured 2026-09-14: Android killed Termux with LOW_MEMORY, no reboot, so
// Termux:Boot never ran and the in-Termux watchdog died with it. Starting the
// Termux activity was enough: its shell startup runs runit, which brings
// `multibot` back in about 25 s. The shell does that itself now, at most twice
// per outage, then leaves the manual button.

export const FIRST_LAUNCH_AFTER_MS = 60_000;
export const SECOND_LAUNCH_AFTER_MS = 90_000;
export const MAX_AUTO_LAUNCHES = 2;
export const RECOVERED_NOTICE_MS = 5_000;
export const PROBE_INTERVAL_MS = 30_000;
export const OUTAGE_PROBE_INTERVAL_MS = 10_000;
export const AUTO_REVIVE_KEY = "multibot.autoRevive";

export type ReviveState = {
  downSince: number | null;
  launches: number;
  lastLaunchAt: number | null;
  launchFailed: boolean;
  recoveredAt: number | null;
};

export const INITIAL_REVIVE_STATE: ReviveState = { downSince: null, launches: 0, lastLaunchAt: null, launchFailed: false, recoveredAt: null };

export type ReviveInput = { healthy: boolean; now: number; resumed?: boolean };

/** One probe result in. Returns the next state and whether to fire the Termux launch intent now. */
export function reviveStep(state: ReviveState, { healthy, now, resumed = false }: ReviveInput): { state: ReviveState; launch: boolean } {
  if (healthy) {
    return { state: { ...INITIAL_REVIVE_STATE, recoveredAt: state.launches > 0 ? now : state.recoveredAt }, launch: false };
  }
  const downSince = state.downSince ?? now;
  let launch = false;
  if (!state.launchFailed && state.launches < MAX_AUTO_LAUNCHES) {
    launch = state.launches === 0 ? resumed || now - downSince >= FIRST_LAUNCH_AFTER_MS : now - (state.lastLaunchAt ?? now) >= SECOND_LAUNCH_AFTER_MS;
  }
  return {
    state: { ...state, downSince, recoveredAt: null, launches: state.launches + (launch ? 1 : 0), lastLaunchAt: launch ? now : state.lastLaunchAt },
    launch,
  };
}

/** The intent threw (Termux missing or blocked): only the manual banner from now on. */
export function reviveLaunchFailed(state: ReviveState): ReviveState {
  return { ...state, launchFailed: true };
}

export type RevivePhase = "hidden" | "waking" | "manual" | "recovered";

export function revivePhase(state: ReviveState, now: number): RevivePhase {
  if (state.downSince === null) {
    return state.recoveredAt !== null && now - state.recoveredAt < RECOVERED_NOTICE_MS ? "recovered" : "hidden";
  }
  if (state.launchFailed) return "manual";
  if (state.launches >= MAX_AUTO_LAUNCHES && now - (state.lastLaunchAt ?? now) >= SECOND_LAUNCH_AFTER_MS) return "manual";
  return state.launches > 0 ? "waking" : "hidden";
}

export function nextProbeDelay(state: ReviveState, now: number): number {
  if (state.downSince !== null) return OUTAGE_PROBE_INTERVAL_MS;
  return state.recoveredAt !== null && now - state.recoveredAt < RECOVERED_NOTICE_MS ? RECOVERED_NOTICE_MS : PROBE_INTERVAL_MS;
}

// Persisted counter: "how often did the shell have to wake Termux". Stored as
// one JSON string under AUTO_REVIVE_KEY by whatever key-value store the app has.
export type AutoRevives = { count: number; last: number | null };

export function parseAutoRevives(raw: string | null | undefined): AutoRevives {
  try {
    const parsed = JSON.parse(raw ?? "") as Partial<AutoRevives>;
    return { count: Number.isFinite(parsed.count) ? Number(parsed.count) : 0, last: Number.isFinite(parsed.last) ? Number(parsed.last) : null };
  } catch {
    return { count: 0, last: null };
  }
}

export function bumpAutoRevives(raw: string | null | undefined, now: number): string {
  const current = parseAutoRevives(raw);
  return JSON.stringify({ count: current.count + 1, last: now });
}

export function formatAutoRevives({ count, last }: AutoRevives): string {
  return `Automatyczne wybudzenia: ${count}, ostatnie: ${last === null ? "brak" : new Date(last).toLocaleString("pl-PL")}`;
}
