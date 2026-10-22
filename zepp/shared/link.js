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

export function unsubscribe(page) {
  return page.request({ method: "unsubscribe" }, { timeout: 5000 }).catch(() => {});
}

// While a page / the card is on screen the app-side keeps polling the phone; without these
// keepalives it stops after a minute. Returns a function that stops them.
const KEEPALIVE_MS = 30 * 1000;

export function keepAlive(page) {
  const timer = setInterval(() => {
    page.request({ method: "keepalive" }, { timeout: 5000 }).catch(() => {});
  }, KEEPALIVE_MS);
  return () => clearInterval(timer);
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
