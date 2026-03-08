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
const emailDocId = (email) => normalizeEmail(email);
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


// CSA Daily storage: one doc per company per day
function csaDailyDocId(companyId, dayStr) {
  return `${companyId}__${dayStr}`;
}

async function loadDailyValues(companyId, days) {
  const out = {};
  for (const day of days) out[day] = {};

  // Fetch each day doc (small ranges are fine; usually <= 31)
  for (const day of days) {
    const snap = await getDoc(doc(db, "csaDaily", csaDailyDocId(companyId, day)));
    if (snap.exists()) {
      const data = snap.data() || {};
      // stored shape: { values: {...} } OR { metrics: {...} } (support both)
      out[day] = data.values || data.metrics || {};
    }
  }
  return out;
}

async function saveDailyValues(companyId, days, valuesByDate) {
  if (currentRole !== "management") return;
  const email = currentUser?.email || "";
  for (const day of days) {
    const values = valuesByDate[day] || {};
    await setDoc(doc(db, "csaDaily", csaDailyDocId(companyId, day)), {
      companyId,
      date: day,
      values,
      updatedAt: serverTimestamp(),
      updatedBy: email
    }, { merge: true });
  }
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

// QVI
const qviCompanySelect = $("qviCompanySelect");
const qviYearSelect = $("qviYearSelect");
const qviQuarterTabs = Array.from(document.querySelectorAll(".quarter-tab"));
const btnQviRefresh = $("btnQviRefresh");
const qviMsg = $("qviMsg");
const qviSearchInput = $("qviSearchInput");
const qviTableBody = $("qviTableBody");
const qviEmpty = $("qviEmpty");
const qviStatScheduled = $("qviStatScheduled");
const qviStatCompleted = $("qviStatCompleted");
const qviStatCompletedPct = $("qviStatCompletedPct");
const qviStatSsti = $("qviStatSsti");
const qviStatSstiPct = $("qviStatSstiPct");
const qviStatRemaining = $("qviStatRemaining");
const qviProgressQviBar = $("qviProgressQviBar");
const qviProgressQviText = $("qviProgressQviText");
const qviProgressSstiBar = $("qviProgressSstiBar");
const qviProgressSstiText = $("qviProgressSstiText");
const qviStatusSnapshot = $("qviStatusSnapshot");

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

// QVI
let qviSelectedQuarter = "QTR1";
let qviVehiclesCache = [];
let qviInspectionsCache = [];

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
  show(btnCsaCreate, false); // removed: Save handles all CSA persistence

  show(btnCsaSave, role === "management");
}

function setTab(tab) {
  allTabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  show($("panel-open"), tab === "open");
  show($("panel-history"), tab === "history");
  show($("panel-csa"), tab === "csa");
  show($("panel-qvi"), tab === "qvi");
  show($("panel-admin"), tab === "admin");
}


function formatPct(n) {
  const num = Number(n) || 0;
  return `${num.toFixed(1)}%`;
}

function setQuarterTabUI() {
  qviQuarterTabs.forEach(btn => btn.classList.toggle("active", btn.dataset.quarter === qviSelectedQuarter));
}

function populateQviYearSelect() {
  if (!qviYearSelect || qviYearSelect.options.length) return;
  const thisYear = new Date().getFullYear();
  for (let y = thisYear + 1; y >= thisYear - 2; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === thisYear) opt.selected = true;
    qviYearSelect.appendChild(opt);
  }
}

function populateQviCompanySelect() {
  if (!qviCompanySelect) return;
  const current = qviCompanySelect.value;
  qviCompanySelect.innerHTML = '<option value="">All companies</option>';

  for (const c of companiesCache || []) {
    if (!c?.active) continue;
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name || c.id;
    qviCompanySelect.appendChild(opt);
  }

  if (current) qviCompanySelect.value = current;
}

