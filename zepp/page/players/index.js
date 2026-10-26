import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop } from "@zos/ui";
import { px } from "@zos/utils";
import { push, back } from "@zos/router";
import { W, DARK, GRAY, RED, text, setText, errorText, ignorePalm } from "../../shared/ui";
import { getAccent } from "../../shared/accent";
import { MEDIA } from "../../shared/media";
import { send, sendJson, subscribe, dispatch, keepAlive } from "../../shared/link";
import { createList } from "../../shared/list";

// Which app to control (in place of Spotify Remote's Connect devices) + media volume.

const VOLUME_ROW = {
  label: "Громкость",
  onClick: () => push({ url: "page/value/index", params: JSON.stringify({ kind: "volume" }) }),
};

Page(
  BasePage({
    build() {
      ignorePalm();
      this.accent = getAccent();
      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      text(80, 40, W - 160, 50, "Плеер", { size: 30 });
      this.status = text(60, 90, W - 120, 30, "", { size: 20, color: GRAY });
      this.list = createList(126, this.accent);
      this.list.render([VOLUME_ROW]);

      this.stopKeepAlive = keepAlive(this);
      this.setStatus("Загрузка…");
      subscribe(this)
        .then(() => send(this, MEDIA.PLAYERS))
        .catch((e) => this.setStatus(errorText(e), RED));
    },

    setStatus(value, color = GRAY) {
      setText(this.status, value);
      this.status.setProperty(prop.COLOR, color);
    },

    onCall(data) {
      dispatch(data, {
        onLink: (l) => {
          if (!l.ok) this.setStatus(errorText(l.error), RED);
        },
        // Two messages on this path: the list (JSON) and a status ("SUCCESS" / "PERMISSION_DENIED")
        [MEDIA.PLAYERS]: (m, d) => {
          if (!d) {
            if (m.text === "PERMISSION_DENIED") this.setStatus("Нет доступа к уведомлениям на телефоне", RED);
            return;
          }
          const active = d.activePlayerKey || "";
          const players = (d.musicPlayers || []).slice().sort((a, b) => (a.key_label || "").localeCompare(b.key_label || ""));
          this.setStatus("");
          this.list.render([
            VOLUME_ROW,
            ...players.map((p) => ({
              label: p.key_label || p.key_package_name,
              active: !!active && active.indexOf(p.key_package_name) >= 0,
              onClick: () => this.open(p),
            })),
          ]);
        },
      });
    },

    // Starts the app on the phone and attaches the media controls to it
    open(p) {
      this.setStatus("Запуск: " + (p.key_label || p.key_package_name), this.accent);
      sendJson(this, MEDIA.OPEN_PLAYER, { first: p.key_package_name, second: p.key_activity_name })
        .then(() => send(this, MEDIA.CONNECT, { text: p.key_package_name }))
        .then(() => back())
        .catch((e) => this.setStatus(errorText(e), RED));
    },

    onDestroy() {
      if (this.stopKeepAlive) this.stopKeepAlive();
    },
  })
);
