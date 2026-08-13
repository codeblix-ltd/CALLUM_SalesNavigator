import assert from "node:assert/strict";
import test from "node:test";

test("completion and rate-limit messages play distinct four-note sounds", async () => {
  let messageListener = null;
  const frequencies = [];
  const waveTypes = [];
  let starts = 0;
  let stops = 0;

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(listener) { messageListener = listener; },
      },
    },
  };

  globalThis.AudioContext = class {
    currentTime = 10;
    destination = {};

    async resume() {}

    createOscillator() {
      return {
        type: "",
        frequency: {
          setValueAtTime(value) { frequencies.push(value); },
        },
        connect(node) { return node; },
        start() {
          starts += 1;
          waveTypes.push(this.type);
        },
        stop() { stops += 1; },
      };
    }

    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() { return this; },
      };
    }
  };

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => {
    queueMicrotask(callback);
    return 1;
  };

  try {
    await import(`../offscreen.js?sound-test=${Date.now()}`);
    assert.equal(typeof messageListener, "function");

    const response = await new Promise((resolve) => {
      const keepChannelOpen = messageListener(
        { target: "offscreen", type: "playCompletionSound" },
        {},
        resolve,
      );
      assert.equal(keepChannelOpen, true);
    });

    assert.deepEqual(response, { ok: true });

    const alertResponse = await new Promise((resolve) => {
      const keepChannelOpen = messageListener(
        { target: "offscreen", type: "playRateLimitAlert" },
        {},
        resolve,
      );
      assert.equal(keepChannelOpen, true);
    });

    assert.deepEqual(alertResponse, { ok: true });
    assert.deepEqual(frequencies, [
      523.25, 659.25, 783.99, 1046.5,
      880, 587.33, 880, 587.33,
    ]);
    assert.deepEqual(waveTypes, ["sine", "sine", "sine", "sine", "square", "square", "square", "square"]);
    assert.equal(starts, 8);
    assert.equal(stops, 8);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    delete globalThis.AudioContext;
    delete globalThis.chrome;
  }
});
