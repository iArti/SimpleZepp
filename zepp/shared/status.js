import { localStorage } from "@zos/storage";

// Last known phone status, shared by the app pages and the shortcut card
const KEY = "phone_status";

export function loadStatus() {
  try {
    return JSON.parse(localStorage.getItem(KEY, "{}")) || {};
  } catch (e) {
    return {};
  }
}

export function saveStatus(patch) {
  const next = { ...loadStatus(), ...patch, ts: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    console.log("status save failed", e);
  }
  return next;
}

// Turn phone messages into status fields; returns null when the message is irrelevant
export function statusPatch(path, json) {
  if (!json) return null;
  if (path === "/status/battery") return { battery: { level: json.batteryLevel, charging: !!json.isCharging } };
  if (path === "/status/signal") return { signal: json };
  if (path !== "/actions") return null;
  switch (json.actionType) {
    case "wifi":
      return { wifi: !!json.isEnabled };
    case "mobiledata":
      return { data: !!json.isEnabled };
    case "ringer":
      return { ringer: json.value || 0 };
    default:
      return null;
  }
}

export const BATT_STEPS = 7;

// prefix "card_" selects the larger shortcut-card set
export function batteryIcon(level, charging, prefix = "") {
  const step = Math.max(0, Math.min(BATT_STEPS, Math.round(((level || 0) / 100) * BATT_STEPS)));
  return "icons/" + prefix + (charging ? "battery_c" : "battery_") + step + ".png";
}

// Signal icons are SimpleWear's own Wi-Fi (3 parts) and cell (4 bars) vectors with parts lit by level.
// `wifi` / `data` are the on/off states from /actions; `signal` comes from /status/signal.
const WIFI_PARTS = 3;
const CELL_PARTS = 4;

export function wifiIconFor(wifi, signal) {
  if (!wifi || (signal && !signal.wifiEnabled)) return "icons/wifi_off.png";
  if (!signal) return "icons/wifi_on.png";
  if (!signal.wifiConnected) return "icons/wifi_l0.png";
  // Android levels 0..4 -> 0..3 arcs
  const parts = Math.min(WIFI_PARTS, Math.ceil(((signal.wifiLevel || 0) * WIFI_PARTS) / 4));
  return "icons/wifi_l" + parts + ".png";
}

export function cellIconFor(data, signal) {
  if (!data || (signal && !signal.dataEnabled)) return "icons/data_off.png";
  if (!signal) return "icons/data_on.png";
  // the phone reports its own scale (MagicOS 0..5) -> 0..4 bars
  const max = signal.cellMax || 4;
  const bars = Math.min(CELL_PARTS, Math.round(((signal.cellLevel || 0) * CELL_PARTS) / max));
  return "icons/cell_l" + bars + ".png";
}
