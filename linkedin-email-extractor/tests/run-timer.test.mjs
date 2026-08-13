import assert from "node:assert/strict";
import test from "node:test";

import { formatRunDuration, getRunDurationMs } from "../run-timer.js";

test("formats run time in minutes and seconds", () => {
  assert.equal(formatRunDuration(0), "0m 00s");
  assert.equal(formatRunDuration(754_000), "12m 34s");
});

test("formats longer run time in hours, minutes, and seconds", () => {
  assert.equal(formatRunDuration(4_923_000), "1h 22m 03s");
});

test("uses live time while running and freezes at completion", () => {
  const liveState = { createdAt: 1_000, updatedAt: 3_000, running: true };
  const completedState = { ...liveState, running: false, completedAt: 8_000, updatedAt: 9_000 };

  assert.equal(getRunDurationMs(liveState, 6_000), 5_000);
  assert.equal(getRunDurationMs(completedState, 20_000), 7_000);
});

test("freezes an unfinished stopped or paused run at its last update", () => {
  assert.equal(getRunDurationMs({ createdAt: 1_000, updatedAt: 5_000, running: false }, 20_000), 4_000);
});
