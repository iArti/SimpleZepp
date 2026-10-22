import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, event, prop } from "@zos/ui";
import { px } from "@zos/utils";
import { W, GRAY, RED, MINT, text, errorText } from "../../shared/ui";
import { PATH } from "../../shared/protocol";
import { send, sendJson, subscribe, dispatch, keepAlive } from "../../shared/link";

const TOP = 110;
const ROW_H = 76;
const MAX_APPS = 150;

Page(
  BasePage({
    build() {
      this.stopKeepAlive = keepAlive(this);
      try {
        text(W / 2 - 120, 40, 240, 44, "Приложения", { size: 28, color: GRAY });
        this.status = text(60, TOP, W - 120, 40, "Загрузка…", { size: 20, color: GRAY });
        this.rows = [];
        subscribe(this)
          .then(() => send(this, PATH.APPS))
          .catch((e) => this.setStatus(errorText(e), RED));
      } catch (e) {
        text(40, 180, W - 80, 120, "build: " + e, { color: RED, wrap: true, size: 22 });
      }
    },

    onDestroy() {
      if (this.stopKeepAlive) this.stopKeepAlive();
    },

    setStatus(value, color = GRAY) {
      this.status.setProperty(prop.TEXT, value);
      this.status.setProperty(prop.COLOR, color);
    },

    showApps(apps) {
      if (this.rows.length) return; // list arrives once per open
      this.setStatus(apps.length ? "" : "Список пуст");
      apps.slice(0, MAX_APPS).forEach((app, i) => {
        const y = TOP + 44 + i * ROW_H;
        const geom = { x: px(50), y: px(y), w: px(W - 100), h: px(ROW_H - 10), radius: px(28) };
        const bg = createWidget(widget.FILL_RECT, { ...geom, color: 0x1c1c1c });
        const label = text(70, y, W - 140, ROW_H - 10, app.label || app.pkg, { size: 24 });
        const launch = () => {
          bg.setProperty(prop.MORE, { ...geom, color: 0x1c1c1c });
          this.setStatus("Запуск: " + (app.label || app.pkg), MINT);
          // androidx.core.util.Pair serialised by Gson
          sendJson(this, PATH.LAUNCH_APP, { first: app.pkg, second: app.activity }).catch((e) =>
            this.setStatus(errorText(e), RED)
          );
        };
        [bg, label].forEach((w) => {
          w.addEventListener(event.CLICK_DOWN, () => bg.setProperty(prop.MORE, { ...geom, color: 0x3a2a55 }));
          w.addEventListener(event.CLICK_UP, launch);
        });
        this.rows.push(bg);
      });
      text(0, TOP + 44 + Math.min(apps.length, MAX_APPS) * ROW_H, W, 100, "", {});
    },

    onCall(data) {
      dispatch(data, {
        onLink: (l) => {
          if (!l.ok) this.setStatus(errorText(l.error), RED);
        },
        [PATH.APPS]: (m) => {
          if (m.apps) this.showApps(m.apps);
          else this.setStatus("Не удалось получить список", RED);
        },
        [PATH.LAUNCH_APP]: (m) => {
          if (m.text && m.text !== "SUCCESS") this.setStatus("Не получилось: " + m.text, RED);
        },
      });
    },
  })
);
