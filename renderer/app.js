/* OpenCode notch — renderer */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const frame = document.getElementById("frame");
const pill = document.getElementById("pill");
const pdots = document.getElementById("pdots");
const panel = document.getElementById("panel");
const conn = document.getElementById("conn");
const hstats = document.getElementById("hstats");
const permslot = document.getElementById("permslot");
const rowsEl = document.getElementById("rows");
const formsEl = document.getElementById("forms");
const sumEl = document.getElementById("sum");
const input = document.getElementById("in");
const filterEl = document.getElementById("filt");
const pinBtn = document.getElementById("pin");
const muteBtn = document.getElementById("mute");

/* window.notch is exposed by preload (contextBridge) — do not redeclare */

let snap = null;
let hover = false;
let dismissed = false;
let target = null;
let rendered = false;
let filter = "";
let pinned = false;
let muted = false;
const seenPerms = new Set();
const seenForms = new Set();

/* ---------------- helpers ---------------- */
const baseDir = (d) => String(d ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
const shortModel = (s) => {
  const m = String(s.modelID ?? "");
  return m.includes("/") ? m.split("/").pop() : m;
};
const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};
const fmtAgo = (ms) => fmtElapsed(ms);
const fmtTok = (n) => {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return String(Math.round(n));
};
const fmtCost = (c) => (c > 0 ? `$${c < 0.01 ? c.toFixed(4) : c.toFixed(2)}` : "");
function statusClass(s, permed) {
  if (permed?.has(s.id)) return "att";
  if (s.error && s.status === "retry") return "err";
  if (s.status === "retry") return s.error ? "err" : "busy";
  if (s.status === "busy") return "busy";
  return "done";
}

const totalTokens = (s) =>
  (s.tokens?.input ?? 0) + (s.tokens?.output ?? 0) + (s.tokens?.reasoning ?? 0) + (s.tokens?.cache?.read ?? 0);

const baseName = (sid) => {
  const s = (snap?.sessions ?? []).find((x) => x.id === sid);
  return s ? baseDir(s.directory) || (s.title || "").slice(0, 14) || "session" : "session";
};

function limitFor(s) {
  if (s.providerID && s.modelID) {
    const l = snap?.models?.[`${s.providerID}/${s.modelID}`];
    if (l > 0) return l;
  }
  return 0;
}

/* retry.next may be epoch-ms, epoch-seconds or relative seconds — accept all */
function retryIn(s, now) {
  let t = s.retryNext;
  if (!t) return "";
  if (t > 1e12) t = t - now;
  else if (t > 1e9) t = t * 1000 - now;
  else t = t * 1000;
  return `${Math.max(0, Math.ceil(t / 1000))}s`;
}

function permDetail(p) {
  const m = p.metadata ?? {};
  const lines = [];
  for (const [k, v] of Object.entries(m)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    let sv = Array.isArray(v) ? v.join(", ") : String(v);
    if (/path|dir|file/i.test(k) && sv.length > 60) {
      const base = sv.split(/[\\/]/).filter(Boolean);
      sv = base.length > 3 ? `[…]/${base.slice(-2).join("/")}` : sv;
    }
    if (sv.length > 140) sv = sv.slice(0, 140) + "…";
    lines.push(`${k}: ${sv}`);
  }
  return lines.slice(0, 4).join("  ·  ") || "return to the session to review";
}

function beep() {
  if (muted) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = ac.currentTime;
    for (const [f, d] of [[920, 0], [1380, 0.11]]) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.2, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.17);
      o.connect(g).connect(ac.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.2);
    }
    setTimeout(() => ac.close().catch(() => {}), 700);
  } catch {}
}

/* ---------------- forms ---------------- */
const formVals = new Map(); // `${formID}:${key}` -> value
let lastFormSig = "";

const fkey = (fid, k) => `${fid}:${k}`;
const valOf = (fid, f) => {
  const k = fkey(fid, f.key);
  if (formVals.has(k)) return formVals.get(k);
  return f.default;
};
const cmp = (a, b) => (typeof a === "string" || typeof b === "string" ? String(a) === String(b) : a === b);
function fieldVisible(fid, f) {
  if (f.hidden) return false;
  for (const w of f.when ?? []) {
    const v = valOf(fid, { key: w.key });
    if (w.op === "eq" ? !cmp(v, w.value) : cmp(v, w.value)) return false;
  }
  return true;
}

