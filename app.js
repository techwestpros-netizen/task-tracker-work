import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  addDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* -------------------------------
   Helpers
-------------------------------- */
const $ = (id) => document.getElementById(id);
const show = (el, yes) => { if (el) el.classList.toggle("hidden", !yes); };

const normalizeEmail = (email) => (email || "").trim().toLowerCase();
const emailDocId = (email) => normalizeEmail(email).replaceAll(".", "(dot)");

const displayNameFromEmail = (email) => {
  const local = (email || "").split("@")[0] || "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const slugifyId = (name) =>
  (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const fmtTime = (ts) => {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    if (!d) return "";
    return d.toLocaleString();
  } catch {
    return "";
  }
};

function yyyyMmDd(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseDateInput(val) {
  if (!val) return null;
  const [y, m, day] = val.split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day);
}
function eachDayInclusive(start, end) {
  const days = [];
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (let d = s; d <= e; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    days.push(yyyyMmDd(d));
  }
  return days;
}
function toNumberOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Percent helpers:
   - Store percent values as fraction (0.985)
   - Accept input as 0.985 OR 98.5 OR "98.5%"
*/
function percentToFraction(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) <= 1.5) return n;
  return n / 100;
}
function formatPercentFraction(f) {
  if (f === null || f === undefined) return "";
  const n = Number(f);
  if (!Number.isFinite(n)) return "";
  return `${(n * 100).toFixed(2)}%`;
}

/* -------------------------------
   Elements (must match index.html)
-------------------------------- */
const authCard = $("authCard");
const appShell = $("appShell");

const authEmail = $("authEmail");
const authPassword = $("authPassword");
const authMsg = $("authMsg");

const btnSignIn = $("btnSignIn");
const btnSignUp = $("btnSignUp");
const btnSendLink = $("btnSendLink");
const btnSignOut = $("btnSignOut");
const userPill = $("userPill");

const searchInput = $("searchInput");
const tabAdmin = $("tabAdmin");

const openList = $("openList");
const openEmpty = $("openEmpty");
const historyList = $("historyList");
const historyEmpty = $("historyEmpty");

const btnNewTask = $("btnNewTask");
const btnRefreshHistory = $("btnRefreshHistory"); // optional

// Modal
const backdrop = $("modalBackdrop");
const taskModal = $("taskModal");
const btnModalClose = $("btnModalClose");
const btnCancelTask = $("btnCancelTask");
const btnCreateTask = $("btnCreateTask");
const taskTitle = $("taskTitle");
const taskDesc = $("taskDesc");
const taskAssignTo = $("taskAssignTo");
const taskMsg = $("taskMsg");

// Admin allow-list
const allowEmail = $("allowEmail");
const allowRole = $("allowRole");
const btnAllowAdd = $("btnAllowAdd");
const btnAllowRemove = $("btnAllowRemove");
const adminMsg = $("adminMsg");
const allowedList = $("allowedList");
const allowedEmpty = $("allowedEmpty");

// CSA Summary
const csaCompanySelect = $("csaCompanySelect");
const csaStartDate = $("csaStartDate");
const csaEndDate = $("csaEndDate");
const btnCsaLoad = $("btnCsaLoad");
const btnCsaCreate = $("btnCsaCreate");
const btnCsaSave = $("btnCsaSave");
const csaMsg = $("csaMsg");
const csaTableWrap = $("csaTableWrap");

const companyName = $("companyName");
const btnCompanyAdd = $("btnCompanyAdd");
const companyList = $("companyList");

// Tabs
const allTabs = Array.from(document.querySelectorAll(".tab"));

/* -------------------------------
   State
-------------------------------- */
let currentUser = null;
let currentRole = null;

// Tasks
let unsubOpen = null;
let unsubHistory = null;
let openCache = [];
let histCache = [];

// Companies
let unsubCompanies = null;
let companiesCache = [];
let selectedCompanyId = null;

// CSA
let currentCsaMetricSet = null;
let currentCsaReportId = null;
let currentCsaValuesByDate = {};
let currentCsaDays = [];
let csaTotalsTds = [];

/* -------------------------------
   UI helpers
-------------------------------- */

