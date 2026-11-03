import { BaseSideService } from "@zeppos/zml/base-side";

// Phone app (dev.iarti.simplewear) serves this on the loopback interface, see ZeppBridgeService.kt
const BASE = "http://127.0.0.1:47821";
// Zepp's fetch gives up after ~10 s, the phone answers long polls within 8 s
const POLL_WAIT_MS = 7000;
// Stop polling when the watch has been quiet this long. Visible pages and the shortcut card send a
// keepalive every 30 s; their timers stop with the screen, so polling (and the phone) can sleep.
const IDLE_STOP_MS = 60 * 1000;
const PAIR_TIMEOUT_MS = 90 * 1000;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToB64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

function b64ToBytes(s) {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2]) & 63) << 6) |
      (B64.indexOf(clean[i + 3]) & 63);
    bytes.push((n >> 16) & 255);
    if (clean[i + 2] !== undefined) bytes.push((n >> 8) & 255);
    if (clean[i + 3] !== undefined) bytes.push(n & 255);
  }
  return bytes;
}

function parseBody(body) {
  if (typeof body !== "string") return body || {};
  try {
    return JSON.parse(body);
  } catch (e) {
    return {};
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getToken() {
  return settings.settingsStorage.getItem("token") || "";
}

function setToken(token) {
  if (token) settings.settingsStorage.setItem("token", token);
  else settings.settingsStorage.removeItem("token");
}

async function http(path, { method = "GET", body } = {}) {
  const res = await fetch({
    url: BASE + path,
    method,
    headers: { "Content-Type": "application/json", "X-Bridge-Token": getToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    setToken("");
    throw new Error("unpaired");
  }
  if (res.status !== 200) throw new Error("http_" + res.status);
  return parseBody(res.body);
}

const noIcon = ({ key_icon, icon, ...rest }) => rest;
const STRIP_ICONS = {
  "/media/app/info": (app) => (app ? noIcon(app) : app),
  "/media/actions": (d) => ({ ...d, actions: (d.actions || []).map(noIcon) }),
  "/music-players": (d) => ({ ...d, musicPlayers: (d.musicPlayers || []).map(noIcon) }),
  "/media/queueitems": (d) => ({ ...d, queueItems: (d.queueItems || []).map(noIcon) }),
};

/* Images for the watch, sent as files (same pipeline as Spotify Remote):
   download from the phone (loopback) -> PNG -> TransferFile, one at a time.
   - covers: /media/art, the current one only, ahead of everything else
   - app icons: /media/appicon, for the player screen */

const IMAGE_JOB_TIMEOUT_MS = 60000;
const imageQueue = [];
let imageCurrent = null; // key of the job being transferred
let coverWatchHas = ""; // cover id the watch already shows (it tells us on open)
let coverSlot = 0;
const iconsSent = {}; // package -> true once the watch has its icon

function isQueued(key) {
  return imageCurrent === key || imageQueue.some((j) => j.key === key);
}

function enqueueImage(job, urgent) {
  if (urgent) imageQueue.unshift(job);
  else imageQueue.push(job);
  pumpImages();
}

function pumpImages() {
  if (imageCurrent || !imageQueue.length) return;
  const job = imageQueue.shift();
  imageCurrent = job.key;
  let finished = false;
  const finish = (state) => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    if (state === "transferred") job.done();
    else console.log("image failed", job.key, state);
    imageCurrent = null;
    pumpImages();
  };
  // A stuck callback must not block the queue forever
  const watchdog = setTimeout(() => finish("timeout"), IMAGE_JOB_TIMEOUT_MS);

  const transfer = (path) => {
    const outbox = transferFile.outbox || transferFile.getOutbox();
    const file = outbox.enqueueFile(path, job.params);
    file.on("change", (e) => {
      const state = e.data.readyState;
      if (state === "transferred" || state === "error" || state === "canceled") finish(state);
    });
  };

  try {
    // filePath is relative to data://download
    const task = network.downloader.downloadFile({ url: job.url, timeout: 30000, filePath: `${job.name}.${job.ext}` });
    task.onSuccess = (ev) => {
      if (ev.statusCode && ev.statusCode !== 200) {
        finish("dl http " + ev.statusCode);
        return;
      }
      const downloaded = ev.filePath || ev.tempFilePath || `data://download/${job.name}.${job.ext}`;
      // PNG goes as is; JPEG covers are converted first
      if (job.ext === "png") {
        transfer(downloaded);
        return;
      }
      image
        .convert({ filePath: downloaded, targetFilePath: `data://download/${job.name}.png` })
        .then((result) => transfer(result.targetFilePath))
        .catch((e) => finish("conv err: " + ((e && e.message) || e)));
    };
    task.onFail = (ev) => finish("dl err: " + ev.code + " " + ev.message);
  } catch (e) {
    finish("err: " + ((e && e.message) || e));
  }
}

function sendCover(id) {
  if (!id || id === coverWatchHas || isQueued("cover:" + id)) return;
  // only the newest cover matters: drop older ones still waiting
  for (let i = imageQueue.length - 1; i >= 0; i--) if (imageQueue[i].key.startsWith("cover:")) imageQueue.splice(i, 1);
  coverSlot = 1 - coverSlot;
  enqueueImage(
    {
      key: "cover:" + id,
      url: `${BASE}/media/art?id=${id}&t=${getToken()}`,
      name: coverSlot ? "cover_a" : "cover_b",
      ext: "jpg",
      params: { kind: "cover", coverId: id },
      done: () => (coverWatchHas = id),
    },
    true
  );
}

function sendAppIcon(pkg) {
  if (!pkg || iconsSent[pkg] || isQueued("icon:" + pkg)) return;
  enqueueImage(
    {
      key: "icon:" + pkg,
      url: `${BASE}/media/appicon?pkg=${encodeURIComponent(pkg)}&t=${getToken()}`,
      name: "icon_" + pkg.replace(/[^A-Za-z0-9]/g, "_"),
      ext: "png",
      params: { kind: "appicon", pkg },
      done: () => (iconsSent[pkg] = true),
    },
    false
  );
}

// The apps list carries base64 PNG icons; the watch shows names only for now
function slimMessage(m) {
  if (m.path === "/apps" && m.text) {
    try {
      const apps = JSON.parse(m.text).map((a) => ({
        label: a.key_label,
        pkg: a.key_package_name,
        activity: a.key_activity_name,
      }));
      return { path: m.path, apps };
    } catch (e) {
      return { path: m.path, error: "bad_apps" };
    }
  }
  if (STRIP_ICONS[m.path] && m.text) {
    try {
      return { path: m.path, text: JSON.stringify(STRIP_ICONS[m.path](JSON.parse(m.text))) };
    } catch (e) {
      return { path: m.path, error: "bad_json" };
    }
  }
  const out = { path: m.path };
  if (m.text !== undefined) out.text = m.text;
  else if (m.b64) out.bytes = b64ToBytes(m.b64);
  return out;
}

AppSideService(
  BaseSideService({
    onInit() {
      this.polling = false;
      this.lastWatchActivity = Date.now();
    },

    async pollLoop() {
      if (this.polling) return;
      this.polling = true;
      let failures = 0;
      while (this.polling && Date.now() - this.lastWatchActivity < IDLE_STOP_MS) {
        try {
          const r = await http("/events?wait=" + POLL_WAIT_MS);
          failures = 0;
          const msgs = (r.messages || []).map(slimMessage);
          msgs.forEach((m) => {
            if (m.path === "/media/playback_state/art" && m.text) sendCover(m.text);
          });
          if (msgs.length) this.call({ type: "messages", msgs });
        } catch (e) {
          failures++;
          const msg = (e && e.message) || "error";
          this.call({ type: "link", ok: false, error: msg });
          if (msg === "unpaired") break;
          // Phone app not running / frozen: back off
          await sleep(Math.min(1000 * failures, 10000));
        }
      }
      this.polling = false;
    },

    async pair() {
      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const deadline = Date.now() + PAIR_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const r = await http("/pair", { method: "POST", body: { nonce, name: "Zepp OS watch" } });
        if (r.status === "ok" && r.token) {
          setToken(r.token);
          return "ok";
        }
        await sleep(2000);
      }
      throw new Error("pair_timeout");
    },

    onRequest(req, res) {
      this.lastWatchActivity = Date.now();
      const p = req.params || {};
      let job;
      switch (req.method) {
        case "status":
          job = http("/ping").then((r) => ({ paired: !!getToken() && !!r.paired }));
          break;
        case "pair":
          job = this.pair();
          break;
        case "subscribe":
          if (!getToken()) {
            job = Promise.reject(new Error("unpaired"));
            break;
          }
          this.pollLoop();
          job = Promise.resolve("ok");
          break;
        case "media_cover":
          // the watch already shows this cover (kept across app restarts)
          coverWatchHas = p.have || "";
          job = Promise.resolve("ok");
          break;
        case "app_icon":
          // the watch keeps icons across restarts and says whether it has this one
          if (p.have) iconsSent[p.pkg] = true;
          else sendAppIcon(p.pkg);
          job = Promise.resolve("ok");
          break;
        case "keepalive":
          // the page is still on screen: make sure polling runs (it may have idled out)
          if (getToken()) this.pollLoop();
          job = Promise.resolve("ok");
          break;
        case "unsubscribe":
          this.polling = false;
          job = Promise.resolve("ok");
          break;
        case "send": {
          const body = { path: p.path };
          if (p.bytes) body.b64 = bytesToB64(p.bytes);
          else if (p.text !== undefined) body.text = p.text;
          job = http("/message", { method: "POST", body });
          break;
        }
        default:
          job = Promise.reject(new Error("unknown_method"));
      }
      job
        .then((result) => res(null, { result }))
        .catch((e) => res((e && e.message) || "error"));
    },

    onRun() {},

    onDestroy() {
      this.polling = false;
    },
  })
);
