import { createWidget, widget, align, text_style, event, prop } from "@zos/ui";
import { px } from "@zos/utils";

export const W = 480; // design width; px() scales to the real screen
export const MINT = 0x7fe0b0;
export const GRAY = 0xb3b3b3;
export const RED = 0xff8080;
export const TILE_OFF = 0x262626;
export const TILE_ON = 0x5b3a8c;
export const TILE_BUSY = 0x3f3f3f;

export function text(x, y, w, h, value, opts = {}) {
  return createWidget(widget.TEXT, {
    x: px(x),
    y: px(y),
    w: px(w),
    h: px(h),
    text: value,
    text_size: px(opts.size || 26),
    color: opts.color ?? 0xffffff,
    align_h: opts.alignH ?? align.CENTER_H,
    align_v: align.CENTER_V,
    text_style: opts.wrap ? text_style.WRAP : text_style.ELLIPSIS,
  });
}

export function statusLine(y, w = 300) {
  const t = text((W - w) / 2, y, w, 36, "", { size: 20, color: GRAY });
  return {
    set(value, color = GRAY) {
      t.setProperty(prop.TEXT, value);
      t.setProperty(prop.COLOR, color);
    },
  };
}

// Round button with an icon or a label; IMG/TEXT on top would eat taps, so every layer listens
export function roundButton(cx, cy, d, content, onTap, opts = {}) {
  let color = opts.color ?? TILE_OFF;
  const geom = () => ({ center_x: px(cx), center_y: px(cy), radius: px(d / 2), color });
  const circle = createWidget(widget.CIRCLE, geom());
  let face;
  // prop.MORE resets anything not passed, so updates always resend the full geometry
  const s = content.size || 56;
  const imgGeom = {
    x: px(cx - d / 2),
    y: px(cy - d / 2),
    w: px(d),
    h: px(d),
    pos_x: px((d - s) / 2),
    pos_y: px((d - s) / 2),
  };
  const textGeom = { x: px(cx - d / 2), y: px(cy - d / 2), w: px(d), h: px(d) };
  if (content.icon) {
    face = createWidget(widget.IMG, { ...imgGeom, src: content.icon });
  } else {
    face = text(cx - d / 2, cy - d / 2, d, d, content.label, { size: content.textSize || 28 });
  }
  const paint = (c) => circle.setProperty(prop.MORE, { ...geom(), color: c });
  [circle, face].forEach((w) => {
    w.addEventListener(event.CLICK_DOWN, () => paint(0x4a4a4a));
    w.addEventListener(event.CLICK_UP, () => {
      paint(color);
      onTap();
    });
  });
  return {
    setColor(c) {
      color = c;
      paint(c);
    },
    setIcon(src) {
      if (content.icon) face.setProperty(prop.MORE, { ...imgGeom, src });
    },
    setLabel(label) {
      if (!content.icon) face.setProperty(prop.TEXT, label);
    },
  };
}

export function errorText(e) {
  const msg = String((e && (e.message || e)) || "");
  if (msg === "unpaired") return "Нет привязки к телефону";
  if (msg === "pair_timeout") return "Не подтвердили на телефоне";
  if (msg.toLowerCase().includes("timeout")) return "Телефон не отвечает";
  if (msg.toLowerCase().includes("network")) return "SimpleZepp на телефоне не запущен";
  if (msg.startsWith("http_")) return "Телефон: ошибка " + msg.slice(5);
  return "Ошибка: " + msg.slice(0, 30);
}

export function actionErrorText(status) {
  switch (String(status || "").toLowerCase()) {
    case "permission_denied":
    case "remote_permission_denied":
      return "Нет разрешения на телефоне";
    case "timeout":
      return "Телефон не успел";
    default:
      return "Не получилось";
  }
}
