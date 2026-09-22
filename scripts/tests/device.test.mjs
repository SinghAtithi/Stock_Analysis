import test from "node:test";
import assert from "node:assert/strict";

/* TASK-1541 — device getDeviceId: stable anonymous id shared by alerts +
   the watchlist cloud mirror (future auth claims rows by it, TASK-63).
   Zero coverage before this file. Window is toggled per test because the
   module branches on `typeof window` at call time. */

const device = await import("../../web/src/lib/device.ts");
const KEY = "niftyterm.deviceId";

const withWindow = (storage) => {
  globalThis.window = {
    localStorage: storage,
    dispatchEvent: () => true,
    addEventListener() {},
    removeEventListener() {},
  };
};
const withoutWindow = () => {
  delete globalThis.window;
};
const memStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

test("server (no window) returns the local fallback id", () => {
  withoutWindow();
  assert.equal(device.getDeviceId(), device.LOCAL_DEVICE_ID);
});

test("fresh browser mints a UUID and persists it", () => {
  const storage = memStore();
  withWindow(storage);
  const first = device.getDeviceId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(storage.getItem(KEY), first);
  assert.equal(device.getDeviceId(), first);
  withoutWindow();
});

test("existing stored id is reused as-is", () => {
  const storage = memStore();
  storage.setItem(KEY, "sticky-id-123");
  withWindow(storage);
  assert.equal(device.getDeviceId(), "sticky-id-123");
  withoutWindow();
});

test("storage failure falls back to the local id", () => {
  withWindow({
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {},
  });
  assert.equal(device.getDeviceId(), device.LOCAL_DEVICE_ID);
  withoutWindow();
});
