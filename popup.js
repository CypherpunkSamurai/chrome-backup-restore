"use strict";

// ─── Tab navigation ────────────────────────────────────────────────────────────
const tabList = [...document.querySelectorAll(".tab")];
const panelList = [...document.querySelectorAll(".panel")];

tabList.forEach(tab => {
  tab.addEventListener("click", () => {
    tabList.forEach(t => {
      const on = t === tab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    });
    panelList.forEach(p => p.classList.remove("active"));
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add("active");
  });
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Copy: "1 origin" / "3 origins". The (s) form reads as machine output.
function plural(n, singular, pluralForm = singular + "s") {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

// User-facing copy starts lowercase; the status icon carries the state.
function sentence(msg) {
  return msg.charAt(0).toLowerCase() + msg.slice(1);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_ICON = { success: "i-check", error: "i-error", warn: "i-alert", idle: "i-info" };

function setStatus(el, type, msg) {
  el.className = `status ${type}`;
  if (type === "loading") {
    el.innerHTML = `<span class="spinner"></span><span>${esc(msg)}</span>`;
  } else {
    const icon = STATUS_ICON[type];
    el.textContent = "";
    if (icon) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "icon");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", `#${icon}`);
      svg.appendChild(use);
      el.appendChild(svg);
    }
    el.appendChild(document.createTextNode(msg));
  }
}

function triggerDownload(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function readFile(input) {
  return new Promise((resolve, reject) => {
    const file = input.files[0];
    if (!file) return reject(new Error("No file picked. Choose a .json file and try again."));
    const reader = new FileReader();
    reader.onload = e => {
      try { resolve(JSON.parse(e.target.result)); }
      catch (err) { reject(new Error("This file is not valid JSON. Export again, then import that file.")); }
    };
    reader.onerror = () => reject(new Error("Could not read that file. Check it still exists, then try again."));
    reader.readAsText(file);
  });
}

function openFilePicker(input) {
  return new Promise(resolve => {
    input.value = "";
    input.onchange = () => resolve();
    input.click();
  });
}

function setProgress(fillEl, pctEl, labelEl, wrapEl, pct, label) {
  wrapEl.hidden = false;
  fillEl.style.transform = `scaleX(${Math.max(0, Math.min(1, pct / 100))})`;
  pctEl.textContent = `${Math.round(pct)}%`;
  if (label) labelEl.textContent = label;
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ─── EXTENSIONS ────────────────────────────────────────────────────────────────
const extStatus = document.getElementById("ext-status");

document.getElementById("ext-export").addEventListener("click", async () => {
  setStatus(extStatus, "loading", "Fetching extensions…");
  try {
    const includeDisabled = document.getElementById("ext-include-disabled").checked;
    const includeChrome   = document.getElementById("ext-include-chrome").checked;

    const all = await chrome.management.getAll();
    let exts = all.filter(e => {
      if (!includeDisabled && !e.enabled) return false;
      if (!includeChrome && (e.installType === "other" && e.id.length < 10)) return false;
      return true;
    });

    const data = {
      exportedAt: new Date().toISOString(),
      count: exts.length,
      extensions: exts.map(e => ({
        id: e.id,
        name: e.name,
        version: e.version,
        description: e.description,
        enabled: e.enabled,
        installType: e.installType,
        type: e.type,
        homepageUrl: e.homepageUrl || null,
        icons: e.icons || [],
      }))
    };

    triggerDownload(`extensions-${ts()}.json`, data);
    setStatus(extStatus, "success", `Exported ${plural(exts.length, "extension")}`);
  } catch (err) {
    setStatus(extStatus, "error", sentence(err.message));
  }
});

const extPreview = document.getElementById("ext-preview");
const extListEl  = document.getElementById("ext-preview-list");
const extSelAll  = document.getElementById("ext-select-all");
const extCount   = document.getElementById("ext-preview-count");
const extApply   = document.getElementById("ext-apply");
const extCancel  = document.getElementById("ext-cancel");
const extStart   = document.getElementById("ext-start");

// The start row and the preview actions are the same choice at two different
// stages, so only one of them is ever on screen.
function setExtStage(stage) {
  extStart.hidden = stage === "preview";
  extPreview.hidden = stage !== "preview";
}

let extPending = []; // parsed entries awaiting confirmation

document.getElementById("ext-import").addEventListener("click", async () => {
  const fileInput = document.getElementById("ext-file");
  await openFilePicker(fileInput);
  if (!fileInput.files[0]) return;

  setStatus(extStatus, "loading", "Parsing file…");
  try {
    const data = await readFile(fileInput);
    const list = data?.extensions ?? data;
    if (!Array.isArray(list)) throw new Error("This file is not an extension export. Pick a file exported from the Extensions tab.");

    const seen = new Set();
    const valid = list.filter(e => {
      if (!e || typeof e.id !== "string" || typeof e.enabled !== "boolean") return false;
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    const installed = await chrome.management.getAll();
    const installedMap = new Map(installed.map(e => [e.id, e]));

    extPending = valid;
    renderExtPreview(installedMap);
    setStatus(extStatus, "idle", `${plural(valid.length, "extension")} parsed. Pick the ones to import.`);
  } catch (err) {
    setStatus(extStatus, "error", sentence(err.message));
  }
});

function renderExtPreview(installedMap) {
  extListEl.innerHTML = "";

  extPending.forEach((item, idx) => {
    const current = installedMap.get(item.id);
    let badgeText, badgeClass;
    if (!current) {
      badgeText = (item.installType === "normal" && /^[a-z]{32}$/.test(item.id))
        ? "store page" : "missing";
      badgeClass = "missing";
    } else if (current.enabled === item.enabled) {
      badgeText = "unchanged";
      badgeClass = "";
    } else {
      badgeText = item.enabled ? "enable" : "disable";
      badgeClass = "change";
    }

    const row = document.createElement("label");
    row.className = "ext-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "ext-check";
    cb.checked = true;
    cb.dataset.idx = idx;
    cb.addEventListener("change", syncExtSelection);

    const meta = document.createElement("span");
    meta.className = "ext-meta";
    const name = document.createElement("span");
    name.className = "ext-name";
    name.textContent = item.name || item.id;
    const sub = document.createElement("span");
    sub.className = "ext-sub";
    sub.textContent = `v${item.version || "?"} · ${item.id}`;
    meta.append(name, sub);

    const badge = document.createElement("span");
    badge.className = `ext-badge ${badgeClass}`.trim();
    badge.textContent = badgeText;

    row.append(cb, meta, badge);
    extListEl.appendChild(row);
  });

  setExtStage("preview");
  syncExtSelection();
}

function syncExtSelection() {
  const boxes = [...extListEl.querySelectorAll(".ext-check")];
  const n = boxes.filter(cb => cb.checked).length;
  extCount.textContent = `${n} of ${boxes.length}`;
  extApply.querySelector(".btn-label").textContent = n > 0 ? `Import ${n} selected` : "Import";
  extApply.disabled = n === 0;
  extSelAll.checked = boxes.length > 0 && n === boxes.length;
  extSelAll.indeterminate = n > 0 && n < boxes.length;
}

extSelAll.addEventListener("change", () => {
  extListEl.querySelectorAll(".ext-check").forEach(cb => { cb.checked = extSelAll.checked; });
  syncExtSelection();
});

extCancel.addEventListener("click", () => {
  extPending = [];
  setExtStage("start");
  setStatus(extStatus, "idle", "");
});

extApply.addEventListener("click", async () => {
  const selected = [...extListEl.querySelectorAll(".ext-check")]
    .filter(cb => cb.checked)
    .map(cb => extPending[Number(cb.dataset.idx)]);
  if (selected.length === 0) return;

  extApply.disabled = true;
  extCancel.disabled = true;
  setStatus(extStatus, "loading", "Applying extension states…");
  try {
    const installed = await chrome.management.getAll();
    const installedMap = new Map(installed.map(e => [e.id, e]));

    let toggled = 0, alreadyOk = 0, failed = 0;
    const missing = [];

    for (const ext of selected) {
      const current = installedMap.get(ext.id);

      if (!current) {
        // Only queue extensions from the Web Store (32-char IDs, installType=normal)
        if (ext.installType === "normal" && /^[a-z]{32}$/.test(ext.id)) {
          missing.push(ext);
        }
        continue;
      }

      if (current.enabled !== ext.enabled) {
        try {
          await chrome.management.setEnabled(ext.id, ext.enabled);
          toggled++;
        } catch { failed++; }
      } else {
        alreadyOk++;
      }
    }

    let msg = "";
    if (missing.length > 0) {
      msg = `Opening the Web Store for ${plural(missing.length, "extension")} you do not have. Install ${missing.length === 1 ? "it" : "them"} there.`;
      setStatus(extStatus, "warn", msg);

      // Open CWS pages in batches to avoid popup blocker (max 5 at a time)
      const CWS = "https://chromewebstore.google.com/detail/";
      for (let i = 0; i < missing.length; i += 5) {
        const batch = missing.slice(i, i + 5);
        for (const ext of batch) {
          await chrome.tabs.create({
            url: `${CWS}${ext.id}`,
            active: false,
          });
        }
        if (i + 5 < missing.length) {
          await new Promise(r => setTimeout(r, 800));
        }
      }
    }

    const parts = [];
    if (toggled > 0) parts.push(`${plural(toggled, "state")} updated`);
    if (alreadyOk > 0) parts.push(`${plural(alreadyOk, "extension", "extensions")} already correct`);
    if (failed > 0) parts.push(`${plural(failed, "failure")}`);
    if (missing.length > 0) parts.push(`${plural(missing.length, "Web Store tab")} opened`);

    extPending = [];
    setExtStage("start");
    setStatus(extStatus, failed > 0 ? "warn" : "success", parts.join(", "));
  } catch (err) {
    syncExtSelection();
    setStatus(extStatus, "error", sentence(err.message));
  }
});

// ─── BOOKMARKS ─────────────────────────────────────────────────────────────────
const bmStatus = document.getElementById("bm-status");

document.getElementById("bm-export").addEventListener("click", async () => {
  setStatus(bmStatus, "loading", "Fetching bookmarks…");
  try {
    const tree = await chrome.bookmarks.getTree();
    const data = {
      exportedAt: new Date().toISOString(),
      tree
    };
    triggerDownload(`bookmarks-${ts()}.json`, data);
    // Count total bookmarks
    let count = 0;
    function countNodes(nodes) {
      for (const n of nodes) {
        if (n.url) count++;
        if (n.children) countNodes(n.children);
      }
    }
    countNodes(tree);
    setStatus(bmStatus, "success", `Exported ${plural(count, "bookmark")}`);
  } catch (err) {
    setStatus(bmStatus, "error", sentence(err.message));
  }
});

document.getElementById("bm-import").addEventListener("click", async () => {
  const fileInput = document.getElementById("bm-file");
  await openFilePicker(fileInput);
  if (!fileInput.files[0]) return;

  setStatus(bmStatus, "loading", "Importing bookmarks…");
  try {
    const data = await readFile(fileInput);
    const tree = data.tree || data;
    if (!Array.isArray(tree)) throw new Error("This file is not a bookmark export. Pick a file exported from the Bookmarks tab.");

    let created = 0;
    let failed = 0;

    async function importNode(node, parentId) {
      if (!node) return;
      // Skip the root synthetic nodes (id "0", "1", "2")
      if (node.id === "0") {
        if (node.children) {
          for (const child of node.children) await importNode(child, parentId);
        }
        return;
      }

      if (node.url) {
        // It's a bookmark
        try {
          await chrome.bookmarks.create({ parentId, title: node.title || "", url: node.url });
          created++;
        } catch { failed++; }
      } else if (node.title || node.children) {
        // It's a folder
        let folderId = parentId;
        if (node.title && node.title !== "Bookmarks bar" && node.title !== "Other bookmarks" && node.title !== "Mobile bookmarks") {
          try {
            const folder = await chrome.bookmarks.create({ parentId, title: node.title });
            folderId = folder.id;
          } catch { /* use parent */ }
        }
        if (node.children) {
          for (const child of node.children) await importNode(child, folderId);
        }
      }
    }

    // Import under "Other bookmarks" (id "2") by default
    for (const root of tree) {
      await importNode(root, "2");
    }

    setStatus(bmStatus, "success", `Imported ${plural(created, "bookmark")}${failed > 0 ? `, ${plural(failed, "failure")}` : ""}`);
  } catch (err) {
    setStatus(bmStatus, "error", sentence(err.message));
  }
});

// ─── HISTORY ───────────────────────────────────────────────────────────────────
const histStatus   = document.getElementById("hist-status");
const histProgress = document.getElementById("hist-progress");
const histFill     = document.getElementById("hist-prog-fill");
const histPct      = document.getElementById("hist-prog-pct");
const histLabel    = document.getElementById("hist-prog-label");

// The field shell draws the border, so the stepper only moves the value and
// keeps the native spin buttons out of the paint. A step stops at min and max,
// and an empty or unparsable field restarts from the min, so a step from a
// blank box always lands on a legal value.
const histLimit = document.getElementById("history-limit");

function stepField(input, dir) {
  const min = Number(input.min);
  const max = Number(input.max);
  const step = Number(input.step) || 1;
  const current = parseInt(input.value, 10);
  const base = Number.isNaN(current) ? min : current;
  const next = Math.min(max, Math.max(min, base + dir * step));
  input.value = String(next);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function syncFieldSteps() {
  const input = histLimit;
  const min = Number(input.min);
  const max = Number(input.max);
  const current = parseInt(input.value, 10);
  const base = Number.isNaN(current) ? min : current;
  document.querySelectorAll(`.field-step[data-for="${input.id}"]`).forEach(btn => {
    const dir = Number(btn.dataset.dir);
    const next = base + dir * (Number(input.step) || 1);
    btn.disabled = next > max || next < min;
  });
}

document.querySelectorAll(".field-step").forEach(btn => {
  const input = document.getElementById(btn.dataset.for);
  // Stepping must never submit or steal focus, because the caret belongs to
  // the number field for as long as the popup stays open.
  btn.addEventListener("pointerdown", e => e.preventDefault());
  btn.addEventListener("click", () => stepField(input, Number(btn.dataset.dir)));
});

histLimit.addEventListener("input", syncFieldSteps);
histLimit.addEventListener("change", syncFieldSteps);
syncFieldSteps();

document.getElementById("hist-export").addEventListener("click", async () => {
  setStatus(histStatus, "loading", "Fetching history…");
  try {
    const limitVal = parseInt(document.getElementById("history-limit").value, 10);
    const maxResults = (isNaN(limitVal) || limitVal < 0) ? 2147483647 : limitVal;
    const items = await chrome.history.search({
      text: "",
      maxResults,
      startTime: 0,
    });

    const data = {
      exportedAt: new Date().toISOString(),
      count: items.length,
      history: items.map(h => ({
        id: h.id,
        url: h.url,
        title: h.title || "",
        lastVisitTime: h.lastVisitTime,
        visitCount: h.visitCount,
        typedCount: h.typedCount,
      }))
    };

    triggerDownload(`history-${ts()}.json`, data);
    setStatus(histStatus, "success", `Exported ${plural(items.length, "entry", "entries")}`);
  } catch (err) {
    setStatus(histStatus, "error", sentence(err.message));
  }
});

document.getElementById("hist-import").addEventListener("click", async () => {
  const fileInput = document.getElementById("hist-file");
  await openFilePicker(fileInput);
  if (!fileInput.files[0]) return;

  setStatus(histStatus, "loading", "Reading file…");
  histProgress.hidden = true;

  try {
    const data = await readFile(fileInput);
    const list = data.history || data;
    if (!Array.isArray(list)) throw new Error("This file is not a history export. Pick a file exported from the History tab.");

    // Import oldest first — Chrome stamps addUrl with current time,
    // so the last entry added ends up most recent in history.
    list.sort((a, b) => (a.lastVisitTime || 0) - (b.lastVisitTime || 0));

    let added = 0, failed = 0;
    const total = list.length;
    const batchSize = 50;

    setProgress(histFill, histPct, histLabel, histProgress, 0, "Importing history…");

    for (let i = 0; i < total; i += batchSize) {
      const batch = list.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(async item => {
        if (!item.url) { failed++; return; }
        // chrome.history.addUrl only supports http/https URLs
        if (!/^https?:\/\//i.test(item.url)) { failed++; return; }
        try {
          // addUrl only accepts {url} — no other fields
          await chrome.history.addUrl({ url: item.url });
          added++;
        } catch { failed++; }
      }));

      const pct = Math.min(100, ((i + batchSize) / total) * 100);
      setProgress(histFill, histPct, histLabel, histProgress, pct, `Importing ${Math.min(i + batchSize, total)} / ${total}…`);
    }

    histProgress.hidden = true;
    setStatus(histStatus, failed > 0 ? "warn" : "success",
      `Imported ${plural(added, "entry", "entries")}${failed > 0 ? `, ${plural(failed, "failure")}` : ""}`);
  } catch (err) {
    histProgress.hidden = true;
    setStatus(histStatus, "error", sentence(err.message));
  }
});

// ─── COOKIES ───────────────────────────────────────────────────────────────────
const ckStatus   = document.getElementById("ck-status");
const ckProgress = document.getElementById("ck-progress");
const ckFill     = document.getElementById("ck-prog-fill");
const ckPct      = document.getElementById("ck-prog-pct");
const ckLabel    = document.getElementById("ck-prog-label");

document.getElementById("ck-export").addEventListener("click", async () => {
  setStatus(ckStatus, "loading", "Fetching cookies…");
  try {
    const cookies = await chrome.cookies.getAll({});

    const data = {
      exportedAt: new Date().toISOString(),
      count: cookies.length,
      cookies: cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate,
        session: c.session,
        storeId: c.storeId,
      }))
    };

    triggerDownload(`cookies-${ts()}.json`, data);
    setStatus(ckStatus, "success", `Exported ${plural(cookies.length, "cookie")} from ${plural(new Set(cookies.map(c => c.domain)).size, "domain")}`);
  } catch (err) {
    setStatus(ckStatus, "error", sentence(err.message));
  }
});

document.getElementById("ck-import").addEventListener("click", async () => {
  const fileInput = document.getElementById("ck-file");
  await openFilePicker(fileInput);
  if (!fileInput.files[0]) return;

  setStatus(ckStatus, "loading", "Reading file…");
  ckProgress.hidden = true;

  try {
    const data = await readFile(fileInput);
    const list = data.cookies || data;
    if (!Array.isArray(list)) throw new Error("This file is not a cookie export. Pick a file exported from the Cookies tab.");

    let set = 0, failed = 0;
    const total = list.length;
    const batchSize = 20;
    const oneYearFromNow = (Date.now() / 1000) + (365 * 24 * 60 * 60);

    setProgress(ckFill, ckPct, ckLabel, ckProgress, 0, "Setting cookies…");

    for (let i = 0; i < total; i += batchSize) {
      const batch = list.slice(i, i + batchSize);

      await Promise.allSettled(batch.map(async cookie => {
        try {
          const domain = cookie.domain;
          if (!domain) { failed++; return; }

          const scheme = cookie.secure ? "https" : "http";
          const cleanDomain = domain.startsWith(".") ? domain.slice(1) : domain;
          const url = `${scheme}://${cleanDomain}${cookie.path || "/"}`;

          // Normalize sameSite — Chrome API only accepts these exact values
          const sameSiteMap = {
            no_restriction: "no_restriction",
            lax: "lax",
            strict: "strict",
            unspecified: "unspecified",
            // handle variants that may appear in exports
            none: "no_restriction",
            "": "unspecified",
          };
          const sameSite = sameSiteMap[(cookie.sameSite || "").toLowerCase()] ?? "unspecified";

          // Skip cookies whose expiry has already passed
          const now = Date.now() / 1000;
          if (!cookie.session && cookie.expirationDate && cookie.expirationDate < now) {
            failed++;
            return;
          }

          const cookieDetails = {
            url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || "/",
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
            sameSite,
            // storeId intentionally omitted — store IDs differ across profiles
          };

          if (!cookie.session && cookie.expirationDate) {
            cookieDetails.expirationDate = cookie.expirationDate;
          } else {
            cookieDetails.expirationDate = oneYearFromNow;
          }

          await chrome.cookies.set(cookieDetails);
          set++;
        } catch { failed++; }
      }));

      const pct = Math.min(100, ((i + batchSize) / total) * 100);
      setProgress(ckFill, ckPct, ckLabel, ckProgress, pct, `Setting ${Math.min(i + batchSize, total)} / ${total}…`);
    }

    ckProgress.hidden = true;
    setStatus(ckStatus, failed > 0 ? "warn" : "success",
      `Set ${plural(set, "cookie")}${failed > 0 ? `, ${plural(failed, "failure")}` : ""}`);
  } catch (err) {
    ckProgress.hidden = true;
    setStatus(ckStatus, "error", sentence(err.message));
  }
});

// ─── WEB STORAGE (LOCAL + SESSION) ────────────────────────────────────────────
const stStatus   = document.getElementById("st-status");
const stPreview  = document.getElementById("st-preview");
const stListEl   = document.getElementById("st-preview-list");
const stSelAll   = document.getElementById("st-select-all");
const stCount    = document.getElementById("st-preview-count");
const stApply    = document.getElementById("st-apply");
const stCancel   = document.getElementById("st-cancel");
const stStart    = document.getElementById("st-start");

// Same two-stage rule as the extensions panel.
function setStStage(stage) {
  stStart.hidden = stage === "preview";
  stPreview.hidden = stage !== "preview";
}
const stProgress = document.getElementById("st-progress");
const stFill     = document.getElementById("st-prog-fill");
const stPct      = document.getElementById("st-prog-pct");
const stLabel    = document.getElementById("st-prog-label");

let stPending = []; // parsed origins awaiting confirmation

// Reads window.localStorage/sessionStorage in the page's context. Returns {}
// when blocked (e.g. sandboxed frames).
async function readWebStorage(tabId, storageType) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: type => {
      try {
        return Object.fromEntries(Object.entries(window[type]));
      } catch {
        return {};
      }
    },
    args: [storageType],
  });
  return results[0]?.result || {};
}

// Resolves when the tab finishes loading, or false after a timeout.
function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => done(false), timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") done(true);
    };
    const done = result => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(result);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Finds a tab already on the origin, or opens one in the background and waits
