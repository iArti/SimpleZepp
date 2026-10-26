import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop, event, getTextLayout } from "@zos/ui";
import { px } from "@zos/utils";
import { back } from "@zos/router";
import {
  showToast,
  onKey,
  offKey,
  onGesture,
  offGesture,
  KEY_UP,
  KEY_DOWN,
  KEY_SELECT,
  KEY_EVENT_CLICK,
  KEY_EVENT_LONG_PRESS,
  GESTURE_UP,
  GESTURE_DOWN,
} from "@zos/interaction";
import { W, DARK, text, setText, errorText, ignorePalm } from "../../shared/ui";
import { getAccent } from "../../shared/accent";
import { MEDIA } from "../../shared/media";
import { send, subscribe, dispatch, keepAlive } from "../../shared/link";

// Ported from Spotify Remote. The player's queue (media session queue) as a wheel: the
// focused track large in the middle, two neighbours above and below, smaller and dimmer
// towards the edge. Accent = the player app's color.
// Up/Down move by one track, dragging turns the wheel under the finger (with a
// fling at the end); Select, holding Down or a tap on the middle plays it; a
// tap on a neighbour focuses it.

const LABEL = 0x8a8a8a;
const PILL = 0x1f1f1f;
const FOCUS_LINE = 3;
const EQ_GAP = 10; // between the "playing" bars and the title

// One slot per offset from the focus: title (and artist) text boxes
const SLOTS = [
  { offset: -2, x: 90, w: 300, y: 92, h: 32, size: 19, color: 0x555555 },
  { offset: -1, x: 60, w: 360, y: 136, h: 36, size: 24, color: 0x9a9a9a, sub: { y: 170, h: 26, size: 17, color: 0x6a6a6a } },
  { offset: 0, x: 66, w: 348, y: 210, h: 46, size: 34, color: 0xffffff, sub: { y: 254, h: 34, size: 24, color: 0 } },
  { offset: 1, x: 60, w: 360, y: 310, h: 36, size: 24, color: 0x9a9a9a, sub: { y: 344, h: 26, size: 17, color: 0x6a6a6a } },
  { offset: 2, x: 90, w: 300, y: 388, h: 32, size: 19, color: 0x555555 },
];

// Touch: finger travel per track, tap tolerance, fling
const DRAG_STEP = 52;
const TAP_SLOP = 16;
const FLING_SAMPLE_MS = 120; // velocity is measured over the last part of the drag
const FLING_MIN_SPEED = 0.5; // design px per ms
const FLING_STEPS_PER_SPEED = 6;
const FLING_MAX_STEPS = 20;
const FLING_FIRST_MS = 30;
const FLING_SLOWDOWN = 1.25; // each next step waits this much longer

// Tap zones (design y) between the slots
const ZONE_EDGES = [128, 204, 298, 382];

// Position indicator along the right edge
const ARC_BOX = { x: 14, y: 14, w: 452, h: 452 };
const ARC_FROM = -40;
const ARC_TO = 40;
const ARC_LINE = 5;
const ARC_MIN_THUMB = 8; // degrees

