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
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/** ---------------------------
 * Helpers
 * --------------------------*/
const $ = (id) => document.getElementById(id);
const show = (el, yes) => { if (el) el.classList.toggle("hidden", !yes); };

const fmtTime = (ts) => {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    if (!d) return "";
    return d.toLocaleString();
  } catch { return ""; }
};

const normalizeEmail = (email) => (email || "").trim().toLowerCase();
const emailDocId = (email) => normalizeEmail(email).replaceAll(".", "(dot)");
const slugifyId = (name) =>
  (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const displayNameFromEmail = (email) => {
  const local = (email || "").split("@")[0] || "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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

/** Percent helpers
 * - internally we store percent values as FRACTION (0.985)
 * - user can type 0.985, 98.5, 98.5%, etc.
 */
function percentToFraction(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) <= 1.5) return n;      // looks like fraction
  return n / 100;                        // looks like percent
}
function formatPercentFraction(f) {
  if (f === null || f === undefined) return "";
  const n = Number(f);
  if (!Number.isFinite(n)) return "";
  return `${(n * 100).toFixed(2)}%`;
}

/** ---------------------------
 * UI elements
 * --------------------------*/
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

const tabAdmin = $("tabAdmin");
const searchInput = $("searchInput");

const openList = $("openList");
const openEmpty = $("openEmpty");
const historyList = $("historyList");
const historyEmpty = $("historyEmpty");

const btnNewTask = $("btnNewTask");
const btnRefreshHistory = $("btnRefreshHistory");

const allowEmail = $("allowEmail");
const allowRole = $("allowRole");
const btnAllowAdd = $("btnAllowAdd");
const btnAllowRemove = $("btnAllowRemove");
const adminMsg = $("adminMsg");
const allowedList = $("allowedList");
const allowedEmpty = $("allowedEmpty");

const backdrop = $("modalBackdrop");
const taskModal = $("taskModal");
const btnModalClose = $("btnModalClose");
const btnCancelTask = $("btnCancelTask");
const btnCreateTask = $("btnCreateTask");
const taskTitle = $("taskTitle");
const taskDesc = $("taskDesc");
const taskAssignTo = $("taskAssignTo");
const taskMsg = $("taskMsg");

/** ---------------------------
 * CSA elements
 * --------------------------*/
const csaCompanyName = $("companyName");
const btnCompanySave = $("btnCompanyAdd");
const companyListEl = $("companyList");

const csaCompanySelect = $("csaCompanySelect");
const csaStartDate = $("csaStartDate");
const csaEndDate = $("csaEndDate");
const btnCsaLoad = $("btnCsaLoad");
const btnCsaCreate = $("btnCsaCreate");
const btnCsaSave = $("btnCsaSave");
const csaMsg = $("csaMsg");
const csaTableWrap = $("csaTableWrap");

/** ---------------------------
 * App state
 * --------------------------*/
let currentUser = null;
let currentRole = null; // 'management' | 'user'

let unsubOpen = null;
let unsubHistory = null;
let openCache = [];
let histCache = [];

let unsubCompanies = null;
let companiesCache = [];
let selectedCompanyId = null;

// CSA
let currentCsaMetricSet = null;
let currentCsaReportId = null;
let currentCsaValuesByDate = {};  // stored normalized (percent as fraction)
let currentCsaDays = [];

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

function setRole(role) {
  currentRole = role;
  show(btnNewTask, role === "management");
  show(tabAdmin, role === "management");

  // CSA buttons only for management
  show(btnCompanySave, role === "management");
  show(btnCsaCreate, role === "management");
  show(btnCsaSave, role === "management");
}

function setSignedInUI(yes) {
  show(authCard, !yes);
  show(appShell, yes);
  show(btnSignOut, yes);
  show(userPill, yes);
}

function setTab(tab) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  show($("panel-open"), tab === "open");
  show($("panel-history"), tab === "history");
  show($("panel-admin"), tab === "admin");
  show($("panel-csa"), tab === "csa");
}

