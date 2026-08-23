/* Stable anonymous device id, shared by alerts + the watchlist cloud mirror.
   Auth (TASK-63) will claim rows by this id before migrating scope to users. */

const DEVICE_KEY = "niftyterm.deviceId";
export const LOCAL_DEVICE_ID = "nifty-local-device";

export function getDeviceId(): string {
  if (typeof window === "undefined") return LOCAL_DEVICE_ID;
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return LOCAL_DEVICE_ID;
  }
}