function fieldHTML(fid, f) {
  const k = esc(f.key);
  const title = esc(f.title || f.key);
  const req = f.required ? " *" : "";
  const desc = f.description ? `<span class="fdesc">${esc(f.description)}</span>` : "";
  const v = valOf(fid, f);
  if (f.type === "external") {
    const url = String(f.url ?? "");
    return `<div class="frow"><a class="fext" data-furl="${esc(url)}">${esc(f.title || url)} ↗</a>${desc}</div>`;
  }
  if (f.type === "boolean") {
    return `<div class="frow"><label class="fcheck"><input type="checkbox" data-fid="${esc(fid)}" data-fkey="${k}"${v ? " checked" : ""}/> ${title}${req}</label>${desc}</div>`;
  }
  if (f.type === "multiselect") {
    const cur = Array.isArray(v) ? v : [];
    const boxes = (f.options ?? [])
      .map(
        (o) =>
          `<label><input type="checkbox" data-fid="${esc(fid)}" data-fkey="${k}" data-fopt="${esc(o.value)}"${cur.includes(o.value) ? " checked" : ""}/> ${esc(o.label)}</label>`,
      )
      .join("");
    return `<div class="frow"><label>${title}${req}</label><div class="fmulti">${boxes}</div>${desc}</div>`;
  }
  if (f.options?.length) {
    const opts = f.options
      .map((o) => `<option value="${esc(o.value)}"${v === o.value ? " selected" : ""}>${esc(o.label)}</option>`)
      .join("");
    const blank = f.required ? "" : `<option value=""${v === undefined || v === "" ? " selected" : ""}>—</option>`;
    return `<div class="frow"><label>${title}${req}</label><select data-fid="${esc(fid)}" data-fkey="${k}">${blank}${opts}</select>${desc}</div>`;
  }
  const type = f.type === "number" || f.type === "integer" ? "number" : f.format === "date" ? "date" : f.format === "date-time" ? "datetime-local" : "text";
  const step = f.type === "integer" ? ' step="1"' : "";
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : "";
  const sv = v === undefined || v === null ? "" : String(v);
  return `<div class="frow"><label>${title}${req}</label><input type="${type}"${step} data-fid="${esc(fid)}" data-fkey="${k}" value="${esc(sv)}"${ph}/>${desc}</div>`;
}

function formCardHTML(f) {
  const fields = (f.fields ?? []).filter((x) => fieldVisible(f.id, x)).map((x) => fieldHTML(f.id, x)).join("");
  return `
<div class="fcard" data-form="${esc(f.id)}" data-fsid="${esc(f.sessionID)}">
  <div class="ft"><span class="ic">▤</span>${esc(f.title || "Input required")}
    <button class="fx" data-fcancel="${esc(f.id)}" data-fsid="${esc(f.sessionID)}" title="Cancel form">✕</button>
  </div>
  <div class="fbody">${fields}</div>
  <div class="factions">
    <button class="fsend" data-fsend="${esc(f.id)}" data-fsid="${esc(f.sessionID)}">Send</button>
  </div>
</div>`;
}

const formsSig = (forms) => JSON.stringify(forms.map((f) => [f.id, f.title, f.fields]));

function renderForms(forms) {
  const sig = formsSig(forms);
  if (sig === lastFormSig) return;
  lastFormSig = sig;
  formsEl.innerHTML = forms.map(formCardHTML).join("");
}

function collectAnswer(fid, fields) {
  const answer = {};
  let bad = false;
  for (const f of fields) {
    if (f.type === "external" || !fieldVisible(fid, f)) continue;
    const v = valOf(fid, f);
    if (f.type === "boolean") {
      answer[f.key] = v === undefined ? !!f.default : !!v;
    } else if (f.type === "multiselect") {
      const arr = Array.isArray(v) ? v : Array.isArray(f.default) ? f.default : [];
      answer[f.key] = arr;
      if (f.required && !arr.length) bad = true;
    } else if (f.type === "number" || f.type === "integer") {
      if (v === undefined || v === "" || Number.isNaN(Number(v))) {
        if (f.required) bad = true;
      } else answer[f.key] = Number(v);
    } else {
      if (v === undefined || v === "") {
        if (f.required) bad = true;
      } else answer[f.key] = String(v);
    }
  }
  return bad ? null : answer;
}

