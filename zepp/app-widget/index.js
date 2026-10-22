import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop, event, align, text_style, getAppWidgetSize, setAppWidgetSize, getTextLayout } from "@zos/ui";
import { px } from "@zos/utils";
import { launchApp, push } from "@zos/router";
import { onKey, offKey, KEY_SELECT, KEY_EVENT_CLICK } from "@zos/interaction";
import { loadStatus, saveStatus, statusPatch, batteryIcon, wifiIconFor, cellIconFor } from "../shared/status";

// Shortcut card: Wi-Fi, mobile data, ringer mode and battery of the phone.
// Draws the cached status at once, then asks the phone for a fresh one.

const APP_ID = 1145144;
const CARD_H = 112;
const ICON = 56;
const BATT_ICON = 50;
// the battery body leaves ~12 px empty on its right inside the 50 px image: pull the text over it
const BATT_GAP = -2;
const BATT_TEXT = 24;
const RINGER_ICONS = ["ringer_silent", "ringer_vibrate", "ringer_sound"];

const options = {
  build() {
    try {
      setAppWidgetSize({ h: px(CARD_H) });
      const { w, margin, radius } = getAppWidgetSize();
      this.card = { x: margin, w, h: px(CARD_H) };

      // The card background is a BUTTON: the card list swallows CLICK_UP on plain widgets
      createWidget(widget.BUTTON, {
        x: margin, y: 0, w, h: px(CARD_H), radius,
        normal_color: 0x1f1530, press_color: 0x2e2147, text: "",
        click_func: () => this.openApp(),
      });

      // four equal cells: Wi-Fi, mobile data, ringer, battery
      const cell = w / 4;
      const iconY = Math.round((px(CARD_H) - px(ICON)) / 2);
      const cellX = (i, size) => Math.round(margin + cell * i + (cell - size) / 2);

      this.wifi = createWidget(widget.IMG, { x: cellX(0, px(ICON)), y: iconY, w: px(ICON), h: px(ICON), src: "icons/wifi_off.png" });
      this.data = createWidget(widget.IMG, { x: cellX(1, px(ICON)), y: iconY, w: px(ICON), h: px(ICON), src: "icons/data_off.png" });
      this.ringer = createWidget(widget.IMG, { x: cellX(2, px(ICON)), y: iconY, w: px(ICON), h: px(ICON), src: "icons/ringer_sound.png" });

      // battery icon + percentage side by side, centred in the last cell (see placeBattery)
      this.battCell = { x: margin + cell * 3, w: cell };
      this.battY = Math.round((px(CARD_H) - px(BATT_ICON)) / 2);
      this.batt = createWidget(widget.IMG, { x: cellX(3, px(BATT_ICON)), y: this.battY, w: px(BATT_ICON), h: px(BATT_ICON), src: batteryIcon(0, false, "card_") });
      this.battText = createWidget(widget.TEXT, {
        x: cellX(3, 0), y: this.battY, w: px(4), h: px(BATT_ICON),
        text: "", text_size: px(BATT_TEXT), color: 0xffffff, align_h: align.LEFT, align_v: align.CENTER_V,
        text_style: text_style.NONE,
      });

      // icons sit on top of the button and may take the tap themselves
      [this.wifi, this.data, this.ringer, this.batt, this.battText].forEach((wg) =>
        wg.addEventListener(event.CLICK_UP, () => this.openApp())
      );

      this.show(loadStatus());
    } catch (e) {
      console.log("card build failed", e);
    }
  },

  openApp() {
    try {
      launchApp({ appId: APP_ID, url: "page/dashboard/index" });
    } catch (e) {
      console.log("launchApp failed", e);
      push({ url: "page/dashboard/index" });
    }
  },

  onResume() {
    // card has focus: Select opens the app, every other key stays with the system
    try {
      onKey({
        callback: (key, keyEvent) => {
          if (key === KEY_SELECT && keyEvent === KEY_EVENT_CLICK) {
            this.openApp();
            return true;
          }
          return false;
        },
      });
    } catch (e) {
      console.log("card onKey failed", e);
    }
    this.refresh();
  },

  onPause() {
    try {
      offKey();
    } catch (e) {
      console.log("card offKey failed", e);
    }
    // card left the screen: stop the phone polling
    if (this.stopKeepAlive) this.stopKeepAlive();
    this.stopKeepAlive = null;
    if (this.request) this.request({ method: "unsubscribe" }, { timeout: 5000 }).catch(() => {});
  },

  refresh() {
    if (!this.request) return; // zml messaging unavailable in this context
    if (!this.stopKeepAlive) {
      const timer = setInterval(() => {
        this.request({ method: "keepalive" }, { timeout: 5000 }).catch(() => {});
      }, 30 * 1000);
      this.stopKeepAlive = () => clearInterval(timer);
    }
    this.request({ method: "subscribe" }, { timeout: 12000 })
      .then(() => this.request({ method: "send", params: { path: "/app_state", text: "FOREGROUND" } }, { timeout: 12000 }))
      .catch((e) => console.log("card refresh failed", e));
  },

  show(st) {
    if (!this.wifi) return;
    this.wifi.setProperty(prop.MORE, { ...this.geomOf(this.wifi), src: wifiIconFor(st.wifi, st.signal) });
    this.data.setProperty(prop.MORE, { ...this.geomOf(this.data), src: cellIconFor(st.data, st.signal) });
    const r = st.ringer === undefined ? 2 : st.ringer;
    this.ringer.setProperty(prop.MORE, { ...this.geomOf(this.ringer), src: "icons/" + RINGER_ICONS[r] + ".png" });
    if (st.battery) this.placeBattery(st.battery.level, st.battery.charging);
  },

  placeBattery(level, charging) {
    const label = level + "%";
    const textW = getTextLayout(label, { text_size: px(BATT_TEXT), text_width: 0, wrapped: 0 }).width;
    const groupW = px(BATT_ICON + BATT_GAP) + textW;
    const x0 = Math.round(this.battCell.x + (this.battCell.w - groupW) / 2);
    this.batt.setProperty(prop.MORE, {
      x: x0, y: this.battY, w: px(BATT_ICON), h: px(BATT_ICON), src: batteryIcon(level, charging, "card_"),
    });
    this.battText.setProperty(prop.MORE, {
      x: x0 + px(BATT_ICON + BATT_GAP), y: this.battY, w: textW + px(6), h: px(BATT_ICON), text: label,
    });
  },

  // prop.MORE resets omitted fields, so resend each icon's own geometry
  geomOf(wg) {
    return {
      x: wg.getProperty(prop.X),
      y: wg.getProperty(prop.Y),
      w: wg.getProperty(prop.W),
      h: wg.getProperty(prop.H),
    };
  },

  onCall(data) {
    if (!data || data.type !== "messages") return;
    let st = null;
    for (const m of data.msgs || []) {
      let json;
      try {
        json = m.text !== undefined ? JSON.parse(m.text) : undefined;
      } catch (e) {
        json = undefined;
      }
      const patch = statusPatch(m.path, json);
      if (patch) st = saveStatus(patch);
    }
    if (st) this.show(st);
  },
};

// zml needs the app instance; fall back to cache-only if the card runs without it
let card = options;
try {
  card = BasePage(options);
} catch (e) {
  console.log("card without messaging", e);
}
AppWidget(card);
