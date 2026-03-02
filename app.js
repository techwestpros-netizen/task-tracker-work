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
  refreshVisibleLists();
}

function refreshVisibleLists(){
  const tab = getCurrentTab();
  // nothing special here; listeners keep lists updated.
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
