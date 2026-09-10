import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../chrome-extension/support-entry.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../chrome-extension/manifest.json", import.meta.url), "utf8"));
function popup(installed = manifest.version) {
  const node = () => ({ children: [], hidden: false, textContent: "", append(...items) { this.children.push(...items); }, prepend(item) { this.children.unshift(item); }, after(item) { this.next = item; }, setAttribute() {}, addEventListener() {} });
  const brand = node(), topbar = node(), actions = node();
  let changed, resolve, reject;
  const stored = new Promise((yes, no) => { resolve = yes; reject = no; });
  vm.runInNewContext(source, {
    document: { createElement: node, querySelector: selector => ({ ".topbar strong": brand, ".topbar": topbar, ".topbar-actions": actions })[selector] },
    chrome: { runtime: { getManifest: () => ({ version: installed }) }, storage: { local: { get: () => stored }, onChanged: { addListener: fn => { changed = fn; } } } },
  });
  return { brand, notice: topbar.next, resolve, reject, change: (value, area = "local") => changed({ scoutAvailableUpdate: { newValue: value } }, area) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const view = popup();
assert.equal(view.brand.children[0].textContent, `v${manifest.version}`);
assert.equal(view.notice.hidden, true);
view.resolve({ scoutAvailableUpdate: "0.10.35" });
await flush();
assert.equal(view.notice.hidden, false);
assert.equal(view.notice.children[0].textContent, "New version available: v0.10.35");
assert.match(view.notice.children[1].textContent, /Finish your current work/);
for (const value of [manifest.version, "0.10.34.0", "0.10.9", "0.9.999", "", undefined, "0.10.35<script>"]) {
  view.change(value);
  assert.equal(view.notice.hidden, true, `hide stale or invalid update: ${value}`);
}
view.change("0.11");
assert.equal(view.notice.hidden, false, "compare missing components as zero");
view.change(undefined, "sync");
assert.equal(view.notice.hidden, false, "ignore other storage areas");
view.change(undefined);
assert.equal(view.notice.hidden, true, "remove notice when pending update is removed");
const race = popup("0.10.9");
race.change("0.10.10");
race.resolve({ scoutAvailableUpdate: "0.10.8" });
await flush();
assert.equal(race.notice.hidden, false, "new event wins over stale initial storage read");
assert.match(race.notice.children[0].textContent, /0\.10\.10/);
const failed = popup();
failed.reject(new Error("Storage unavailable"));
await flush();
assert.equal(failed.brand.children[0].textContent, `v${manifest.version}`);
assert.equal(failed.notice.hidden, true);
console.log("Extension update UI checks passed: installed badge, stored/live notices, numeric version order, stale notices, storage failure and read/event race.");