function qviMatchesSearch(row) {
  const q = (qviSearchInput?.value || "").trim().toLowerCase();
  if (!q) return true;
  return [
    row.entityName,
    row.unitType,
    row.vehicleNumber,
    row.quarter,
    row.inspectedBy,
    row.notes
  ].join(" ").toLowerCase().includes(q);
}

function quarterRecordForVehicle(vehicle, inspection) {
  const quarter = qviSelectedQuarter;
  return {
    entityName: vehicle?.entityName || "",
    unitType: vehicle?.unitType || "",
    vehicleNumber: vehicle?.vehicleNumber || vehicle?.id || "",
    quarter,
    inspectionDate: inspection?.inspectionDate || "",
    inspectedBy: inspection?.inspectedBy || "",
    outOfService: Boolean(inspection?.outOfService),
    qviComplete: Boolean(inspection?.qviComplete),
    sstiComplete: Boolean(inspection?.sstiComplete),
    notes: inspection?.notes || ""
  };
}

function qviTag(text, yes) {
  return `<span class="qvi-tag ${yes ? "yes" : "no"}">${text}</span>`;
}

function renderQviStatusSnapshot(stats) {
  if (!qviStatusSnapshot) return;
  const rows = [
    ["QVI Completed", stats.completedPct],
    ["SSTI Completed", stats.sstiPct],
    ["Remaining", stats.remainingPct]
  ];

  qviStatusSnapshot.innerHTML = rows.map(([label, pct]) => `
    <div class="qvi-status-row">
      <div class="qvi-status-top">
        <span class="qvi-status-label">${label}</span>
        <strong>${formatPct(pct)}</strong>
      </div>
      <div class="progress-track"><div class="progress-fill ${label.includes("SSTI") ? "alt" : ""}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
    </div>
  `).join("");
}

function renderQviDashboard(rows) {
  const scheduled = rows.length;
  const completed = rows.filter(r => r.qviComplete).length;
  const ssti = rows.filter(r => r.sstiComplete).length;
  const remaining = Math.max(0, scheduled - completed);
  const completedPct = scheduled ? (completed / scheduled) * 100 : 0;
  const sstiPct = scheduled ? (ssti / scheduled) * 100 : 0;
  const remainingPct = scheduled ? (remaining / scheduled) * 100 : 0;

  if (qviStatScheduled) qviStatScheduled.textContent = String(scheduled);
  if (qviStatCompleted) qviStatCompleted.textContent = String(completed);
  if (qviStatCompletedPct) qviStatCompletedPct.textContent = `${formatPct(completedPct)} complete`;
  if (qviStatSsti) qviStatSsti.textContent = String(ssti);
  if (qviStatSstiPct) qviStatSstiPct.textContent = `${formatPct(sstiPct)} complete`;
  if (qviStatRemaining) qviStatRemaining.textContent = String(remaining);
  if (qviProgressQviBar) qviProgressQviBar.style.width = `${completedPct}%`;
  if (qviProgressQviText) qviProgressQviText.textContent = formatPct(completedPct);
  if (qviProgressSstiBar) qviProgressSstiBar.style.width = `${sstiPct}%`;
  if (qviProgressSstiText) qviProgressSstiText.textContent = formatPct(sstiPct);

  renderQviStatusSnapshot({ completedPct, sstiPct, remainingPct });
}

