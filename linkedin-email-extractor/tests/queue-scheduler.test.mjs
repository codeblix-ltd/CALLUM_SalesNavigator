import assert from "node:assert/strict";
import test from "node:test";

import { createQueueScheduler } from "../queue-scheduler.js";

test("a completed lookup moves the next refill earlier", async () => {
  const timers = new Map();
  const cleared = [];
  let nextTimerId = 1;
  let now = 1_000;
  let pumpCount = 0;
  const scheduler = createQueueScheduler(
    () => { pumpCount += 1; },
    {
      now: () => now,
      setTimer(callback, delay) {
        const id = nextTimerId++;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimer(id) {
        cleared.push(id);
        timers.delete(id);
      },
    },
  );

  scheduler.schedule(1_800);
  now = 1_100;
  scheduler.schedule(0);

  assert.deepEqual(cleared, [1]);
  assert.equal(scheduler.getDueAt(), 1_100);
  assert.equal(timers.get(2).delay, 0);

  timers.get(2).callback();
  await Promise.resolve();
  assert.equal(pumpCount, 1);
});

test("later completion signals cannot postpone an immediate refill", async () => {
  const timers = new Map();
  const cleared = [];
  let nextTimerId = 1;
  let now = 5_000;
  let pumpCount = 0;
  const scheduler = createQueueScheduler(
    () => { pumpCount += 1; },
    {
      now: () => now,
      setTimer(callback, delay) {
        const id = nextTimerId++;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimer(id) {
        cleared.push(id);
        timers.delete(id);
      },
    },
  );

  scheduler.schedule(0);
  now = 5_001;
  scheduler.schedule(0);
  now = 5_002;
  scheduler.schedule(0);

  assert.deepEqual(cleared, []);
  assert.equal(timers.size, 1);
  assert.equal(scheduler.getDueAt(), 5_000);

  timers.get(1).callback();
  await Promise.resolve();
  assert.equal(pumpCount, 1);
});