/* -------------------------------
   Modal (no prompt/popups)
-------------------------------- */
let __modalEl = null;
function ensureModal() {
  if (__modalEl) return __modalEl;

  const overlay = document.createElement("div");
  overlay.id = "ttModalOverlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.55)";
  overlay.style.display = "none";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "9999";
  overlay.style.padding = "16px";

  const box = document.createElement("div");
  box.id = "ttModalBox";
  box.style.width = "min(560px, 100%)";
  box.style.borderRadius = "14px";
  box.style.border = "1px solid rgba(255,255,255,.12)";
  box.style.background = "rgba(20,20,24,.98)";
  box.style.boxShadow = "0 18px 60px rgba(0,0,0,.55)";
  box.style.padding = "14px";
  box.style.display = "grid";
  box.style.gap = "10px";

  const title = document.createElement("div");
  title.id = "ttModalTitle";
  title.style.fontWeight = "800";
  title.style.fontSize = "16px";

  const ta = document.createElement("textarea");
  ta.id = "ttModalTextarea";
  ta.rows = 4;
  ta.style.width = "100%";
  ta.style.resize = "vertical";
  ta.style.borderRadius = "10px";
  ta.style.border = "1px solid rgba(255,255,255,.12)";
  ta.style.padding = "10px";
  ta.style.background = "rgba(0,0,0,.25)";
  ta.style.color = "inherit";
  ta.style.font = "inherit";
  ta.style.outline = "none";

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "10px";
  row.style.justifyContent = "flex-end";

  const btnCancel = document.createElement("button");
  btnCancel.className = "btn";
  btnCancel.textContent = "Cancel";

  const btnOk = document.createElement("button");
  btnOk.className = "btn primary";
  btnOk.textContent = "Save";

  row.appendChild(btnCancel);
  row.appendChild(btnOk);

  box.appendChild(title);
  box.appendChild(ta);
  box.appendChild(row);
  overlay.appendChild(box);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(null);
  });

  document.body.appendChild(overlay);

  __modalEl = { overlay, box, title, ta, btnCancel, btnOk, resolver: null };
  btnCancel.onclick = () => closeModal(null);

  window.addEventListener("keydown", (e) => {
    if (overlay.style.display !== "flex") return;
    if (e.key === "Escape") closeModal(null);
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") closeModal((ta.value || "").trim());
  });

  return __modalEl;
}

function openTextModal(titleText, placeholder, initialValue) {
  const m = ensureModal();
  m.title.textContent = titleText || "Enter text";
  m.ta.placeholder = placeholder || "";
  m.ta.value = initialValue || "";
  m.overlay.style.display = "flex";
  setTimeout(() => m.ta.focus(), 0);
  return new Promise((resolve) => {
    m.resolver = resolve;
    m.btnOk.onclick = () => closeModal((m.ta.value || "").trim());
  });
}

function closeModal(val) {
  const m = ensureModal();
  m.overlay.style.display = "none";
  const r = m.resolver;
  m.resolver = null;
  if (typeof r === "function") r(val);
}

function setMsg(el, text, kind) {
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.className = "msg hidden";
    return;
  }
  el.textContent = text;
  el.className = "msg " + (kind || "");
  show(el, true);
}

function setSignedInUI(yes) {
  show(authCard, !yes);
  show(appShell, yes);
  show(btnSignOut, yes);
  show(userPill, yes);
}

function setRole(role) {
  currentRole = role;
  show(btnNewTask, role === "management");
  show(tabAdmin, role === "management");

  // CSA buttons only for management
  show(btnCompanyAdd, role === "management");
  show(btnCsaCreate, role === "management");
  show(btnCsaSave, role === "management");
}

function setTab(tab) {
  allTabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  show($("panel-open"), tab === "open");
  show($("panel-history"), tab === "history");
  show($("panel-csa"), tab === "csa");
  show($("panel-admin"), tab === "admin");
}

/* -------------------------------
   Allow-list check
-------------------------------- */
async function requireAllowedUser(user) {
  const email = normalizeEmail(user?.email);
  if (!email) return { ok: false, reason: "Missing email on account." };

  const snap = await getDoc(doc(db, "allowedUsers", emailDocId(email)));
  if (!snap.exists()) return { ok: false, reason: "This email is not allow-listed." };

  const d = snap.data() || {};
  const role = d.role;
  if (role !== "management" && role !== "user") return { ok: false, reason: "Allow-list entry missing role." };

  return { ok: true, role };
}

