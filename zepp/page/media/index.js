import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop, event, align, getTextLayout } from "@zos/ui";
import { px } from "@zos/utils";
import { push } from "@zos/router";
import { Time } from "@zos/sensor";
import { localStorage } from "@zos/storage";
import {
  setScrollMode,
  swipeToIndex,
  SCROLL_MODE_SWIPER,
  SCROLL_ANIMATION_NONE,
  SCROLL_ANIMATION_SMOOTH,
} from "@zos/page";
import { setPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff, resetPalmScreenOff } from "@zos/display";
import {
  onKey,
  offKey,
  onGesture,
  offGesture,
  onWristMotion,
  WRIST_MOTION_LIFT,
  KEY_SELECT,
  KEY_UP,
  KEY_DOWN,
  KEY_EVENT_CLICK,
  KEY_EVENT_LONG_PRESS,
  GESTURE_UP,
} from "@zos/interaction";
import { W, DARK, RED, text, setText, iconButton, errorText, ignorePalm } from "../../shared/ui";
import { ensureFileReceiver } from "../../shared/files";
import { rightHandMode } from "../../shared/config";
import { getAccent, saveAccent } from "../../shared/accent";
import { MEDIA, AUTOLAUNCH, toPlayer, findLike } from "../../shared/media";
import { send, subscribe, dispatch, keepAlive } from "../../shared/link";

// Media control, ported from Spotify Remote's control page: screensaver (cover + clock)
// above the controls screen. The phone (SimpleWear's MediaControllerService) pushes every
// change, so there is no polling; the ring is extrapolated from the last update.

// onWristMotion event types
const WRIST_PALM = 0;
const WRIST_EVENT = 3;

// Screen stays on while playing; on pause it times out after this
const PAUSED_SCREEN_MS = 3 * 60 * 1000;
const MAX_BRIGHT_MS = 2147483000;
// Screensaver taps: one = play/pause, two = prev (left half) / next (right half)
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 24; // finger movement that still counts as a tap, not a swipe
// Page dots on the screensaver fade out after this
const SAVER_DOTS_MS = 2000;
// Screensaver text: no marquee, no ellipsis; long lines run off the right edge into the vignette
const SAVER_TEXT_X = 50;
const SAVER_TITLE_SIZE = 42;
const SAVER_ARTIST_SIZE = 30;

// Vertical screens: 0 = screensaver, 1 = controls; swiping up from controls opens the player actions
const SAVER = 0;
const CONTROLS = 1;

// Progress ring around the play button (relative to the controls screen)
const RING_CX = 240;
const RING_CY = 240;
const RING_R = 69;
const RING_LINE = 9;
// ARC strokes inside its box, so the middle of the line is half a width in
const KNOB_R = RING_R - RING_LINE / 2;

// Bottom row: like and players mirrored around the center at the same height, queue below
const BOTTOM_DX = 122;
const BOTTOM_Y = 362;
const QUEUE_Y = 399;
// "Liked": a disk in the accent color under a dark check (icons can't be tinted)
const LIKED_R = 26;

const ICON = (name) => "media/" + name + ".png";

// Screensaver text on bright covers: TEXT has no shadow, so a dark copy
// shifted down-right is drawn under the main text
const SHADOW_DX = 2;
const SHADOW_DY = 2;
const SHADOW_COLOR = 0x202020;

function shadowedText(x, y, w, h, value, opts) {
  const shadow = text(x + SHADOW_DX, y + SHADOW_DY, w, h, value, { ...opts, color: SHADOW_COLOR });
  return { main: text(x, y, w, h, value, opts), shadow };
}

function setShadowedText(o, value) {
  setText(o.shadow, value);
  setText(o.main, value);
}

