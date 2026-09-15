// The outage machine is driven with an explicit clock, so "fake timers" here
// is just a number we advance by hand. Nothing from React Native is imported.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bumpAutoRevives,
  FIRST_LAUNCH_AFTER_MS,
  formatAutoRevives,
  INITIAL_REVIVE_STATE,
  MAX_AUTO_LAUNCHES,
  nextProbeDelay,
  OUTAGE_PROBE_INTERVAL_MS,
  parseAutoRevives,
  PROBE_INTERVAL_MS,
  RECOVERED_NOTICE_MS,
  reviveLaunchFailed,
  revivePhase,
  reviveStep,
  SECOND_LAUNCH_AFTER_MS,
  type ReviveState,
} from "./serverRevive.ts";

const T0 = 1_700_000_000_000;

/** Runs a probe result through the machine and returns the state plus phase. */
function probe(state: ReviveState, now: number, healthy: boolean, resumed = false) {
  const next = reviveStep(state, { healthy, now, resumed });
  return { ...next, phase: revivePhase(next.state, now), now };
}

test("healthy server: nothing fires, banner hidden, slow probe cadence", () => {
  let state = INITIAL_REVIVE_STATE;
  for (let i = 0; i < 5; i++) {
    const r = probe(state, T0 + i * PROBE_INTERVAL_MS, true);
    assert.equal(r.launch, false);
    assert.equal(r.phase, "hidden");
    assert.equal(nextProbeDelay(r.state, r.now), PROBE_INTERVAL_MS);
    state = r.state;
  }
});

test("outage: launch at 60 s, again 90 s later, then manual only", () => {
  let now = T0;
  let r = probe(INITIAL_REVIVE_STATE, now, false);
  assert.equal(r.launch, false, "first failure only starts the clock");
  assert.equal(r.phase, "hidden");
  assert.equal(nextProbeDelay(r.state, r.now), OUTAGE_PROBE_INTERVAL_MS);

  now += FIRST_LAUNCH_AFTER_MS - 1;
  r = probe(r.state, now, false);
  assert.equal(r.launch, false, "59.999 s is not yet 60 s");

  now += 1;
  r = probe(r.state, now, false);
  assert.equal(r.launch, true, "first launch at 60 s of continuous failure");
  assert.equal(r.phase, "waking");

  now += SECOND_LAUNCH_AFTER_MS - 1;
  r = probe(r.state, now, false);
  assert.equal(r.launch, false);
  assert.equal(r.phase, "waking");

  now += 1;
  r = probe(r.state, now, false);
  assert.equal(r.launch, true, "second launch 90 s after the first");
  assert.equal(r.state.launches, MAX_AUTO_LAUNCHES);
  assert.equal(r.phase, "waking", "Termux needs ~25 s, keep saying we are waking it");

  now += SECOND_LAUNCH_AFTER_MS;
  r = probe(r.state, now, false);
  assert.equal(r.launch, false);
  assert.equal(r.phase, "manual");

  // Nothing more, ever, for this outage: an hour of failures fires nothing.
  for (let i = 0; i < 360; i++) {
    now += OUTAGE_PROBE_INTERVAL_MS;
    r = probe(r.state, now, false);
    assert.equal(r.launch, false);
    assert.equal(r.phase, "manual");
  }
  assert.equal(r.state.launches, 2);
});

test("recovery shows the notice briefly and resets the outage", () => {
  let now = T0;
  let r = probe(INITIAL_REVIVE_STATE, now, false);
  now += FIRST_LAUNCH_AFTER_MS;
  r = probe(r.state, now, false);
  assert.equal(r.launch, true);

  now += 25_000;
  r = probe(r.state, now, true);
  assert.equal(r.phase, "recovered");
  assert.equal(nextProbeDelay(r.state, r.now), RECOVERED_NOTICE_MS);
  assert.equal(r.state.downSince, null);
  assert.equal(r.state.launches, 0);

  now += RECOVERED_NOTICE_MS;
  r = probe(r.state, now, true);
  assert.equal(r.phase, "hidden");

  // A fresh outage gets its own two launches.
  now += PROBE_INTERVAL_MS;
  r = probe(r.state, now, false);
  now += FIRST_LAUNCH_AFTER_MS;
  r = probe(r.state, now, false);
  assert.equal(r.launch, true);
});

