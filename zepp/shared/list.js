import { createWidget, widget, event, prop } from "@zos/ui";
import { px } from "@zos/utils";
import { W, text } from "./ui";

// Scrolling list of rounded rows for the media pages (players, player actions).
// Rows are rebuilt from scratch: lists are short and change rarely.

const ROW_H = 76;
const ROW_COLOR = 0x1c1c1c;

export function createList(top, accent) {
  let widgets = [];

  const clear = () => {
    widgets.forEach((w) => {
      try {
        w.setProperty(prop.VISIBLE, false);
      } catch (e) {}
    });
    widgets = [];
  };

  // rows: [{ label, sub?, active?, onClick }]
  const render = (rows) => {
    clear();
    rows.forEach((row, i) => {
      const y = top + i * ROW_H;
      const geom = { x: px(50), y: px(y), w: px(W - 100), h: px(ROW_H - 10), radius: px(28) };
      const bg = createWidget(widget.FILL_RECT, { ...geom, color: ROW_COLOR });
      const label = text(76, y, W - 152, ROW_H - 10, row.label, { size: 24, color: row.active ? accent : 0xffffff });
      const press = () => bg.setProperty(prop.MORE, { ...geom, color: 0x333333 });
      const release = () => {
        bg.setProperty(prop.MORE, { ...geom, color: ROW_COLOR });
        row.onClick();
      };
      [bg, label].forEach((w) => {
        w.addEventListener(event.CLICK_DOWN, press);
        w.addEventListener(event.CLICK_UP, release);
      });
      widgets.push(bg, label);
    });
    // room to scroll the last row above the round bezel
    widgets.push(text(0, top + rows.length * ROW_H, W, 100, "", {}));
  };

  return { render };
}
