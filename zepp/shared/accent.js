import { localStorage } from "@zos/storage";
import { MINT } from "./ui";

// Accent of the media screens: the player app's icon color, computed on the phone
// (AccentColor.kt) and sent with /media/app/info. Cached so screens open in it right away.
const KEY = "mediaAccent";

export function getAccent() {
  const v = Number(localStorage.getItem(KEY, ""));
  return Number.isFinite(v) && v > 0 ? v : MINT;
}

// Returns true when the color changed
export function saveAccent(appInfo) {
  const next = appInfo && typeof appInfo.accent === "number" ? appInfo.accent : MINT;
  if (next === getAccent()) return false;
  localStorage.setItem(KEY, String(next));
  return true;
}