function renderQviTable() {
  if (!qviTableBody) return;

  const companyId = qviCompanySelect?.value || "";
  const year = Number(qviYearSelect?.value || new Date().getFullYear());

  const vehicles = (qviVehiclesCache || []).filter(v => v?.active !== false).filter(v => !companyId || v.companyId === companyId);
  const inspections = (qviInspectionsCache || []).filter(i => Number(i?.year) === year).filter(i => (i?.quarter || "") === qviSelectedQuarter).filter(i => !companyId || i.companyId === companyId);

  const byVehicle = new Map(inspections.map(i => [String(i.vehicleNumber || i.id || ""), i]));
  const rows = vehicles.map(v => quarterRecordForVehicle(v, byVehicle.get(String(v.vehicleNumber || v.id || "")))).filter(qviMatchesSearch);

  renderQviDashboard(rows);
  qviTableBody.innerHTML = "";

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.entityName || ""}</td>
      <td>${row.unitType || ""}</td>
      <td><strong>${row.vehicleNumber || ""}</strong></td>
      <td>${row.quarter}</td>
      <td>${row.inspectionDate || "—"}</td>
      <td>${row.inspectedBy || "—"}</td>
      <td>${qviTag(row.outOfService ? "Yes" : "No", row.outOfService)}</td>
      <td>${qviTag(row.qviComplete ? "Yes" : "No", row.qviComplete)}</td>
      <td>${qviTag(row.sstiComplete ? "Yes" : "No", row.sstiComplete)}</td>
      <td>${row.notes || "—"}</td>
    `;
    qviTableBody.appendChild(tr);
  }

  show(qviEmpty, rows.length === 0);
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

qviQuarterTabs.forEach(btn => {
  btn.addEventListener("click", () => {
    qviSelectedQuarter = btn.dataset.quarter || "QTR1";
    setQuarterTabUI();
    renderQviTable();
  });
});

qviCompanySelect?.addEventListener("change", renderQviTable);
qviYearSelect?.addEventListener("change", renderQviTable);
qviSearchInput?.addEventListener("input", renderQviTable);
btnQviRefresh?.addEventListener("click", () => {
  setMsg(qviMsg, "QVI layout is ready. Firestore data wiring comes in the next step.", "ok");
  renderQviTable();
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

  // Comments (newest first)
  const commentsArr = Array.isArray(t.comments) ? t.comments.slice() : [];
  if (commentsArr.length) {
    commentsArr.sort((a, b) => {
      const ta = a?.at ? new Date(a.at).getTime() : 0;
      const tb = b?.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    });

    const commentsWrap = document.createElement("div");
    commentsWrap.className = "comments";

    for (const c of commentsArr) {
      const row = document.createElement("div");
      row.className = "comment";

      const who = document.createElement("div");
      who.className = "who";
      const by = (c?.by || "").trim();
      const when = c?.at ? new Date(c.at).toLocaleString() : "";
      who.textContent = `${by}${by && when ? " • " : ""}${when}`;

      const txt = document.createElement("div");
      txt.className = "txt";
      txt.textContent = (c?.text || "").trim();

      row.appendChild(who);
      row.appendChild(txt);
      commentsWrap.appendChild(row);
    }

    card.appendChild(commentsWrap);
  }

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
  return `${companyId}__${startStr}__${endStr}`;
}

async function loadReport(companyId, startStr, endStr) {
  const id = reportDocId(companyId, startStr, endStr);
  currentCsaReportId = id;

  const ref = doc(db, "csaReports", id);
  const snap = await getDoc(ref);

  // initialize empty
  currentCsaValuesByDate = {};
  for (const day of currentCsaDays) currentCsaValuesByDate[day] = {};

  if (!snap.exists()) return false;

  const data = snap.data() || {};
  const incoming = data.valuesByDate || {};

  for (const day of currentCsaDays) {
    currentCsaValuesByDate[day] = incoming[day] || {};
  }

  // normalize percent values in report
  const pctKeys = new Set((currentCsaMetricSet.metrics || []).filter(m => m.type === "percent").map(m => m.key));
  for (const day of currentCsaDays) {
    const row = currentCsaValuesByDate[day] || {};
    for (const k of pctKeys) {
      if (row[k] !== null && row[k] !== undefined) row[k] = percentToFraction(row[k]);
    }
  }

  return true;
}

async function createReport(companyId, startStr, endStr) {
  if (currentRole !== "management") return;

  const id = reportDocId(companyId, startStr, endStr);
  currentCsaReportId = id;

  const valuesByDate = {};
  for (const day of currentCsaDays) valuesByDate[day] = {};

  await setDoc(doc(db, "csaReports", id), {
    companyId,
    startDate: startStr,
    endDate: endStr,
    valuesByDate,
    createdAt: serverTimestamp(),
    createdBy: currentUser?.email || "",
    updatedAt: serverTimestamp(),
    updatedBy: currentUser?.email || ""
  }, { merge: true });

  currentCsaValuesByDate = valuesByDate;
  setMsg(csaMsg, "Report created. Enter values and click Save.", "ok");
  renderCsaTable();
}

async function saveReport(companyId, startStr, endStr) {
  if (currentRole !== "management") return;
  if (!currentCsaReportId) return setMsg(csaMsg, "No report loaded.", "err");

  await setDoc(doc(db, "csaReports", currentCsaReportId), {
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

    selectedCompanyId = companyId;
    currentCsaDays = eachDayInclusive(s, e);

    await loadMetricSet(companyId);

    // Load existing daily values for all days in range (anything previously entered stays)
    currentCsaValuesByDate = await loadDailyValues(companyId, currentCsaDays);

    setMsg(csaMsg, "Loaded daily values for selected range.", "ok");
    renderCsaTable();
  } catch (e) {
    console.error(e);
    setMsg(csaMsg, "Load failed: " + (e?.message || e), "err");
  }
});

/* btnCsaCreate removed: Save now persists CSA daily values */


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

    selectedCompanyId = companyId;
    currentCsaDays = eachDayInclusive(s, e);

    // Persist each day to csaDaily. This makes values show up in any expanded range.
    await saveDailyValues(companyId, currentCsaDays, currentCsaValuesByDate);

    // Reload to ensure UI reflects what is stored (and merges new days if range changed)
    currentCsaValuesByDate = await loadDailyValues(companyId, currentCsaDays);

    setMsg(csaMsg, "Saved daily values.", "ok");
    renderCsaTable();
  } catch (e) {
    console.error(e);
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
    populateQviYearSelect();
    setQuarterTabUI();
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

// ============================
// QVI VEHICLE LOADER
// ============================

let qviQuarter = "QTR1";
let qviYear = new Date().getFullYear();

async function loadQviVehicles() {

  const tableBody = document.getElementById("qvi-table-body");
  if (!tableBody) return;

  tableBody.innerHTML = "";

  const snapshot = await db.collection("qviVehicles")
    .where("active","==",true)
    .get();

  snapshot.forEach(doc => {

    const vehicle = doc.data();

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${vehicle.entityName || ""}</td>
      <td>${vehicle.unitType || ""}</td>
      <td>${vehicle.vehicleNumber || doc.id}</td>
      <td>${qviQuarter}</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td></td>
    `;

    tableBody.appendChild(row);

  });

}


// load vehicles when dashboard opens
setTimeout(() => {
  loadQviVehicles();
}, 1500);


// ============================
// ADD VEHICLE
// ============================

document.getElementById("add-vehicle-btn")?.addEventListener("click", async () => {

  const vehicleNumber = document.getElementById("vehicle-number-input").value.trim();
  const entityName = document.getElementById("entity-name-input").value.trim();
  const unitType = document.getElementById("unit-type-input").value;

  if (!vehicleNumber || !entityName) {
    alert("Please enter vehicle number and entity name");
    return;
  }

  try {

    await db.collection("qviVehicles").doc(vehicleNumber).set({

      vehicleNumber: vehicleNumber,
      entityName: entityName,
      unitType: unitType,
      active: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()

    });

    document.getElementById("vehicle-number-input").value = "";
    document.getElementById("entity-name-input").value = "";

    alert("Vehicle added successfully");

    loadQviVehicles();

  } catch (error) {

    console.error(error);
    alert("Error adding vehicle");

  }

});
