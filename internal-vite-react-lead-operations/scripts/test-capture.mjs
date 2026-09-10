import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../chrome-extension/report.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("async function captureFrame("), source.indexOf('window.addEventListener("pagehide"'));
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup({ ready = true, grab } = {}) {
  const timers = new Map(); let next = 0, videos = 0, removed = 0, pauses = 0, draws = 0;
  const listeners = new Map();
  const track = { readyState: "live", addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const stream = { getVideoTracks: () => [track] };
  const video = {
    style: {}, readyState: ready ? 2 : 0, videoWidth: 1920, videoHeight: 1080,
    setAttribute() {}, addEventListener() {}, removeEventListener() {},
    // Simulates the background-tab failure: neither play nor paint callbacks finish.
    play: () => new Promise(() => {}), requestVideoFrameCallback: () => { throw new Error("Must not wait for compositor"); },
    pause: () => { pauses++; }, remove: () => { removed++; },
  };
  const context = {
    document: { body: { append() {} }, createElement: type => {
      if (type === "video") { videos++; return video; }
      return { width: 0, height: 0, getContext: () => ({ drawImage: () => { draws++; } }) };
    } },
    setTimeout: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; },
    setInterval: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
  };
  if (grab) context.ImageCapture = class { grabFrame() { return grab(); } };
  vm.runInNewContext(helpers, context);
  return { capture: () => context.captureFrame(stream), track, video, timers, listeners,
    fire: ms => { const timer = [...timers.values()].find(timer => timer.ms === ms); assert.ok(timer, `Timer ${ms} exists`); timer.fn(); },
    counts: () => ({ videos, removed, pauses, draws }),
  };
}
let closed = 0;
const bitmap = { width: 800, height: 600, close: () => { closed++; } };
const direct = setup({ grab: async () => bitmap });
const directFrame = await direct.capture();
assert.equal(directFrame.source, bitmap); directFrame.close(); assert.equal(closed, 1);
assert.equal(direct.counts().videos, 0); assert.equal(direct.timers.size, 0);

for (const grab of [undefined, async () => { throw new Error("Unsupported display track"); }]) {
  const fallback = setup({ grab }); const frame = await fallback.capture();
  assert.equal(frame.width, 1920); assert.equal(frame.height, 1080);
  assert.deepEqual(fallback.counts(), { videos: 1, removed: 1, pauses: 1, draws: 1 });
  assert.equal(fallback.timers.size, 0); assert.equal(fallback.listeners.size, 0);
  assert.equal(fallback.video.srcObject, null);
}
const timeout = setup({ ready: false }); const waiting = timeout.capture();
const rejected = assert.rejects(waiting, /Sharing has stopped/);
timeout.fire(8000); await rejected;
assert.equal(timeout.counts().removed, 1); assert.equal(timeout.timers.size, 0);

const ended = setup({ ready: false }); const endedResult = assert.rejects(ended.capture(), /sharing stopped/);
ended.track.readyState = "ended"; ended.listeners.get("ended")(); await endedResult;
assert.equal(ended.counts().removed, 1); assert.equal(ended.timers.size, 0);

let deliverLate;
const late = setup({ grab: () => new Promise(resolve => { deliverLate = resolve; }) });
const lateResult = late.capture(); late.fire(4000); await flush();
assert.equal((await lateResult).width, 1920);
deliverLate(bitmap); await flush(); assert.equal(closed, 2, "late bitmap must be released");
assert.equal(late.timers.size, 0);
console.log("Capture regression tests passed: direct stream frame, background/pending-play fallback, unsupported ImageCapture, stalled frame timeout, stopped sharing, late frame disposal and timer/video cleanup.");
