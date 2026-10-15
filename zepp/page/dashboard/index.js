import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, event, prop, align, getTextLayout } from "@zos/ui";
import { px } from "@zos/utils";
import { push } from "@zos/router";
import { W, MINT, GRAY, RED, TILE_OFF, TILE_ON, TILE_BUSY, text, roundButton, errorText, actionErrorText } from "../../shared/ui";
import { PATH, RINGER, toggleAction, multiChoiceAction, normalAction } from "../../shared/protocol";
import { send, sendJson, subscribe, dispatch } from "../../shared/link";
import { saveStatus, statusPatch, batteryIcon, wifiIconFor, cellIconFor, loadStatus } from "../../shared/status";

const ICON = (name) => "icons/" + name + ".png";

// kind: toggle | ringer | normal | page
const TILES = [
  { type: "wifi", label: "Wi-Fi", kind: "toggle", on: "wifi_on", off: "wifi_off" },
  { type: "bluetooth", label: "Bluetooth", kind: "toggle", on: "bt_on", off: "bt_off" },
  { type: "mobiledata", label: "Моб. данные", kind: "toggle", on: "data_on", off: "data_off" },
  { type: "location", label: "Геолокация", kind: "toggle", on: "location_on", off: "location_off" },
  { type: "torch", label: "Фонарик", kind: "toggle", on: "torch", off: "torch" },
  { type: "donotdisturb", label: "Не беспок.", kind: "toggle", on: "dnd_on", off: "dnd_off" },
  { type: "ringer", label: "Звонок", kind: "ringer" },
  { type: "hotspot", label: "Точка дост.", kind: "toggle", on: "hotspot", off: "hotspot" },
  { type: "nfc", label: "NFC", kind: "toggle", on: "nfc_on", off: "nfc_off" },
  { type: "batterysaver", label: "Экономия", kind: "toggle", on: "battery_saver", off: "battery_saver" },
  { type: "lockscreen", label: "Блокировка", kind: "normal", icon: "lock" },
  { type: "volume", label: "Громкость", kind: "page", icon: "volume", url: "page/value/index", params: { kind: "volume" } },
  { type: "brightness", label: "Яркость", kind: "page", icon: "brightness", url: "page/value/index", params: { kind: "brightness" } },
  { type: "apps", label: "Приложения", kind: "page", icon: "apps", url: "page/apps/index" },
];
const RINGER_ICONS = ["ringer_silent", "ringer_vibrate", "ringer_sound"];

const COL_X = [100, 240, 380];

// Phone battery header: stepped icon (battery_0..7, battery_c0..7 when charging) + percentage
const BATT_ICON = 40;
const BATT_GAP = 6;
const BATT_TEXT = 28;
const BATT_Y = 30;
const BATT_X0 = 200;
const ROW_Y = 180;
const ROW_STEP = 140;
const D = 100;

