import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop, align, text_style } from "@zos/ui";
import { px } from "@zos/utils";
import { back, push } from "@zos/router";
import { onKey, offKey, KEY_UP, KEY_DOWN, KEY_EVENT_CLICK } from "@zos/interaction";
import { W, GRAY, RED, DARK, text, setText, onTap, errorText, ignorePalm } from "../../shared/ui";
import { getAccent } from "../../shared/accent";
import { PATH } from "../../shared/protocol";
import { MEDIA } from "../../shared/media";
import { getMediaApp, saveMediaApp, getAppIcons } from "../../shared/players";
import { send, sendJson, subscribe, dispatch, keepAlive } from "../../shared/link";
import { ensureFileReceiver } from "../../shared/files";

// Player screen, after Spotify Remote's devices page: two cards in a row (the app being
// controlled, the list of music apps) and the media volume pill. Up/Down change the volume.

const LABEL = 0x8a8a8a;
const PILL = 0x2a2a2a;
const LABEL_Y = 100;
const CARDS_Y = 140;
const VOLUME_Y = 324;
const CARD_W = 136;
const CARD_H = 148;
const CARD_GAP = 14;
const CARD_ICON = 64;
const FALLBACK_ICON = "media/player.png";

// Active card: the accent dimmed towards the background, as Spotify Remote's dark green
function dimmed(color) {
  const mix = (shift) => Math.round(((color >> shift) & 0xff) * 0.38 + ((DARK >> shift) & 0xff) * 0.62);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

Page(
  BasePage({
    build() {
      ignorePalm();
      ensureFileReceiver();
      this.accent = getAccent();
      this.app = getMediaApp();
      this.volume = null; // { cur, min, max } once the phone answers

      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      this.label = text(140, LABEL_Y - 30, 200, 30, "ПЛЕЕР", { size: 18, color: LABEL });

      const left = (W - 2 * CARD_W - CARD_GAP) / 2;
      this.appCard = this.card(left, this.app ? this.app.label : "Плеер", this.iconFor(this.app), true, () => back());
      this.card(left + CARD_W + CARD_GAP, "Приложения", "icons/apps.png", false, () => push({ url: "page/plist/index" }));

      this.buildVolume();
      this.bindKeys();

      getApp().globalData.onAppIcon = (pkg, path) => {
        if (this.app && this.app.pkg === pkg) this.setAppIcon(path);
      };

      this.stopKeepAlive = keepAlive(this);
      subscribe(this)
        .then(() => send(this, MEDIA.APP_INFO))
        .then(() => send(this, PATH.AUDIO_STATUS, { text: "MUSIC" }))
        .catch((e) => this.showError(errorText(e)));
    },

    iconFor(app) {
      return (app && getAppIcons()[app.pkg]) || FALLBACK_ICON;
    },

    // Card: button background, icon and a two-line label on top (they forward taps)
    card(x, label, icon, active, onClick) {
      const bg = createWidget(widget.BUTTON, {
        x: px(x),
        y: px(CARDS_Y),
        w: px(CARD_W),
        h: px(CARD_H),
        radius: px(20),
        normal_color: active ? dimmed(this.accent) : PILL,
        press_color: 0x3a3a3a,
        text: "",
        click_func: onClick,
      });
      const iconGeom = { x: px(x + (CARD_W - CARD_ICON) / 2), y: px(CARDS_Y + 18), w: px(CARD_ICON), h: px(CARD_ICON) };
      const img = createWidget(widget.IMG, { ...iconGeom, auto_scale: true, src: icon });
      const caption = createWidget(widget.TEXT, {
        x: px(x + 6),
        y: px(CARDS_Y + 88),
        w: px(CARD_W - 12),
        h: px(54),
        text: label,
        text_size: px(17),
        color: 0xffffff,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
        text_style: text_style.WRAP,
      });
      onTap(img, onClick);
      onTap(caption, onClick);
      return { bg, img, caption, iconGeom };
    },

    setAppIcon(path) {
      const c = this.appCard;
      c.img.setProperty(prop.MORE, { ...c.iconGeom, auto_scale: true, src: path });
    },

    // --- volume pill: − N% + ; tapping the value opens the full volume screen ---

    buildVolume() {
      const y = VOLUME_Y;
      createWidget(widget.FILL_RECT, { x: px(104), y: px(y), w: px(272), h: px(58), radius: px(29), color: PILL });
      const minus = text(110, y, 64, 58, "−", { size: 36 });
      const plus = text(306, y, 64, 58, "+", { size: 36 });
      this.valueText = text(174, y, 132, 58, "…", { size: 28 });
      onTap(minus, () => this.changeVolume(-1));
      onTap(plus, () => this.changeVolume(1));
      onTap(this.valueText, () => push({ url: "page/value/index", params: JSON.stringify({ kind: "volume" }) }));
      this.status = text(80, y + 70, W - 160, 30, "", { size: 17, color: RED });
    },

    renderVolume() {
      const v = this.volume;
      if (!v) return;
      const pct = v.max > v.min ? Math.round(((v.cur - v.min) * 100) / (v.max - v.min)) : 0;
      setText(this.valueText, pct + "%");
    },

    // The phone's media stream has few steps (15 on most phones): one press = one step
    changeVolume(dir) {
      const v = this.volume;
      if (!v) return;
      const next = Math.min(v.max, Math.max(v.min, v.cur + dir));
      if (next === v.cur) return;
      v.cur = next;
      this.renderVolume();
      sendJson(this, PATH.AUDIO_VOLUME, { currentVolume: next, minVolume: v.min, maxVolume: v.max, streamType: "music" }).catch(
        (e) => this.showError(errorText(e))
      );
    },

    bindKeys() {
      onKey({
        callback: (key, keyEvent) => {
          if (key !== KEY_UP && key !== KEY_DOWN) return false;
          if (keyEvent === KEY_EVENT_CLICK) this.changeVolume(key === KEY_UP ? 1 : -1);
          return true;
        },
      });
    },

    showError(message) {
      setText(this.status, message);
    },

    onCall(data) {
      dispatch(data, {
        onLink: (l) => {
          if (!l.ok) this.showError(errorText(l.error));
        },
        [MEDIA.APP_INFO]: (m, info) => {
          if (!info || !info.key_package_name) return;
          saveMediaApp(info);
          this.app = getMediaApp();
          setText(this.appCard.caption, this.app.label);
          const icon = getAppIcons()[this.app.pkg];
          if (icon) this.setAppIcon(icon);
          // ask the phone for the icon file unless the watch has it already
          this.request({ method: "app_icon", params: { pkg: this.app.pkg, have: !!icon } }, { timeout: 8000 }).catch(
            () => {}
          );
        },
        [PATH.AUDIO_STATUS]: (m, s) => {
          if (!s || String(s.streamType).toUpperCase() !== "MUSIC") return;
          this.volume = { cur: s.currentVolume, min: s.minVolume, max: s.maxVolume };
          this.renderVolume();
        },
      });
    },

    // Back from the app list or the volume screen: keys, the current app and the volume may have changed
    onResume() {
      this.bindKeys();
      ensureFileReceiver();
      send(this, MEDIA.APP_INFO)
        .then(() => send(this, PATH.AUDIO_STATUS, { text: "MUSIC" }))
        .catch(() => {});
    },

    onDestroy() {
      if (this.stopKeepAlive) this.stopKeepAlive();
      getApp().globalData.onAppIcon = null;
      try {
        offKey();
      } catch (e) {}
    },
  })
);