// for it to finish loading. Returns the tabId or null.
async function ensureOriginTab(origin) {
  const tabs = await chrome.tabs.query({ url: origin + "/*" });
  if (tabs.length > 0) return tabs[0].id;

  const tab = await chrome.tabs.create({ url: origin + "/", active: false });
  const ok = await waitForTabComplete(tab.id);
  return ok ? tab.id : null;
}

// Opens a temporary background tab for an origin that has no open tab, reads
// its persisted localStorage, then closes the tab. sessionStorage is empty by
// definition in a fresh tab, so it is not collected here.
async function readFreshTabStorage(origin) {
  const tab = await chrome.tabs.create({ url: origin + "/", active: false });
  try {
    const ok = await waitForTabComplete(tab.id);
    if (!ok) throw new Error("The page did not load in time. Close heavy tabs and try again.");
    return await readWebStorage(tab.id, "localStorage");
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// Most-recently-visited http(s) origins from browsing history that are not
// already covered by open tabs, capped to keep the crawl bounded.
async function getHistoryOrigins(known, cap = 50) {
  const items = await chrome.history.search({ text: "", maxResults: 500, startTime: 0 });
  const latest = new Map();
  for (const item of items) {
    if (!item.url || !item.url.startsWith("http")) continue;
    let origin;
    try { origin = new URL(item.url).origin; } catch { continue; }
    if (known.has(origin)) continue;
    const t = item.lastVisitTime || 0;
    const prev = latest.get(origin);
    if (prev === undefined || prev < t) latest.set(origin, t);
  }
  return [...latest.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(e => e[0]);
}

document.getElementById("st-export").addEventListener("click", async () => {
  setStatus(stStatus, "loading", "Scanning open tabs…");
  try {
    const includeHistory = document.getElementById("st-include-history").checked;
    const tabs = await chrome.tabs.query({});
    const byOrigin = new Map();
    for (const tab of tabs) {
      if (!tab.url || !tab.url.startsWith("http") || !tab.id) continue;
      let origin;
      try { origin = new URL(tab.url).origin; } catch { continue; }
      if (!byOrigin.has(origin)) byOrigin.set(origin, tab.id);
    }

    if (byOrigin.size === 0 && !includeHistory) {
      throw new Error("No sites to export. Open a page in the tab you want to capture.");
    }

    const targets = [...byOrigin.entries()].map(([origin, tabId]) => ({ origin, tabId }));

    if (includeHistory) {
      setStatus(stStatus, "loading", "Collecting history origins…");
      const histOrigins = await getHistoryOrigins(new Set(byOrigin.keys()));
      for (const origin of histOrigins) targets.push({ origin, tabId: null });
    }

    if (targets.length === 0) throw new Error("No sites to export. Open a page in the tab you want to capture.");

    setProgress(stFill, stPct, stLabel, stProgress, 0, "Reading storage…");
    const stored = {};
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      const { origin, tabId } = targets[i];
      try {
        let local, session;
        if (tabId != null) {
          [local, session] = await Promise.all([
            readWebStorage(tabId, "localStorage"),
            readWebStorage(tabId, "sessionStorage"),
          ]);
        } else {
          local = await readFreshTabStorage(origin);
          session = {}; // sessionStorage does not persist across tabs
        }
        if (Object.keys(local).length > 0 || Object.keys(session).length > 0) {
          stored[origin] = { local, session };
        }
      } catch { failed++; }
      setProgress(stFill, stPct, stLabel, stProgress,
        ((i + 1) / targets.length) * 100,
        `Reading ${i + 1} / ${targets.length}…`);
    }

    stProgress.hidden = true;

    const count = Object.keys(stored).length;
    if (count === 0) {
      setStatus(stStatus, "warn", `No web storage found. ${plural(failed, "site")} could not be read.`);
      return;
    }

    triggerDownload(`webstorage-${ts()}.json`, {
      exportedAt: new Date().toISOString(),
      count,
      origins: stored,
    });
    setStatus(stStatus, failed > 0 ? "warn" : "success",
      `Exported ${plural(count, "origin")}${failed > 0 ? `, ${plural(failed, "site")} skipped` : ""}`);
  } catch (err) {
    stProgress.hidden = true;
    setStatus(stStatus, "error", sentence(err.message));
  }
});

document.getElementById("st-import").addEventListener("click", async () => {
  const fileInput = document.getElementById("st-file");
  await openFilePicker(fileInput);
  if (!fileInput.files[0]) return;

  setStatus(stStatus, "loading", "Parsing file…");
  try {
    const data = await readFile(fileInput);
    const map = data.origins || data;
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      throw new Error("This file is not a storage export. Pick a file exported from the Storage tab.");
    }

    const isObj = v => v && typeof v === "object" && !Array.isArray(v);
    const valid = Object.entries(map).filter(([origin, items]) =>
      typeof origin === "string" &&
      /^https?:\/\//.test(origin) &&
      items && typeof items === "object" && !Array.isArray(items)
    ).map(([origin, items]) => {
      // Wrapped format {local:{},session:{}}; a flat map (string values only)
      // is treated as localStorage-only.
      const entry = isObj(items.local) || isObj(items.session)
        ? { local: items.local || {}, session: items.session || {} }
        : { local: items, session: {} };
      return { origin, ...entry };
    });
    if (valid.length === 0) throw new Error("No readable sites in this file. Export again with a page open.");

    stPending = valid;
    renderStPreview();
    setStatus(stStatus, "idle", `${plural(stPending.length, "origin")} parsed. Pick the ones to restore.`);
  } catch (err) {
    setStatus(stStatus, "error", sentence(err.message));
  }
});

function renderStPreview() {
  stListEl.innerHTML = "";

  stPending.forEach((item, idx) => {
    const nLocal = Object.keys(item.local).length;
    const nSession = Object.keys(item.session).length;

    const row = document.createElement("label");
    row.className = "ext-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "ext-check";
    cb.checked = true;
    cb.dataset.idx = idx;
    cb.addEventListener("change", syncStSelection);

    const meta = document.createElement("span");
    meta.className = "ext-meta";
    const name = document.createElement("span");
    name.className = "ext-name";
    name.textContent = item.origin;
    const sub = document.createElement("span");
    sub.className = "ext-sub";
    sub.textContent = `${plural(nLocal, "key")} local · ${plural(nSession, "key")} session`;
    meta.append(name, sub);

    const badge = document.createElement("span");
    badge.className = "ext-badge";
    badge.textContent = nLocal + nSession === 0 ? "empty" : "restore";
    if (nLocal + nSession > 0) badge.classList.add("change");

    row.append(cb, meta, badge);
    stListEl.appendChild(row);
  });

  setStStage("preview");
  syncStSelection();
}

function syncStSelection() {
  const boxes = [...stListEl.querySelectorAll(".ext-check")];
  const n = boxes.filter(cb => cb.checked).length;
  stCount.textContent = `${n} of ${boxes.length}`;
  stApply.querySelector(".btn-label").textContent = n > 0 ? `Import ${n} selected` : "Import";
  stApply.disabled = n === 0;
  stSelAll.checked = boxes.length > 0 && n === boxes.length;
  stSelAll.indeterminate = n > 0 && n < boxes.length;
}

stSelAll.addEventListener("change", () => {
  stListEl.querySelectorAll(".ext-check").forEach(cb => { cb.checked = stSelAll.checked; });
  syncStSelection();
});

stCancel.addEventListener("click", () => {
  stPending = [];
  setStStage("start");
  setStatus(stStatus, "idle", "");
});

stApply.addEventListener("click", async () => {
  const selected = [...stListEl.querySelectorAll(".ext-check")]
    .filter(cb => cb.checked)
    .map(cb => stPending[Number(cb.dataset.idx)]);
  if (selected.length === 0) return;

  stApply.disabled = true;
  stCancel.disabled = true;
  setStatus(stStatus, "loading", "Restoring web storage…");
  setStStage("start");
  try {
    let restored = 0, failed = 0;
    for (let i = 0; i < selected.length; i++) {
      const { origin, local, session } = selected[i];
      try {
        // ensureOriginTab returns null when the page never finishes loading.
        // That case is counted as a failure below, not shown on its own.
        const tabId = await ensureOriginTab(origin);
        if (!tabId) throw new Error("origin tab did not load");
        await chrome.scripting.executeScript({
          target: { tabId },
          func: data => {
            for (const [key, value] of Object.entries(data.local)) {
              window.localStorage.setItem(key, value);
            }
            for (const [key, value] of Object.entries(data.session)) {
              window.sessionStorage.setItem(key, value);
            }
          },
          args: [{ local, session }],
        });
        restored++;
      } catch { failed++; }
      setProgress(stFill, stPct, stLabel, stProgress,
        ((i + 1) / selected.length) * 100,
        `Restoring ${i + 1} / ${selected.length}…`);
    }

    stProgress.hidden = true;
    stPending = [];
    setStatus(stStatus, failed > 0 ? "warn" : "success",
      `Restored ${plural(restored, "origin")}${failed > 0 ? `, ${plural(failed, "failure")}` : ""}`);
  } catch (err) {
    stProgress.hidden = true;
    syncStSelection();
    setStatus(stStatus, "error", sentence(err.message));
  }
});