/* ---------------- activity line ---------------- */
function activityLine(s) {
  if (s.status === "retry") return s.statusMessage ? { text: s.statusMessage, cls: "err", mark: "↻" } : { text: "waiting to retry…", cls: "", mark: "↻" };
  if (s.status !== "busy") return null;
  if (s.toolDetail) {
    const mark = s.toolStatus === "ok" ? "✓" : s.toolStatus === "err" ? "✕" : "…";
    const cls = s.toolStatus === "ok" ? "ok" : s.toolStatus === "err" ? "err" : "";
    return { text: s.toolDetail, cls, mark };
  }
  if (s.liveText) return { text: s.liveText, cls: "", mark: "»" };
  if (s.statusMessage) return { text: s.statusMessage, cls: "", mark: "…" };
  return s.lastTool ? { text: s.lastTool, cls: "", mark: "…" } : null;
}

/* ---------------- rendering ---------------- */
function render() {
  if (!snap) return;
  const now = Date.now();
  const perms = snap.permissions ?? [];
  const forms = snap.forms ?? [];
  const permed = new Set(perms.map((p) => p.sessionID));
  pinned = !!snap.pinned;
  muted = !!snap.muted;
  document.body.classList.toggle("atop", !!snap.atTop);
  document.body.dataset.theme = snap.theme || "notch";

  const fq = filter.trim().toLowerCase();
  const all = (snap.sessions ?? [])
    .filter((s) => s.status !== "idle" || (s.doneAt && now - s.doneAt < 45 * 60e3) || permed.has(s.id))
    .filter(
      (s) =>
        !fq ||
        [s.title, s.directory, s.modelID, s.agent, s.id, baseDir(s.directory)]
          .filter(Boolean)
          .some((x) => String(x).toLowerCase().includes(fq)),
    )
    .sort((a, b) => recency(b) - recency(a));
  function recency(s) {
    return Math.max(s.since ?? 0, s.doneAt ?? 0, s.updatedAt ?? 0);
  }
  const maxRows = fq ? 30 : 7;
  const active = all.slice(0, maxRows);

  const focused = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  const expanded = !dismissed && (pinned || hover || perms.length > 0 || forms.length > 0 || focused);
  frame.classList.toggle("ex", expanded);

  if (!target || !active.some((s) => s.id === target)) target = active[0]?.id ?? null;
  input.placeholder = target && (snap.sessions ?? []).length ? `reply → ${baseName(target)}` : "reply…";

  /* header */
  conn.className = `sdot ${snap.connected ? "done" : "off"}`;
  const busyN = active.filter((s) => s.status === "busy" || s.status === "retry").length;
  hstats.textContent = snap.connected
    ? [busyN ? `${busyN} running` : null, perms.length ? `${perms.length} approval${perms.length > 1 ? "s" : ""} needed` : null, forms.length ? `${forms.length} form${forms.length > 1 ? "s" : ""}` : null]
        .filter(Boolean)
        .join(" · ") || "idle"
    : "reconnecting…";
  pinBtn.classList.toggle("on", pinned);
  muteBtn.classList.toggle("off", muted);

  /* collapsed dots */
  const dots = [];
  for (const p of perms) dots.push('<span class="sdot att"></span>');
  for (const s of active) {
    if (dots.length >= 7) break;
    dots.push(`<span class="sdot ${statusClass(s, permed)}"></span>`);
  }
  pdots.innerHTML = dots.join("");

  /* permission cards */
  permslot.innerHTML = perms
    .map(
      (p) => `
<div class="pcard" data-pid="${esc(p.id)}">
  <div class="pt"><span class="ic">⚠</span>${esc(p.title || p.action || "Permission")}</div>
  <div class="pd">${esc(permDetail(p))}</div>
  <div class="pb">
    <button class="b1" data-act="once" data-pid="${esc(p.id)}" data-sid="${esc(p.sessionID)}">Allow once</button>
    <button class="b2" data-act="always" data-pid="${esc(p.id)}" data-sid="${esc(p.sessionID)}">Always</button>
    <button class="b3" data-act="reject" data-pid="${esc(p.id)}" data-sid="${esc(p.sessionID)}">Reject</button>
  </div>
</div>`,
    )
    .join("");

  /* session rows */
  rowsEl.innerHTML = active
    .map((s) => {
      const cls = statusClass(s, permed);
      const used = s.ctxUsed ?? 0;
      const limit = s.ctxLimit || limitFor(s);
      const pct = limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : null;
      const fillCls = pct > 92 ? "hot" : pct > 78 ? "warn" : "";
      let right = "";
      let rightErr = false;
      if (s.status === "retry") {
        right = [retryIn(s, now) ? `retry ${retryIn(s, now)}` : "retrying", s.attempt ? `#${s.attempt}` : null].filter(Boolean).join(" ");
        rightErr = !!s.error || !!s.statusMessage;
      } else if (s.status !== "idle") {
        right = fmtElapsed(now - (s.since ?? now));
      } else if (s.doneAt) {
        right = `done ${fmtAgo(now - s.doneAt)} ago`;
      }
      if (s.status !== "retry" && s.error) rightErr = true;
      const act = activityLine(s);
      const cost = fmtCost(s.cost ?? 0);
      return `
<div class="row ${target === s.id ? "tg" : ""}" data-sid="${esc(s.id)}">
  <span class="sdot ${cls}"></span>
  <div class="l1row">
    <div class="l1">
      <span class="stitle">${esc(s.title || "untitled session")}</span>
      <span class="stime ${rightErr ? "err" : ""}">${esc(s.error && s.status !== "retry" ? `${right} · error` : right)}</span>
    </div>
    <div class="l2">
      <span class="lmeta">
        <span class="sdir">${esc(baseDir(s.directory))}</span>
        <span class="sep">·</span>
        <span class="smodel">${esc(shortModel(s))}</span>
        ${s.lastTool ? `<span class="sep">·</span><span class="stool" title="${esc(s.lastTool)}">${esc(s.lastTool)}</span>` : ""}
      </span>
      ${cost ? `<span class="cost">${esc(cost)}</span>` : ""}
      ${s.status !== "idle" ? `<button class="ibtn" data-int="${esc(s.id)}" title="Interrupt">■</button>` : ""}
    </div>
    ${
      act
        ? `<div class="l3" title="${esc(act.text)}"><span class="tstat ${act.cls}">${act.mark}</span><span class="ltext">${esc(act.text)}</span></div>`
        : ""
    }
    <div class="lbar" title="context now ${fmtTok(used)} tok · session total ${fmtTok(totalTokens(s))} tok">
      <span class="spct">${limit ? `ctx ${fmtTok(used)} / ${fmtTok(limit)}` : (used ? `ctx ${fmtTok(used)}` : "\u00a0")}${pct !== null ? ` · ${pct}%` : ""}</span>
      ${pct !== null ? `<span class="btrack"><span class="bfill ${fillCls}" style="width:${pct}%"></span></span>` : ""}
    </div>
  </div>
</div>`;
    })
    .join("");

  /* forms */
  renderForms(forms);

  /* totals */
  const sumCost = active.reduce((a, s) => a + (s.cost ?? 0), 0);
  const sumTok = active.reduce((a, s) => a + totalTokens(s), 0);
  sumEl.innerHTML =
    active.length && !fq
      ? `Σ <b>${active.length}</b> session${active.length > 1 ? "s" : ""} · <b>${busyN}</b> running · ${fmtTok(sumTok)} tok${sumCost > 0 ? ` · <b>${esc(fmtCost(sumCost))}</b>` : ""}`
      : active.length
        ? `${active.length} match${active.length > 1 ? "es" : ""}`
        : "";
}