Page(
  BasePage({
    build() {
      ignorePalm();
      this.accent = getAccent();
      SLOTS[2].sub.color = this.accent;
      this.touch(createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK }));
      this.touch(text(90, 40, W - 180, 26, "ОЧЕРЕДЬ", { size: 15, color: LABEL }));

      this.items = [];
      this.focus = 0;
      this.buildWheel();
      this.bindInput();

      this.stopKeepAlive = keepAlive(this);
      this.showStatus("Загрузка…");
      subscribe(this)
        .then(() => send(this, MEDIA.QUEUE))
        .catch((e) => this.showStatus(errorText(e)));
    },

    onCall(data) {
      dispatch(data, {
        onLink: (l) => {
          if (!l.ok && !this.items.length) this.showStatus(errorText(l.error));
        },
        [MEDIA.QUEUE]: (m, q) => this.loadQueue(q),
      });
    },

    // --- data: items are { name, sub, playing, onClick } ---

    // QueueItems: { activeQueueItemId, queueItems: [{ queueId, title, subTitle }] }
    loadQueue(q) {
      const list = (q && q.queueItems) || [];
      const active = q ? q.activeQueueItemId : -1;
      // the phone re-sends the queue on every change: keep the user's place
      const keepFocus = this.items.length > 0;
      const items = list.map((item) => ({
        name: item.title,
        sub: item.subTitle || "",
        playing: item.queueId === active,
        onClick: () => this.play(item.queueId),
      }));
      if (!items.length) {
        this.items = [];
        this.showStatus("Очередь пуста или плеер её не показывает");
        return;
      }
      const playing = Math.max(0, items.findIndex((i) => i.playing));
      this.setItems(items, keepFocus ? Math.min(this.focus, items.length - 1) : playing);
    },

    setItems(items, focus) {
      this.items = items;
      this.showStatus("");
      this.setFocus(focus);
    },

    // --- wheel widgets: created once, only their texts change ---

    buildWheel() {
      this.pill = createWidget(widget.STROKE_RECT, {
        x: px(46),
        y: px(204),
        w: px(388),
        h: px(92),
        radius: px(46),
        line_width: px(FOCUS_LINE),
        color: this.accent,
      });
      this.pill.setProperty(prop.VISIBLE, false);
      this.touch(this.pill);

      this.slots = SLOTS.map((slot) => {
        const title = text(slot.x, slot.y, slot.w, slot.h, "", { size: slot.size, color: slot.color });
        const sub = slot.sub ? text(slot.x, slot.sub.y, slot.w, slot.sub.h, "", slot.sub) : null;
        this.touch(title);
        if (sub) this.touch(sub);
        return { ...slot, title, sub: sub && { ...slot.sub, widget: sub } };
      });

      // "Playing" mark: three bars moved next to whichever title is playing
      this.eq = [0, 1, 2].map(() => createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(4), h: px(4), color: this.accent }));
      this.eq.forEach((bar) => bar.setProperty(prop.VISIBLE, false));

      this.status = this.touch(text(70, 200, W - 140, 100, "", { size: 24, color: LABEL, wrap: true }));
      this.counter = this.touch(text(140, 426, 200, 24, "", { size: 16, color: LABEL }));

      this.arcOpts = {
        x: px(ARC_BOX.x),
        y: px(ARC_BOX.y),
        w: px(ARC_BOX.w),
        h: px(ARC_BOX.h),
        line_width: px(ARC_LINE),
      };
      this.arcTrack = createWidget(widget.ARC, { ...this.arcOpts, start_angle: ARC_FROM, end_angle: ARC_TO, color: 0x333333 });
      this.arcThumb = createWidget(widget.ARC, { ...this.arcOpts, start_angle: ARC_FROM, end_angle: ARC_FROM, color: this.accent });
      [...this.eq, this.arcTrack, this.arcThumb].forEach((w) => this.touch(w));
      this.arcTrack.setProperty(prop.VISIBLE, false);
      this.arcThumb.setProperty(prop.VISIBLE, false);
    },

    showStatus(message) {
      setText(this.status, message);
    },

    setFocus(index) {
      const n = this.items.length;
      if (!n) return;
      this.focus = Math.max(0, Math.min(n - 1, index));
      this.pill.setProperty(prop.VISIBLE, true);

      let eqSlot = null;
      this.slots.forEach((slot) => {
        const item = this.items[this.focus + slot.offset];
        setText(slot.title, item ? item.name : "");
        if (slot.sub) setText(slot.sub.widget, item ? item.sub || "" : "");
        const color = item && item.playing ? this.accent : slot.color;
        slot.title.setProperty(prop.COLOR, color);
        if (item && item.playing) eqSlot = slot;
      });
      this.placeEq(eqSlot);

      setText(this.counter, `${this.focus + 1} / ${n}`);
      this.renderArc();
    },

    // Bars to the left of the centered title, bottom-aligned with its text
    placeEq(slot) {
      if (!slot) {
        this.eq.forEach((bar) => bar.setProperty(prop.VISIBLE, false));
        return;
      }
      const item = this.items[this.focus + slot.offset];
      const { width } = getTextLayout(item.name, { text_size: px(slot.size), text_width: 0, wrapped: 0 });
      const textW = Math.min(width, px(slot.w));
      const unit = Math.max(3, Math.round(slot.size / 8)); // bar width scales with the font
      const groupW = unit * 5;
      const left = px(W / 2) - textW / 2 - px(EQ_GAP) - px(groupW);
      const bottom = px(slot.y + slot.h / 2 + slot.size * 0.35);
      [0.6, 1, 0.4].forEach((k, i) => {
        const h = px(Math.round(slot.size * 0.8 * k));
        this.eq[i].setProperty(prop.MORE, { x: Math.round(left + px(unit * 2 * i)), y: bottom - h, w: px(unit), h });
        this.eq[i].setProperty(prop.VISIBLE, true);
      });
    },

    renderArc() {
      const n = this.items.length;
      const show = n > 1;
      this.arcTrack.setProperty(prop.VISIBLE, show);
      this.arcThumb.setProperty(prop.VISIBLE, show);
      if (!show) return;
      const span = ARC_TO - ARC_FROM;
      const thumb = Math.max(ARC_MIN_THUMB, span * Math.min(1, SLOTS.length / n));
      const start = ARC_FROM + ((span - thumb) * this.focus) / (n - 1);
      this.arcThumb.setProperty(prop.MORE, { ...this.arcOpts, start_angle: start, end_angle: start + thumb, color: this.accent });
    },

    // --- input ---

    bindInput() {
      onKey({
        callback: (key, keyEvent) => {
          if (key === KEY_UP || key === KEY_DOWN) {
            if (keyEvent === KEY_EVENT_CLICK) this.setFocus(this.focus + (key === KEY_UP ? -1 : 1));
            else if (key === KEY_DOWN && keyEvent === KEY_EVENT_LONG_PRESS) this.activate();
            return true;
          }
          if (key === KEY_SELECT && keyEvent === KEY_EVENT_CLICK) {
            this.activate();
            return true;
          }
          return false;
        },
      });
      // Vertical swipes are handled by the touch events; keep the system and
      // the previous page's listener away from them
      onGesture({ callback: (gesture) => gesture === GESTURE_UP || gesture === GESTURE_DOWN });
    },

    // Every widget gets the same handlers: the one under the finger at CLICK_DOWN
    // keeps receiving MOVE and CLICK_UP for the whole drag
    touch(w) {
      w.addEventListener(event.CLICK_DOWN, (e) => this.onDown(e));
      w.addEventListener(event.MOVE, (e) => this.onMove(e));
      w.addEventListener(event.CLICK_UP, (e) => this.onUp(e));
      return w;
    },

    onDown(e) {
      this.stopFling();
      const now = Date.now();
      this.drag = { startY: e.y, anchor: this.focus, moved: false, samples: [{ y: e.y, t: now }] };
    },

    onMove(e) {
      const d = this.drag;
      if (!d) return;
      const dy = e.y - d.startY;
      if (Math.abs(dy) > px(TAP_SLOP)) d.moved = true;
      const now = Date.now();
      d.samples.push({ y: e.y, t: now });
      while (d.samples.length > 2 && now - d.samples[0].t > FLING_SAMPLE_MS) d.samples.shift();
      if (!d.moved) return;
      // Finger up = wheel up = next track
      const target = d.anchor - Math.round(dy / px(DRAG_STEP));
      if (target !== this.focus) this.setFocus(target);
    },

    onUp(e) {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (!d.moved) {
        this.tapAt(e.y);
        return;
      }
      const first = d.samples[0];
      const dt = Date.now() - first.t;
      if (dt <= 0) return;
      const speed = (e.y - first.y) / px(1) / dt; // design px per ms, negative = up
      if (Math.abs(speed) < FLING_MIN_SPEED) return;
      const steps = Math.min(FLING_MAX_STEPS, Math.round(Math.abs(speed) * FLING_STEPS_PER_SPEED));
      this.fling(speed < 0 ? 1 : -1, steps, FLING_FIRST_MS);
    },

    // Inertia: keep stepping with growing pauses
    fling(dir, steps, delay) {
      if (steps <= 0) return;
      this.flingTimer = setTimeout(() => {
        this.flingTimer = null;
        const before = this.focus;
        this.setFocus(this.focus + dir);
        if (this.focus !== before) this.fling(dir, steps - 1, delay * FLING_SLOWDOWN);
      }, delay);
    },

    stopFling() {
      if (this.flingTimer) clearTimeout(this.flingTimer);
      this.flingTimer = null;
    },

    tapAt(y) {
      const designY = (y * W) / px(W);
      const zone = ZONE_EDGES.filter((edge) => designY >= edge).length; // 0..4
      const offset = zone - 2;
      if (offset) this.setFocus(this.focus + offset);
      else this.activate();
    },

    activate() {
      const item = this.items[this.focus];
      if (item) item.onClick();
    },

    play(queueId) {
      send(this, MEDIA.QUEUE_CLICK, { text: String(queueId) })
        .then(() => back())
        .catch((e) => showToast({ content: errorText(e) }));
    },

    onDestroy() {
      this.stopFling();
      if (this.stopKeepAlive) this.stopKeepAlive();
      try {
        offKey();
        offGesture();
      } catch (e) {}
    },
  })
);