test("a blip that never needed a launch shows no recovery notice", () => {
  let r = probe(INITIAL_REVIVE_STATE, T0, false);
  r = probe(r.state, T0 + 30_000, true);
  assert.equal(r.phase, "hidden");
});

test("foreground: the first failed probe fires without waiting 60 s, but never a third time", () => {
  let r = probe(INITIAL_REVIVE_STATE, T0, false, true);
  assert.equal(r.launch, true);
  assert.equal(r.phase, "waking");

  // Termux comes to the front, the user comes back 10 s later: still down.
  r = probe(r.state, T0 + 10_000, false, true);
  assert.equal(r.launch, false, "resume does not bypass the 90 s spacing");

  r = probe(r.state, T0 + SECOND_LAUNCH_AFTER_MS, false, true);
  assert.equal(r.launch, true);
  r = probe(r.state, T0 + 2 * SECOND_LAUNCH_AFTER_MS, false, true);
  assert.equal(r.launch, false);
  assert.equal(r.phase, "manual");
});

test("intent failure drops straight to the manual banner", () => {
  let r = probe(INITIAL_REVIVE_STATE, T0, false, true);
  assert.equal(r.launch, true);
  const failed = reviveLaunchFailed(r.state);
  assert.equal(revivePhase(failed, T0), "manual");
  r = probe(failed, T0 + SECOND_LAUNCH_AFTER_MS, false);
  assert.equal(r.launch, false, "no retry after the launcher threw");
  assert.equal(r.phase, "manual");
  r = probe(r.state, T0 + 2 * SECOND_LAUNCH_AFTER_MS, true);
  assert.equal(r.state.launchFailed, false, "recovery clears the failure");
});

test("auto-revive counter survives garbage and counts up", () => {
  assert.deepEqual(parseAutoRevives(null), { count: 0, last: null });
  assert.deepEqual(parseAutoRevives("not json"), { count: 0, last: null });
  assert.deepEqual(parseAutoRevives('{"count":"x"}'), { count: 0, last: null });
  const once = bumpAutoRevives(null, T0);
  assert.deepEqual(parseAutoRevives(once), { count: 1, last: T0 });
  const twice = bumpAutoRevives(once, T0 + 1);
  assert.deepEqual(parseAutoRevives(twice), { count: 2, last: T0 + 1 });
  assert.equal(formatAutoRevives({ count: 0, last: null }), "Automatyczne wybudzenia: 0, ostatnie: brak");
  assert.match(formatAutoRevives(parseAutoRevives(twice)), /^Automatyczne wybudzenia: 2, ostatnie: \d/);
});

test("the shell wires the machine into the WebView and the 24/7 checklist", () => {
  const webview = readFileSync("src/screens/WebViewScreen.tsx", "utf8");
  const checklist = readFileSync("src/components/Server247Checklist.tsx", "utf8");
  for (const needed of ["reviveStep", "revivePhase", "reviveLaunchFailed", "nextProbeDelay", "bumpAutoRevives", "Serwer padł, budzę Termux...", "Serwer wrócił"]) {
    assert.ok(webview.includes(needed), `WebViewScreen is missing ${needed}`);
  }
  for (const needed of ["parseAutoRevives", "formatAutoRevives", "AUTO_REVIVE_KEY"]) {
    assert.ok(checklist.includes(needed), `Server247Checklist is missing ${needed}`);
  }
  // Polish strings without em/en dashes in the new banner copy.
  const banner = webview.slice(webview.indexOf("styles.outageBanner"), webview.indexOf("server247Open ? ("));
  assert.ok(!/[—–]/.test(banner), "banner copy contains an em/en dash");
});