Page(
  BasePage({
    build() {
      try {
        this.state = {}; // actionType -> last Action from the phone
        this.tiles = {};
        this.paired = false;
        this.signal = loadStatus().signal; // Wi-Fi / cell levels for the two tiles

        this.batteryIcon = createWidget(widget.IMG, { x: px(BATT_X0), y: px(BATT_Y), w: px(BATT_ICON), h: px(BATT_ICON), src: ICON("battery_0") });
        this.batteryText = text(BATT_X0 + BATT_ICON + BATT_GAP, BATT_Y, 120, BATT_ICON, "", { size: BATT_TEXT, alignH: align.LEFT });

        this.status = text(80, 80, W - 160, 44, "Подключение…", { size: 20, color: GRAY });
        this.status.addEventListener(event.CLICK_UP, () => {
          if (!this.paired) this.pair();
        });

        TILES.forEach((t, i) => this.tile(t, COL_X[i % 3], ROW_Y + Math.floor(i / 3) * ROW_STEP));
        // room to scroll the last row above the round bezel
        text(0, ROW_Y + Math.ceil(TILES.length / 3) * ROW_STEP, W, 80, "", {});

        this.connect();
      } catch (e) {
        text(40, 180, W - 80, 120, "build: " + e, { color: RED, wrap: true, size: 22 });
      }
    },

    onResume() {
      // back from a sub page: refresh everything (the sub page may have changed volume etc.)
      if (this.paired) this.start();
    },

    tile(t, cx, cy) {
      const icon = t.kind === "toggle" ? ICON(t.off) : t.kind === "ringer" ? ICON(RINGER_ICONS[2]) : ICON(t.icon);
      const btn = roundButton(cx, cy, D, { icon, size: 56 }, () => this.tap(t));
      text(cx - 70, cy + D / 2 + 2, 140, 28, t.label, { size: 18, color: GRAY });
      this.tiles[t.type] = btn;
    },

    showBattery(level, charging) {
      const label = level + "%";
      // centre icon + text as one group on the measured text width
      const textW = getTextLayout(label, { text_size: px(BATT_TEXT), text_width: 0, wrapped: 0 }).width;
      const groupW = px(BATT_ICON + BATT_GAP) + textW;
      const x0 = Math.round((px(W) - groupW) / 2);
      this.batteryIcon.setProperty(prop.MORE, {
        x: x0, y: px(BATT_Y), w: px(BATT_ICON), h: px(BATT_ICON),
        src: batteryIcon(level, charging),
      });
      this.batteryText.setProperty(prop.MORE, {
        x: x0 + px(BATT_ICON + BATT_GAP), y: px(BATT_Y), w: textW + px(8), h: px(BATT_ICON),
        text: label,
      });
    },

    setStatus(value, color = GRAY) {
      this.status.setProperty(prop.TEXT, value);
      this.status.setProperty(prop.COLOR, color);
    },

    connect() {
      this.request({ method: "status" }, { timeout: 12000 })
        .then(({ result }) => {
          this.paired = result.paired;
          if (this.paired) this.start();
          else this.setStatus("Нажмите, чтобы привязать", MINT);
        })
        .catch((e) => this.setStatus(errorText(e), RED));
    },

    pair() {
      this.setStatus("Подтвердите на телефоне…", MINT);
      this.request({ method: "pair" }, { timeout: 100000 })
        .then(() => {
          this.paired = true;
          this.start();
        })
        .catch((e) => this.setStatus(errorText(e), RED));
    },

    start() {
      subscribe(this)
        .then(() => send(this, PATH.APP_STATE, { text: "FOREGROUND" }))
        .then(() => this.setStatus(""))
        .catch((e) => {
          if (String(e && (e.message || e)) === "unpaired") {
            this.paired = false;
            this.setStatus("Нажмите, чтобы привязать", MINT);
          } else {
            this.setStatus(errorText(e), RED);
          }
        });
    },

    tap(t) {
      if (t.kind === "page") {
        push({ url: t.url, params: t.params ? JSON.stringify(t.params) : undefined });
        return;
      }

      let action;
      const cur = this.state[t.type];
      if (t.kind === "toggle") action = toggleAction(t.type, !(cur && cur.isEnabled));
      else if (t.kind === "ringer") action = multiChoiceAction(t.type, ((cur ? cur.value || 0 : 2) + 1) % RINGER.length);
      else action = normalAction(t.type);

      this.tiles[t.type].setColor(TILE_BUSY);
      sendJson(this, PATH.ACTIONS, action).catch((e) => {
        this.render(t.type);
        if (String((e && (e.message || e)) || "") === "unpaired") {
          this.paired = false;
          this.setStatus("Нажмите, чтобы привязать", MINT);
        } else {
          this.setStatus(errorText(e), RED);
        }
      });
    },

    render(type) {
      const t = TILES.find((x) => x.type === type);
      const btn = this.tiles[type];
      const a = this.state[type];
      if (!t || !btn) return;
      if (t.kind === "toggle") {
        const on = !!(a && a.isEnabled);
        btn.setColor(on ? TILE_ON : TILE_OFF);
        if (type === "wifi") btn.setIcon(wifiIconFor(on, this.signal));
        else if (type === "mobiledata") btn.setIcon(cellIconFor(on, this.signal));
        else btn.setIcon(ICON(on ? t.on : t.off));
      } else if (t.kind === "ringer") {
        const v = a ? a.value || 0 : 2;
        btn.setIcon(ICON(RINGER_ICONS[v]));
        btn.setColor(v === 2 ? TILE_OFF : TILE_ON);
      } else {
        btn.setColor(TILE_OFF);
      }
    },

    onCall(data) {
      // keep the shortcut card's cached status fresh
      if (data && data.type === "messages") {
        for (const m of data.msgs || []) {
          let json;
          try {
            json = m.text !== undefined ? JSON.parse(m.text) : undefined;
          } catch (e) {
            json = undefined;
          }
          const patch = statusPatch(m.path, json);
          if (patch) saveStatus(patch);
        }
      }
      dispatch(data, {
        onLink: (l) => {
          if (l.error === "unpaired") {
            this.paired = false;
            this.setStatus("Нажмите, чтобы привязать", MINT);
          } else if (!l.ok) {
            this.setStatus(errorText(l.error), RED);
          }
        },
        [PATH.ACTIONS]: (m, a) => {
          if (!a || !a.actionType) return;
          this.state[a.actionType] = a;
          this.render(a.actionType);
          if (a.isActionSuccessful === false) this.setStatus(actionErrorText(a.actionStatus), RED);
          else this.setStatus("");
        },
        "/status/signal": (m, sig) => {
          if (!sig) return;
          this.signal = sig;
          this.render("wifi");
          this.render("mobiledata");
        },
        [PATH.BATTERY]: (m, b) => {
          if (b) this.showBattery(b.batteryLevel, b.isCharging);
        },
      });
    },
  })
);