window.addEventListener("error", (e) =>
  console.error("app.js error:", e.message, "@", e.filename, e.lineno),
);
/* ---------------- measure → dynamic window size ---------------- */
function measure() {
  const el = frame.classList.contains("ex") ? panel : pill;
  const r = el.getBoundingClientRect();
  notch.setSize?.(Math.ceil(r.width), Math.ceil(r.height + 2));
}

/* ---------------- events ---------------- */
notch.state((s) => {
  if (!rendered) {
    rendered = true;
    for (const p of s.permissions ?? []) seenPerms.add(p.id);
    for (const f of s.forms ?? []) seenForms.add(f.id);
  } else {
    for (const p of s.permissions ?? []) {
      if (!seenPerms.has(p.id)) {
        seenPerms.add(p.id);
        beep();
      }
    }
    for (const f of s.forms ?? []) {
      if (!seenForms.has(f.id)) {
        seenForms.add(f.id);
        beep();
      }
    }
  }
  snap = s;
  window._snap = s;
  if (typeof s.hover === "boolean") hover = s.hover;
  render();
  requestAnimationFrame(measure);
});
notch.ready().then((ok) => {
  if (!ok) setTimeout(() => notch.ready(), 1000);
});
setInterval(() => {
  if (!snap) return;
  render();
  requestAnimationFrame(measure);
}, 1000);

/* hover with hysteresis: window resizes on expand/collapse — the 350ms
   delay on leave absorbs synthetic enter/leave churn from the resize */
notch.hover?.((v) => {
  hover = v;
  if (!v) dismissed = false;
  render();
  requestAnimationFrame(measure);
});

