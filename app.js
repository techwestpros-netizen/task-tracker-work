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
 * CSA elements (optional; only runs if present in your HTML)
 * --------------------------*/
const tabCSA = $("tabCSA") || document.querySelector('.tab[data-tab="csa"]'); // supports either id or data-tab button
const csaCompanyName = $("csaCompanyName") || $("companyNameInput") || $("companyName"); // fallback ids
const btnCompanySave = $("btnCompanySave") || $("btnAddCompany") || $("btnCompanyAdd") || $("btnCompanyUpdate");
const companyListEl = $("companyList") || $("companyListItems") || $("companyListContainer");
const csaCompanySelect = $("csaCompanySelect") || $("companySelect") || $("csaCompanyDropdown");
const csaStartDate = $("csaStartDate") || $("startDate");
const csaEndDate = $("csaEndDate") || $("endDate");
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
  // CSA tab is visible to allowed users (both roles), but edit buttons are management-only
  // If your HTML hides CSA tab by default, you can uncomment:
  // if (tabCSA) tabCSA.classList.remove("hidden");
}

function setSignedInUI(yes) {
  show(authCard, !yes);
  show(appShell, yes);
  show(btnSignOut, yes);
  show(userPill, yes);
}

function getCurrentTab() {
  const active = document.querySelector(".tab.active");
  return active?.dataset?.tab || "open";
}

function setTab(tab) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  show($("panel-open"), tab === "open");
  show($("panel-history"), tab === "history");
  show($("panel-admin"), tab === "admin");
  show($("panel-csa"), tab === "csa");
  // re-render CSA if visible
  if (tab === "csa") {
    renderCompaniesUI();
  }
}

/** ---------------------------
 * Allow-list + role lookup
 * --------------------------*/
async function fetchRoleForEmail(email) {
  const id = emailDocId(email);
  const ref = doc(db, "allowedUsers", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const d = snap.data() || {};
  return d.role || null;
}

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
 * Task listeners + rendering
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

    // Comments display
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
 * CSA: Companies + Dropdown + (basic) structure
 * --------------------------*/
function stopCompaniesListener() {
  if (unsubCompanies) unsubCompanies();
  unsubCompanies = null;
  companiesCache = [];
}

function startCompaniesListener() {
  // Only start once user is signed-in + allowed.
  if (unsubCompanies) return;

  // Read all active companies (and also show inactive in "Company list" for management if you want)
  // We'll read all and filter in UI to keep it simple.
  const qCompanies = query(collection(db, "companies"), orderBy("name", "asc"), limit(500));
  unsubCompanies = onSnapshot(qCompanies, (snap) => {
    companiesCache = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    renderCompaniesUI();
  }, (err) => {
    setMsg(csaMsg, "Companies read blocked: " + (err?.message || err), "err");
  });
}

function renderCompaniesUI() {
  // Populate the list panel (management only)
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
            // clicking a company selects it in dropdown (if present)
            if (csaCompanySelect) {
              csaCompanySelect.value = c.id;
              selectedCompanyId = c.id;
            }
          };
          companyListEl.appendChild(row);
        }
      }
    } else {
      // non-management: hide list content (if your HTML shows it)
      // leaving empty is fine
    }
  }

  // Populate dropdown with ACTIVE companies (both roles)
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

    // restore selection if possible
    if (prev && activeCompanies.some(c => c.id === prev)) {
      csaCompanySelect.value = prev;
      selectedCompanyId = prev;
    } else if (selectedCompanyId && activeCompanies.some(c => c.id === selectedCompanyId)) {
      csaCompanySelect.value = selectedCompanyId;
    }
  }

  // Show/hide CSA edit controls if your HTML uses buttons
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

    setMsg(csaMsg, `Saved company: ${id}`, "ok");
    if (csaCompanyName) csaCompanyName.value = "";
  } catch (e) {
    setMsg(csaMsg, "Failed to save company: " + (e?.message || e), "err");
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

    // Bind task listeners
    unbindTaskListeners();
    bindTaskListeners();

    // Admin list
    if (res.role === "management") {
      await refreshAllowedList();
    }

    // ✅ START COMPANIES LISTENER *AFTER ROLE IS KNOWN*
    // This is the key fix so the UI always populates.
    if (tabCSA || $("panel-csa") || csaCompanySelect || companyListEl) {
      startCompaniesListener();
    }
  } catch (e) {
    await signOut(auth);
    setMsg(authMsg, "Sign-in blocked: " + (e?.message || e), "err");
  }
});
