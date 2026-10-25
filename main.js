import { app, BrowserWindow, ipcMain, Tray, Menu, screen, globalShortcut, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Service } from "@opencode/client/service";

/* Window is transparent + dynamically sized to the rendered pill/panel
   (renderer measures and sends ui:size). Hover is driven by main's cursor
   polling: resizing the window under the cursor fires synthetic enter/leave,
   which would otherwise flap. Opaque windows and force-device-scale-factor
   were both tried and are broken here, do not revisit. */

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(os.tmpdir(), "opencode-notch.log");
const log = (...a) => {
  try {
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n`);
  } catch {}
};
process.on("uncaughtException", (e) => log("uncaught", e?.stack || String(e)));
process.on("unhandledRejection", (e) => log("unhandledRejection", String(e)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- opencode service ---------------- */
let ep = null;
let hdrs = null;

const api = (p, opt = {}) => {
  if (!ep || !hdrs) throw new Error("not-connected");
  return fetch(new URL(p, ep.url).href, {
    ...opt,
    headers: { ...hdrs, ...(opt.body ? { "content-type": "application/json" } : null), ...(opt.headers || null) },
  });
};
const gj = async (p) => {
  const r = await api(p);
  if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
  return r.json();
};

/* ---------------- state ---------------- */
const S = { connected: false, sessions: new Map(), permissions: new Map(), forms: new Map(), models: new Map() };

const sessDefault = (id) => ({
  id,
  title: "",
  directory: "",
  agent: "",
  modelID: "",
  providerID: "",
  variant: "",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  status: "idle",
  attempt: 0,
  statusMessage: "",
  busyAt: null,
  busyAlive: false,
  since: null,
  doneAt: null,
  lastTool: null,
  lastToolAt: null,
  toolStatus: "",
  updatedAt: 0,
  error: false,
  retryNext: null,
  liveText: "",
  toolDetail: "",
  step: 0,
  ctxUsed: 0,
  ctxLimit: 0,
  ctxAt: 0,
});

const sess = (id) => {
  let s = S.sessions.get(id);
  if (!s) {
    s = sessDefault(id);
    S.sessions.set(id, s);
  }
  return s;
};

const finishTurn = (s) => {
  if (s.busyAlive || !s.doneAt) {
    s.busyAlive = false;
    s.status = "idle";
    s.doneAt = Date.now();
    s.statusMessage = "";
  }
  s.ctxAt = 0;
  s.retryNext = null;
  s.liveText = "";
  setTimeout(() => refreshContext(s.id).catch(() => {}), 900);
};

const refetchSoon = (() => {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => refreshSessions().catch((e) => log("refetch sessions:", e.message)), 300);
  };
})();

/* ---------------- event reducer ---------------- */
const summariseInput = (input) => {
  if (!input || typeof input !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === null || v === undefined || v === "") continue;
    let sv = typeof v === "string" ? v : JSON.stringify(v);
    sv = String(sv).replace(/\s+/g, " ").trim();
    if (!sv) continue;
    parts.push(`${k}: ${sv.length > 70 ? sv.slice(0, 70) + "…" : sv}`);
    if (parts.length >= 2) break;
  }
  return parts.join("  ·  ");
};

function handle(ev) {
  const t = ev?.type;
  if (!t) return;
  const d = ev.properties?.data ?? ev.data ?? {};
  const known = [
    "session.status",
    "session.idle",
    "session.renamed",
    "session.usage.updated",
    "session.tool.input.started",
    "session.tool.called",
    "session.tool.success",
    "session.tool.failed",
    "session.text.started",
    "session.text.delta",
    "session.text.ended",
    "session.step.started",
    "session.execution.started",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
  ];
  const s = known.includes(t) ? sess(d.sessionID) : null;
  if (!s) {
    switch (t) {
      case "permission.asked": {
        if (d.id) {
          S.permissions.set(d.id, {
            id: d.id,
            sessionID: d.sessionID,
            action: d.action ?? "permission",
            title: d.title ?? d.action ?? "Permission",
            metadata: d.metadata ?? null,
            at: Date.now(),
          });
          send();
        }
        break;
      }
      case "permission.replied": {
        if (d.requestID && S.permissions.delete(d.requestID)) send();
        break;
      }
      case "form.created": {
        const f = d.form;
        if (f?.id) {
          S.forms.set(f.id, f);
          send();
        }
        break;
      }
      case "form.replied":
      case "form.cancelled": {
        const fid = d.form?.id ?? d.id;
        if (fid && S.forms.delete(fid)) send();
        break;
      }
      case "session.created":
      case "session.deleted":
      case "session.archived":
        refetchSoon();
        break;
    }
    return;
  }

  switch (t) {
    case "session.status": {
      const st = d.status?.type;
      s.attempt = d.status?.attempt ?? s.attempt;
      s.statusMessage = d.status?.message ?? "";
      if (st === "busy") {
        if (!s.busyAlive) {
          s.busyAlive = true;
          s.busyAt = Date.now();
          s.since = Date.now();
          s.error = false;
          s.liveText = "";
          s.toolDetail = "";
          s.step = 0;
        }
        s.status = "busy";
        s.retryNext = null;
      } else if (st === "retry") {
        s.status = "retry";
        const nx = d.status?.next;
        s.retryNext = typeof nx === "number" ? nx : null;
      } else if (st === "idle") {
        finishTurn(s);
      }
      break;
    }
    case "session.idle":
      finishTurn(s);
      break;
    case "session.execution.started":
      if (!s.busyAlive) {
        s.busyAlive = true;
        s.busyAt = Date.now();
        s.since = Date.now();
        s.error = false;
        s.liveText = "";
        s.toolDetail = "";
        s.step = 0;
      }
      s.status = "busy";
      break;
    case "session.execution.succeeded":
      finishTurn(s);
      break;
    case "session.execution.failed":
      finishTurn(s);
      s.error = true;
      break;
    case "session.execution.interrupted":
      finishTurn(s);
      break;
    case "session.renamed":
      s.title = d.title ?? s.title;
      refetchSoon();
      break;
    case "session.usage.updated":
      s.tokens = d.tokens ?? s.tokens;
      s.cost = d.cost ?? s.cost;
      s.ctxAt = 0;
      break;
    case "session.tool.input.started":
      if (d.name) {
        s.lastTool = d.name;
        s.lastToolAt = Date.now();
        s.toolDetail = "";
      }
      break;
    case "session.tool.called":
      s.lastTool = d.name ?? s.lastTool;
      s.toolDetail = summariseInput(d.input);
      s.toolStatus = "run";
      break;
    case "session.tool.success":
      s.toolStatus = "ok";
      break;
    case "session.tool.failed":
      s.toolStatus = "err";
      break;
    case "session.text.started":
      s.liveText = "";
      break;
    case "session.text.delta": {
      const chunk = d.delta ?? d.text ?? d.content ?? "";
      if (chunk) s.liveText = (s.liveText + chunk).slice(-260);
      break;
    }
    case "session.step.started":
      s.step = (s.step ?? 0) + 1;
      break;
    default:
      break;
  }
  s.updatedAt = Date.now();
  send();
}

/* ---------------- refresh ---------------- */
async function refreshSessions() {
  const data = await gj("/api/session?limit=40");
  for (const it of data.data ?? []) {
    const s = sess(it.id);
    s.title = it.title ?? s.title;
    s.directory = it.location?.directory ?? s.directory;
    s.agent = it.agent ?? s.agent;
    if (it.model) {
      s.modelID = it.model.id ?? s.modelID;
      s.providerID = it.model.providerID ?? s.providerID;
      s.variant = it.model.variant ?? s.variant;
    }
    s.cost = it.cost ?? s.cost;
    if (it.tokens) s.tokens = it.tokens;
    const tu = it.time?.updated;
    if (tu) s.updatedAt = (typeof tu === "number" ? tu : Date.parse(tu)) || s.updatedAt;
    S.sessions.set(it.id, s);
  }
}

async function refreshActive() {
  const act = await gj("/api/session/active");
  for (const [sid, st] of Object.entries(act.data ?? {})) {
    const s = sess(sid);
    if (st?.type === "running") {
      s.status = "busy";
      s.busyAlive = true;
      if (!s.since) s.since = Date.now();
      s.busyAt ??= s.since ?? Date.now();
    }
  }
}

async function refreshPermissions() {
  const pr = await gj("/api/permission/request");
  for (const p of pr.data ?? []) {
    if (!p?.id) continue;
    S.permissions.set(p.id, {
      id: p.id,
      sessionID: p.sessionID,
      action: p.action ?? "permission",
      title: p.title ?? p.action ?? "Permission",
      metadata: p.metadata ?? null,
      at: Date.now(),
    });
  }
}

async function refreshForms() {
  const fr = await gj("/api/form");
  for (const f of fr.data ?? []) {
    if (f?.id) S.forms.set(f.id, f);
  }
}

async function refreshModels() {
  const ml = await gj("/api/model");
  for (const m of ml.data ?? []) {
    S.models.set(`${m.providerID}/${m.modelID ?? m.id}`, m.limit?.context ?? 0);
  }
}

/* Context occupancy: the LAST completed assistant message carries per-step
   tokens (input + cache.read + output + reasoning) = real prompt size for
   that step, NOT cumulative session totals. */
async function refreshContext(sid) {
  const s = S.sessions.get(sid);
  if (!s) return;
  if (Date.now() - (s.ctxAt ?? 0) < 4000) return;
  s.ctxAt = Date.now();
  const r = await gj(`/api/session/${encodeURIComponent(sid)}/message?limit=10&order=desc`);
  const msgs = r.data ?? [];
  let lastTokens = null;
  let newest = 0;
  for (const m of msgs) {
    const c = typeof m.time?.created === "number" ? m.time.created : 0;
    if (c > newest) newest = c;
    if (!lastTokens && m.type === "assistant" && m.tokens) lastTokens = m.tokens;
  }
  if (lastTokens) {
    s.ctxUsed =
      (lastTokens.input ?? 0) + (lastTokens.cache?.read ?? 0) + (lastTokens.output ?? 0) + (lastTokens.reasoning ?? 0);
  }
  const lim = S.models.get(`${s.providerID}/${s.modelID}`) ?? 0;
  if (lim) s.ctxLimit = lim;
  /* after app restart / reconnect `since` is app-start time; the newest
     message timestamp is the real start of the current turn */
  if (s.status === "busy" && newest && s.since && s.since > newest + 1500) s.since = newest;
  s.ctxAt = Date.now();
  send();
}

async function refreshContexts() {
  const list = [...S.sessions.values()]
    .filter((s) => s.status !== "idle" || Date.now() - (s.updatedAt || 0) < 10 * 60e3)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 8);
  await Promise.allSettled(list.map((s) => refreshContext(s.id)));
}

async function refreshAll() {
  const rs = await Promise.allSettled([refreshSessions(), refreshActive(), refreshPermissions(), refreshForms(), refreshModels()]);
  rs.forEach((r, i) => {
    if (r.status === "rejected") log(`refresh[${i}]:`, r.reason?.message || String(r.reason));
  });
  await refreshContexts().catch((e) => log("refresh contexts:", e.message));
}

/* ---------------- send to renderer ---------------- */
let sendT = null;
const send = () => {
  if (sendT) return;
  sendT = setTimeout(() => {
    sendT = null;
    if (!win?.webContents) return;
    const st = [...S.sessions.values()];
    let atTop = false;
    try {
      const bw = win.getBounds();
      atTop = bw.y <= screen.getDisplayMatching(bw).workArea.y + 1;
    } catch {}
    win.webContents.send("state", {
      connected: S.connected,
      ts: Date.now(),
      pinned,
      muted,
      theme,
      atTop,
      hover: hoverState,
      models: Object.fromEntries(S.models),
      sessions: [...S.sessions.values()].map((s) => ({ ...s, tokens: { ...s.tokens, cache: { ...s.tokens.cache } } })),
      permissions: [...S.permissions.values()].map((p) => ({ ...p })),
      forms: [...S.forms.values()].map((f) => ({ ...f })),
    });
  }, 110);
};

/* ---------------- SSE loop ---------------- */
let abortCtl = null;

async function sseLoop() {
  for (;;) {
    try {
      ep = await Service.discover();
      hdrs = Service.headers(ep);
      await refreshAll();
      abortCtl = new AbortController();
      const r = await api("/api/event", { signal: abortCtl.signal });
      if (!r.ok || !r.body) throw new Error(`/api/event → HTTP ${r.status}`);
      S.connected = true;
      send();
      log("sse connected", new URL(ep.url).port);
      const rd = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = block
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          try {
            handle(JSON.parse(data));
          } catch (e) {
            log("bad event json:", e.message);
          }
        }
      }
      throw new Error("stream ended");
    } catch (e) {
      if (app.quitting) return;
      S.connected = false;
      send();
      log("sse lost:", e?.message || String(e));
      abortCtl?.abort();
      abortCtl = null;
      await sleep(1500);
      try {
        ep = await Service.discover();
        hdrs = Service.headers(ep);
        await refreshAll();
        log("rediscovered");
        S.connected = true;
        send();
      } catch (e2) {
        log("rediscover fail:", e2?.message || String(e2));
        await sleep(3500);
      }
    }
  }
}

/* ---------------- window ---------------- */
let win = null;
let tray = null;
let cur = { w: 240, h: 56 };
/* remembered position: user may drag the window anywhere; resizes must keep it
   there instead of snapping back to the top-centre of the work area.
   Also persisted to userData so restarts keep the spot. */
let anchorX = null; // horizontal centre, DIP screen coords
let anchorY = null; // top edge, DIP screen coords
let muted = false; // silence the permission beep
let pinned = false; // keep the panel open regardless of hover
let theme = "notch"; // notch | midnight | mono
let syncing = false; // true while our own setBounds moves the window

const THEMES = ["notch", "midnight", "mono"];

const CFG_PATH = path.join(app.getPath("userData"), "notch.json");
function loadPrefs() {
  try {
    const c = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
    if (typeof c.anchorX === "number" && typeof c.anchorY === "number") {
      anchorX = c.anchorX;
      anchorY = c.anchorY;
    }
    muted = !!c.muted;
    pinned = !!c.pinned;
    if (THEMES.includes(c.theme)) theme = c.theme;
  } catch {}
}
let saveT = null;
function savePrefs() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
      fs.writeFileSync(CFG_PATH, JSON.stringify({ anchorX, anchorY, muted, pinned, theme }, null, 2));
    } catch {}
  }, 400);
}

function place(center = false) {
  if (!win) return;
  /* the window follows whichever display the anchor (or cursor) is on */
  const probe = anchorX != null && anchorY != null ? { x: anchorX, y: anchorY } : screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(probe).workArea;
  const w = Math.min(cur.w, wa.width - 16);
  const h = Math.min(cur.h, wa.height - 8);
  if (center || anchorX == null) {
    anchorX = wa.x + wa.width / 2;
    anchorY = wa.y;
    savePrefs();
  }
  let x = Math.round(anchorX - w / 2);
  let y = Math.round(anchorY);
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  const b = win.getBounds();
  if (b.x !== x || b.y !== y || b.width !== w || b.height !== h) {
    syncing = true;
    win.setBounds({ x, y, width: w, height: h });
    setTimeout(() => (syncing = false), 150);
  }
}

/* keep the anchor in sync when the user drags the window around */
function watchMove(w) {
  w.on("move", () => {
    if (syncing) return;
    const b = w.getBounds();
    anchorX = b.x + b.width / 2;
    anchorY = b.y;
    savePrefs();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 240,
    height: 56,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: !process.argv.includes("--hidden"),
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(DIR, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setMenuBarVisibility(false);
  watchMove(win);
  win.webContents.on("did-fail-load", (e, code, desc, url) => log(`did-fail-load ${code} ${desc} ${url}`));
  win.webContents.on("preload-error", (e, p, err) => log(`preload-error ${p} ${err}`));
  win.webContents.on("render-process-gone", (e, d) => log(`render-gone ${JSON.stringify(d)}`));
  win.webContents.on("console-message", (e) => {
    if ((e.level ?? "info") !== "info") log(`renderer ${e.level}: ${e.message ?? ""}`);
  });
  win.webContents.on("did-finish-load", () => {
    log("renderer loaded");
    setTimeout(() => {
      place();
    }, 1500);
  });
  win.loadFile(path.join(DIR, "renderer", "index.html"));
  win.on("closed", () => {
    win = null;
  });
}

function setPinned(v) {
  pinned = !!v;
  savePrefs();
  if (pinned) win?.show();
  send();
  tray?.setContextMenu(buildTrayMenu());
}

function setTheme(v) {
  if (!THEMES.includes(v) || v === theme) return;
  theme = v;
  savePrefs();
  send();
  tray?.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: pinned ? "Unpin panel" : "Pin panel open", click: () => setPinned(!pinned) },
    { label: "Show", click: () => win?.show() },
    { label: "Hide", click: () => win?.hide() },
    { label: "Center at top", click: () => place(true) },
    { type: "separator" },
    {
      label: "Mute sounds",
      type: "checkbox",
      checked: muted,
      click: (mi) => {
        muted = mi.checked;
        savePrefs();
        send();
      },
    },
    {
      label: "Theme",
      submenu: [
        { label: "Notch", type: "radio", checked: theme === "notch", click: () => setTheme("notch") },
        { label: "Midnight", type: "radio", checked: theme === "midnight", click: () => setTheme("midnight") },
        { label: "Mono", type: "radio", checked: theme === "mono", click: () => setTheme("mono") },
      ],
    },
    {
      label: "Launch at login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked, args: ["--hidden"] }),
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}

function createTray() {
  tray = new Tray(path.join(DIR, "tray.png"));
  tray.setToolTip("OpenCode notch");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    win?.show();
    setPinned(!pinned);
  });
}

function ipcWire() {
  ipcMain.handle("app:ready", () => {
    win?.webContents.send("state", {
      connected: S.connected,
      ts: Date.now(),
      pinned,
      muted,
      theme,
      hover: hoverState,
      models: Object.fromEntries(S.models),
      sessions: [...S.sessions.values()].map((s) => ({ ...s })),
      permissions: [...S.permissions.values()],
      forms: [...S.forms.values()],
    });
    return true;
  });
  ipcMain.handle("perm:reply", (e, a) =>
    (async () => {
      const { sessionID, requestID, decision, message } = a ?? {};
      if (typeof sessionID !== "string" || typeof requestID !== "string") return { ok: false, error: "bad args" };
      if (!["once", "always", "reject"].includes(decision)) return { ok: false, error: "bad decision" };
      const r = await api(`/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`, {
        method: "POST",
        body: JSON.stringify({ decision, ...(message ? { message } : {}) }),
      });
      if (!r.ok) throw new Error(`reply → HTTP ${r.status}`);
      S.permissions.delete(requestID);
      send();
      return { ok: true };
    })().catch((err) => ({ ok: false, error: String(err?.message || err) })),
  );
  ipcMain.handle("session:prompt", (e, a) =>
    (async () => {
      const { sessionID, text } = a ?? {};
      if (typeof sessionID !== "string" || typeof text !== "string" || !text.trim()) return { ok: false, error: "bad args" };
      const r = await api(`/api/session/${encodeURIComponent(sessionID)}/prompt`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`prompt → HTTP ${r.status}`);
      const s = sess(sessionID);
      if (!s.busyAlive) {
        s.busyAlive = true;
        s.busyAt = Date.now();
        s.since = Date.now();
        s.doneAt = null;
        s.status = "busy";
        s.error = false;
      }
      s.updatedAt = Date.now();
      send();
      return { ok: true };
    })().catch((err) => ({ ok: false, error: String(err?.message || err) })),
  );
  ipcMain.handle("session:interrupt", (e, a) =>
    (async () => {
      const { sessionID, resume } = a ?? {};
      if (typeof sessionID !== "string") return { ok: false, error: "bad args" };
      const r = await api(`/api/session/${encodeURIComponent(sessionID)}/interrupt${resume ? "?resume=true" : ""}`, { method: "POST" });
      if (!r.ok) throw new Error(`interrupt → HTTP ${r.status}`);
      return { ok: true };
    })().catch((err) => ({ ok: false, error: String(err?.message || err) })),
  );
  ipcMain.handle("form:reply", (e, a) =>
    (async () => {
      const { sessionID, formID, answer } = a ?? {};
      if (typeof sessionID !== "string" || typeof formID !== "string" || !answer || typeof answer !== "object") {
        return { ok: false, error: "bad args" };
      }
      const r = await api(`/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}/reply`, {
        method: "POST",
        body: JSON.stringify({ answer }),
      });
      if (!r.ok) throw new Error(`form reply → HTTP ${r.status}`);
      S.forms.delete(formID);
      send();
      return { ok: true };
    })().catch((err) => ({ ok: false, error: String(err?.message || err) })),
  );
  ipcMain.handle("form:cancel", (e, a) =>
    (async () => {
      const { sessionID, formID } = a ?? {};
      if (typeof sessionID !== "string" || typeof formID !== "string") return { ok: false, error: "bad args" };
      const r = await api(`/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(formID)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(`form cancel → HTTP ${r.status}`);
      S.forms.delete(formID);
      send();
      return { ok: true };
    })().catch((err) => ({ ok: false, error: String(err?.message || err) })),
  );
  ipcMain.on("ui:pin", (e, v) => {
    pinned = !!v;
    savePrefs();
    send();
  });
  ipcMain.on("ui:mute", (e, v) => {
    muted = !!v;
    savePrefs();
    send();
    tray?.setContextMenu(buildTrayMenu());
  });
  ipcMain.on("open:external", (e, url) => {
    if (typeof url === "string" && /^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
  });
  ipcMain.on("ui:size", (e, a) => {
    const w = Math.max(40, Math.round(a?.w || 0));
    const h = Math.max(40, Math.round(a?.h || 0));
    if (w !== cur.w || h !== cur.h) {
      cur = { w, h };
      place();
    }
  });
}

