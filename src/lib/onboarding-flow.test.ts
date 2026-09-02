import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const screen = readFileSync("src/screens/AddHostScreen.tsx", "utf8");

test("mobile onboarding starts with the host address before pairing controls", () => {
  assert.match(screen, /useState<Step>\("address"\)/);
  assert.match(screen, /onPress=\{\(\) => void handleContinue\(\)\}/);
  assert.ok(screen.indexOf('step === "address"') < screen.indexOf('step === "pairing"'));
  assert.ok(screen.indexOf("Host address") < screen.indexOf("One-time pairing code"));
});
