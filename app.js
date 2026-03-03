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

function yyyyMmDd(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseDateInput(val) {
  // expects YYYY-MM-DD
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
const tabCSA = $("tabCSA") || document.querySelector('.tab[data-tab="csa"]');

const csaCompanyName = $("csaCompanyName") || $("companyNameInput") || $("companyName");
const btnCompanySave = $("btnCompanySave") || $("btnAddCompany") || $("btnCompanyAdd") || $("btnCompanyUpdate");
const companyListEl = $("companyList") || $("companyListItems") || $("companyListContainer");

const csaCompanySelect = $("csaCompanySelect") || $("companySelect") || $("csaCompanyDropdown");
const csaStartDate = $("csaStartDate") || $("startDate");
const csaEndDate = $("csaEndDate") || $("endDate");
const btnCsaLoad = $("btnCsaLoad");
const btnCsaCreate = $("btnCsaCreate") || $("btnCreateReport");
const btnCsaSave = $("btnCsaSave") || $("btnSaveReport");
const csaMsg = $("csaMsg") || $("companyMsg") || $("csaStatusMsg");
const csaTableWrap = $("csaTableWrap") || $("csaTableContainer") || $("csaTable");

/** ---------------------------
 * App state
 * --------------------------*/
let currentUser = null;
let currentRole = null; // 'management' | 'user'
let unsubOpen = null;
let unsubHistory = null;

let openCache = [];
let histCache = [];

// CSA state
let unsubCompanies = null;
let companiesCache = []; // [{id,name,active}]
let selectedCompanyId = null;

// CSA Report state
let currentCsaMetricSet = null;     // { metrics: [...] }
let currentCsaReportId = null;      // doc id in csaReports
let currentCsaValuesByDate = {};    // { "YYYY-MM-DD": { metricKey: number|null } }
let currentCsaDays = [];            // ["YYYY-MM-DD", ...]
let currentCsaDirty = false;

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

  if (tab === "csa") {
    renderCompaniesUI();
    // optional: auto-load if selections exist
    renderCsaTable();
  }
}

/** ---------------------------
 * Allow-list + role lookup (KEEP AS-IS)
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
  return { ok: true, role, allow: d };
}

/** ---------------------------
 * Tabs click handler
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
    meta.textContent = `Created: ${fmtTime(t.createdAt)} • By: ${t.createdBy || ""}` + (t.assignedTo ? ` • Assigned: ${t.assignedTo}` : "");

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
        alert("Failed to mark completed: " + (e?.message || e));
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

    const comments = document.createElement("div");
    comments.className = "comments";
    (t.comments || []).forEach(c => {
      const row = document.createElement("div");
      row.className = "comment";
      row.textContent = `${c.by || ""}: ${c.text || ""}`;
      comments.appendChild(row);
    });

    card.appendChild(top);
    card.appendChild(desc);
    card.appendChild(actions);
    if ((t.comments || []).length) card.appendChild(comments);

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

/** ---------------------------
 * Modal (new task)
 * --------------------------*/
function openTaskModal() {
  show(backdrop, true);
  show(taskModal, true);
  if (taskTitle) taskTitle.value = "";
  if (taskDesc) taskDesc.value = "";
  if (taskMsg) setMsg(taskMsg, "", "");
  loadAssignableUsers().catch(() => {});
}

function closeTaskModal() {
  show(taskModal, false);
  show(backdrop, false);
}

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

/** ---------------------------
 * Admin allow-list
 * --------------------------*/
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

/** ---------------------------
 * CSA: Companies list + dropdown
 * --------------------------*/
function stopCompaniesListener() {
  if (unsubCompanies) unsubCompanies();
  unsubCompanies = null;
  companiesCache = [];
}

function startCompaniesListener() {
  if (unsubCompanies) return;

  const qCompanies = query(collection(db, "companies"), orderBy("name", "asc"), limit(500));
  unsubCompanies = onSnapshot(qCompanies, (snap) => {
    companiesCache = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    renderCompaniesUI();
  }, (err) => {
    setMsg(csaMsg, "Companies read blocked: " + (err?.message || err), "err");
  });
}

function renderCompaniesUI() {
  // List panel (management only)
  if (companyListEl) {
    companyListEl.innerHTML = "";
    if (currentRole === "management") {
      const items = companiesCache.slice();
      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No companies yet.";
        companyListEl.appendChild(empty);
      } else {
        for (const c of items) {
          const row = document.createElement("div");
          row.className = "company-row";
          const active = (c.active !== false);
          row.textContent = `${c.name || c.id}` + (active ? "" : " (inactive)");
          row.style.cursor = "pointer";
          row.onclick = () => {
            if (csaCompanySelect) {
              csaCompanySelect.value = c.id;
              selectedCompanyId = c.id;
            }
          };
          companyListEl.appendChild(row);
        }
      }
    }
  }

  // Dropdown (active only)
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
    } else if (selectedCompanyId && activeCompanies.some(c => c.id === selectedCompanyId)) {
      csaCompanySelect.value = selectedCompanyId;
    }
  }

  show(btnCompanySave, currentRole === "management");
  show(btnCsaCreate, currentRole === "management");
  show(btnCsaSave, currentRole === "management");
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

    // Ensure metric set exists for this company
    await ensureDefaultMetricSet(id);

    setMsg(csaMsg, `Saved company: ${id}`, "ok");
    if (csaCompanyName) csaCompanyName.value = "";
  } catch (e) {
    setMsg(csaMsg, "Failed to save company: " + (e?.message || e), "err");
  }
}

