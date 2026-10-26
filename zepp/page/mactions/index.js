import { BasePage } from "@zeppos/zml/base-page";
import { createWidget, widget, prop } from "@zos/ui";
import { px } from "@zos/utils";
import { W, DARK, GRAY, RED, text, setText, errorText, ignorePalm } from "../../shared/ui";
import { getAccent } from "../../shared/accent";
import { MEDIA, otherActions } from "../../shared/media";
import { send, subscribe, dispatch, keepAlive } from "../../shared/link";
import { createList } from "../../shared/list";

// The player's own buttons (media session custom actions): shuffle, repeat, radio, …
// Opened by swiping up on the media controls (in place of Spotify Remote's library).

Page(
  BasePage({
    build() {
      ignorePalm();
      createWidget(widget.FILL_RECT, { x: 0, y: 0, w: px(W), h: px(W), color: DARK });
      text(80, 40, W - 160, 50, "Действия плеера", { size: 30 });
      this.status = text(60, 110, W - 120, 60, "Загрузка…", { size: 22, color: GRAY, wrap: true });
      this.list = createList(110, getAccent());

      this.stopKeepAlive = keepAlive(this);
      subscribe(this)
        .then(() => send(this, MEDIA.ACTIONS))
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
        [MEDIA.ACTIONS]: (m, actions) => {
          const rows = otherActions(actions).map((a) => ({
            label: a.title || a.action,
            onClick: () => this.click(a.action),
          }));
          this.setStatus(rows.length ? "" : "У этого плеера нет своих действий");
          this.list.render(rows);
        },
      });
    },

    // The phone answers with the updated actions (e.g. shuffle on -> "turn shuffle off")
    click(id) {
      send(this, MEDIA.ACTIONS_CLICK, { text: id })
        .then(() => setTimeout(() => send(this, MEDIA.ACTIONS).catch(() => {}), 600))
        .catch((e) => this.setStatus(errorText(e), RED));
    },

    onDestroy() {
      if (this.stopKeepAlive) this.stopKeepAlive();
    },
  })
);
