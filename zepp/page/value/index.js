import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop } from "@zos/ui";
import { px } from "@zos/utils";
import { onKey, KEY_UP, KEY_DOWN, KEY_EVENT_CLICK } from "@zos/interaction";
import { W, MINT, GRAY, RED, TILE_ON, text, roundButton, errorText } from "../../shared/ui";
import { PATH, STREAMS, ACTION_VALUE, intBytes } from "../../shared/protocol";
import { send, sendJson, subscribe, dispatch } from "../../shared/link";

const STREAM_LABEL = { MUSIC: "Медиа", RINGTONE: "Звонок", VOICE_CALL: "Разговор", ALARM: "Будильник" };
const C = W / 2;
const R = 200;
const ARC_W = 16;

Page(
  BasePage({
    onInit(params) {
      try {
        this.kind = JSON.parse(params || "{}").kind || "volume";
      } catch (e) {
        this.kind = "volume";
      }
    },

    build() {
      try {
        this.streamIdx = 0;
        this.value = null; // {cur, min, max}
        this.auto = false;

        createWidget(widget.ARC, {
          x: px(C - R), y: px(C - R), w: px(R * 2), h: px(R * 2),
          start_angle: 135, end_angle: 405, color: 0x262626, line_width: px(ARC_W),
        });
        this.arc = createWidget(widget.ARC, {
          x: px(C - R), y: px(C - R), w: px(R * 2), h: px(R * 2),
          start_angle: 135, end_angle: 135, color: MINT, line_width: px(ARC_W),
        });

        text(C - 120, 70, 240, 40, this.kind === "volume" ? "Громкость" : "Яркость", { size: 26, color: GRAY });
        this.valueText = text(C - 90, C - 50, 180, 100, "—", { size: 72 });

        roundButton(C - 130, C, 84, { label: "−", textSize: 48 }, () => this.step(-1));
        roundButton(C + 130, C, 84, { label: "+", textSize: 48 }, () => this.step(1));

        // bottom: stream switch (volume) or auto mode (brightness)
        this.modeBtn = roundButton(C, C + 140, 96, { label: "", textSize: 20 }, () => this.mode());
        this.status = text(C - 150, C + 60, 300, 32, "", { size: 18, color: GRAY });

        onKey({
          callback: (key, ev) => {
            if (ev !== KEY_EVENT_CLICK) return false;
            if (key === KEY_UP) this.step(1);
            else if (key === KEY_DOWN) this.step(-1);
            else return false;
            return true;
          },
        });

        this.renderMode();
        subscribe(this)
          .then(() => this.refresh())
          .catch((e) => this.setStatus(errorText(e), RED));
      } catch (e) {
        text(40, 180, W - 80, 120, "build: " + e, { color: RED, wrap: true, size: 22 });
      }
    },

    setStatus(value, color = GRAY) {
      this.status.setProperty(prop.TEXT, value);
      this.status.setProperty(prop.COLOR, color);
    },

    refresh() {
      if (this.kind === "volume") return send(this, PATH.AUDIO_STATUS, { text: STREAMS[this.streamIdx] });
      return send(this, PATH.VALUE_STATUS, { bytes: intBytes(ACTION_VALUE.BRIGHTNESS) });
    },

    step(dir) {
      const v = this.value;
      if (!v) return;
      const unit = this.kind === "volume" ? 1 : Math.max(1, Math.round((v.max - v.min) / 10));
      const next = Math.min(v.max, Math.max(v.min, v.cur + dir * unit));
      if (next === v.cur) return;
      v.cur = next;
      this.render();

      const job =
        this.kind === "volume"
          ? sendJson(this, PATH.AUDIO_VOLUME, {
              currentVolume: next, minVolume: v.min, maxVolume: v.max, streamType: STREAMS[this.streamIdx].toLowerCase(),
            })
          : sendJson(this, PATH.VALUE_SET, {
              currentValue: next, minValue: v.min, maxValue: v.max, actionType: "brightness",
            });
      job.catch((e) => this.setStatus(errorText(e), RED));
    },

    mode() {
      if (this.kind === "volume") {
        this.streamIdx = (this.streamIdx + 1) % STREAMS.length;
        this.value = null;
        this.render();
        this.renderMode();
        this.refresh().catch((e) => this.setStatus(errorText(e), RED));
      } else {
        send(this, PATH.BRIGHTNESS_MODE).catch((e) => this.setStatus(errorText(e), RED));
      }
    },

    renderMode() {
      if (this.kind === "volume") {
        this.modeBtn.setLabel(STREAM_LABEL[STREAMS[this.streamIdx]]);
      } else {
        this.modeBtn.setLabel(this.auto ? "Авто: вкл" : "Авто: выкл");
        this.modeBtn.setColor(this.auto ? TILE_ON : 0x262626);
      }
    },

    render() {
      const v = this.value;
      if (!v) {
        this.valueText.setProperty(prop.TEXT, "—");
        this.arc.setProperty(prop.MORE, {
          x: px(C - R), y: px(C - R), w: px(R * 2), h: px(R * 2),
          start_angle: 135, end_angle: 135, color: MINT, line_width: px(ARC_W),
        });
        return;
      }
      const frac = v.max > v.min ? (v.cur - v.min) / (v.max - v.min) : 0;
      const shown = this.kind === "volume" ? String(v.cur) : Math.round(frac * 100) + "%";
      this.valueText.setProperty(prop.TEXT, shown);
      this.arc.setProperty(prop.MORE, {
        x: px(C - R), y: px(C - R), w: px(R * 2), h: px(R * 2),
        start_angle: 135, end_angle: 135 + Math.round(270 * frac), color: MINT, line_width: px(ARC_W),
      });
    },

    onCall(data) {
      dispatch(data, {
        onLink: (l) => {
          if (!l.ok) this.setStatus(errorText(l.error), RED);
        },
        [PATH.AUDIO_STATUS]: (m, s) => {
          if (this.kind !== "volume" || !s || String(s.streamType).toUpperCase() !== STREAMS[this.streamIdx]) return;
          this.value = { cur: s.currentVolume, min: s.minVolume, max: s.maxVolume };
          this.setStatus("");
          this.render();
        },
        [PATH.AUDIO_VOLUME]: (m) => this.setStatus("Не получилось: " + (m.text || ""), RED),
        [PATH.VALUE_STATUS]: (m, s) => {
          if (this.kind !== "brightness" || !s) return;
          this.value = { cur: s.currentValue, min: s.minValue, max: s.maxValue };
          this.setStatus("");
          this.render();
        },
        [PATH.VALUE_SET]: (m) => this.setStatus("Не получилось: " + (m.text || ""), RED),
        [PATH.BRIGHTNESS_MODE]: (m) => {
          this.auto = !!(m.bytes && m.bytes[0]);
          this.renderMode();
        },
      });
    },
  })
);