/* ---------------- interaction ---------------- */
filterEl.addEventListener("input", () => {
  filter = filterEl.value;
  render();
  requestAnimationFrame(measure);
});
document.getElementById("q").addEventListener("click", () => {
  dismissed = true;
  pinned = false;
  notch.pin(false);
  document.activeElement?.blur?.();
  render();
  requestAnimationFrame(measure);
});
pinBtn.addEventListener("click", () => {
  pinned = !pinned;
  notch.pin(pinned);
  render();
  requestAnimationFrame(measure);
});
muteBtn.addEventListener("click", () => {
  muted = !muted;
  notch.mute(muted);
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    filterEl.value = "";
    filter = "";
    if (pinned) {
      pinned = false;
      notch.pin(false);
    }
    dismissed = true;
    if (["BODY", "INPUT"].includes(document.activeElement?.tagName)) document.activeElement?.blur?.();
    render();
    requestAnimationFrame(measure);
  }
});

/* form value tracking + conditional visibility re-render */
function formValueFrom(el) {
  const fid = el.dataset.fid;
  const key = fkey(fid, el.dataset.fkey);
  if (el.type === "checkbox") {
    if (el.dataset.fopt) {
      const cur = new Set(Array.isArray(formVals.get(key)) ? formVals.get(key) : []);
      el.checked ? cur.add(el.dataset.fopt) : cur.delete(el.dataset.fopt);
      formVals.set(key, [...cur]);
    } else formVals.set(key, el.checked);
  } else formVals.set(key, el.value);
}
formsEl.addEventListener("input", (e) => {
  const el = e.target.closest("[data-fkey]");
  if (!el) return;
  formValueFrom(el);
  const tag = el.tagName === "SELECT" || el.type === "checkbox";
  const drivesCondition = (snap?.forms ?? []).some((f) => (f.fields ?? []).some((x) => (x.when ?? []).some((w) => w.key === el.dataset.fkey)));
  if (tag && drivesCondition) {
    lastFormSig = "";
    render();
    requestAnimationFrame(measure);
  }
});
formsEl.addEventListener("change", (e) => {
  const el = e.target.closest("[data-fkey]");
  if (!el) return;
  formValueFrom(el);
});

document.addEventListener("click", async (e) => {
  const ext = e.target.closest("[data-furl]");
  if (ext) {
    notch.openExternal(ext.dataset.furl);
    return;
  }
  const fsend = e.target.closest("[data-fsend]");
  if (fsend) {
    const fid = fsend.dataset.fsend;
    const form = (snap?.forms ?? []).find((f) => f.id === fid);
    if (!form) return;
    const answer = collectAnswer(fid, form.fields ?? []);
    if (!answer) {
      fsend.textContent = "fill required";
      setTimeout(() => (fsend.textContent = "Send"), 1400);
      return;
    }
    fsend.disabled = true;
    fsend.textContent = "sending…";
    const res = await notch.formReply(form.sessionID, fid, answer);
    if (!res?.ok) {
      fsend.disabled = false;
      fsend.textContent = "✕ retry";
      setTimeout(() => (fsend.textContent = "Send"), 1400);
    }
    return;
  }
  const fcancel = e.target.closest("[data-fcancel]");
  if (fcancel) {
    fcancel.disabled = true;
    await notch.formCancel(fcancel.dataset.fsid, fcancel.dataset.fcancel);
    return;
  }
  const actBtn = e.target.closest("[data-act]");
  if (actBtn) {
    const btns = actBtn.parentElement.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    const res = await notch.permReply(actBtn.dataset.sid, actBtn.dataset.pid, actBtn.dataset.act);
    if (!res?.ok) {
      btns.forEach((b) => (b.disabled = false));
      const orig = actBtn.textContent;
      actBtn.textContent = "✕";
      setTimeout(() => (actBtn.textContent = orig), 1200);
    } else render();
    return;
  }
  const intBtn = e.target.closest("[data-int]");
  if (intBtn) {
    intBtn.disabled = true;
    await notch.interrupt(intBtn.dataset.int);
    return;
  }
  const row = e.target.closest(".row");
  if (row && row.dataset.sid) {
    target = row.dataset.sid;
    input.focus();
    input.placeholder = `reply → ${baseName(target)}`;
    render();
  }
});

input.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const v = input.value.trim();
  if (!v || !target) return;
  input.value = "";
  input.placeholder = "sending…";
  await notch.prompt(target, v);
});
