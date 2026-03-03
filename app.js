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
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/** ---------------------------
 * Helpers
 * --------------------------*/
const $ = (id) => document.getElementById(id);
const show = (el, yes) => el.classList.toggle("hidden", !yes);
const fmtTime = (ts) => {
  try{
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    if(!d) return "";
    return d.toLocaleString();
  }catch{ return ""; }
};

const normalizeEmail = (email) => (email || "").trim().toLowerCase();
const emailDocId = (email) => normalizeEmail(email).replaceAll(".", "(dot)"); // Firestore doc IDs can include '.' but this avoids confusion

const displayNameFromEmail = (email) => {
  // "weston.williams@fedex.com" -> "Weston Williams"
  const local = (email || "").split("@")[0] || "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

async function loadAssignableUsers(){
  if(!taskAssignTo) return;
  taskAssignTo.innerHTML = "";
  // Blank option = unassigned
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "(Unassigned)";
  taskAssignTo.appendChild(blank);

  const snaps = await getDocs(query(collection(db, "allowedUsers"), orderBy("email","asc"), limit(250)));
  snaps.forEach(s => {
    const d = s.data() || {};
    const email = normalizeEmail(d.email);
    if(!email) return;
    const opt = document.createElement("option");
    opt.value = email;
    opt.textContent = `${d.name || displayNameFromEmail(email)} (${email})`;
    taskAssignTo.appendChild(opt);
  });
}

function setMsg(el, text, kind){
  if(!text){
    el.textContent = "";
    el.className = "msg hidden";
    return;
  }
  el.textContent = text;
  el.className = "msg " + (kind || "");
  show(el, true);
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

/** ---------------------------
 * CSA Summary + Companies (Management)
 * --------------------------*/
const companyName = $("companyName");
const btnCompanyAdd = $("btnCompanyAdd");
const companyMsg = $("companyMsg");
const companyList = $("companyList");
const companyEmpty = $("companyEmpty");

const csaCompanySelect = $("csaCompanySelect");
const csaStart = $("csaStart");
const csaEnd = $("csaEnd");
const btnCsaLoad = $("btnCsaLoad");
const btnCsaCreate = $("btnCsaCreate");
const btnCsaSave = $("btnCsaSave");
const csaMsg = $("csaMsg");
const csaTableWrap = $("csaTableWrap");


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
 * App state
 * --------------------------*/
let currentUser = null;
let currentRole = null; // 'management' | 'user'
let unsubOpen = null;
let unsubHistory = null;

let openCache = [];
let histCache = [];
function setRole(role){
  currentRole = role;
  show(btnNewTask, role === "management");
  show(tabAdmin, role === "management");
  // CSA Summary: management can create/save; everyone can view
  show(btnCsaCreate, role === "management");
  show(btnCsaSave, role === "management");
}

function setSignedInUI(yes){
  show(authCard, !yes);
  show(appShell, yes);
  show(btnSignOut, yes);
  show(userPill, yes);
}

function getCurrentTab(){
  const active = document.querySelector(".tab.active");
  return active?.dataset?.tab || "open";
}

function setTab(tab){
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  show($("panel-open"), tab === "open");
  show($("panel-history"), tab === "history");
  show($("panel-admin"), tab === "admin");
  show($("panel-csa"), tab === "csa");
  refreshVisibleLists();
}

function refreshVisibleLists(){
  const tab = getCurrentTab();
  if(tab === "csa"){
    ensureDefaultCsaDates();
    // only load if we have companies
    loadCsaReport();
  }
}

/** ---------------------------
 * Allow-list + role lookup
 * --------------------------*/
async function fetchRoleForEmail(email){
  const id = emailDocId(email);
  const ref = doc(db, "allowedUsers", id);
  const snap = await getDoc(ref);
  if(!snap.exists()) return null;
  const data = snap.data();
  return data?.role || "user";
}

async function requireAllowedUser(user){
  const email = normalizeEmail(user?.email);
  if(!email) return { ok:false, reason:"No email on account." };
  const role = await fetchRoleForEmail(email);
  if(!role) return { ok:false, reason:"This email is not on the allow-list." };
  return { ok:true, role };
}

/** ---------------------------
 * CSA Summary
 * --------------------------*/

// Default metric template (derived from your Excel)
const DEFAULT_CSA_METRICS = [
  {
    "key": "RIB",
    "label": "RIB",
    "goal": 0.985,
    "type": "percent",
    "direction": "higher",
    "totalMode": "avg"
  },
  {
    "key": "LIB",
    "label": "LIB",
    "goal": 0.99,
    "type": "percent",
    "direction": "higher",
    "totalMode": "avg"
  },
  {
    "key": "DNA",
    "label": "DNA",
    "goal": 5,
    "type": "number",
    "direction": "lower",
    "totalMode": "sum"
  },
  {
    "key": "CODE 10",
    "label": "CODE 10",
    "goal": 5,
    "type": "number",
    "direction": "lower",
    "totalMode": "sum"
  },
  {
    "key": "CODE 12",
    "label": "CODE 12",
    "goal": 5,
    "type": "number",
    "direction": "lower",
    "totalMode": "sum"
  },
  {
    "key": "MPU",
    "label": "MPU",
    "goal": 0,
    "type": "number",
    "direction": "lower",
    "totalMode": "sum"
  },
  {
    "key": "E/L",
    "label": "E/L",
    "goal": 0,
    "type": "number",
    "direction": "lower",
    "totalMode": "sum"
  },
  {
    "key": "PU Prox",
    "label": "PU Prox",
    "goal": 0.025,
    "type": "percent",
    "direction": "lower",
    "totalMode": "avg"
  },
  {
    "key": "CODE 85",
    "label": "CODE 85",
    "goal": 5,
    "type": "number",
    "direction": "lower",
    "totalMode": "sum"
  },
  {
    "key": "PPOD",
    "label": "PPOD",
    "goal": 0.97,
    "type": "percent",
    "direction": "higher",
    "totalMode": "avg"
  },
  {
    "key": "SIG COM",
    "label": "SIG COM",
    "goal": 0.992,
    "type": "percent",
    "direction": "higher",
    "totalMode": "avg"
  },
  {
    "key": "DOOR TAG",
    "label": "DOOR TAG",
    "goal": 0.9,
    "type": "percent",
    "direction": "higher",
    "totalMode": "avg"
  }
];

// in-memory CSA state
let csaState = {
  companyId: null,
  start: null,
  end: null,
  reportId: null,
  metrics: [],
  valuesByDate: {}
};

function slugCompanyId(name){
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toISODate(d){
  // d: Date
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function parseISODate(s){
  // s: 'YYYY-MM-DD'
  const [y,m,d] = (s||"").split("-").map(n => parseInt(n,10));
  if(!y || !m || !d) return null;
  return new Date(y, m-1, d);
}

function datesInRange(startISO, endISO){
  const a = parseISODate(startISO);
  const b = parseISODate(endISO);
  if(!a || !b) return [];
  const out = [];
  const cur = new Date(a.getTime());
  while(cur <= b){
    out.push(toISODate(cur));
    cur.setDate(cur.getDate()+1);
  }
  return out;
}

function fmtMetricValue(metric, val){
  if(val === null || val === undefined || val === "") return "";
  const num = Number(val);
  if(Number.isNaN(num)) return "";
  if(metric.type === "percent") {
    return (num*100).toFixed(2) + "%";
  }
  // keep integers if possible
  if(Number.isInteger(num)) return String(num);
  return String(num);
}

function normalizeInput(metric, raw){
  if(raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if(s === "") return null;
  // allow user to type 98.5 for percent or 0.985; interpret > 1 as percent points
  let num = Number(s.replace(/%/g,""));
  if(Number.isNaN(num)) return null;
  if(metric.type === "percent") {
    if(num > 1) num = num / 100;
    // clamp reasonable
    if(num < 0) num = 0;
    if(num > 1) num = 1;
  }
  return num;
}

function cellStatus(metric, val){
  if(val === null || val === undefined) return "";
  const goal = Number(metric.goal);
  if(Number.isNaN(goal)) return "";
  const v = Number(val);
  if(Number.isNaN(v)) return "";
  const higher = metric.direction === "higher";

  // Simple thresholds:
  // - OK meets goal
  // - WARN within 1% (percent metrics) or within 1 (number metrics)
  // - BAD otherwise
  const ok = higher ? (v >= goal) : (v <= goal);
  if(ok) return "ok";

  if(metric.type === "percent") {
    const delta = Math.abs(v - goal);
    if(delta <= 0.01) return "warn"; // within 1 percentage point
  } else {
    const delta = Math.abs(v - goal);
    if(delta <= 1) return "warn";
  }
  return "bad";
}

function computeTotal(metric, dateKeys, valuesByDate){
  const nums = [];
  for(const d of dateKeys){
    const v = valuesByDate?.[d]?.[metric.key];
    if(v === null || v === undefined) continue;
    const n = Number(v);
    if(Number.isNaN(n)) continue;
    nums.push(n);
  }
  if(nums.length === 0) return null;
  if(metric.totalMode === "sum") {
    return nums.reduce((a,b)=>a+b,0);
  }
  // avg default
  return nums.reduce((a,b)=>a+b,0) / nums.length;
}



function updateCsaTotalsAndColors(metrics, dates){
  const table = csaTableWrap?.querySelector("table.csa-table");
  if(!table) return;

  // Update per-cell class (management inputs)
  if(currentRole === "management"){
    table.querySelectorAll('input[data-date][data-key]').forEach(inp => {
      const d = inp.dataset.date;
      const k = inp.dataset.key;
      const m = metrics.find(x => x.key === k);
      if(!m) return;
      const v = csaState.valuesByDate?.[d]?.[k];
      const st = cellStatus(m, v);
      const td = inp.closest("td");
      if(td){
        td.classList.remove("cell-ok","cell-warn","cell-bad");
        if(st) td.classList.add(`cell-${st}`);
      }
    });
  }

  // Update TOTAL row
  const totalRow = table.querySelector("tr.csa-row-total");
  if(!totalRow) return;
  const tds = totalRow.querySelectorAll("td");
  // tds[0] is label
  metrics.forEach((m, i) => {
    const t = computeTotal(m, dates, csaState.valuesByDate);
    const st = cellStatus(m, t);
    const td = tds[i+1];
    if(!td) return;
    td.classList.remove("cell-ok","cell-warn","cell-bad");
    if(st) td.classList.add(`cell-${st}`);
    td.textContent = fmtMetricValue(m, t);
  });
}
function ensureDefaultCsaDates(){
  // If empty, default to last 7 days ending today
  const today = new Date();
  const end = toISODate(today);
  const startD = new Date(today.getTime());
  startD.setDate(startD.getDate()-6);
  const start = toISODate(startD);
  if(csaStart && !csaStart.value) csaStart.value = start;
  if(csaEnd && !csaEnd.value) csaEnd.value = end;
}

async function upsertCompanyByName(name){
  const clean = (name || "").trim();
  if(!clean) throw new Error("Enter a company name.");
  const id = slugCompanyId(clean);
  if(!id) throw new Error("Company name is invalid.");
  const ref = doc(db, "companies", id);

  // create/update company
  const snap = await getDoc(ref);
  if(!snap.exists()) {
    await setDoc(ref, {
      name: clean,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } else {
    await setDoc(ref, {
      name: clean,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  // initialize metric set if missing
  const mref = doc(db, "csaMetricSets", id);
  const msnap = await getDoc(mref);
  if(!msnap.exists()) {
    await setDoc(mref, {
      companyId: id,
      metrics: DEFAULT_CSA_METRICS,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    });
  }

  return id;
}

function renderCompanyList(items){
  if(!companyList) return;
  companyList.innerHTML = "";
  show(companyEmpty, items.length === 0);

  for(const c of items){
    const div = document.createElement("div");
    div.className = "item";
    const badgeClass = c.active ? "ok" : "off";
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
        <div>
          <div style="font-weight:700;">${escapeHtml(c.name)}</div>
          <div class="muted" style="font-size:12px;">ID: ${escapeHtml(c.id)}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="badge ${badgeClass}">${c.active ? "Active" : "Inactive"}</span>
          <button class="btn" data-act="toggle" data-id="${escapeAttr(c.id)}">${c.active ? "Disable" : "Enable"}</button>
          <button class="btn danger" data-act="delete" data-id="${escapeAttr(c.id)}">Delete</button>
        </div>
      </div>
    `;
    companyList.appendChild(div);
  }

  companyList.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if(!id) return;
      try{
        if(act === "toggle") {
          const ref = doc(db, "companies", id);
          const snap = await getDoc(ref);
          if(!snap.exists()) return;
          const data = snap.data();
          await setDoc(ref, {
            active: !data.active,
            updatedAt: serverTimestamp()
          }, { merge: true });
        } else if(act === "delete") {
          // NOTE: This deletes the company record only (reports remain).
          // You can manually delete reports later if you ever want.
          await deleteDoc(doc(db, "companies", id));
        }
      }catch(e){
        setMsg(companyMsg, e?.message || String(e), "err");
      }
    });
  });
}

function renderCompanyDropdown(items){
  if(!csaCompanySelect) return;
  const active = items.filter(x => x.active);
  const prev = csaCompanySelect.value;
  csaCompanySelect.innerHTML = "";
  for(const c of active){
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    csaCompanySelect.appendChild(opt);
  }
  // keep selection when possible
  if(prev && active.some(x=>x.id===prev)) {
    csaCompanySelect.value = prev;
  }
}

function bindCompanySnapshots(){
  // always listen (dropdown available to everyone)
  const q = query(collection(db, "companies"), orderBy("name"));
  return onSnapshot(q, (snap) => {
    const items = [];
    snap.forEach(docSnap => {
      const d = docSnap.data();
      items.push({
        id: docSnap.id,
        name: d?.name || docSnap.id,
        active: d?.active !== false
      });
    });
    renderCompanyDropdown(items);
    // company list only meaningful for management
    if(currentRole === "management") {
      renderCompanyList(items);
    }
  }, (err) => {
    // avoid crashing UI; show in CSA msg
    setMsg(csaMsg, "Failed to load companies: " + (err?.message || err), "err");
  });
}

let unsubCompanies = null;

async function loadMetricSet(companyId){
  const ref = doc(db, "csaMetricSets", companyId);
  const snap = await getDoc(ref);
  if(!snap.exists()) return DEFAULT_CSA_METRICS;
  const d = snap.data();
  return Array.isArray(d?.metrics) ? d.metrics : DEFAULT_CSA_METRICS;
}

function reportDocId(companyId, startISO, endISO){
  return `${companyId}__${startISO}__${endISO}`;
}

async function loadCsaReport(){
  setMsg(csaMsg, "", "");
  ensureDefaultCsaDates();

  const companyId = csaCompanySelect?.value;
  const startISO = csaStart?.value;
  const endISO = csaEnd?.value;

  if(!companyId) {
    setMsg(csaMsg, "No companies yet. Add one in Management → Companies.", "warn");
    csaTableWrap.innerHTML = "";
    return;
  }
  if(!startISO || !endISO) {
    setMsg(csaMsg, "Choose a start and end date.", "warn");
    return;
  }

  const dates = datesInRange(startISO, endISO);
  if(dates.length === 0) {
    setMsg(csaMsg, "Invalid date range.", "err");
    return;
  }
  if(dates.length > 31) {
    setMsg(csaMsg, "Date range too large. Keep it to 31 days or less.", "warn");
    return;
  }

  const metrics = await loadMetricSet(companyId);
  const rid = reportDocId(companyId, startISO, endISO);
  const ref = doc(db, "csaReports", rid);
  const snap = await getDoc(ref);

  if(!snap.exists()) {
    // no report yet
    csaState = {
      companyId,
      start: startISO,
      end: endISO,
      reportId: rid,
      metrics,
      valuesByDate: Object.fromEntries(dates.map(d => [d, {}]))
    };
    csaTableWrap.innerHTML = "";
    setMsg(csaMsg, "No report for this range. Click “Create report” to start.", "warn");
    // show create only for management (already controlled in setRole)
    return;
  }

  const data = snap.data() || {};
  csaState = {
    companyId,
    start: startISO,
    end: endISO,
    reportId: rid,
    metrics,
    valuesByDate: data.valuesByDate || {}
  };
  // ensure all dates exist
  for(const d of dates){
    if(!csaState.valuesByDate[d]) csaState.valuesByDate[d] = {};
  }
  renderCsaTable();
}

async function createCsaReport(){
  if(currentRole !== "management") return;
  setMsg(csaMsg, "", "");
  await loadCsaReport();
  if(!csaState?.companyId) return;

  const dates = datesInRange(csaState.start, csaState.end);
  const valuesByDate = Object.fromEntries(dates.map(d => [d, csaState.valuesByDate?.[d] || {}]));
  const payload = {
    companyId: csaState.companyId,
    startDate: csaState.start,
    endDate: csaState.end,
    valuesByDate,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, "csaReports", csaState.reportId), payload);
  setMsg(csaMsg, "Report created. Enter values and click Save.", "ok");
  csaState.valuesByDate = valuesByDate;
  renderCsaTable();
}

async function saveCsaReport(){
  if(currentRole !== "management") return;
  setMsg(csaMsg, "", "");

  if(!csaState?.reportId) {
    setMsg(csaMsg, "Load or create a report first.", "warn");
    return;
  }

  await setDoc(doc(db, "csaReports", csaState.reportId), {
    companyId: csaState.companyId,
    startDate: csaState.start,
    endDate: csaState.end,
    valuesByDate: csaState.valuesByDate,
    updatedAt: serverTimestamp()
  }, { merge: true });

  setMsg(csaMsg, "Saved.", "ok");
  renderCsaTable(); // re-render totals/colors
}

function renderCsaTable(){
  if(!csaTableWrap) return;
  const metrics = csaState.metrics || [];
  const dates = datesInRange(csaState.start, csaState.end);

  const thead = `
    <thead>
      <tr>
        <th>Date</th>
        ${metrics.map(m => `<th>${escapeHtml(m.label || m.key)}</th>`).join("")}
      </tr>
    </thead>
  `;

  // GOAL row
  const goalRow = `
    <tr class="csa-row-goal">
      <td>GOAL</td>
      ${metrics.map(m => `<td>${fmtMetricValue(m, m.goal)}</td>`).join("")}
    </tr>
  `;

  // daily rows
  const rows = dates.map(d => {
    const displayDate = d; // keep ISO for now
    const cells = metrics.map(m => {
      const val = csaState.valuesByDate?.[d]?.[m.key];
      const status = cellStatus(m, val);
      const cls = status ? `cell-${status}` : "";
      if(currentRole === "management") {
        const raw = (val === null || val === undefined) ? "" : String(val);
        return `
          <td class="${cls}">
            <input
              data-date="${escapeAttr(d)}"
              data-key="${escapeAttr(m.key)}"
              value="${escapeAttr(raw)}"
              placeholder=""
            />
          </td>
        `;
      }
      return `<td class="${cls}">${fmtMetricValue(m, val)}</td>`;
    }).join("");
    return `<tr><td>${escapeHtml(displayDate)}</td>${cells}</tr>`;
  }).join("");

  // TOTAL row
  const totalCells = metrics.map(m => {
    const t = computeTotal(m, dates, csaState.valuesByDate);
    const status = cellStatus(m, t);
    const cls = status ? `cell-${status}` : "";
    return `<td class="${cls}">${fmtMetricValue(m, t)}</td>`;
  }).join("");

  const totalRow = `<tr class="csa-row-total"><td>TOTAL</td>${totalCells}</tr>`;

  csaTableWrap.innerHTML = `
    <table class="csa-table">
      ${thead}
      <tbody>
        ${goalRow}
        ${rows}
        ${totalRow}
      </tbody>
    </table>
  `;

  // bind input events
  if(currentRole === "management") {
    csaTableWrap.querySelectorAll("input[data-date][data-key]").forEach(inp => {
      inp.addEventListener("input", () => {
        const dateKey = inp.dataset.date;
        const metricKey = inp.dataset.key;
        const metric = metrics.find(x => x.key === metricKey);
        if(!metric) return;
        const val = normalizeInput(metric, inp.value);
        if(!csaState.valuesByDate[dateKey]) csaState.valuesByDate[dateKey] = {};
        if(val === null) {
          delete csaState.valuesByDate[dateKey][metricKey];
        } else {
          csaState.valuesByDate[dateKey][metricKey] = val;
        }
        // live update totals/colors
        updateCsaTotalsAndColors(metrics, dates);
});
    });
  }
}



/** ---------------------------
 * Tasks
 * Firestore structure:
 *  - tasks (collection)
 *      - { title, description, status: 'open'|'done', createdAt, createdBy, completedAt, completedBy, comments: [] }
 * --------------------------*/
function taskMatchesSearch(task, q){
  if(!q) return true;
  const s = q.toLowerCase();
  return (task.title || "").toLowerCase().includes(s)
    || (task.description || "").toLowerCase().includes(s)
    || (task.completedBy || "").toLowerCase().includes(s)
    || (task.createdBy || "").toLowerCase().includes(s);
}

function renderTaskItem(docSnap, isHistory){
  const t = docSnap.data();
  const id = docSnap.id;

  const wrap = document.createElement("div");
  wrap.className = "item";

  const top = document.createElement("div");
  top.className = "item-top";

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = t.title || "(untitled)";
  left.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "item-meta";
  const created = fmtTime(t.createdAt);
  const done = fmtTime(t.completedAt);
  const assignedLabel = t.assignedTo ? ` • assigned to ${t.assignedToName || t.assignedTo}` : "";
  meta.textContent = isHistory
    ? `Completed ${done || ""} • by ${t.completedBy || "?"} • created ${created || ""}${assignedLabel}`
    : `Created ${created || ""} • by ${t.createdBy || "?"}${assignedLabel}`;
  left.appendChild(meta);

  top.appendChild(left);

  const right = document.createElement("div");
  right.className = "badge";
  right.textContent = t.status === "done" ? "Done" : "Open";
  top.appendChild(right);

  wrap.appendChild(top);

  if(t.description){
    const desc = document.createElement("div");
    desc.className = "item-desc";
    desc.textContent = t.description;
    wrap.appendChild(desc);
  }

  // Comments
  const comments = Array.isArray(t.comments) ? t.comments : [];
  const commentsWrap = document.createElement("div");
  commentsWrap.className = "comments";
  if(comments.length){
    comments.slice().reverse().forEach(c => {
      const el = document.createElement("div");
      el.className = "comment";
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = `${c.by || "?"} • ${c.at ? new Date(c.at).toLocaleString() : ""}`;
      const txt = document.createElement("div");
      txt.className = "txt";
      txt.textContent = c.text || "";
      el.appendChild(who);
      el.appendChild(txt);
      commentsWrap.appendChild(el);
    });
  }
  wrap.appendChild(commentsWrap);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  // Comment input
  const cInput = document.createElement("input");
  cInput.type = "text";
  cInput.placeholder = "Add a comment…";
  cInput.style.flex = "1";
  cInput.maxLength = 300;

  const cBtn = document.createElement("button");
  cBtn.className = "btn";
  cBtn.textContent = "Comment";
  cBtn.onclick = async () => {
    const text = (cInput.value || "").trim();
    if(!text) return;
    cBtn.disabled = true;
    try{
      const next = comments.concat([{ by: currentUser.email, text, at: Date.now() }]);
      await updateDoc(doc(db, "tasks", id), { comments: next });
      cInput.value = "";
    }catch(e){
      alert("Could not add comment: " + (e?.message || e));
    }finally{
      cBtn.disabled = false;
    }
  };

  actions.appendChild(cInput);
  actions.appendChild(cBtn);

  if(!isHistory){
    const doneBtn = document.createElement("button");
    doneBtn.className = "btn primary";
    doneBtn.textContent = "Mark completed";
    doneBtn.onclick = async () => {
      doneBtn.disabled = true;
      try{
        await updateDoc(doc(db, "tasks", id), {
          status: "done",
          completedAt: serverTimestamp(),
          completedBy: currentUser.email
        });
      }catch(e){
        alert("Could not complete task: " + (e?.message || e));
      }finally{
        doneBtn.disabled = false;
      }
    };
    actions.appendChild(doneBtn);
  }

  // Management-only delete
  if(currentRole === "management"){
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.textContent = "Delete";
    delBtn.onclick = async () => {
      if(!confirm("Delete this task?")) return;
      delBtn.disabled = true;
      try{
        await deleteDoc(doc(db, "tasks", id));
      }catch(e){
        alert("Could not delete task: " + (e?.message || e));
      }finally{
        delBtn.disabled = false;
      }
    };
    actions.appendChild(delBtn);
  }

  wrap.appendChild(actions);
  return wrap;
}


function renderOpenFromCache(){
  const q = (searchInput.value || "").trim().toLowerCase();
  openList.innerHTML = "";
  let count = 0;
  openCache.forEach(({ docSnap, data }) => {
    const t = data;
    if(t.status !== "open") return;
    if(!taskMatchesSearch(t, q)) return;
    openList.appendChild(renderTaskItem(docSnap, false));
    count++;
  });
  show(openEmpty, count === 0);
}

function renderHistoryFromCache(){
  const q = (searchInput.value || "").trim().toLowerCase();
  historyList.innerHTML = "";
  let count = 0;
  histCache.forEach(({ docSnap, data }) => {
    const t = data;
    if(t.status !== "done") return;
    if(!taskMatchesSearch(t, q)) return;
    historyList.appendChild(renderTaskItem(docSnap, true));
    count++;
  });
  show(historyEmpty, count === 0);
}


function bindTaskListeners(){
  // open tasks
  const qOpen = query(collection(db, "tasks"), orderBy("createdAt","desc"), limit(200));
  unsubOpen = onSnapshot(qOpen, (snap) => {
    openCache = [];
    snap.forEach(d => openCache.push({ docSnap: d, data: d.data() }));
    renderOpenFromCache();
  });

  // history tasks
  const qHist = query(collection(db, "tasks"), orderBy("completedAt","desc"), limit(200));
  unsubHistory = onSnapshot(qHist, (snap) => {
    histCache = [];
    snap.forEach(d => histCache.push({ docSnap: d, data: d.data() }));
    renderHistoryFromCache();
  });
}

function unbindTaskListeners(){
  if(unsubOpen) unsubOpen();
  if(unsubHistory) unsubHistory();
  unsubOpen = null;
  unsubHistory = null;
}

/** ---------------------------
 * Management panel: allow-list
 * --------------------------*/
async function refreshAllowedList(){
  allowedList.innerHTML = "";
  const snaps = await getDocs(query(collection(db, "allowedUsers"), orderBy("email","asc"), limit(250)));
  let count = 0;
  snaps.forEach(s => {
    const d = s.data();
    const div = document.createElement("div");
    div.className = "item";
    div.style.padding = "10px 12px";
    div.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-title">${d.email || "(no email)"}</div>
          <div class="item-meta">Role: <b>${d.role || "user"}</b></div>
        </div>
        <span class="badge">${d.role || "user"}</span>
      </div>
    `;
    div.onclick = () => {
      allowEmail.value = d.email || "";
      allowRole.value = d.role || "user";
      setMsg(adminMsg, "Loaded user into editor.", "");
    };
    allowedList.appendChild(div);
    count++;
  });
  show(allowedEmpty, count === 0);
}

async function upsertAllowed(){
  const email = normalizeEmail(allowEmail.value);
  const role = allowRole.value;
  if(!email){
    setMsg(adminMsg, "Enter an email.", "err");
    return;
  }
  btnAllowAdd.disabled = true;
  try{
    const id = emailDocId(email);
    await setDoc(doc(db, "allowedUsers", id), {
      email,
      role,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.email
    }, { merge:true });
    setMsg(adminMsg, "Saved allow-list entry.", "ok");
    await refreshAllowedList();
  }catch(e){
    setMsg(adminMsg, "Could not save: " + (e?.message || e), "err");
  }finally{
    btnAllowAdd.disabled = false;
  }
}

async function removeAllowed(){
  const email = normalizeEmail(allowEmail.value);
  if(!email){
    setMsg(adminMsg, "Enter an email to remove.", "err");
    return;
  }
  if(!confirm("Remove this email from allow-list?")) return;
  btnAllowRemove.disabled = true;
  try{
    await deleteDoc(doc(db, "allowedUsers", emailDocId(email)));
    setMsg(adminMsg, "Removed from allow-list.", "ok");
    await refreshAllowedList();
  }catch(e){
    setMsg(adminMsg, "Could not remove: " + (e?.message || e), "err");
  }finally{
    btnAllowRemove.disabled = false;
  }
}

/** ---------------------------
 * Modal
 * --------------------------*/
async function openModal(){
  taskTitle.value = "";
  taskDesc.value = "";
  if(taskAssignTo){
    await loadAssignableUsers();
    taskAssignTo.value = "";
  }
  setMsg(taskMsg, "", "");
  show(backdrop, true);
  show(taskModal, true);
  taskTitle.focus();
}
function closeModal(){
  show(taskModal, false);
  show(backdrop, false);
}
btnModalClose.onclick = closeModal;
btnCancelTask.onclick = closeModal;
backdrop.onclick = closeModal;

async function createTask(){
  const title = (taskTitle.value || "").trim();
  const description = (taskDesc.value || "").trim();
  if(!title){
    setMsg(taskMsg, "Title is required.", "err");
    return;
  }
  btnCreateTask.disabled = true;
  try{
    const assignedTo = normalizeEmail(taskAssignTo?.value || "");
    await addDoc(collection(db, "tasks"), {
      title,
      description,
      assignedTo: assignedTo || null,
      assignedToName: assignedTo ? displayNameFromEmail(assignedTo) : null,
      status: "open",
      createdAt: serverTimestamp(),
      createdBy: currentUser.email,
      comments: []
    });
    setMsg(taskMsg, "Created.", "ok");
    setTimeout(closeModal, 300);
  }catch(e){
    setMsg(taskMsg, "Could not create: " + (e?.message || e), "err");
  }finally{
    btnCreateTask.disabled = false;
  }
}

/** ---------------------------
 * Auth flows
 * --------------------------*/
async function doSignIn(){
  setMsg(authMsg, "", "");
  const email = normalizeEmail(authEmail.value);
  const pass = authPassword.value || "";
  if(!email || !pass){
    setMsg(authMsg, "Enter email and password.", "err");
    return;
  }
  btnSignIn.disabled = true;
  try{
    await signInWithEmailAndPassword(auth, email, pass);
  }catch(e){
    setMsg(authMsg, e?.message || String(e), "err");
  }finally{
    btnSignIn.disabled = false;
  }
}

async function doSignUp(){
  setMsg(authMsg, "", "");
  const email = normalizeEmail(authEmail.value);
  const pass = authPassword.value || "";
  if(!email || !pass){
    setMsg(authMsg, "Enter email and password.", "err");
    return;
  }
  btnSignUp.disabled = true;
  try{
    // Optional: soft-check allow-list before creating account
    const role = await fetchRoleForEmail(email);
    if(!role){
      setMsg(authMsg, "That email is not on the allow-list yet.", "err");
      return;
    }
    await createUserWithEmailAndPassword(auth, email, pass);
  }catch(e){
    setMsg(authMsg, e?.message || String(e), "err");
  }finally{
    btnSignUp.disabled = false;
  }
}

async function doSendLink(){
  setMsg(authMsg, "", "");
  const email = normalizeEmail(authEmail.value);
  if(!email){
    setMsg(authMsg, "Enter your email first.", "err");
    return;
  }
  // Soft-check allow-list before sending link
  const role = await fetchRoleForEmail(email);
  if(!role){
    setMsg(authMsg, "That email is not on the allow-list yet.", "err");
    return;
  }

  btnSendLink.disabled = true;
  try{
    const actionCodeSettings = {
      // IMPORTANT: replace with your hosting URL after you deploy
      url: "https://techwestpros-netizen.github.io/task-tracker-work/",
      handleCodeInApp: true
    };
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem("emailForSignIn", email);
    setMsg(authMsg, "Email link sent. Check your inbox.", "ok");
  }catch(e){
    setMsg(authMsg, e?.message || String(e), "err");
  }finally{
    btnSendLink.disabled = false;
  }
}

btnSignIn.onclick = doSignIn;
btnSignUp.onclick = doSignUp;
btnSendLink.onclick = doSendLink;

btnSignOut.onclick = async () => {
  await signOut(auth);
};

// Tabs
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => setTab(t.dataset.tab));
});

btnNewTask.onclick = openModal;
btnCreateTask.onclick = createTask;

btnRefreshHistory.onclick = () => {
  // snapshots auto-update; this is just a convenience
  setMsg(authMsg, "", "");
};


// Search (re-renders immediately using cached snapshots)
searchInput.addEventListener("input", () => {
  // Only render the visible panel, but it's fine to render both (small lists).
  renderOpenFromCache();
  renderHistoryFromCache();
});
// Admin events
btnAllowAdd.onclick = upsertAllowed;
btnAllowRemove.onclick = removeAllowed;

// Companies (Management)
if(btnCompanyAdd){
  btnCompanyAdd.onclick = async () => {
    try{
      setMsg(companyMsg, "", "");
      if(currentRole !== "management"){
        setMsg(companyMsg, "Management only.", "err");
        return;
      }
      const id = await upsertCompanyByName(companyName.value);
      companyName.value = "";
      setMsg(companyMsg, "Saved company: " + id, "ok");
    }catch(e){
      setMsg(companyMsg, e?.message || String(e), "err");
    }
  };
}

// CSA Summary events
if(btnCsaLoad) btnCsaLoad.onclick = () => loadCsaReport();
if(btnCsaCreate) btnCsaCreate.onclick = () => createCsaReport();
if(btnCsaSave) btnCsaSave.onclick = () => saveCsaReport();

// load on company/date change (lightweight)
if(csaCompanySelect) csaCompanySelect.addEventListener("change", () => {
  if(getCurrentTab() === "csa") loadCsaReport();
});
if(csaStart) csaStart.addEventListener("change", () => {
  if(getCurrentTab() === "csa") loadCsaReport();
});
if(csaEnd) csaEnd.addEventListener("change", () => {
  if(getCurrentTab() === "csa") loadCsaReport();
});



/** ---------------------------
 * Handle email-link sign in (optional)
 * --------------------------*/
(async function handleEmailLink(){
  try{
    if(isSignInWithEmailLink(auth, window.location.href)){
      const email = window.localStorage.getItem("emailForSignIn") || prompt("Confirm your email");
      if(email){
        await signInWithEmailLink(auth, email, window.location.href);
        window.localStorage.removeItem("emailForSignIn");
        // clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }catch(e){
    setMsg(authMsg, "Email link sign-in failed: " + (e?.message || e), "err");
  }
})();

/** ---------------------------
 * Auth state
 * --------------------------*/
onAuthStateChanged(auth, async (user) => {
  setMsg(authMsg, "", "");
  setMsg(adminMsg, "", "");
  if(!user){
    currentUser = null;
    currentRole = null;
    userPill.textContent = "";
    setSignedInUI(false);
    unbindTaskListeners();
    if(unsubCompanies){ try{unsubCompanies();}catch{} unsubCompanies=null; }
    return;
  }

  // Enforce allow-list
  try{
    const res = await requireAllowedUser(user);
    if(!res.ok){
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

    // Bind task listeners
    unbindTaskListeners();

    // Companies + CSA
    if(unsubCompanies){ try{unsubCompanies();}catch{} unsubCompanies=null; }
    unsubCompanies = bindCompanySnapshots();
    ensureDefaultCsaDates();

    bindTaskListeners();

    // Admin list
    if(res.role === "management"){
      await refreshAllowedList();
    }
  }catch(e){
    await signOut(auth);
    setMsg(authMsg, "Sign-in blocked: " + (e?.message || e), "err");
  }
});