/* -------------------------------
   Tabs click
-------------------------------- */
allTabs.forEach(btn => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

/* -------------------------------
   Tasks
-------------------------------- */
function matchesSearch(task) {
  const q = (searchInput?.value || "").trim().toLowerCase();
  if (!q) return true;

  const hay = [
    task.title,
    task.desc,
    task.description,
    task.createdBy,
    task.assignedTo,
    (task.comments || []).map(c => `${c.by} ${c.text}`).join(" ")
  ].join(" ").toLowerCase();

  return hay.includes(q);
}

function renderTaskCard(t, isHistory) {
  const card = document.createElement("div");
  card.className = "task";

  const top = document.createElement("div");
  top.className = "task-top";

  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = t.title || "(untitled)";

  const meta = document.createElement("div");
  meta.className = "task-meta";

  const created = fmtTime(t.createdAt);
  const done = fmtTime(t.completedAt);

  if (isHistory) {
    meta.textContent = `Completed: ${done || ""} • By: ${t.completedBy || ""}`;
  } else {
    meta.textContent = `Created: ${created || ""} • By: ${t.createdBy || ""}` + (t.assignedTo ? ` • Assigned: ${t.assignedTo}` : "");
  }

  const left = document.createElement("div");
  left.appendChild(title);
  left.appendChild(meta);

  const badge = document.createElement("div");
  badge.className = "badge";
  const st = (t.status || "").toLowerCase();
  badge.textContent = (st === "completed" || st === "done") ? "Done" : "Open";

  top.appendChild(left);
  top.appendChild(badge);

  const descText = (t.desc || t.description || "").trim();
  if (descText) {
    const desc = document.createElement("div");
    desc.className = "task-desc";
    desc.textContent = descText;
    card.appendChild(desc);
  }

  // Actions for open tasks
  if (!isHistory) {
    const actions = document.createElement("div");
    actions.className = "task-actions";

    const btnDone = document.createElement("button");
    btnDone.className = "btn";
    btnDone.textContent = "Mark completed";
    btnDone.onclick = async () => {
      try {
        await updateDoc(doc(db, "tasks", t.id), {
          status: "completed",
          completedAt: serverTimestamp(),
          completedBy: currentUser?.email || ""
        });
      } catch (e) {
        alert("Failed to mark completed: " + (e?.message || e));
      }
    };

    const btnComment = document.createElement("button");
    btnComment.className = "btn";
    btnComment.textContent = "Add comment";
    btnComment.onclick = async () => {
      const text = await openTextModal("Add comment", "Type your comment…");
      if (!text) return;
      try {
        await updateDoc(doc(db, "tasks", t.id), {
          comments: arrayUnion({ by: currentUser?.email || "", text, at: new Date().toISOString() })
        });
      } catch (e) {
        alert("Failed to add comment: " + (e?.message || e));
      }
    };

    actions.appendChild(btnDone);
    actions.appendChild(btnComment);

    if (currentRole === "management") {
      const btnDel = document.createElement("button");
      btnDel.className = "btn danger";
      btnDel.textContent = "Delete";
      btnDel.onclick = async () => {
        if (!confirm("Delete this task?")) return;
        try {
          await deleteDoc(doc(db, "tasks", t.id));
        } catch (e) {
          alert("Failed to delete: " + (e?.message || e));
        }
      };
      actions.appendChild(btnDel);
    }

    card.appendChild(actions);
  }

  card.prepend(top);
  return card;
}

function renderOpenFromCache() {
  if (!openList) return;
  openList.innerHTML = "";

  const items = (openCache || []).filter(t => {
    const status = (t.status || "").toLowerCase();
    return status === "open";
  }).filter(matchesSearch);

  items.forEach(t => openList.appendChild(renderTaskCard(t, false)));
  show(openEmpty, items.length === 0);
}

function renderHistoryFromCache() {
  if (!historyList) return;
  historyList.innerHTML = "";

  const items = (histCache || []).filter(t => {
    const status = (t.status || "").toLowerCase();
    return status === "completed" || status === "done";
  }).filter(matchesSearch);

  // sort newest completion first if possible
  items.sort((a, b) => {
    const da = a.completedAt?.toDate ? a.completedAt.toDate().getTime() : (a.completedAt ? new Date(a.completedAt).getTime() : 0);
    const dbb = b.completedAt?.toDate ? b.completedAt.toDate().getTime() : (b.completedAt ? new Date(b.completedAt).getTime() : 0);
    return dbb - da;
  });

  items.forEach(t => historyList.appendChild(renderTaskCard(t, true)));
  show(historyEmpty, items.length === 0);
}

function bindTaskListeners() {
  // Unbind previous
  if (unsubOpen) unsubOpen();
  if (unsubHistory) unsubHistory();
  unsubOpen = null;
  unsubHistory = null;

  // Listener for OPEN tasks
  const openQ = query(
    collection(db, "tasks"),
    where("status", "==", "open"),
    orderBy("createdAt", "desc"),
    limit(200)
  );

  // Listener for HISTORY tasks (supports "completed" and "done" safely)
  // We can't do "in" + orderBy completedAt reliably for old docs without completedAt,
  // so we read by status == completed and also status == done separately if needed.
  const completedQ = query(
    collection(db, "tasks"),
    where("status", "==", "completed"),
    orderBy("createdAt", "desc"),
    limit(200)
  );
  const doneQ = query(
    collection(db, "tasks"),
    where("status", "==", "done"),
    orderBy("createdAt", "desc"),
    limit(200)
  );

  unsubOpen = onSnapshot(openQ, (snap) => {
    openCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOpenFromCache();
  }, (err) => {
    console.error("Open tasks listener error:", err);
    if (openList) openList.innerHTML = `<div class="msg err">Tasks blocked: ${err.message}</div>`;
  });

  // Merge completed + done into histCache
  let completedCache = [];
  let doneCache = [];
  const rerenderHistory = () => {
    // merge by id
    const map = new Map();
    for (const t of completedCache) map.set(t.id, t);
    for (const t of doneCache) map.set(t.id, t);
    histCache = Array.from(map.values());
    renderHistoryFromCache();
  };

  const unsub1 = onSnapshot(completedQ, (snap) => {
    completedCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rerenderHistory();
  }, (err) => {
    console.error("History(completed) listener error:", err);
    if (historyList) historyList.innerHTML = `<div class="msg err">History blocked: ${err.message}</div>`;
  });

  const unsub2 = onSnapshot(doneQ, (snap) => {
    doneCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rerenderHistory();
  }, (err) => {
    console.error("History(done) listener error:", err);
    if (historyList) historyList.innerHTML = `<div class="msg err">History blocked: ${err.message}</div>`;
  });

  // store combined unsub in unsubHistory
  unsubHistory = () => { try { unsub1(); } catch {} try { unsub2(); } catch {} };
}

searchInput?.addEventListener("input", () => {
  renderOpenFromCache();
  renderHistoryFromCache();
});

btnRefreshHistory?.addEventListener("click", () => {
  renderHistoryFromCache();
});

/* -------------------------------
   Modal: create new task
-------------------------------- */
function openTaskModal() {
  show(backdrop, true);
  show(taskModal, true);
  setMsg(taskMsg, "", "");
  if (taskTitle) taskTitle.value = "";
  if (taskDesc) taskDesc.value = "";
  loadAssignableUsers().catch(() => {});
}

function closeTaskModal() {
  show(taskModal, false);
  show(backdrop, false);
}

btnNewTask?.addEventListener("click", openTaskModal);
btnModalClose?.addEventListener("click", closeTaskModal);
btnCancelTask?.addEventListener("click", closeTaskModal);
backdrop?.addEventListener("click", closeTaskModal);

async function loadAssignableUsers() {
  if (!taskAssignTo) return;
  taskAssignTo.innerHTML = "";

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "(Unassigned)";
  taskAssignTo.appendChild(blank);

  const snaps = await getDocs(query(collection(db, "allowedUsers"), orderBy("email", "asc"), limit(250)));
  snaps.forEach(s => {
    const d = s.data() || {};
    const email = normalizeEmail(d.email);
    if (!email) return;
    const opt = document.createElement("option");
    opt.value = email;
    opt.textContent = `${d.name || displayNameFromEmail(email)} (${email})`;
    taskAssignTo.appendChild(opt);
  });
}

btnCreateTask?.addEventListener("click", async () => {
  try {
    if (currentRole !== "management") return;

    const title = (taskTitle?.value || "").trim();
    const desc = (taskDesc?.value || "").trim();
    const assignedTo = (taskAssignTo?.value || "").trim();

    if (!title) return setMsg(taskMsg, "Title required.", "err");

    await addDoc(collection(db, "tasks"), {
      title,
      desc,
      assignedTo: assignedTo || "",
      status: "open",
      createdAt: serverTimestamp(),
      createdBy: currentUser?.email || "",
      comments: []
    });

    setMsg(taskMsg, "Task created.", "ok");
    setTimeout(closeTaskModal, 250);
  } catch (e) {
    setMsg(taskMsg, "Failed: " + (e?.message || e), "err");
  }
});

/* -------------------------------
   Admin: allow list
-------------------------------- */
async function refreshAllowedList() {
  if (!allowedList) return;
  allowedList.innerHTML = "";
  setMsg(adminMsg, "", "");

  const snaps = await getDocs(query(collection(db, "allowedUsers"), orderBy("email", "asc"), limit(300)));
  const items = [];
  snaps.forEach(s => items.push({ id: s.id, ...s.data() }));

  show(allowedEmpty, items.length === 0);

  for (const u of items) {
    const row = document.createElement("div");
    row.className = "allow-row";
    row.textContent = `${u.email || ""} • ${u.role || ""}`;
    allowedList.appendChild(row);
  }
}

async function upsertAllowed() {
  try {
    const email = normalizeEmail(allowEmail?.value);
    if (!email) return setMsg(adminMsg, "Enter an email.", "err");

    const role = allowRole?.value || "user";
    const id = emailDocId(email);

    await setDoc(doc(db, "allowedUsers", id), {
      email,
      role,
      name: displayNameFromEmail(email),
      updatedAt: serverTimestamp()
    }, { merge: true });

    setMsg(adminMsg, "Saved allow-list user.", "ok");
    await refreshAllowedList();
  } catch (e) {
    setMsg(adminMsg, "Failed: " + (e?.message || e), "err");
  }
}

async function removeAllowed() {
  try {
    const email = normalizeEmail(allowEmail?.value);
    if (!email) return setMsg(adminMsg, "Enter an email.", "err");
    const id = emailDocId(email);

    await deleteDoc(doc(db, "allowedUsers", id));

    setMsg(adminMsg, "Removed allow-list user.", "ok");
    await refreshAllowedList();
  } catch (e) {
    setMsg(adminMsg, "Failed: " + (e?.message || e), "err");
  }
}

btnAllowAdd?.addEventListener("click", upsertAllowed);
btnAllowRemove?.addEventListener("click", removeAllowed);

/* -------------------------------
   CSA: default metric set
-------------------------------- */
function defaultMetricSet() {
  const pct = (label, goalPercent) => ({
    key: label,
    label,
    type: "percent",
    goal: goalPercent / 100, // fraction
    totalMode: "avg",
    direction: "higher"
  });

  const numLower = (label, goalNumber) => ({
    key: label,
    label,
    type: "number",
    goal: goalNumber,
    totalMode: "sum",
    direction: "lower"
  });

  return {
    metrics: [
      pct("RIB", 98.5),
      pct("LIB", 99.0),
      numLower("DNA", 5),
      numLower("CODE 10", 5),
      numLower("CODE 12", 5),
      numLower("MPU", 0),
      numLower("E/L", 0),
      pct("PU Prox", 2.5),
      numLower("CODE 85", 5),
      numLower("Service Cross Issues", 5),
      numLower("Scanner log out issues", 0),
      pct("PPOD Quality", 97.0),
      pct("SIG COM", 99.2),
      pct("DOOR TAG", 90.0)
    ]
  };
}

async function ensureDefaultMetricSet(companyId) {
  const ref = doc(db, "csaMetricSets", companyId);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const d = defaultMetricSet();
  await setDoc(ref, { ...d, updatedAt: serverTimestamp() }, { merge: true });
  return d;
}

async function loadMetricSet(companyId) {
  const ref = doc(db, "csaMetricSets", companyId);
  const snap = await getDoc(ref);
  currentCsaMetricSet = snap.exists() ? snap.data() : await ensureDefaultMetricSet(companyId);

  // Normalize percent goals
  for (const m of (currentCsaMetricSet.metrics || [])) {
    if (m.type === "percent") m.goal = percentToFraction(m.goal);
  }
}

function reportDocId(companyId, startStr, endStr) {
  // Legacy range-id (still used for optional snapshots)
  return `${companyId}__${startStr}__${endStr}`;
}

/**
 * DAILY-BASED CSA STORAGE
 * - Each day is stored in /csaDaily/{companyId}__{YYYY-MM-DD}
 * - Loading any date range pulls each day's saved values so expanding the range won't "wipe" prior entries.
 *
 * Returns: { foundAny: boolean }
 */
async function loadReport(companyId, startStr, endStr) {
  const id = reportDocId(companyId, startStr, endStr);
  currentCsaReportId = id;

  // initialize empty for the currently selected days
  currentCsaValuesByDate = {};
  for (const day of currentCsaDays) currentCsaValuesByDate[day] = {};

  let foundAny = false;

  // 1) Load per-day docs (preferred behavior)
  for (const day of currentCsaDays) {
    const dailyId = `${companyId}__${day}`;
    const snap = await getDoc(doc(db, "csaDaily", dailyId));
    if (!snap.exists()) continue;

    const data = snap.data() || {};
    const incoming = (data.metrics || data.values || {}) || {};
    currentCsaValuesByDate[day] = incoming;
    foundAny = true;
  }

  // 2) Legacy fallback: if nothing found in csaDaily, try the old range snapshot doc
  if (!foundAny) {
    const ref = doc(db, "csaReports", id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() || {};
      const incoming = data.valuesByDate || {};
      for (const day of currentCsaDays) {
        currentCsaValuesByDate[day] = incoming[day] || {};
      }
      foundAny = true;
    }
  }

  // normalize percent values
  const pctKeys = new Set((currentCsaMetricSet.metrics || []).filter(m => m.type === "percent").map(m => m.key));
  for (const day of currentCsaDays) {
    const row = currentCsaValuesByDate[day] || {};
    for (const k of pctKeys) {
      if (row[k] !== null && row[k] !== undefined) row[k] = percentToFraction(row[k]);
    }
  }

  return { foundAny };
}

async function createReport(companyId, startStr, endStr) {
  // With daily storage, a "report" doesn't need to be created.
  // We'll just initialize the table for the chosen days.
  if (currentRole !== "management") return;

  currentCsaReportId = reportDocId(companyId, startStr, endStr);

  const valuesByDate = {};
  for (const day of currentCsaDays) valuesByDate[day] = {};
  currentCsaValuesByDate = valuesByDate;

  setMsg(csaMsg, "Ready. Enter values and click Save.", "ok");
  renderCsaTable();
}

async function saveReport(companyId, startStr, endStr) {
  if (currentRole !== "management") return;

  // Save each day into csaDaily so expanding the range will always load prior values.
  for (const day of currentCsaDays) {
    const dailyId = `${companyId}__${day}`;
    const metrics = currentCsaValuesByDate?.[day] || {};
    await setDoc(doc(db, "csaDaily", dailyId), {
      companyId,
      date: day,
      metrics,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser?.email || ""
    }, { merge: true });
  }

  // Optional: also keep a snapshot of the selected range (legacy support / easy export)
  const snapId = reportDocId(companyId, startStr, endStr);
  await setDoc(doc(db, "csaReports", snapId), {
    companyId,
    startDate: startStr,
    endDate: endStr,
    valuesByDate: currentCsaValuesByDate,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser?.email || ""
  }, { merge: true });

  currentCsaReportId = snapId;
  setMsg(csaMsg, "Saved.", "ok");
}


function isFail(metric, val) {
  if (val === null || val === undefined) return false;
  if (metric.goal === null || metric.goal === undefined) return false;

  const dir = metric.direction || (metric.type === "percent" ? "higher" : "lower");

  if (metric.type === "percent") {
    const v = percentToFraction(val);
    const g = percentToFraction(metric.goal);
    if (v === null || g === null) return false;
    return dir === "higher" ? (v < g) : (v > g);
  }

  const v = Number(val);
  const g = Number(metric.goal);
  if (!Number.isFinite(v) || !Number.isFinite(g)) return false;
  return dir === "higher" ? (v < g) : (v > g);
}

function parseCellInput(metric, raw) {
  const t = (raw || "").trim();
  if (!t) return null;
  const cleaned = t.replace("%", "").trim();
  const n = toNumberOrNull(cleaned);
  if (n === null) return null;
  return metric.type === "percent" ? percentToFraction(n) : n;
}

function computeTotal(metric) {
  const vals = [];
  for (const day of currentCsaDays) {
    const row = currentCsaValuesByDate[day] || {};
    const v = row[metric.key];
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    vals.push(metric.type === "percent" ? percentToFraction(n) : n);
  }
  if (!vals.length) return null;
  if (metric.totalMode === "sum") return vals.reduce((a, b) => a + b, 0);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function setCellStyle(td, metric, val) {
  // Only color when there is a value
  const hasValue = !(val === null || val === undefined);
  td.dataset.hasvalue = hasValue ? "1" : "0";
  td.classList.toggle("csa-fail", hasValue && isFail(metric, val));
  td.classList.toggle("csa-pass", hasValue && !isFail(metric, val));
}

function recomputeTotalsRow() {
  const metrics = currentCsaMetricSet?.metrics || [];
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    const td = csaTotalsTds[i];
    if (!td) continue;

    const total = computeTotal(m);
    if (total === null) td.textContent = "";
    else td.textContent = (m.type === "percent") ? formatPercentFraction(total) : String(Math.round(total * 100) / 100);
  }
}

function renderCsaTable() {
  if (!csaTableWrap) return;
  csaTableWrap.innerHTML = "";
  csaTotalsTds = [];

  const metrics = currentCsaMetricSet?.metrics || [];
  if (!metrics.length || !currentCsaDays.length) return;

  const table = document.createElement("table");
  table.className = "csa-table";

  // Header row
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.textContent = "Date";
  hr.appendChild(th0);

  for (const m of metrics) {
    const th = document.createElement("th");
    th.textContent = m.label;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  // GOAL row
  const gr = document.createElement("tr");
  const g0 = document.createElement("td");
  g0.textContent = "GOAL";
  gr.appendChild(g0);

  for (const m of metrics) {
    const td = document.createElement("td");
    td.style.fontWeight = "800";
    td.textContent = (m.type === "percent") ? formatPercentFraction(percentToFraction(m.goal)) : String(m.goal ?? "");
    gr.appendChild(td);
  }
  tbody.appendChild(gr);

  // Day rows
  for (const day of currentCsaDays) {
    const tr = document.createElement("tr");
    const tdDay = document.createElement("td");
    tdDay.textContent = day;
    tr.appendChild(tdDay);

    const row = currentCsaValuesByDate[day] || (currentCsaValuesByDate[day] = {});

    metrics.forEach((m) => {
      const td = document.createElement("td");
      const val = row[m.key];

      setCellStyle(td, m, val);

      if (currentRole === "management") {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "input";
        input.inputMode = "decimal";
        input.autocomplete = "off";
        input.spellcheck = false;

        // show formatted value initially
        if (val === null || val === undefined) input.value = "";
        else input.value = (m.type === "percent") ? formatPercentFraction(val) : String(val);

        // DO NOT parse while typing (prevents focus loss and allows ".")
        input.addEventListener("input", () => {
          td.classList.remove("csa-fail", "csa-pass");
          td.dataset.hasvalue = input.value.trim() ? "1" : "0";
        });

        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            input.blur();
          }
        });

        // Commit on blur: parse + format + color + totals (NO re-render)
        input.addEventListener("blur", () => {
          const parsed = parseCellInput(m, input.value);
          row[m.key] = parsed;

          if (parsed === null) input.value = "";
          else input.value = (m.type === "percent") ? formatPercentFraction(parsed) : String(parsed);

          setCellStyle(td, m, parsed);
          recomputeTotalsRow();
        });

        td.appendChild(input);
      } else {
        td.textContent = (val === null || val === undefined)
          ? ""
          : (m.type === "percent" ? formatPercentFraction(percentToFraction(val)) : String(val));
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  }

  // TOTAL row
  const trT = document.createElement("tr");
  const tdT0 = document.createElement("td");
  tdT0.textContent = "TOTAL";
  tdT0.style.fontWeight = "900";
  trT.appendChild(tdT0);

  for (const m of metrics) {
    const td = document.createElement("td");
    td.style.fontWeight = "900";
    csaTotalsTds.push(td);
    trT.appendChild(td);
  }

  tbody.appendChild(trT);
  table.appendChild(tbody);
  csaTableWrap.appendChild(table);

  recomputeTotalsRow();
}

/* -------------------------------
   CSA: Companies
-------------------------------- */
function startCompaniesListener() {
  if (unsubCompanies) return;

  const qCompanies = query(collection(db, "companies"), orderBy("name", "asc"), limit(500));
  unsubCompanies = onSnapshot(qCompanies, (snap) => {
    companiesCache = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    renderCompaniesUI();
  }, (err) => {
    console.error("Companies listener error:", err);
    setMsg(csaMsg, "Companies blocked: " + err.message, "err");
  });
}

function renderCompaniesUI() {
  // Dropdown: active only
  if (csaCompanySelect) {
    const active = companiesCache.filter(c => c.active !== false);
    const prev = csaCompanySelect.value;

    csaCompanySelect.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Select company...";
    csaCompanySelect.appendChild(ph);

    for (const c of active) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name || c.id;
      csaCompanySelect.appendChild(opt);
    }

    if (prev && active.some(c => c.id === prev)) {
      csaCompanySelect.value = prev;
      selectedCompanyId = prev;
    }
  }

  // List: management only
  if (companyList) {
    companyList.innerHTML = "";
    if (currentRole === "management") {
      for (const c of companiesCache) {
        const row = document.createElement("div");
        row.className = "company-row";
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.justifyContent = "space-between";
        row.style.gap = "10px";

        const left = document.createElement("div");
        left.textContent = c.name || c.id;
        left.style.cursor = "pointer";
        left.style.flex = "1";
        left.onclick = () => {
          if (csaCompanySelect) csaCompanySelect.value = c.id;
          selectedCompanyId = c.id;
        };

        const right = document.createElement("div");
        right.style.display = "flex";
        right.style.gap = "8px";

        const isActive = c.active !== false;

        const btnToggle = document.createElement("button");
        btnToggle.className = "btn";
        btnToggle.textContent = isActive ? "Delete" : "Restore";
        btnToggle.title = isActive ? "Hide this company (soft delete)" : "Show this company again";
        btnToggle.onclick = async (e) => {
          e.stopPropagation();
          if (currentRole !== "management") return;
          const ok = confirm(isActive ? `Delete (hide) company "${c.name || c.id}"?` : `Restore company "${c.name || c.id}"?`);
          if (!ok) return;
          try {
            await updateDoc(doc(db, "companies", c.id), {
              active: !isActive,
              updatedAt: serverTimestamp()
            });
          } catch (err) {
            alert("Failed to update company: " + (err?.message || err));
          }
        };

        right.appendChild(btnToggle);

        row.appendChild(left);
        row.appendChild(right);
        companyList.appendChild(row);
      }
    }
  }
}

btnCompanyAdd?.addEventListener("click", async () => {
  try {
    if (currentRole !== "management") return;

    const name = (companyName?.value || "").trim();
    if (!name) return setMsg(csaMsg, "Enter a company name.", "err");

    const id = slugifyId(name);
    if (!id) return setMsg(csaMsg, "Company name invalid.", "err");

    await setDoc(doc(db, "companies", id), {
      name,
      active: true,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await ensureDefaultMetricSet(id);

    setMsg(csaMsg, `Saved company: ${id}`, "ok");
    if (companyName) companyName.value = "";
  } catch (e) {
    setMsg(csaMsg, "Failed to save company: " + (e?.message || e), "err");
  }
});

/* -------------------------------
   CSA: Load/Create/Save
-------------------------------- */
btnCsaLoad?.addEventListener("click", async () => {
  try {
    setMsg(csaMsg, "", "");
    const companyId = csaCompanySelect?.value || selectedCompanyId;
    if (!companyId) return setMsg(csaMsg, "Select a company.", "err");

    const s = parseDateInput(csaStartDate?.value);
    const e = parseDateInput(csaEndDate?.value);
    if (!s || !e) return setMsg(csaMsg, "Pick start and end date.", "err");
    if (e < s) return setMsg(csaMsg, "End date must be after start date.", "err");

    const startStr = yyyyMmDd(s);
    const endStr = yyyyMmDd(e);

    // UX: If a report doesn't exist for the selected range, don't wipe the currently
    // visible table. Keep showing the last loaded report so the user's info doesn't
    // appear to "vanish" just because they changed the date.
    const prevCompanyId = selectedCompanyId;
    const prevDays = Array.isArray(currentCsaDays) ? [...currentCsaDays] : [];
    const prevValues = currentCsaValuesByDate ? JSON.parse(JSON.stringify(currentCsaValuesByDate)) : {};
    const prevReportId = currentCsaReportId;

    const nextDays = eachDayInclusive(s, e);

    selectedCompanyId = companyId;
    currentCsaDays = nextDays;

    await loadMetricSet(companyId);
    const { foundAny } = await loadReport(companyId, startStr, endStr);

    if (foundAny) {
      setMsg(csaMsg, "Loaded. (Days with no saved data are blank.)", "ok");
    } else {
      setMsg(csaMsg, "Loaded. No saved data for this range yet — enter values and click Save.", "err");
    }

    renderCsaTable();
} catch (e) {
    console.error(e);
    setMsg(csaMsg, "Load failed: " + (e?.message || e), "err");
  }
});

btnCsaCreate?.addEventListener("click", async () => {
  try {
    setMsg(csaMsg, "", "");
    if (currentRole !== "management") return;

    const companyId = csaCompanySelect?.value || selectedCompanyId;
    if (!companyId) return setMsg(csaMsg, "Select a company.", "err");

    const s = parseDateInput(csaStartDate?.value);
    const e = parseDateInput(csaEndDate?.value);
    if (!s || !e) return setMsg(csaMsg, "Pick start and end date.", "err");
    if (e < s) return setMsg(csaMsg, "End date must be after start date.", "err");

    const startStr = yyyyMmDd(s);
    const endStr = yyyyMmDd(e);

    selectedCompanyId = companyId;
    currentCsaDays = eachDayInclusive(s, e);

    await loadMetricSet(companyId);
    await createReport(companyId, startStr, endStr);
  } catch (e) {
    setMsg(csaMsg, "Create failed: " + (e?.message || e), "err");
  }
});

btnCsaSave?.addEventListener("click", async () => {
  try {
    setMsg(csaMsg, "", "");
    if (currentRole !== "management") return;

    const companyId = csaCompanySelect?.value || selectedCompanyId;
    if (!companyId) return setMsg(csaMsg, "Select a company.", "err");

    const s = parseDateInput(csaStartDate?.value);
    const e = parseDateInput(csaEndDate?.value);
    if (!s || !e) return setMsg(csaMsg, "Pick start and end date.", "err");
    if (e < s) return setMsg(csaMsg, "End date must be after start date.", "err");

    await saveReport(companyId, yyyyMmDd(s), yyyyMmDd(e));
  } catch (e) {
    setMsg(csaMsg, "Save failed: " + (e?.message || e), "err");
  }
});

/* -------------------------------
   Auth actions
-------------------------------- */
btnSignIn?.addEventListener("click", async () => {
  setMsg(authMsg, "", "");
  try {
    await signInWithEmailAndPassword(auth, normalizeEmail(authEmail?.value), authPassword?.value || "");
  } catch (e) {
    setMsg(authMsg, e?.message || String(e), "err");
  }
});

btnSignUp?.addEventListener("click", async () => {
  setMsg(authMsg, "", "");
  try {
    await createUserWithEmailAndPassword(auth, normalizeEmail(authEmail?.value), authPassword?.value || "");
    setMsg(authMsg, "Account created. If you can't sign in, ask management to add your email to allow-list.", "ok");
  } catch (e) {
    setMsg(authMsg, e?.message || String(e), "err");
  }
});

btnSendLink?.addEventListener("click", async () => {
  setMsg(authMsg, "", "");
  try {
    const email = normalizeEmail(authEmail?.value);
    if (!email) return setMsg(authMsg, "Enter email first.", "err");

    const actionCodeSettings = {
      url: window.location.href.split("#")[0],
      handleCodeInApp: true
    };

    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem("emailForSignIn", email);
    setMsg(authMsg, "Sign-in link sent! Check your email.", "ok");
  } catch (e) {
    setMsg(authMsg, e?.message || String(e), "err");
  }
});

btnSignOut?.addEventListener("click", async () => {
  await signOut(auth);
});

// Optional: handle email link sign-in
(async function handleEmailLink() {
  try {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      const email = window.localStorage.getItem("emailForSignIn") || prompt("Confirm your email");
      if (email) {
        await signInWithEmailLink(auth, email, window.location.href);
        window.localStorage.removeItem("emailForSignIn");
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  } catch (e) {
    setMsg(authMsg, "Email link sign-in failed: " + (e?.message || e), "err");
  }
})();

/* -------------------------------
   Auth state
-------------------------------- */
onAuthStateChanged(auth, async (user) => {
  setMsg(authMsg, "", "");
  setMsg(adminMsg, "", "");
  setMsg(csaMsg, "", "");

  if (!user) {
    currentUser = null;
    currentRole = null;
    if (userPill) userPill.textContent = "";
    setSignedInUI(false);

    // Unbind listeners
    try { if (unsubOpen) unsubOpen(); } catch {}
    try { if (unsubHistory) unsubHistory(); } catch {}
    unsubOpen = null; unsubHistory = null;
    openCache = []; histCache = [];

    try { if (unsubCompanies) unsubCompanies(); } catch {}
    unsubCompanies = null;
    companiesCache = [];
    selectedCompanyId = null;

    return;
  }

  try {
    const res = await requireAllowedUser(user);
    if (!res.ok) {
      await signOut(auth);
      setMsg(authMsg, res.reason, "err");
      return;
    }

    currentUser = user;
    setRole(res.role);
    if (userPill) userPill.textContent = `${user.email} • ${res.role}`;
    setSignedInUI(true);

    // Default to Open tab
    setTab("open");

    // Start listeners
    bindTaskListeners();
    startCompaniesListener();

    // Admin list
    if (res.role === "management") {
      await refreshAllowedList();
      await loadAssignableUsers();
    }

  } catch (e) {
    console.error(e);
    await signOut(auth);
    setMsg(authMsg, "Sign-in blocked: " + (e?.message || e), "err");
  }
});
