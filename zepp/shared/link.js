// Page-side helpers for talking to the phone through the app-side (see app-side/index.js)

export function send(page, path, payload = {}) {
  return page.request({ method: "send", params: { path, ...payload } }, { timeout: 12000 });
}

export function sendJson(page, path, obj) {
  return send(page, path, { text: JSON.stringify(obj) });
}

export function subscribe(page) {
  return page.request({ method: "subscribe" }, { timeout: 12000 });
}

// app-side pushes {type: "messages", msgs: [{path, text?, bytes?, apps?}]} and {type: "link", ok, error}
export function dispatch(data, handlers) {
  if (!data) return;
  if (data.type === "link") {
    if (handlers.onLink) handlers.onLink(data);
    return;
  }
  if (data.type !== "messages") return;
  for (const m of data.msgs || []) {
    const fn = handlers[m.path];
    if (!fn) continue;
    let json;
    if (m.text !== undefined) {
      try {
        json = JSON.parse(m.text);
      } catch (e) {
        json = undefined;
      }
    }
    try {
      fn(m, json);
    } catch (e) {
      console.log("handler failed", m.path, e);
    }
  }
}
