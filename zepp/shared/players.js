import { localStorage } from "@zos/storage";

// The player app the phone is attached to ({ label, pkg }, from /media/app/info) and
// app icons received as files ({ pkg: filePath }). Both cached so screens draw at once.

export function getMediaApp() {
  try {
    return JSON.parse(localStorage.getItem("mediaApp", "null"));
  } catch (e) {
    return null;
  }
}

export function saveMediaApp(info) {
  if (!info || !info.key_package_name) return;
  localStorage.setItem("mediaApp", JSON.stringify({ label: info.key_label || info.key_package_name, pkg: info.key_package_name }));
}

export function getAppIcons() {
  try {
    return JSON.parse(localStorage.getItem("appIcons", "{}")) || {};
  } catch (e) {
    return {};
  }
}

export function saveAppIcon(pkg, path) {
  const icons = getAppIcons();
  icons[pkg] = path;
  localStorage.setItem("appIcons", JSON.stringify(icons));
}