/* cursor polling drives hover: resize under the cursor generates synthetic
   enter/leave events, which would flap forever — polling is immune to it */
let hoverState = false;
setInterval(() => {
  if (!win || win.isDestroyed() || !win.isVisible?.()) {
    if (hoverState) {
      hoverState = false;
      win?.webContents.send("hover", false);
    }
    return;
  }
  const pt = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const inside =
    pt.x >= b.x - 2 && pt.x <= b.x + b.width + 2 && pt.y >= b.y - 2 && pt.y <= b.y + b.height + 2;
  if (inside !== hoverState) {
    hoverState = inside;
    win.webContents.send("hover", inside);
  }
}, 110);
ipcMain.on("app:quit", () => app.quit());

/* ---------------- app lifecycle ---------------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    win?.show();
    place();
  });
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    app.quitting = true;
    try {
      abortCtl?.abort();
    } catch {}
  });
  app.whenReady().then(() => {
    loadPrefs();
    createWindow();
    createTray();
    ipcWire();
    place();
    const hkTry = ["CommandOrControl+Alt+N", "CommandOrControl+Shift+N", "CommandOrControl+Alt+O", "F9"];
    for (const ak of hkTry) {
      try {
        if (globalShortcut.register(ak, () => {
          win?.show();
          setPinned(!pinned);
        })) {
          log(`hotkey registered: ${ak}`);
          break;
        }
      } catch (e) {
        log(`hotkey ${ak} error: ${e?.message || e}`);
      }
    }
    screen.on("display-metrics-changed", () => place());
    screen.on("display-removed", () => place());
    screen.on("display-added", () => place());
    sseLoop();
    setInterval(() => {
      if (S.connected) refreshContexts().catch(() => {});
    }, 15000);
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
}
