import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldPresentNotification } from "./notification-policy.ts";

test("routine and turn lifecycle pushes never alert in the foreground", () => {
  for (const kind of ["started", "finished", "failed", "attention", "question", "handoff", "approval", "routine", "unknown"]) {
    for (const visible of [null, "other", "bot"]) {
      assert.equal(shouldPresentNotification({ kind, botId: "bot" }, visible, true), false, kind);
    }
  }
  assert.equal(shouldPresentNotification(undefined, null, true), false);
  assert.equal(shouldPresentNotification({}, null, true), false);
});

test("an intentional bot notification alerts unless its chat is already visible", () => {
  assert.equal(shouldPresentNotification({ kind: "notify", botId: "bot" }, null, true), true);
  assert.equal(shouldPresentNotification({ kind: "notify", botId: "bot" }, "other", true), true);
  assert.equal(shouldPresentNotification({ kind: "notify", botId: "bot" }, "bot", true), false);
});

test("explicit reminders still alert in their open chat", () => {
  assert.equal(shouldPresentNotification({ kind: "reminder", botId: "bot" }, "bot", true), true);
});

test("local diagnostics are not mistaken for legacy routine pushes", () => {
  assert.equal(shouldPresentNotification(undefined, null, false), true);
  assert.equal(shouldPresentNotification({ action: "install-apk" }, "bot", false), true);
});