/** ---------------------------
 * Allow-list method (unchanged)
 * --------------------------*/
async function requireAllowedUser(user) {
  const email = normalizeEmail(user?.email);
  if (!email) return { ok: false, reason: "Missing email on account." };

  const id = emailDocId(email);
  const ref = doc(db, "allowedUsers", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, reason: "This email is not allow-listed." };

  const d = snap.data() || {};
  const role = d.role;
  if (role !== "management" && role !== "user") {
    return { ok: false, reason: "Allow-list entry missing role." };
  }
  return { ok: true, role };
}

/** ---------------------------
 * Tabs
 * --------------------------*/
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

/** ---------------------------
 * Tasks
 * --------------------------*/
function matchesSearch(task) {
  const q = (searchInput?.value || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    task.title,
    task.desc,
    task.createdBy,
    task.assignedTo,
    (task.comments || []).map(c => `${c.by} ${c.text}`).join(" ")
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

function renderOpenFromCache() {
  if (!openList) return;
  openList.innerHTML = "";
  const items = openCache.filter(matchesSearch);
  show(openEmpty, items.length === 0);

  for (const t of items) {
    const card = document.createElement("div");
    card.className = "task";

    const top = document.createElement("div");
    top.className = "task-top";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = t.title || "(No title)";

    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent =
      `Created: ${fmtTime(t.createdAt)} • By: ${t.createdBy || ""}` +
      (t.assignedTo ? ` • Assigned: ${t.assignedTo}` : "");

    top.appendChild(title);
    top.appendChild(meta);

    const desc = document.createElement("div");
    desc.className = "task-desc";
    desc.textContent = t.desc || "";

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
        alert("Failed: " + (e?.message || e));
      }
    };

    const btnComment = document.createElement("button");
    btnComment.className = "btn";
    btnComment.textContent = "Add comment";
    btnComment.onclick = async () => {
      const text = prompt("Comment:");
      if (!text) return;
      try {
        const next = [...(t.comments || []), { by: currentUser?.email || "", text, at: new Date().toISOString() }];
        await updateDoc(doc(db, "tasks", t.id), { comments: next });
      } catch (e) {
        alert("Failed: " + (e?.message || e));
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
          alert("Failed: " + (e?.message || e));
        }
      };
      actions.appendChild(btnDel);
    }

    card.appendChild(top);
    card.appendChild(desc);
    card.appendChild(actions);
    openList.appendChild(card);
  }
}

function renderHistoryFromCache() {
  if (!historyList) return;
  historyList.innerHTML = "";
  const items = histCache.filter(matchesSearch);
  show(historyEmpty, items.length === 0);

  for (const t of items) {
    const card = document.createElement("div");
    card.className = "task";

    const top = document.createElement("div");
    top.className = "task-top";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = t.title || "(No title)";

    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = `Completed: ${fmtTime(t.completedAt)} • By: ${t.completedBy || ""}`;

    top.appendChild(title);
    top.appendChild(meta);

    const desc = document.createElement("div");
    desc.className = "task-desc";
    desc.textContent = t.desc || "";

    card.appendChild(top);
    card.appendChild(desc);
    historyList.appendChild(card);
  }
}

function bindTaskListeners() {
  const openQ = query(collection(db, "tasks"), where("status", "==", "open"), orderBy("createdAt", "desc"), limit(200));
  const histQ = query(collection(db, "tasks"), where("status", "==", "completed"), orderBy("completedAt", "desc"), limit(200));

  unsubOpen = onSnapshot(openQ, (snap) => {
    openCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOpenFromCache();
  });

  unsubHistory = onSnapshot(histQ, (snap) => {
    histCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistoryFromCache();
  });
}

function unbindTaskListeners() {
  if (unsubOpen) unsubOpen();
  if (unsubHistory) unsubHistory();
  unsubOpen = null;
  unsubHistory = null;
  openCache = [];
  histCache = [];
}

searchInput?.addEventListener("input", () => {
  renderOpenFromCache();
  renderHistoryFromCache();
});

/** ---------------------------
 * New task modal (minimal)
 * --------------------------*/