// Centered if it fits; otherwise left-aligned and as wide as the text itself,
// so nothing is cut with "..." and the tail goes past the screen edge
function setSaverText(o, value, size, y, h) {
  const avail = px(W - 2 * SAVER_TEXT_X);
  let width = 0;
  try {
    width = value ? getTextLayout(value, { text_size: px(size), text_width: 0, wrapped: 0 }).width : 0;
  } catch (e) {
    width = 0;
  }
  const fits = width <= avail;
  const place = (widgetRef, dx, dy) =>
    widgetRef.setProperty(prop.MORE, {
      x: px(SAVER_TEXT_X + dx),
      y: px(y + dy),
      w: fits ? avail : width + px(16),
      h: px(h),
      text: value,
      align_h: fits ? align.CENTER_H : align.LEFT,
    });
  place(o.shadow, SHADOW_DX, SHADOW_DY);
  place(o.main, 0, 0);
}

function loadCachedPlayer() {
  try {
    return JSON.parse(localStorage.getItem("mediaState", "null"));
  } catch (e) {
    return null;
  }
}

Page(
  BasePage({
    state: {
      player: null,
      lastSync: 0,
      timers: [],
      screenIndex: CONTROLS,
      keepAwake: null,
    },

    build() {
      ignorePalm();
      this.accent = getAccent();
      this.like = null;

      setScrollMode({
        mode: SCROLL_MODE_SWIPER,
        options: {
          height: px(W),
          count: 2,
          modeParams: {
            on_page: (index) => this.onScreen(index),
          },
        },
      });

      this.covers = [];
      this.shown = {};
      this.coverSrc = localStorage.getItem("coverPath", "") || "";
      this.buildSaver(SAVER * W);
      this.buildControls(CONTROLS * W);

      this.time = new Time();
      this.updateClock();
      this.time.onPerMinute(() => this.updateClock());

      swipeToIndex({ index: CONTROLS, animation: SCROLL_ANIMATION_NONE });

      const cached = loadCachedPlayer();
      if (cached) this.render(cached, true);
      this.applyScreenPolicy(!!(this.state.player && this.state.player.playing));

      this.bindInput();
      ensureFileReceiver();
      getApp().globalData.onCover = (path) => this.setCover(path);

      this.stopKeepAlive = keepAlive(this);
      // The dashboard detaches the phone from the player when we get back there
      // (this page is destroyed when queue / players / actions open on top of it)
      getApp().globalData.mediaActive = true;
      this.connect();
      this.state.timers.push(setInterval(() => this.tick(), 1000));
    },

    // Ask SimpleWear to attach to the playing app, then for everything it knows
    connect() {
      subscribe(this)
        .then(() =>
          this.request({ method: "media_cover", params: { have: localStorage.getItem("coverId", "") } }, { timeout: 8000 })
        )
        .then(() => send(this, MEDIA.CONNECT, { bytes: AUTOLAUNCH }))
        .then(() => send(this, MEDIA.STATE))
        .then(() => send(this, MEDIA.APP_INFO))
        .then(() => send(this, MEDIA.ACTIONS))
        .catch((e) => this.showError(errorText(e)));
    },

    background(top, overlay) {
      createWidget(widget.FILL_RECT, { x: 0, y: px(top), w: px(W), h: px(W), color: DARK });
      this.covers.push(
        createWidget(widget.IMG, {
          x: 0,
          y: px(top),
          w: px(W),
          h: px(W),
          auto_scale: true,
          src: this.coverSrc,
        })
      );
      // Topmost full-screen widget; the screensaver uses it as its tap surface
      this.lastWidget = createWidget(widget.IMG, { x: 0, y: px(top), w: px(W), h: px(W), auto_scale: true, src: overlay });
    },

    pageDots(top, active) {
      return [213, 240, 267].map((y, i) =>
        createWidget(widget.CIRCLE, {
          center_x: px(459),
          center_y: px(top + y),
          radius: px(5),
          color: i === active ? 0xffffff : 0x666666,
        })
      );
    },

    // Called whenever the visible screen changes (swipe or Select)
    onScreen(index) {
      const changed = this.state.screenIndex !== index;
      this.state.screenIndex = index;
      // on_page may fire before build() has created the widgets
      if (changed && this.progressArc && index === CONTROLS) this.updateProgress();
      if (this.dotsTimer) clearTimeout(this.dotsTimer);
      this.dotsTimer = null;
      if (index !== SAVER || !this.saverDots) return;

      this.saverDots.forEach((d) => d.setProperty(prop.VISIBLE, true));
      this.dotsTimer = setTimeout(() => {
        this.dotsTimer = null;
        this.saverDots.forEach((d) => d.setProperty(prop.VISIBLE, false));
      }, SAVER_DOTS_MS);
    },

    buildSaver(top) {
      this.background(top, ICON("vignette_light"));
      const tapLayer = this.lastWidget;
      this.saverClock = shadowedText(170, top + 10, 140, 40, "", { size: 32, color: this.accent });
      this.saverTitle = shadowedText(SAVER_TEXT_X, top + 342, W - 2 * SAVER_TEXT_X, 60, "", { size: SAVER_TITLE_SIZE });
      this.saverArtist = shadowedText(SAVER_TEXT_X, top + 404, W - 2 * SAVER_TEXT_X, 44, "", {
        size: SAVER_ARTIST_SIZE,
        color: this.accent,
      });
      this.saverDots = this.pageDots(top, 0);

      // Brief icon in the center confirming what a tap did
      this.flashBg = createWidget(widget.CIRCLE, {
        center_x: px(240),
        center_y: px(top + 220),
        radius: px(64),
        color: 0x000000,
        alpha: 80,
      });
      this.flashImg = createWidget(widget.IMG, {
        x: px(240 - 44),
        y: px(top + 220 - 44),
        w: px(88),
        h: px(88),
        src: ICON("play"),
      });
      this.hideFlash();

      [tapLayer, this.saverClock.main, this.saverTitle.main, this.saverArtist.main].forEach((w) => {
        w.addEventListener(event.CLICK_DOWN, (e) => {
          this.tapDown = { x: e.x, y: e.y };
        });
        w.addEventListener(event.CLICK_UP, (e) => this.onSaverTap(e));
      });
    },

    onSaverTap(e) {
      const down = this.tapDown;
      this.tapDown = null;
      // Ignore swipes between screens
      if (down && (Math.abs(e.x - down.x) > px(TAP_SLOP) || Math.abs(e.y - down.y) > px(TAP_SLOP))) return;

      if (this.tapTimer) {
        clearTimeout(this.tapTimer);
        this.tapTimer = null;
        const forward = e.x >= px(W) / 2;
        this.flash(ICON(forward ? "next" : "prev"));
        this.command(forward ? MEDIA.NEXT : MEDIA.PREV);
        return;
      }

      this.tapTimer = setTimeout(() => {
        this.tapTimer = null;
        const s = this.state.player;
        this.flash(ICON(s && s.playing ? "pause" : "play"));
        this.togglePlay();
      }, DOUBLE_TAP_MS);
    },

    flash(src) {
      this.flashImg.setProperty(prop.SRC, src);
      this.flashBg.setProperty(prop.VISIBLE, true);
      this.flashImg.setProperty(prop.VISIBLE, true);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => this.hideFlash(), 700);
    },

    // After a flash: keep a pause icon while paused, otherwise hide
    hideFlash() {
      this.flashTimer = null;
      const s = this.state.player;
      const paused = !!(s && s.active && s.title && !s.playing);
      if (paused) this.flashImg.setProperty(prop.SRC, ICON("pause"));
      this.flashBg.setProperty(prop.VISIBLE, paused);
      this.flashImg.setProperty(prop.VISIBLE, paused);
    },

    buildControls(top) {
      this.background(top, ICON("vignette"));

      this.clock = text(180, top + 16, 120, 34, "", { size: 24 });
      this.titleText = text(64, top + 54, W - 128, 52, "", { size: 40, marquee: true });
      // shadow as on the screensaver: the accent may be light, the cover behind it too
      this.artist = shadowedText(90, top + 108, W - 180, 40, "Подключение…", { size: 30, color: this.accent });

      // Progress ring: track, value arc, knob
      this.ringTop = top;
      this.ringOpts = {
        x: px(RING_CX - RING_R),
        y: px(top + RING_CY - RING_R),
        w: px(RING_R * 2),
        h: px(RING_R * 2),
        line_width: px(RING_LINE),
        start_angle: -90,
      };
      createWidget(widget.ARC, { ...this.ringOpts, end_angle: 270, color: 0x8a8a8a });
      this.progressArc = createWidget(widget.ARC, { ...this.ringOpts, end_angle: -90, color: this.accent });
      this.knob = createWidget(widget.CIRCLE, {
        center_x: px(RING_CX),
        center_y: px(top + RING_CY - KNOB_R),
        radius: px(9),
        color: 0xffffff,
      });

      iconButton(86, top + 240, 120, 84, ICON("prev"), () => this.command(MEDIA.PREV));
      this.playBtn = iconButton(240, top + 240, 124, 88, ICON("play"), () => this.togglePlay());
      iconButton(394, top + 240, 120, 84, ICON("next"), () => this.command(MEDIA.NEXT));

      // Bottom row: like, queue, players
      const likeX = 240 - BOTTOM_DX;
      this.likedDisk = createWidget(widget.CIRCLE, {
        center_x: px(likeX),
        center_y: px(top + BOTTOM_Y),
        radius: px(LIKED_R),
        color: this.accent,
      });
      this.likeBtn = iconButton(likeX, top + BOTTOM_Y, 96, 64, ICON("like_add"), () => this.toggleLike());
      iconButton(240, top + QUEUE_Y, 90, 54, ICON("queue"), () => push({ url: "page/mqueue/index" }));
      iconButton(240 + BOTTOM_DX, top + BOTTOM_Y, 96, 64, ICON("player"), () => push({ url: "page/players/index" }));
      this.renderLike();

      this.pageDots(top, 1);
    },

    // Only one key/gesture listener exists system-wide, so rebind when we come back
    bindInput() {
      ignorePalm();
      onKey({
        callback: (key, keyEvent) => (rightHandMode ? this.onKeyRightHand(key, keyEvent) : this.onKeyDefault(key, keyEvent)),
      });
      onGesture({
        callback: (gesture) => {
          if (gesture !== GESTURE_UP || this.state.screenIndex !== CONTROLS) return false;
          push({ url: "page/mactions/index" });
          return true;
        },
      });
      // There is no offWristMotion: the listener stays after this page is gone
      onWristMotion({
        callback: (r) => {
          try {
            this.onWristMotion(r);
          } catch (e) {
            console.log("wrist motion handler failed", e);
          }
        },
      });
    },

    // Palm over the screen = pause (never resumes); raising the wrist = fresh state now
    onWristMotion({ type, motion }) {
      if (type === WRIST_PALM) this.pause();
      else if (type === WRIST_EVENT && motion === WRIST_MOTION_LIFT) send(this, MEDIA.STATE).catch(() => {});
    },

    // Select: click = play/pause, long press = next track
    onKeyDefault(key, keyEvent) {
      if (key !== KEY_SELECT) return false;
      if (keyEvent === KEY_EVENT_CLICK) this.togglePlay();
      else if (keyEvent === KEY_EVENT_LONG_PRESS) this.command(MEDIA.NEXT);
      return true;
    },

    // Up = play/pause, Down = next (hold = previous track), Select = switch screen
    onKeyRightHand(key, keyEvent) {
      if (key === KEY_UP) {
        if (keyEvent === KEY_EVENT_CLICK) this.togglePlay();
        return true;
      }
      if (key === KEY_DOWN) {
        if (keyEvent === KEY_EVENT_CLICK) this.command(MEDIA.NEXT);
        else if (keyEvent === KEY_EVENT_LONG_PRESS) this.command(MEDIA.PREV);
        return keyEvent === KEY_EVENT_CLICK || keyEvent === KEY_EVENT_LONG_PRESS;
      }
      if (key === KEY_SELECT) {
        if (keyEvent === KEY_EVENT_CLICK) {
          const index = this.state.screenIndex === CONTROLS ? SAVER : CONTROLS;
          swipeToIndex({ index, animation: SCROLL_ANIMATION_SMOOTH });
          this.onScreen(index);
        }
        return true;
      }
      return false;
    },

    onResume() {
      this.bindInput();
      ensureFileReceiver();
      getApp().globalData.onCover = (path) => this.setCover(path);
      // Other pages reset the page bright time, so apply it again
      const s = this.state.player;
      this.state.keepAwake = null;
      this.applyScreenPolicy(!!(s && s.playing));
      // A player may have been picked on the players page
      send(this, MEDIA.STATE)
        .then(() => send(this, MEDIA.APP_INFO))
        .then(() => send(this, MEDIA.ACTIONS))
        .catch(() => {});
    },

    applyScreenPolicy(playing) {
      if (this.state.keepAwake === playing) return;
      this.state.keepAwake = playing;
      // Wrist gestures never turn the screen off here; only the timeout does
      // (endless while playing, 3 minutes when paused)
      if (playing) {
        setPageBrightTime({ brightTime: MAX_BRIGHT_MS });
        pauseDropWristScreenOff({ duration: 0 });
      } else {
        setPageBrightTime({ brightTime: PAUSED_SCREEN_MS });
        pauseDropWristScreenOff({ duration: PAUSED_SCREEN_MS });
      }
    },

    updateClock() {
      const h = String(this.time.getHours()).padStart(2, "0");
      const m = String(this.time.getMinutes()).padStart(2, "0");
      setText(this.clock, `${h}:${m}`);
      setShadowedText(this.saverClock, `${h}:${m}`);
    },

    setCover(src) {
      if (src === this.coverSrc) return;
      this.coverSrc = src;
      this.covers.forEach((c) => c.setProperty(prop.SRC, src));
    },

    // Player app color: ring, artist, screensaver clock, the "liked" disk
    setAccent(color) {
      if (color === this.accent) return;
      this.accent = color;
      this.artist.main.setProperty(prop.COLOR, color);
      this.saverClock.main.setProperty(prop.COLOR, color);
      this.saverArtist.main.setProperty(prop.COLOR, color);
      this.likedDisk.setProperty(prop.MORE, {
        center_x: px(240 - BOTTOM_DX),
        center_y: px(this.ringTop + BOTTOM_Y),
        radius: px(LIKED_R),
        color,
      });
      this.updateProgress();
    },

    onCall(data) {
      dispatch(data, {
        onLink: (l) => {
          if (!l.ok) this.showError(errorText(l.error));
        },
        [MEDIA.STATE]: (m, json) => {
          if (!json) return;
          const s = toPlayer(json);
          this.render(s);
          localStorage.setItem("mediaState", JSON.stringify(s));
        },
        [MEDIA.APP_INFO]: (m, info) => {
          if (saveAccent(info)) this.setAccent(getAccent());
        },
        [MEDIA.ACTIONS]: (m, actions) => {
          this.like = findLike(actions);
          this.renderLike();
        },
        [MEDIA.CONNECT]: (m) => {
          if (m.text === "PERMISSION_DENIED") this.showError("Нет доступа к уведомлениям на телефоне");
        },
      });
    },

    // Updates a widget only when its value changed
    apply(key, value, fn) {
      if (this.shown[key] === value) return;
      this.shown[key] = value;
      fn(value);
    },

    render(s, fromCache = false) {
      this.state.player = s;
      this.state.lastSync = Date.now();

      const hasTrack = s.active && s.title;
      const title = hasTrack ? s.title : "";
      const artist = hasTrack ? s.artist || "" : fromCache ? "Подключение…" : "Ничего не играет";
      const saverArtist = hasTrack ? s.artist || "" : "";
      this.apply("title", title, (v) => setText(this.titleText, v));
      // Measuring text is the expensive part: only when the track changes
      this.apply("saverTitle", title, (v) => setSaverText(this.saverTitle, v, SAVER_TITLE_SIZE, SAVER * W + 342, 60));
      this.apply("artist", artist, (v) => setShadowedText(this.artist, v));
      this.apply("saverArtist", saverArtist, (v) =>
        setSaverText(this.saverArtist, v, SAVER_ARTIST_SIZE, SAVER * W + 404, 44)
      );

      this.apply("play", ICON(s.playing ? "pause" : "play"), (v) => this.playBtn.setProperty(prop.SRC, v));
      this.updateProgress();
      if (!fromCache) this.applyScreenPolicy(!!s.playing);
      if (!this.flashTimer) this.hideFlash();
    },

    // No like action (player without one): hide the button
    renderLike() {
      const like = this.like;
      this.likeBtn.setProperty(prop.VISIBLE, !!like);
      this.likedDisk.setProperty(prop.VISIBLE, !!(like && like.liked));
      if (like) this.likeBtn.setProperty(prop.SRC, ICON(like.liked ? "like_check" : "like_add"));
    },

    // The ring lives on the controls screen; don't redraw it while the screensaver is up
    tick() {
      const s = this.state.player;
      if (s && s.playing && this.state.screenIndex === CONTROLS) this.updateProgress();
    },

    updateProgress() {
      const s = this.state.player;
      let pct = 0;
      if (s && s.duration) {
        const elapsed = s.playing ? Date.now() - this.state.lastSync : 0;
        pct = Math.min(1, (s.progress + elapsed) / s.duration);
      }

      const angle = -90 + 360 * pct;
      this.progressArc.setProperty(prop.MORE, { ...this.ringOpts, end_angle: angle, color: this.accent });

      const rad = (angle * Math.PI) / 180;
      this.knob.setProperty(prop.MORE, {
        center_x: px(RING_CX + KNOB_R * Math.cos(rad)),
        center_y: px(this.ringTop + RING_CY + KNOB_R * Math.sin(rad)),
        radius: px(9),
        color: 0xffffff,
      });
    },

    showError(message) {
      setShadowedText(this.artist, message);
      this.artist.main.setProperty(prop.COLOR, RED);
      this.shown.artist = null; // the next render must restore the artist line
      setTimeout(() => this.artist.main.setProperty(prop.COLOR, this.accent), 4000);
    },

    pause() {
      const s = this.state.player;
      if (!s || !s.playing) return;
      this.optimistic({ playing: false });
      this.command(MEDIA.PAUSE);
    },

    togglePlay() {
      const s = this.state.player;
      const playing = !!(s && s.playing);
      this.optimistic({ playing: !playing });
      this.command(playing ? MEDIA.PAUSE : MEDIA.PLAY);
    },

    // Show the expected state right away; the phone's next update corrects it if needed
    optimistic(patch) {
      const s = this.state.player;
      if (!s) return;
      const elapsed = s.playing ? Date.now() - this.state.lastSync : 0;
      this.render({ ...s, progress: s.progress + elapsed, ...patch });
    },

    toggleLike() {
      const like = this.like;
      if (!like) return;
      this.like = { ...like, liked: !like.liked };
      this.renderLike();
      // the phone sends the updated actions (and so the real state) afterwards
      send(this, MEDIA.ACTIONS_CLICK, { text: like.id })
        .then(() => setTimeout(() => send(this, MEDIA.ACTIONS).catch(() => {}), 600))
        .catch((e) => this.showError(errorText(e)));
    },

    command(path) {
      send(this, path).catch((e) => this.showError(errorText(e)));
    },

    onDestroy() {
      this.state.timers.forEach((t) => clearInterval(t));
      if (this.tapTimer) clearTimeout(this.tapTimer);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      if (this.dotsTimer) clearTimeout(this.dotsTimer);
      if (this.stopKeepAlive) this.stopKeepAlive();
      getApp().globalData.onCover = null;
      try {
        offKey();
        offGesture();
        resetDropWristScreenOff();
        resetPalmScreenOff();
      } catch (e) {}
    },
  })
);