/** ---------------------------
 * CSA: Metric set + reports + table
 * --------------------------*/

// Default metric template (based on your Excel-style screenshot)
function defaultMetricSet() {
  // type: "percent" or "number"
  // totalMode: "avg" for percent metrics, "sum" for count metrics
  // direction: "higher" or "lower" (for future color rules; not required to render)
  const pct = (label, goalPercent) => ({
    key: label,
    label,
    type: "percent",
    goal: goalPercent,   // store as percent number, e.g. 98.5
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
      numLower("DNAs", 5),
      numLower("Code 10", 5),
      numLower("Code 12", 5),
      numLower("MPU", 0),
      numLower("E/L", 0),
      pct("PU Prox", 2.5),
      numLower("Code 85s", 5),
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

function reportDocId(companyId, startStr, endStr) {
  return `${companyId}__${startStr}__${endStr}`;
}

async function loadMetricSet(companyId) {
  const ref = doc(db, "csaMetricSets", companyId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    currentCsaMetricSet = await ensureDefaultMetricSet(companyId);
  } else {
    currentCsaMetricSet = snap.data();
  }
}

async function loadReport(companyId, startStr, endStr) {
  const id = reportDocId(companyId, startStr, endStr);
  const ref = doc(db, "csaReports", id);
  const snap = await getDoc(ref);

  currentCsaReportId = id;
  currentCsaDirty = false;

  if (!snap.exists()) {
    currentCsaValuesByDate = {};
    return { exists: false };
  }

  const data = snap.data() || {};
  currentCsaValuesByDate = data.valuesByDate || {};
  return { exists: true, data };
}

async function createReport(companyId, startStr, endStr) {
  if (currentRole !== "management") return;

  const id = reportDocId(companyId, startStr, endStr);
  const ref = doc(db, "csaReports", id);

  // Initialize valuesByDate with empty rows for each day
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
  currentCsaDirty = false;

  setMsg(csaMsg, "Report created. Enter values and click Save.", "ok");
  renderCsaTable();
}

async function saveReport(companyId, startStr, endStr) {
  if (currentRole !== "management") return;

  if (!currentCsaReportId) {
    setMsg(csaMsg, "No report loaded. Click Load or Create report.", "err");
    return;
  }

  const ref = doc(db, "csaReports", currentCsaReportId);
  await setDoc(ref, {
    companyId,
    startDate: startStr,
    endDate: endStr,
    valuesByDate: currentCsaValuesByDate,
    updatedAt: serverTimestamp(),
    updatedBy: currentUser?.email || ""
  }, { merge: true });

  currentCsaDirty = false;
  setMsg(csaMsg, "Saved.", "ok");
}

function formatCell(metric, val) {
  if (val === null || val === undefined) return "";
  if (metric.type === "percent") return `${Number(val).toFixed(2)}`;
  return `${Number(val)}`;
}

function computeTotal(metric, dayValues) {
  const vals = [];
  for (const day of currentCsaDays) {
    const row = dayValues[day] || {};
    const v = row[metric.key];
    if (v === null || v === undefined) continue;
    if (Number.isFinite(v)) vals.push(v);
  }

  if (vals.length === 0) return null;

  if (metric.totalMode === "sum") {
    return vals.reduce((a, b) => a + b, 0);
  }
  // avg default
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function renderCsaTable() {
  if (!csaTableWrap) return;
  csaTableWrap.innerHTML = "";

  if (!currentCsaMetricSet?.metrics?.length) {
    const msg = document.createElement("div");
    msg.className = "muted";
    msg.textContent = "Select a company and date range, then click Load.";
    csaTableWrap.appendChild(msg);
    return;
  }
  if (!currentCsaDays.length) {
    const msg = document.createElement("div");
    msg.className = "muted";
    msg.textContent = "Choose a start and end date.";
    csaTableWrap.appendChild(msg);
    return;
  }

  const metrics = currentCsaMetricSet.metrics;

  const table = document.createElement("table");
  table.className = "csa-table"; // add CSS if you want (optional)

  // Header
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  const thDate = document.createElement("th");
  thDate.textContent = "Date";
  hrow.appendChild(thDate);

  for (const m of metrics) {
    const th = document.createElement("th");
    th.textContent = m.label;
    hrow.appendChild(th);
  }
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  // GOAL row
  const goalRow = document.createElement("tr");
  const goalLabel = document.createElement("td");
  goalLabel.textContent = "GOAL";
  goalLabel.style.fontWeight = "700";
  goalRow.appendChild(goalLabel);

  for (const m of metrics) {
    const td = document.createElement("td");
    td.style.fontWeight = "700";
    td.textContent = (m.goal ?? "") === "" ? "" : String(m.goal);
    goalRow.appendChild(td);
  }
  tbody.appendChild(goalRow);

  // Day rows
  for (const day of currentCsaDays) {
    const tr = document.createElement("tr");

    const tdDay = document.createElement("td");
    tdDay.textContent = day;
    tr.appendChild(tdDay);

    for (const m of metrics) {
      const td = document.createElement("td");

      const row = currentCsaValuesByDate[day] || (currentCsaValuesByDate[day] = {});
      const val = row[m.key];

      if (currentRole === "management") {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "input";
        input.style.minWidth = "90px";
        input.value = val === null || val === undefined ? "" : String(val);

        input.addEventListener("input", () => {
          const n = toNumberOrNull(input.value.trim());
          row[m.key] = n;
          currentCsaDirty = true;
          // re-render totals row quickly by just updating totals at end:
          // simplest: full render (still fast for 7-31 rows). Keep simple.
          renderCsaTable();
        });

        td.appendChild(input);
      } else {
        td.textContent = formatCell(m, val);
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  // TOTAL row
  const totalRow = document.createElement("tr");
  const totalLabel = document.createElement("td");
  totalLabel.textContent = "TOTAL";
  totalLabel.style.fontWeight = "800";
  totalRow.appendChild(totalLabel);

  for (const m of metrics) {
    const td = document.createElement("td");
    td.style.fontWeight = "800";
    const total = computeTotal(m, currentCsaValuesByDate);

    if (total === null) td.textContent = "";
    else if (m.type === "percent") td.textContent = Number(total).toFixed(2);
    else td.textContent = String(Math.round(total * 100) / 100);

    totalRow.appendChild(td);
  }
  tbody.appendChild(totalRow);

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
    const r = await loadReport(companyId, startStr, endStr);

    if (!r.exists) {
      setMsg(csaMsg, "No report exists for this range. Management can click Create report.", "err");
    } else {
      setMsg(csaMsg, "Loaded.", "ok");
    }

    renderCsaTable();
  } catch (e) {
    setMsg(csaMsg, "Load failed: " + (e?.message || e), "err");
  }
}

/** ---------------------------
 * Auth actions
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
    setMsg(authMsg, "Account created. If you're not allow-listed yet, ask management to add your email.", "ok");
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

/** ---------------------------
 * Modal handlers
 * --------------------------*/
btnNewTask?.addEventListener("click", openTaskModal);
btnModalClose?.addEventListener("click", closeTaskModal);
btnCancelTask?.addEventListener("click", closeTaskModal);
backdrop?.addEventListener("click", closeTaskModal);

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
    setTimeout(closeTaskModal, 350);
  } catch (e) {
    setMsg(taskMsg, "Failed: " + (e?.message || e), "err");
  }
});

btnRefreshHistory?.addEventListener("click", () => {});

/** ---------------------------
 * Search
 * --------------------------*/
searchInput?.addEventListener("input", () => {
  renderOpenFromCache();
  renderHistoryFromCache();
});

/** ---------------------------
 * Admin events
 * --------------------------*/
btnAllowAdd?.addEventListener("click", upsertAllowed);
btnAllowRemove?.addEventListener("click", removeAllowed);

/** ---------------------------
 * CSA events
 * --------------------------*/
btnCompanySave?.addEventListener("click", saveCompanyFromUI);

csaCompanySelect?.addEventListener("change", () => {
  selectedCompanyId = csaCompanySelect.value || null;
});

btnCsaLoad?.addEventListener("click", handleCsaLoad);

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

    const startStr = yyyyMmDd(s);
    const endStr = yyyyMmDd(e);

    await saveReport(companyId, startStr, endStr);
  } catch (e) {
    setMsg(csaMsg, "Save failed: " + (e?.message || e), "err");
  }
});

/** ---------------------------
 * Handle email-link sign in (optional)
 * --------------------------*/
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
    stopCompaniesListener();
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

    // Default tab
    setTab("open");

    // Tasks
    unbindTaskListeners();
    bindTaskListeners();

    // Admin list
    if (res.role === "management") {
      await refreshAllowedList();
    }

    // Start companies listener after role is known
    if (tabCSA || $("panel-csa") || csaCompanySelect || companyListEl) {
      startCompaniesListener();
    }
  } catch (e) {
    await signOut(auth);
    setMsg(authMsg, "Sign-in blocked: " + (e?.message || e), "err");
  }
});