function openTaskModal() {
  show(backdrop, true);
  show(taskModal, true);
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

/** ---------------------------
 * Admin allow-list (unchanged)
 * --------------------------*/
async function refreshAllowedList() {
  if (!allowedList) return;
  allowedList.innerHTML = "";
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

/** ---------------------------
 * CSA (companies + table)
 * --------------------------*/
function startCompaniesListener() {
  if (unsubCompanies) return;
  const qCompanies = query(collection(db, "companies"), orderBy("name", "asc"), limit(500));
  unsubCompanies = onSnapshot(qCompanies, (snap) => {
    companiesCache = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    renderCompaniesUI();
  }, (err) => setMsg(csaMsg, "Companies read blocked: " + (err?.message || err), "err"));
}

function renderCompaniesUI() {
  // list
  if (companyListEl && currentRole === "management") {
    companyListEl.innerHTML = "";
    for (const c of companiesCache) {
      const row = document.createElement("div");
      row.className = "company-row";
      row.textContent = c.name || c.id;
      row.style.cursor = "pointer";
      row.onclick = () => {
        if (csaCompanySelect) csaCompanySelect.value = c.id;
        selectedCompanyId = c.id;
      };
      companyListEl.appendChild(row);
    }
  }

  // dropdown (active only)
  if (csaCompanySelect) {
    const activeCompanies = companiesCache.filter(c => c.active !== false);
    const prev = csaCompanySelect.value;

    csaCompanySelect.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Select company...";
    csaCompanySelect.appendChild(ph);

    for (const c of activeCompanies) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name || c.id;
      csaCompanySelect.appendChild(opt);
    }

    if (prev && activeCompanies.some(c => c.id === prev)) {
      csaCompanySelect.value = prev;
      selectedCompanyId = prev;
    }
  }
}

async function saveCompanyFromUI() {
  try {
    if (currentRole !== "management") return;
    const name = (csaCompanyName?.value || "").trim();
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
    if (csaCompanyName) csaCompanyName.value = "";
  } catch (e) {
    setMsg(csaMsg, "Failed to save company: " + (e?.message || e), "err");
  }
}
btnCompanySave?.addEventListener("click", saveCompanyFromUI);

function defaultMetricSet() {
  const pct = (label, goalPercent) => ({
    key: label,
    label,
    type: "percent",
    goal: goalPercent / 100, // store goal as fraction
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
      pct("PPOD", 97.0),
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

function reportDocId(companyId, startStr, endStr) {
  return `${companyId}__${startStr}__${endStr}`;
}

async function loadMetricSet(companyId) {
  const ref = doc(db, "csaMetricSets", companyId);
  const snap = await getDoc(ref);
  currentCsaMetricSet = snap.exists() ? snap.data() : await ensureDefaultMetricSet(companyId);

  // normalize any percent goals if older docs stored 98.5 instead of 0.985
  if (currentCsaMetricSet?.metrics) {
    for (const m of currentCsaMetricSet.metrics) {
      if (m.type === "percent") m.goal = percentToFraction(m.goal);
    }
  }
}

async function loadReport(companyId, startStr, endStr) {
  const id = reportDocId(companyId, startStr, endStr);
  const ref = doc(db, "csaReports", id);
  const snap = await getDoc(ref);

  currentCsaReportId = id;

  if (!snap.exists()) {
    currentCsaValuesByDate = {};
    for (const day of currentCsaDays) currentCsaValuesByDate[day] = {};
    return false;
  }

  const data = snap.data() || {};
  currentCsaValuesByDate = data.valuesByDate || {};
  // ensure all days exist
  for (const day of currentCsaDays) currentCsaValuesByDate[day] ||= {};
  // normalize percent values if old data stored 98.5
  if (currentCsaMetricSet?.metrics) {
    const percentKeys = new Set(currentCsaMetricSet.metrics.filter(m => m.type === "percent").map(m => m.key));
    for (const day of currentCsaDays) {
      const row = currentCsaValuesByDate[day] || {};
      for (const k of percentKeys) {
        if (row[k] !== null && row[k] !== undefined) row[k] = percentToFraction(row[k]);
      }
    }
  }
  return true;
}

async function createReport(companyId, startStr, endStr) {
  if (currentRole !== "management") return;

  const id = reportDocId(companyId, startStr, endStr);
  const ref = doc(db, "csaReports", id);

  const valuesByDate = {};
  for (const day of currentCsaDays) valuesByDate[day] = {};

  await setDoc(ref, {
    companyId,
    startDate: startStr,
    endDate: endStr,
    valuesByDate,
    createdAt: serverTimestamp(),
    createdBy: currentUser?.email || "",
    updatedAt: serverTimestamp(),
    updatedBy: currentUser?.email || ""
  }, { merge: true });

  currentCsaReportId = id;
  currentCsaValuesByDate = valuesByDate;

  setMsg(csaMsg, "Report created. Enter values and click Save.", "ok");
  renderCsaTable();
}

async function saveReport(companyId, startStr, endStr) {
  if (currentRole !== "management") return;
  if (!currentCsaReportId) return setMsg(csaMsg, "No report loaded.", "err");

  const ref = doc(db, "csaReports", currentCsaReportId);
  await setDoc(ref, {
    companyId,
    startDate: startStr,
    endDate: endStr,
    valuesByDate: currentCsaValuesByDate,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser?.email || ""
  }, { merge: true });

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

function formatDisplay(metric, storedVal) {
  if (storedVal === null || storedVal === undefined) return "";
  if (metric.type === "percent") return formatPercentFraction(percentToFraction(storedVal));
  return String(storedVal);
}

function parseInput(metric, raw) {
  const t = (raw || "").trim();
  if (!t) return null;
  const cleaned = t.replace("%", "").trim();
  const n = toNumberOrNull(cleaned);
  if (n === null) return null;
  return metric.type === "percent" ? percentToFraction(n) : n;
}

function renderCsaTable() {
  if (!csaTableWrap) return;
  csaTableWrap.innerHTML = "";

  const metrics = currentCsaMetricSet?.metrics || [];
  if (!metrics.length || !currentCsaDays.length) return;

  const table = document.createElement("table");
  table.className = "csa-table";

  // header
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

  // goal row
  const gr = document.createElement("tr");
  const g0 = document.createElement("td");
  g0.textContent = "GOAL";
  gr.appendChild(g0);
  for (const m of metrics) {
    const td = document.createElement("td");
    td.style.fontWeight = "800";
    td.textContent = m.type === "percent" ? formatPercentFraction(percentToFraction(m.goal)) : String(m.goal ?? "");
    gr.appendChild(td);
  }
  tbody.appendChild(gr);

  // day rows
  for (const day of currentCsaDays) {
    const tr = document.createElement("tr");
    const tdDay = document.createElement("td");
    tdDay.textContent = day;
    tr.appendChild(tdDay);

    const row = currentCsaValuesByDate[day] || (currentCsaValuesByDate[day] = {});

    for (const m of metrics) {
      const td = document.createElement("td");
      const val = row[m.key];

      // apply fail style on render
      if (isFail(m, val)) td.classList.add("csa-fail");

      if (currentRole === "management") {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "input";
        input.value = val === null || val === undefined ? "" : (m.type === "percent" ? formatPercentFraction(val) : String(val));

        // IMPORTANT: do NOT re-render on every keystroke
        input.addEventListener("input", () => {
          // allow any typing; don't parse yet
          td.classList.remove("csa-fail");
        });

        // parse and apply styles ONLY when you leave the field
        input.addEventListener("blur", () => {
          const parsed = parseInput(m, input.value);
          row[m.key] = parsed;

          // rewrite to a clean display format
          input.value = parsed === null ? "" : (m.type === "percent" ? formatPercentFraction(parsed) : String(parsed));

          // re-render ONCE after edit (keeps typing smooth)
          renderCsaTable();
        });

        td.appendChild(input);
      } else {
        td.textContent = formatDisplay(m, val);
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  // totals
  const trT = document.createElement("tr");
  const tdT0 = document.createElement("td");
  tdT0.textContent = "TOTAL";
  tdT0.style.fontWeight = "900";
  trT.appendChild(tdT0);

  for (const m of metrics) {
    const td = document.createElement("td");
    td.style.fontWeight = "900";
    const total = computeTotal(m);
    td.textContent = total === null ? "" : (m.type === "percent" ? formatPercentFraction(total) : String(Math.round(total * 100) / 100));
    trT.appendChild(td);
  }
  tbody.appendChild(trT);

  table.appendChild(tbody);
  csaTableWrap.appendChild(table);
}

async function handleCsaLoad() {
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

    currentCsaDays = eachDayInclusive(s, e);
    selectedCompanyId = companyId;

    await loadMetricSet(companyId);
    const exists = await loadReport(companyId, startStr, endStr);

    if (!exists) setMsg(csaMsg, "No report exists for this range. Management can click Create report.", "err");
    else setMsg(csaMsg, "Loaded.", "ok");

    renderCsaTable();
  } catch (e) {
    setMsg(csaMsg, "Load failed: " + (e?.message || e), "err");
  }
}

btnCsaLoad?.addEventListener("click", handleCsaLoad);

btnCsaCreate?.addEventListener("click", async () => {
  try {
    if (currentRole !== "management") return;
    const companyId = csaCompanySelect?.value || selectedCompanyId;
    if (!companyId) return setMsg(csaMsg, "Select a company.", "err");

    const s = parseDateInput(csaStartDate?.value);
    const e = parseDateInput(csaEndDate?.value);
    if (!s || !e) return setMsg(csaMsg, "Pick start and end date.", "err");
    if (e < s) return setMsg(csaMsg, "End date must be after start date.", "err");

    const startStr = yyyyMmDd(s);
    const endStr = yyyyMmDd(e);

    currentCsaDays = eachDayInclusive(s, e);
    await loadMetricSet(companyId);
    await createReport(companyId, startStr, endStr);
  } catch (e) {
    setMsg(csaMsg, "Create failed: " + (e?.message || e), "err");
  }
});

btnCsaSave?.addEventListener("click", async () => {
  try {
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

/** ---------------------------
 * Auth buttons
 * --------------------------*/
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
    setMsg(authMsg, "Account created. Ask management to add your email to allow-list if needed.", "ok");
  } catch (e) {
    setMsg(authMsg, e?.message || String(e), "err");
  }
});

btnSendLink?.addEventListener("click", async () => {
  setMsg(authMsg, "", "");
  try {
    const email = normalizeEmail(authEmail?.value);
    if (!email) return setMsg(authMsg, "Enter email first.", "err");
    const actionCodeSettings = { url: window.location.href.split("#")[0], handleCodeInApp: true };
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem("emailForSignIn", email);
    setMsg(authMsg, "Sign-in link sent! Check your email.", "ok");
  } catch (e) {
    setMsg(authMsg, e?.message || String(e), "err");
  }
});

btnSignOut?.addEventListener("click", async () => { await signOut(auth); });

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

/** ---------------------------
 * Auth state
 * --------------------------*/
onAuthStateChanged(auth, async (user) => {
  setMsg(authMsg, "", "");
  setMsg(adminMsg, "", "");
  setMsg(csaMsg, "", "");

  if (!user) {
    currentUser = null;
    currentRole = null;
    userPill.textContent = "";
    setSignedInUI(false);
    unbindTaskListeners();
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
    userPill.textContent = `${user.email} • ${res.role}`;
    setSignedInUI(true);

    // Default tab open
    setTab("open");

    // tasks
    unbindTaskListeners();
    bindTaskListeners();

    // admin list
    if (res.role === "management") {
      await refreshAllowedList();
      await loadAssignableUsers();
    }

    // CSA
    startCompaniesListener();
  } catch (e) {
    await signOut(auth);
    setMsg(authMsg, "Sign-in blocked: " + (e?.message || e), "err");
  }
});
