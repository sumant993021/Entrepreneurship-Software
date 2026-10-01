// State Management
let currentUser = null;
let authToken = localStorage.getItem("edmg_token") || null;
let currentMyGroup = null;
let allAdminGroups = [];
let expandedAdminGroupIds = new Set();
let socket = null;
let deleteTargetGroupId = null;
let regRole = "student"; // 'student' or 'faculty'

// Firebase real-time listener un-subscribers
let myGroupFirestoreUnsub = null;
let adminGroupsFirestoreUnsub = null;

const API_BASE = window.location.origin;

// Toast Notifications
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  let icon = "fa-circle-info";
  if (type === "success") icon = "fa-circle-check";
  if (type === "error") icon = "fa-circle-exclamation";

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// WebSocket Setup (Real-time fallback & notification channel)
function setupWebSocket() {
  if (socket) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      const indicator = document.getElementById("liveIndicator");
      if (indicator) {
        indicator.style.display = "flex";
        indicator.title = "Real-Time Firebase & WebSocket Active";
      }
      setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send("ping");
        }
      }, 30000);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleLiveEvent(data);
      } catch (err) {}
    };

    socket.onclose = () => {
      socket = null;
      setTimeout(setupWebSocket, 4000);
    };
  } catch (e) {
    console.warn("WebSocket init error:", e);
  }
}

function handleLiveEvent(data) {
  const activeTab = document.querySelector(".nav-item.active");

  if (data.event === "STEP_VERIFIED") {
    if (currentUser && currentMyGroup && data.group_id === currentMyGroup.id) {
      showToast(`Faculty marked Step ${data.step_number} as '${data.status.toUpperCase()}'!`, data.status === "approved" ? "success" : "info");
      loadMyGroup();
    }
    if (currentUser && currentUser.role === "faculty" && activeTab && activeTab.id === "tabAdminGroupsBtn") {
      loadAdminGroups(false);
    }
  } else if (data.event === "SCORE_UPDATED" || data.event === "GROUP_DELETED") {
    if (activeTab && activeTab.id === "tabLeaderboardBtn") {
      loadLeaderboard(false);
    }
    if (currentUser && currentMyGroup && data.group_id === currentMyGroup.id) {
      if (data.score) {
        currentMyGroup.score = data.score;
        renderStudentMarks(data.score);
        showToast(`Faculty scored your project: ${data.score.total}/50`, "info");
      }
    }
    if (currentUser && currentUser.role === "faculty" && activeTab && activeTab.id === "tabAdminGroupsBtn") {
      loadAdminGroups(false);
    }
  } else if (data.event === "GROUP_CONTENT_UPDATED") {
    if (currentUser && currentUser.role === "faculty" && activeTab && activeTab.id === "tabAdminGroupsBtn") {
      loadAdminGroups(false);
    }
    if (currentUser && currentMyGroup && data.group_id === currentMyGroup.id && activeTab && activeTab.id === "tabMyGroupBtn") {
      loadMyGroup();
    }
  } else if (data.event === "MARKETING_CLICK_RECORDED") {
    if (currentUser && currentMyGroup && data.group_id === currentMyGroup.id) {
      showToast(`New verified unique visit recorded from ${data.channel.toUpperCase()}!`, "info");
      loadMyGroup();
    }
    if (currentUser && currentUser.role === "faculty" && activeTab && activeTab.id === "tabAdminGroupsBtn") {
      loadAdminGroups(false);
    }
  }
}

// Auth Helpers
function authHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${authToken}`
  };
}

async function checkAuth() {
  if (!authToken) {
    showAuthUI();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: authHeaders()
    });

    if (res.ok) {
      currentUser = await res.json();
      setupWebSocket();
      showAppUI();
      loadInitialData();
    } else {
      logout();
    }
  } catch (err) {
    showAuthUI();
  }
}

function showAuthUI() {
  document.getElementById("authSection").style.display = "block";
  document.getElementById("mainNav").style.display = "none";
  document.getElementById("userBadge").style.display = "none";
  hideAllTabs();
}

function showAppUI() {
  document.getElementById("authSection").style.display = "none";
  document.getElementById("mainNav").style.display = "flex";
  document.getElementById("userBadge").style.display = "flex";

  document.getElementById("userNameDisplay").textContent = currentUser.name;
  let roleDesc = currentUser.role.toUpperCase();
  if (currentUser.role === "student") {
    roleDesc += ` • ${currentUser.department} ${currentUser.division} (${currentUser.batch})`;
  } else if (currentUser.role === "faculty") {
    roleDesc += ` • Faculty`;
  }
  document.getElementById("userRoleDisplay").textContent = roleDesc;
  document.getElementById("userAvatar").textContent = currentUser.name.charAt(0).toUpperCase();

  const adminGroupsBtn = document.getElementById("tabAdminGroupsBtn");
  const adminUsersBtn = document.getElementById("tabAdminUsersBtn");
  const myGroupBtn = document.getElementById("tabMyGroupBtn");
  const leaderboardBtn = document.getElementById("tabLeaderboardBtn");

  if (currentUser.role === "faculty") {
    adminGroupsBtn.style.display = "flex";
    adminUsersBtn.style.display = "flex";
    if (leaderboardBtn) leaderboardBtn.style.display = "flex";
    renderFacultyAssignedBadges();
    switchTab("admin-groups");
  } else {
    adminGroupsBtn.style.display = "none";
    adminUsersBtn.style.display = "none";
    // Student Dashboard: No point in leaderboard for student dashboard
    if (leaderboardBtn) leaderboardBtn.style.display = "none";
    switchTab("my-group");
  }
}

function renderFacultyAssignedBadges() {
  const container = document.getElementById("facultyAssignedBadges");
  if (!container || !currentUser || !currentUser.assignments) return;

  const html = currentUser.assignments.map(a => {
    const batches = (a.batches || []).join(", ");
    return `
      <div class="assigned-pill">
        <span class="badge-dept">${a.department}</span>
        <span class="ap-details">${a.student_class} • ${a.division} • <strong>${batches}</strong></span>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="assigned-summary-card">
      <span class="as-title"><i class="fa-solid fa-clipboard-check"></i> Your Registered Department &amp; Batch Allocations:</span>
      <div class="assigned-pills-list">${html}</div>
    </div>
  `;
}

function loadInitialData() {
  if (currentUser.role === "student") {
    loadMyGroup();
  } else if (currentUser.role === "faculty") {
    loadAdminGroups();
  }
}

// Tab Switching
function switchTab(tabId) {
  hideAllTabs();
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.remove("active"));

  if (tabId === "my-group") {
    document.getElementById("myGroupTab").style.display = "block";
    document.getElementById("tabMyGroupBtn").classList.add("active");
    loadMyGroup();
  } else if (tabId === "admin-groups") {
    document.getElementById("adminGroupsTab").style.display = "block";
    document.getElementById("tabAdminGroupsBtn").classList.add("active");
    loadAdminGroups();
  } else if (tabId === "leaderboard") {
    document.getElementById("leaderboardTab").style.display = "block";
    document.getElementById("tabLeaderboardBtn").classList.add("active");
    loadLeaderboard();
  } else if (tabId === "admin-users") {
    document.getElementById("adminUsersTab").style.display = "block";
    document.getElementById("tabAdminUsersBtn").classList.add("active");
    loadAdminUsers();
  }
}

function hideAllTabs() {
  document.getElementById("myGroupTab").style.display = "none";
  document.getElementById("adminGroupsTab").style.display = "none";
  document.getElementById("leaderboardTab").style.display = "none";
  document.getElementById("adminUsersTab").style.display = "none";
}

// Auth Form Modes
let isRegisterMode = false;
function toggleAuthMode() {
  isRegisterMode = !isRegisterMode;
  const loginForm = document.getElementById("loginForm");
  const regSelector = document.getElementById("registerRoleSelector");
  const stuForm = document.getElementById("studentRegisterForm");
  const facForm = document.getElementById("facultyRegisterForm");
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSubtitle");
  const prompt = document.getElementById("authTogglePrompt");
  const toggleBtn = document.getElementById("toggleAuthBtn");

  if (isRegisterMode) {
    loginForm.style.display = "none";
    regSelector.style.display = "block";
    switchRegRole("student");
    title.textContent = "Registration Portal";
    subtitle.textContent = "Register with your Department, Class, Division, and Batches";
    prompt.textContent = "Already registered?";
    toggleBtn.textContent = "Sign in here";
  } else {
    loginForm.style.display = "block";
    regSelector.style.display = "none";
    stuForm.style.display = "none";
    facForm.style.display = "none";
    title.textContent = "E&DM Project Portal";
    subtitle.textContent = "Sign in to access your project dashboard or evaluation portal";
    prompt.textContent = "Need an account?";
    toggleBtn.textContent = "Register here";
  }
}

function switchRegRole(role) {
  regRole = role;
  const tabStu = document.getElementById("roleTabStudent");
  const tabFac = document.getElementById("roleTabFaculty");
  const stuForm = document.getElementById("studentRegisterForm");
  const facForm = document.getElementById("facultyRegisterForm");

  if (role === "student") {
    tabStu.classList.add("active");
    tabFac.classList.remove("active");
    stuForm.style.display = "block";
    facForm.style.display = "none";
  } else {
    tabFac.classList.add("active");
    tabStu.classList.remove("active");
    stuForm.style.display = "none";
    facForm.style.display = "block";
    if (document.querySelectorAll(".assignment-row").length === 0) {
      addFacultyAssignmentRow();
    }
  }
}

// Multi-Department Faculty Assignment Row Builder
let assignmentRowCounter = 0;
function addFacultyAssignmentRow() {
  const container = document.getElementById("facultyAssignmentsContainer");
  const rowId = `assign-row-${assignmentRowCounter++}`;
  
  const div = document.createElement("div");
  div.className = "assignment-row";
  div.id = rowId;
  div.innerHTML = `
    <div class="row-fields-grid">
      <div class="rf-col">
        <label>Department</label>
        <select class="f-dept" required>
          <option value="ECS">ECS</option>
          <option value="Instrumentation">Instrumentation</option>
        </select>
      </div>

      <div class="rf-col">
        <label>Class</label>
        <select class="f-class" required>
          <option value="Third Year">Third Year (TE)</option>
          <option value="Final Year">Final Year (BE)</option>
        </select>
      </div>

      <div class="rf-col">
        <label>Division</label>
        <select class="f-div" required>
          <option value="Div A">Division A</option>
          <option value="Div B">Division B</option>
        </select>
      </div>

      <div class="rf-col">
        <label>Batches (Check all)</label>
        <div class="batch-checkboxes">
          <label><input type="checkbox" value="Batch 1" checked> B1</label>
          <label><input type="checkbox" value="Batch 2" checked> B2</label>
          <label><input type="checkbox" value="Batch 3"> B3</label>
          <label><input type="checkbox" value="Batch 4"> B4</label>
        </div>
      </div>
    </div>

    <button type="button" class="btn-remove-row" onclick="removeAssignmentRow('${rowId}')" title="Remove Allocation">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  container.appendChild(div);
}

function removeAssignmentRow(rowId) {
  const el = document.getElementById(rowId);
  if (el) el.remove();
}

function fillCreds(email, password) {
  if (isRegisterMode) toggleAuthMode();
  document.getElementById("loginEmail").value = email;
  document.getElementById("loginPassword").value = password;
}

// Authentication Submissions with Firebase Auth & Firestore Sync
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const submitBtn = document.getElementById("loginSubmitBtn");

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Signing In...`;
    }

    // 1. Firebase Authentication (non-blocking for existing accounts)
    if (window.firebaseAuth) {
      try {
        await window.firebaseAuth.signInWithEmailAndPassword(email, password);
      } catch (fbErr) {
        // If user doesn't exist in Firebase yet but exists in local DB, create user in Firebase
        if (fbErr.code === "auth/user-not-found" || fbErr.code === "auth/invalid-credential") {
          try {
            await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
          } catch (e2) {
            console.warn("Firebase Auth fallback notice:", e2.message);
          }
        } else {
          console.warn("Firebase Auth notice:", fbErr.message);
        }
      }
    }

    // 2. Server API Session
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Login failed");

    authToken = data.token;
    localStorage.setItem("edmg_token", authToken);
    currentUser = data.user;

    // If Firebase Auth wasn't authenticated yet, try to ensure user exists
    if (window.firebaseAuth && !window.firebaseAuth.currentUser) {
      try {
        await window.firebaseAuth.signInWithEmailAndPassword(email, password);
      } catch (fbSyncErr) {
        try {
          await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
        } catch (e3) {}
      }
    }

    // Save profile to Firestore
    syncUserProfileToFirestore(currentUser);

    showToast(`Welcome back, ${currentUser.name}!`, "success");
    setupWebSocket();
    showAppUI();
    loadInitialData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Sign In to Portal`;
    }
  }
}

async function handleStudentRegister(e) {
  e.preventDefault();
  const name = document.getElementById("stuRegName").value.trim();
  const email = document.getElementById("stuRegEmail").value.trim();
  const department = document.getElementById("stuRegDept").value;
  const student_class = document.getElementById("stuRegClass").value;
  const division = document.getElementById("stuRegDiv").value;
  const batch = document.getElementById("stuRegBatch").value;
  const password = document.getElementById("stuRegPassword").value;

  try {
    // 1. Create user in Firebase Auth
    if (window.firebaseAuth) {
      try {
        await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
      } catch (fbErr) {
        if (fbErr.code !== "auth/email-already-in-use") {
          console.warn("Firebase Auth notice:", fbErr.message);
        }
      }
    }

    // 2. Register in application backend
    const res = await fetch(`${API_BASE}/api/auth/register-student`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, department, student_class, division, batch })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Registration failed");

    authToken = data.token;
    localStorage.setItem("edmg_token", authToken);
    currentUser = data.user;

    syncUserProfileToFirestore(currentUser);

    showToast(`Registered as student for ${department} ${division} (${batch})`, "success");
    setupWebSocket();
    showAppUI();
    loadInitialData();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleFacultyRegister(e) {
  e.preventDefault();
  const name = document.getElementById("facRegName").value.trim();
  const email = document.getElementById("facRegEmail").value.trim();
  const password = document.getElementById("facRegPassword").value;

  const rows = document.querySelectorAll(".assignment-row");
  if (rows.length === 0) {
    showToast("Please add at least one department assignment row.", "error");
    return;
  }

  const assignments = [];
  rows.forEach(r => {
    const department = r.querySelector(".f-dept").value;
    const student_class = r.querySelector(".f-class").value;
    const division = r.querySelector(".f-div").value;
    const checkedBatches = Array.from(r.querySelectorAll(".batch-checkboxes input:checked")).map(cb => cb.value);

    if (checkedBatches.length > 0) {
      assignments.push({ department, student_class, division, batches: checkedBatches });
    }
  });

  if (assignments.length === 0) {
    showToast("Please select at least one batch for your assigned department.", "error");
    return;
  }

  try {
    // 1. Create faculty in Firebase Auth
    if (window.firebaseAuth) {
      try {
        await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
      } catch (fbErr) {
        if (fbErr.code !== "auth/email-already-in-use") {
          console.warn("Firebase Auth notice:", fbErr.message);
        }
      }
    }

    // 2. Register in application backend
    const res = await fetch(`${API_BASE}/api/auth/register-faculty`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, assignments })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Registration failed");

    authToken = data.token;
    localStorage.setItem("edmg_token", authToken);
    currentUser = data.user;

    syncUserProfileToFirestore(currentUser);

    showToast(`Faculty registered with ${assignments.length} department allocations!`, "success");
    setupWebSocket();
    showAppUI();
    loadInitialData();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Sync user profile to Firestore
function syncUserProfileToFirestore(user) {
  if (!window.firestoreDb || !user) return;
  try {
    window.firestoreDb.collection("users").doc(user.id).set({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department || null,
      student_class: user.student_class || null,
      division: user.division || null,
      batch: user.batch || null,
      assignments: user.assignments || [],
      lastActive: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(e => console.warn("Firestore sync user notice:", e));
  } catch (err) {
    console.warn("Firestore error:", err);
  }
}

// Sync group document to Firestore with clean serializable object
function syncGroupToFirestore(group) {
  if (!window.firestoreDb || !group || !group.id) return;
  try {
    const payload = {
      id: group.id,
      name: group.name || "",
      department: group.department || "",
      student_class: group.student_class || "",
      division: group.division || "",
      batch: group.batch || "",
      invite_code: group.invite_code || "",
      created_by: group.created_by || "",
      creator_name: group.creator_name || "",
      member_names: group.member_names || [],
      member_user_ids: group.member_user_ids || [],
      step1_problem_statement: group.step1_problem_statement || "",
      step2_market_research: group.step2_market_research || "",
      step3_innovative_solution: group.step3_innovative_solution || "",
      step4_feasibility_business_model: group.step4_feasibility_business_model || "",
      step5_marketing_presentation: group.step5_marketing_presentation || "",
      step1_status: group.step1_status || "pending",
      step2_status: group.step2_status || "pending",
      step3_status: group.step3_status || "pending",
      step4_status: group.step4_status || "pending",
      step5_status: group.step5_status || "pending",
      step1_remarks: group.step1_remarks || "",
      step2_remarks: group.step2_remarks || "",
      step3_remarks: group.step3_remarks || "",
      step4_remarks: group.step4_remarks || "",
      step5_remarks: group.step5_remarks || "",
      score: group.score || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    window.firestoreDb.collection("groups").doc(group.id).set(payload, { merge: true })
      .catch(e => console.warn("Firestore sync group notice:", e));
  } catch (err) {
    console.warn("Firestore sync error:", err);
  }
}

// Real-time Firestore live listener for active student group
function listenToMyGroupFirestore(groupId) {
  if (!window.firestoreDb || !groupId) return;
  if (myGroupFirestoreUnsub) {
    myGroupFirestoreUnsub();
    myGroupFirestoreUnsub = null;
  }

  try {
    myGroupFirestoreUnsub = window.firestoreDb.collection("groups").doc(groupId)
      .onSnapshot((doc) => {
        if (doc.exists && currentUser && currentUser.role === "student") {
          const liveData = doc.data();
          if (liveData && currentMyGroup && doc.id === currentMyGroup.id) {
            let statusChanged = false;
            for (let i = 1; i <= 5; i++) {
              if (liveData[`step${i}_status`] && liveData[`step${i}_status`] !== currentMyGroup[`step${i}_status`]) {
                currentMyGroup[`step${i}_status`] = liveData[`step${i}_status`];
                currentMyGroup[`step${i}_remarks`] = liveData[`step${i}_remarks`] || "";
                statusChanged = true;
              } else if (liveData[`step${i}_remarks`] !== undefined && liveData[`step${i}_remarks`] !== currentMyGroup[`step${i}_remarks`]) {
                currentMyGroup[`step${i}_remarks`] = liveData[`step${i}_remarks`] || "";
                statusChanged = true;
              }
            }

            if (liveData.score && JSON.stringify(liveData.score) !== JSON.stringify(currentMyGroup.score)) {
              currentMyGroup.score = liveData.score;
              renderStudentMarks(currentMyGroup.score);
              showToast(`Evaluation score updated live: ${liveData.score.total}/50`, "info");
            }

            if (statusChanged) {
              renderStudentStepStatusAndLocking(currentMyGroup);
              showToast("Project milestone status updated in real-time by faculty!", "info");
            }
          }
        }
      }, err => console.warn("Firestore my-group listener notice:", err));
  } catch (e) {
    console.warn("Firestore listener error:", e);
  }
}

// Real-time Firestore live listener for faculty review dashboard (debounced to avoid rapid re-renders)
let facultySyncDebounceTimer = null;
function listenToFacultyGroupsFirestore() {
  if (!window.firestoreDb || !currentUser || currentUser.role !== "faculty") return;
  if (adminGroupsFirestoreUnsub) {
    adminGroupsFirestoreUnsub();
    adminGroupsFirestoreUnsub = null;
  }

  try {
    adminGroupsFirestoreUnsub = window.firestoreDb.collection("groups")
      .onSnapshot((snapshot) => {
        const activeTab = document.querySelector(".nav-item.active");
        if (activeTab && activeTab.id === "tabAdminGroupsBtn") {
          if (facultySyncDebounceTimer) clearTimeout(facultySyncDebounceTimer);
          facultySyncDebounceTimer = setTimeout(() => {
            loadAdminGroups(false);
          }, 1200);
        }
      }, err => console.warn("Firestore faculty listener notice:", err));
  } catch (e) {
    console.warn("Firestore faculty listener error:", e);
  }
}

function logout() {
  if (window.firebaseAuth) {
    window.firebaseAuth.signOut().catch(() => {});
  }
  if (myGroupFirestoreUnsub) {
    myGroupFirestoreUnsub();
    myGroupFirestoreUnsub = null;
  }
  if (adminGroupsFirestoreUnsub) {
    adminGroupsFirestoreUnsub();
    adminGroupsFirestoreUnsub = null;
  }
  authToken = null;
  currentUser = null;
  localStorage.removeItem("edmg_token");
  if (socket) {
    socket.close();
    socket = null;
  }
  showAuthUI();
  showToast("You have signed out.", "info");
}

// ----------------- STUDENT / LEADER FLOW -----------------
async function loadMyGroup() {
  try {
    const res = await fetch(`${API_BASE}/api/groups/my-group`, {
      headers: authHeaders()
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Could not load group data");
    }

    const data = await res.json();
    const noGroupState = document.getElementById("noGroupState");
    const hasGroupState = document.getElementById("hasGroupState");

    if (!data.has_group || !data.group) {
      currentMyGroup = null;
      document.getElementById("studentGreetingName").textContent = currentUser.name;
      document.getElementById("studentGreetingAlloc").textContent = `${currentUser.department} • ${currentUser.student_class} • ${currentUser.division} • ${currentUser.batch}`;
      
      // Pre-fill creation form fields from student registration
      if (document.getElementById("newGroupDept")) {
        document.getElementById("newGroupDept").value = currentUser.department;
        document.getElementById("newGroupClass").value = currentUser.student_class;
        document.getElementById("newGroupDiv").value = currentUser.division;
        document.getElementById("newGroupBatch").value = currentUser.batch;
      }
      
      noGroupState.style.display = "block";
      hasGroupState.style.display = "none";
    } else {
      currentMyGroup = data.group;
      noGroupState.style.display = "none";
      hasGroupState.style.display = "block";
      renderMyGroupDetails(currentMyGroup);
      listenToMyGroupFirestore(currentMyGroup.id);
      syncGroupToFirestore(currentMyGroup);
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderMyGroupDetails(group) {
  document.getElementById("activeGroupName").textContent = group.name;
  document.getElementById("activeGroupInviteCode").textContent = group.invite_code;
  document.getElementById("activeGroupDept").textContent = group.department;
  document.getElementById("activeGroupClass").textContent = group.student_class;
  document.getElementById("activeGroupDiv").textContent = group.division;
  document.getElementById("activeGroupBatch").textContent = group.batch;

  const leaderBadge = document.getElementById("activeGroupLeaderBadge");
  if (group.is_leader) {
    leaderBadge.innerHTML = `<i class="fa-solid fa-crown"></i> You are Group Leader`;
  } else {
    leaderBadge.innerHTML = `<i class="fa-solid fa-user-check"></i> Teammate (Leader: ${escapeHtml(group.creator_name)})`;
  }

  const membersContainer = document.getElementById("activeGroupMembers");
  membersContainer.innerHTML = "";
  (group.member_names || []).forEach(name => {
    const chip = document.createElement("span");
    const isMe = name.toLowerCase() === currentUser.name.toLowerCase();
    chip.className = `member-chip ${isMe ? "me" : ""}`;
    chip.textContent = isMe ? `${name} (You)` : name;
    membersContainer.appendChild(chip);
  });

  document.getElementById("inputStep1").value = group.step1_problem_statement || "";
  document.getElementById("inputStep2").value = group.step2_market_research || "";
  document.getElementById("inputStep3").value = group.step3_innovative_solution || "";
  document.getElementById("inputStep4").value = group.step4_feasibility_business_model || "";
  document.getElementById("inputStep5").value = group.step5_marketing_presentation || "";
  document.getElementById("inputMemberNamesEdit").value = (group.member_names || []).join(", ");

  renderStudentStepStatusAndLocking(group);
  renderStudentBudget(group.budget_items || []);
  renderStudentPitch(group.pitch_strategy || {});
  renderStudentDigitalMarketing(group.digital_marketing || {});
  renderStudentEmployability(group.employability_portfolio || {}, group.member_names || []);
  renderStudentMarks(group.score);
}

function renderStudentStepStatusAndLocking(group) {
  // Step 1: always accessible initially, but once approved it becomes locked against student edits
  const s1Status = group.step1_status || "pending";
  applyStepLocking(1, true, s1Status, group.step1_remarks, "");

  // Step 2 depends on Step 1 being approved
  const s1Approved = (s1Status === "approved");
  const s2Status = group.step2_status || "pending";
  applyStepLocking(2, s1Approved, s2Status, group.step2_remarks, "Step 1 must be marked and approved by faculty before you can proceed with Step 2.");

  // Step 3 depends on Step 2 being approved
  const s2Approved = s1Approved && (s2Status === "approved");
  const s3Status = group.step3_status || "pending";
  applyStepLocking(3, s2Approved, s3Status, group.step3_remarks, "Step 2 must be marked and approved by faculty before you can proceed with Step 3.");

  // Step 4 depends on Step 3 being approved
  const s3Approved = s2Approved && (s3Status === "approved");
  const s4Status = group.step4_status || "pending";
  applyStepLocking(4, s3Approved, s4Status, group.step4_remarks, "Step 3 must be marked and approved by faculty before you can proceed with Step 4.");

  // Step 5 depends on Step 4 being approved
  const s4Approved = s3Approved && (s4Status === "approved");
  const s5Status = group.step5_status || "pending";
  applyStepLocking(5, s4Approved, s5Status, group.step5_remarks, "Step 4 must be marked and approved by faculty before you can proceed with Step 5.");
}

function applyStepLocking(stepNum, isUnlocked, currentStatus, remarks, lockMessage) {
  const card = document.getElementById(`stepCard${stepNum}`);
  const textarea = document.getElementById(`inputStep${stepNum}`);
  const badge = document.getElementById(`step${stepNum}StatusBadge`);
  const lockBanner = document.getElementById(`step${stepNum}LockBanner`);

  if (!isUnlocked) {
    // Prerequisite step is not yet approved
    if (card) {
      card.classList.add("step-locked");
      card.classList.remove("step-approved-locked");
    }
    if (textarea) textarea.disabled = true;
    if (lockBanner) {
      lockBanner.style.display = "flex";
      lockBanner.className = "step-lock-banner";
      lockBanner.innerHTML = `<i class="fa-solid fa-lock"></i> <span><strong>Locked:</strong> ${lockMessage}</span>`;
    }
    if (badge) {
      badge.className = "step-status-badge step-status-locked";
      badge.innerHTML = `<i class="fa-solid fa-lock"></i> Locked (Requires Faculty Approval)`;
    }
  } else if (currentStatus === "approved") {
    // Current step has been approved and marked complete by faculty: lock it from student modification
    if (card) {
      card.classList.remove("step-locked");
      card.classList.add("step-approved-locked");
    }
    if (textarea) textarea.disabled = true;
    if (lockBanner) {
      lockBanner.style.display = "flex";
      lockBanner.className = "step-lock-banner step-approved-banner";
      lockBanner.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span><strong>Approved &amp; Locked:</strong> This step has been approved and finalized by faculty. It cannot be modified.</span>`;
    }
    updateStepBadge(`step${stepNum}StatusBadge`, currentStatus);
  } else {
    // Unlocked and pending or changes requested (editable)
    if (card) {
      card.classList.remove("step-locked");
      card.classList.remove("step-approved-locked");
    }
    if (textarea) textarea.disabled = false;
    if (lockBanner) {
      lockBanner.style.display = "none";
      lockBanner.className = "step-lock-banner";
    }
    updateStepBadge(`step${stepNum}StatusBadge`, currentStatus);
  }

  updateStepFeedback(`step${stepNum}FeedbackBox`, remarks);
}

function updateStepBadge(badgeId, statusVal) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;

  if (statusVal === "approved") {
    badge.className = "step-status-badge step-status-approved";
    badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Approved by Faculty`;
  } else if (statusVal === "rejected") {
    badge.className = "step-status-badge step-status-rejected";
    badge.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Changes Requested`;
  } else {
    badge.className = "step-status-badge step-status-pending";
    badge.innerHTML = `<i class="fa-regular fa-clock"></i> Pending Faculty Verification`;
  }
}

function updateStepFeedback(boxId, remarks) {
  const box = document.getElementById(boxId);
  if (!box) return;
  if (remarks && remarks.trim()) {
    box.style.display = "flex";
    box.innerHTML = `<i class="fa-solid fa-comment-dots" style="color: var(--primary); margin-top: 2px;"></i> <div><strong>Faculty Verification Feedback:</strong> "${escapeHtml(remarks)}"</div>`;
  } else {
    box.style.display = "none";
    box.innerHTML = "";
  }
}

// ----------------- ₹1,00,000 BUDGET PLANNER LOGIC -----------------
let currentBudgetItems = [];

function renderStudentBudget(items) {
  currentBudgetItems = (items && items.length > 0) ? items : [];
  rebuildBudgetTable();
}

function rebuildBudgetTable() {
  const tbody = document.getElementById("budgetTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";
  currentBudgetItems.forEach((b, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <select onchange="updateBudgetItem(${idx}, 'category', this.value)">
          <option value="Hardware & Prototype" ${b.category === "Hardware & Prototype" ? "selected" : ""}>Hardware & Prototype</option>
          <option value="Tooling & Fabrication" ${b.category === "Tooling & Fabrication" ? "selected" : ""}>Tooling & Fabrication</option>
          <option value="Software & Cloud" ${b.category === "Software & Cloud" ? "selected" : ""}>Software & Cloud</option>
          <option value="Testing & Validation" ${b.category === "Testing & Validation" ? "selected" : ""}>Testing & Validation</option>
          <option value="Digital Marketing" ${b.category === "Digital Marketing" ? "selected" : ""}>Digital Marketing</option>
          <option value="Operations & IP" ${b.category === "Operations & IP" ? "selected" : ""}>Operations & IP</option>
          <option value="Miscellaneous" ${b.category === "Miscellaneous" ? "selected" : ""}>Miscellaneous</option>
        </select>
      </td>
      <td>
        <input type="text" value="${escapeHtml(b.item || '')}" placeholder="Item description" oninput="updateBudgetItem(${idx}, 'item', this.value)">
      </td>
      <td>
        <input type="number" min="0" max="100000" step="500" value="${b.cost || 0}" placeholder="Cost in ₹" oninput="updateBudgetItem(${idx}, 'cost', parseFloat(this.value) || 0)">
      </td>
      <td>
        <input type="text" value="${escapeHtml(b.notes || '')}" placeholder="Spec / justification" oninput="updateBudgetItem(${idx}, 'notes', this.value)">
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn-icon" style="color: var(--danger);" onclick="removeBudgetRow(${idx})" title="Remove item">
          <i class="fa-regular fa-trash-can"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  recalcBudgetTotals();
}

function updateBudgetItem(index, field, value) {
  if (currentBudgetItems[index]) {
    currentBudgetItems[index][field] = value;
    if (field === "cost") {
      recalcBudgetTotals();
    }
  }
}

function addBudgetRow() {
  currentBudgetItems.push({
    category: "Hardware & Prototype",
    item: "New Project Component",
    cost: 5000,
    notes: "Prototyping expense"
  });
  rebuildBudgetTable();
}

function removeBudgetRow(index) {
  currentBudgetItems.splice(index, 1);
  rebuildBudgetTable();
}

function recalcBudgetTotals() {
  const total = currentBudgetItems.reduce((acc, curr) => acc + (parseFloat(curr.cost) || 0), 0);
  const remaining = 100000 - total;
  const pct = Math.min(100, Math.max(0, (total / 100000) * 100));

  const totalEl = document.getElementById("budgetTotalDisplay");
  const remEl = document.getElementById("budgetRemainingDisplay");
  const barEl = document.getElementById("budgetBarFill");
  const labelEl = document.getElementById("budgetPercentLabel");

  if (totalEl) totalEl.textContent = `₹${total.toLocaleString("en-IN")}`;
  if (remEl) {
    remEl.textContent = `₹${remaining.toLocaleString("en-IN")}`;
    remEl.style.color = remaining < 0 ? "var(--danger)" : "var(--text-main)";
  }
  if (barEl) {
    barEl.style.width = `${pct}%`;
    if (total > 100000) {
      barEl.classList.add("exceeded");
    } else {
      barEl.classList.remove("exceeded");
    }
  }
  if (labelEl) {
    labelEl.textContent = `${pct.toFixed(1)}% Allocated (${total > 100000 ? "OVER ₹1 Lakh LIMIT!" : "Within Limit"})`;
    labelEl.style.color = total > 100000 ? "var(--danger)" : "var(--text-muted)";
  }
}

async function handleSaveBudget() {
  if (!currentMyGroup) return;
  const total = currentBudgetItems.reduce((acc, curr) => acc + (parseFloat(curr.cost) || 0), 0);
  if (total > 100000) {
    showToast(`Total budget ₹${total.toLocaleString("en-IN")} exceeds the ₹1,00,000 cap! Please adjust expenses.`, "error");
    return;
  }

  const btn = document.getElementById("saveBudgetBtn");
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    const res = await fetch(`${API_BASE}/api/groups/${currentMyGroup.id}/budget`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ budget_items: currentBudgetItems })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to save budget");

    currentMyGroup = data.group;
    syncGroupToFirestore(currentMyGroup);
    showToast("₹1,00,000 Budget allocation saved successfully!", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Budget Plan`;
    }
  }
}

// ----------------- PITCHING STRATEGY LOGIC -----------------
function renderStudentPitch(pitch) {
  pitch = pitch || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };

  setVal("pitchHook", pitch.hook_tagline);
  setVal("pitchProblem", pitch.problem_urgency);
  setVal("pitchUSP", pitch.solution_usp);
  setVal("pitchMarket", pitch.target_market_tam);
  setVal("pitchModel", pitch.business_model_monetization);
  setVal("pitchAsk", pitch.ask_budget_milestone);
  setVal("pitchDeckUrl", pitch.pitch_deck_url);
}

async function handleSavePitch(e) {
  if (e) e.preventDefault();
  if (!currentMyGroup) return;

  const hook_tagline = document.getElementById("pitchHook").value.trim();
  const problem_urgency = document.getElementById("pitchProblem").value.trim();
  const solution_usp = document.getElementById("pitchUSP").value.trim();
  const target_market_tam = document.getElementById("pitchMarket").value.trim();
  const business_model_monetization = document.getElementById("pitchModel").value.trim();
  const ask_budget_milestone = document.getElementById("pitchAsk").value.trim();
  const pitch_deck_url = document.getElementById("pitchDeckUrl").value.trim();

  const btn = document.getElementById("savePitchBtn");
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    const res = await fetch(`${API_BASE}/api/groups/${currentMyGroup.id}/pitch`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        hook_tagline,
        problem_urgency,
        solution_usp,
        target_market_tam,
        business_model_monetization,
        ask_budget_milestone,
        pitch_deck_url
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to save pitch");

    currentMyGroup = data.group;
    syncGroupToFirestore(currentMyGroup);
    showToast("Pitching strategy framework saved!", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Pitching Strategy`;
    }
  }
}

// ----------------- DIGITAL PROMOTION LAB (Points 5-10) -----------------
function renderStudentDigitalMarketing(mkt) {
  mkt = mkt || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };

  setVal("mktFunnelTofu", mkt.funnel_tofu_interest);
  setVal("mktFunnelBofu", mkt.funnel_bofu_conversion);
  setVal("mktLandingPageUrl", mkt.landing_page_url);
  setVal("mktBuyerPersona", mkt.buyer_persona);
  setVal("mktContentCalendar", mkt.content_calendar_json);
  setVal("mktSeoTitle", mkt.seo_meta_title);
  setVal("mktSeoDesc", mkt.seo_meta_description);
  setVal("mktSeoKeywords", mkt.seo_keywords);
  setVal("mktInfographicUrl", mkt.infographic_url);
  setVal("mktSocialLinkedin", mkt.social_linkedin_copy);
  setVal("mktSocialInstagram", mkt.social_instagram_copy);
  setVal("mktAdHeadline", mkt.ad_headline);
  setVal("mktAdCopy", mkt.ad_copy);
  setVal("mktAdBudget", mkt.ad_budget || "");
  setVal("mktAdCpc", mkt.ad_cpc_estimate || "");

  // Restore martech checkboxes
  const tools = mkt.martech_tools || [];
  document.querySelectorAll("input[name='martechTool']").forEach(cb => {
    cb.checked = tools.includes(cb.value);
  });

  updateSeoPreview();
  recalcAdMetrics();
  renderMarketingTrackerLinksAndStats(currentMyGroup);
}

function renderMarketingTrackerLinksAndStats(group) {
  if (!group) return;
  const origin = window.location.origin;
  const invite = group.invite_code;

  const waUrl = `${origin}/track/whatsapp/${invite}`;
  const tgUrl = `${origin}/track/telegram/${invite}`;
  const liUrl = `${origin}/track/linkedin/${invite}`;

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal("waTrackLink", waUrl);
  setVal("tgTrackLink", tgUrl);
  setVal("liTrackLink", liUrl);

  // Render deduplicated unique metrics
  const metrics = group.marketing_metrics || {
    total_unique_views: 0,
    total_raw_clicks: 0,
    whatsapp_unique: 0,
    telegram_unique: 0,
    linkedin_unique: 0,
    engagement_rate: 0
  };

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setText("statUniqueViews", metrics.total_unique_views.toLocaleString());
  setText("statRawClicks", metrics.total_raw_clicks.toLocaleString());
  setText("statWaUnique", metrics.whatsapp_unique.toLocaleString());
  setText("statTgUnique", metrics.telegram_unique.toLocaleString());
  setText("statLiUnique", (metrics.linkedin_unique + (metrics.direct_unique || 0)).toLocaleString());
  setText("statEngagementRate", `${metrics.engagement_rate}%`);
}

function copyTrackLink(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showToast("Tracked marketing link copied to clipboard!", "success");
  });
}

function shareOnWhatsApp() {
  if (!currentMyGroup) return;
  const link = document.getElementById("waTrackLink")?.value || `${window.location.origin}/track/whatsapp/${currentMyGroup.invite_code}`;
  const hook = currentMyGroup.pitch_strategy?.hook_tagline || currentMyGroup.step1_problem_statement || "Check out our engineering project!";
  const text = encodeURIComponent(`🚀 *${currentMyGroup.name}* - E&DM Project Showcase\n\n"${hook}"\n\n👉 View our live project & prototype: ${link}`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
}

function shareOnTelegram() {
  if (!currentMyGroup) return;
  const link = document.getElementById("tgTrackLink")?.value || `${window.location.origin}/track/telegram/${currentMyGroup.invite_code}`;
  const hook = currentMyGroup.pitch_strategy?.hook_tagline || currentMyGroup.step1_problem_statement || "Check out our engineering project!";
  const text = encodeURIComponent(`🚀 ${currentMyGroup.name}\n\n"${hook}"\n\nVerified E&DM Project:`);
  window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`, "_blank");
}

function shareOnLinkedIn() {
  if (!currentMyGroup) return;
  const link = document.getElementById("liTrackLink")?.value || `${window.location.origin}/track/linkedin/${currentMyGroup.invite_code}`;
  window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`, "_blank");
}

function updateSeoPreview() {
  const titleInput = document.getElementById("mktSeoTitle");
  const descInput = document.getElementById("mktSeoDesc");
  const titleDisplay = document.getElementById("spTitleDisplay");
  const descDisplay = document.getElementById("spDescDisplay");

  if (titleInput && titleDisplay) {
    titleDisplay.textContent = titleInput.value.trim() || (currentMyGroup ? `${currentMyGroup.name} - Next-Gen Solution` : "Your Project Meta Title Preview");
  }
  if (descInput && descDisplay) {
    descDisplay.textContent = descInput.value.trim() || "Meta description will appear here as search engines display it to prospective users.";
  }
}

document.addEventListener("input", (e) => {
  if (e.target && (e.target.id === "mktSeoTitle" || e.target.id === "mktSeoDesc")) {
    updateSeoPreview();
  }
});

function recalcAdMetrics() {
  const budget = parseFloat(document.getElementById("mktAdBudget")?.value) || 0;
  const cpc = parseFloat(document.getElementById("mktAdCpc")?.value) || 25;
  const display = document.getElementById("adRoasDisplay");
  if (!display) return;

  const clicks = Math.floor(budget / (cpc > 0 ? cpc : 25));
  const estLeads = Math.floor(clicks * 0.08); // 8% conversion estimate
  const estCac = estLeads > 0 ? Math.round(budget / estLeads) : 0;

  display.innerHTML = `
    <span>Estimated Reach: <strong>${clicks.toLocaleString()} Clicks</strong> • Est. Pilot Leads: <strong>${estLeads}</strong> • Est. CAC: <strong>₹${estCac.toLocaleString('en-IN')}</strong></span>
  `;
}

async function handleSaveDigitalMarketing(e) {
  if (e) e.preventDefault();
  if (!currentMyGroup) return;

  const martech_tools = Array.from(document.querySelectorAll("input[name='martechTool']:checked")).map(cb => cb.value);
  const payload = {
    funnel_tofu_interest: document.getElementById("mktFunnelTofu").value.trim(),
    funnel_bofu_conversion: document.getElementById("mktFunnelBofu").value.trim(),
    martech_tools: martech_tools,
    landing_page_url: document.getElementById("mktLandingPageUrl").value.trim(),
    buyer_persona: document.getElementById("mktBuyerPersona").value.trim(),
    content_calendar_json: document.getElementById("mktContentCalendar").value.trim(),
    seo_meta_title: document.getElementById("mktSeoTitle").value.trim(),
    seo_meta_description: document.getElementById("mktSeoDesc").value.trim(),
    seo_keywords: document.getElementById("mktSeoKeywords").value.trim(),
    infographic_url: document.getElementById("mktInfographicUrl").value.trim(),
    social_linkedin_copy: document.getElementById("mktSocialLinkedin").value.trim(),
    social_instagram_copy: document.getElementById("mktSocialInstagram").value.trim(),
    ad_headline: document.getElementById("mktAdHeadline").value.trim(),
    ad_copy: document.getElementById("mktAdCopy").value.trim(),
    ad_budget: parseFloat(document.getElementById("mktAdBudget").value) || 0,
    ad_cpc_estimate: parseFloat(document.getElementById("mktAdCpc").value) || 0
  };

  const btn = document.getElementById("saveMarketingBtn");
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving Digital Lab...`;
    }

    const res = await fetch(`${API_BASE}/api/groups/${currentMyGroup.id}/digital-marketing`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to save digital marketing");

    currentMyGroup = data.group;
    syncGroupToFirestore(currentMyGroup);
    showToast("Digital Promotion Lab (Points 5-10) saved successfully!", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Digital Promotion Lab Strategy`;
    }
  }
}

// ----------------- ANALYTICS & EMPLOYABILITY (Points 11-12) -----------------
function renderStudentEmployability(emp, memberNames) {
  emp = emp || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };

  setVal("utmSource", emp.utm_source);
  setVal("utmMedium", emp.utm_medium);
  setVal("utmCampaign", emp.utm_campaign);
  setVal("analyticsVisitors", emp.analytics_visitors || "");
  setVal("analyticsCtr", emp.analytics_ctr || "");
  setVal("analyticsConversions", emp.analytics_conversions || "");
  setVal("analyticsCac", emp.cac_cost || "");
  setVal("portfolioExecSummary", emp.executive_summary || "");

  recalcUtmLink();

  // Render team role rows
  const roleContainer = document.getElementById("teamRoleAssignmentContainer");
  if (!roleContainer) return;

  let assignedRoles = {};
  try {
    assignedRoles = typeof emp.team_roles_json === "string" ? JSON.parse(emp.team_roles_json || "{}") : (emp.team_roles_json || {});
  } catch (e) {
    assignedRoles = {};
  }

  const allMembers = (memberNames && memberNames.length > 0) ? memberNames : (currentMyGroup?.member_names || ["Group Leader"]);

  roleContainer.innerHTML = allMembers.map((m, idx) => {
    const roleVal = assignedRoles[m] || (idx === 0 ? "Product Marketing Manager (PMM)" : (idx === 1 ? "Performance Marketer & Growth" : "SEO & Content Strategist"));
    return `
      <div class="team-role-row">
        <div>
          <i class="fa-solid fa-user-tag" style="color: var(--primary); margin-right: 0.4rem;"></i>
          <strong>${escapeHtml(m)}</strong>
        </div>
        <select class="member-role-select" data-member="${escapeHtml(m)}">
          <option value="Product Marketing Manager (PMM)" ${roleVal === "Product Marketing Manager (PMM)" ? "selected" : ""}>Product Marketing Manager (PMM)</option>
          <option value="Performance Marketer & Growth" ${roleVal === "Performance Marketer & Growth" ? "selected" : ""}>Performance Marketer &amp; Growth</option>
          <option value="SEO & Content Strategist" ${roleVal === "SEO & Content Strategist" ? "selected" : ""}>SEO &amp; Content Strategist</option>
          <option value="Financial & Operations Analyst" ${roleVal === "Financial & Operations Analyst" ? "selected" : ""}>Financial &amp; Operations Analyst</option>
          <option value="Technical Product Engineer" ${roleVal === "Technical Product Engineer" ? "selected" : ""}>Technical Product Engineer</option>
        </select>
      </div>
    `;
  }).join("");
}

function recalcUtmLink() {
  const src = document.getElementById("utmSource")?.value.trim() || "linkedin";
  const med = document.getElementById("utmMedium")?.value.trim() || "post";
  const cmp = document.getElementById("utmCampaign")?.value.trim() || "pilot_launch";
  const display = document.getElementById("utmGeneratedUrl");
  if (!display) return;

  const base = currentMyGroup ? `https://${currentMyGroup.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.edu` : "https://yourventure.edu";
  display.textContent = `${base}?utm_source=${encodeURIComponent(src)}&utm_medium=${encodeURIComponent(med)}&utm_campaign=${encodeURIComponent(cmp)}`;
}

async function handleSaveEmployability(e) {
  if (e) e.preventDefault();
  if (!currentMyGroup) return;

  const teamRoles = {};
  document.querySelectorAll(".member-role-select").forEach(sel => {
    const mem = sel.getAttribute("data-member");
    if (mem) teamRoles[mem] = sel.value;
  });

  const payload = {
    utm_source: document.getElementById("utmSource").value.trim(),
    utm_medium: document.getElementById("utmMedium").value.trim(),
    utm_campaign: document.getElementById("utmCampaign").value.trim(),
    analytics_visitors: parseInt(document.getElementById("analyticsVisitors").value) || 0,
    analytics_ctr: parseFloat(document.getElementById("analyticsCtr").value) || 0,
    analytics_conversions: parseInt(document.getElementById("analyticsConversions").value) || 0,
    cac_cost: parseFloat(document.getElementById("analyticsCac").value) || 0,
    team_roles_json: JSON.stringify(teamRoles),
    executive_summary: document.getElementById("portfolioExecSummary").value.trim()
  };

  const btn = document.getElementById("saveEmployabilityBtn");
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    const res = await fetch(`${API_BASE}/api/groups/${currentMyGroup.id}/employability`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to save portfolio");

    currentMyGroup = data.group;
    syncGroupToFirestore(currentMyGroup);
    showToast("Analytics & Employability Portfolio (Points 11-12) saved!", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Analytics &amp; Roles`;
    }
  }
}

function exportVentureDossier() {
  if (!currentMyGroup) return;
  const g = currentMyGroup;
  const mkt = g.digital_marketing || {};
  const emp = g.employability_portfolio || {};
  const pitch = g.pitch_strategy || {};

  let rolesObj = {};
  try {
    rolesObj = typeof emp.team_roles_json === "string" ? JSON.parse(emp.team_roles_json || "{}") : (emp.team_roles_json || {});
  } catch (e) {}

  const printWin = window.open("", "_blank");
  if (!printWin) {
    showToast("Please allow popups to export your Venture Dossier.", "error");
    return;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(g.name)} - Entrepreneurship & Digital Marketing Dossier</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 2rem; color: #1e293b; max-width: 900px; margin: 0 auto; line-height: 1.6; }
        .dossier-header { border-bottom: 3px solid #4f46e5; padding-bottom: 1rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: flex-end; }
        .dossier-title { font-size: 1.75rem; font-weight: 800; color: #0f172a; margin: 0; }
        .dossier-meta { font-size: 0.9rem; color: #64748b; margin-top: 0.35rem; }
        .section-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.25rem; background: #f8fafc; }
        .section-box h3 { margin-top: 0; color: #4f46e5; font-size: 1.1rem; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.4rem; }
        .tag-pill { display: inline-block; background: #e0e7ff; color: #3730a3; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.75rem; font-weight: 700; margin-right: 0.4rem; }
        table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem; }
        th, td { border: 1px solid #cbd5e1; padding: 0.5rem 0.75rem; text-align: left; }
        th { background: #e2e8f0; font-weight: 700; }
        @media print { .no-print { display: none; } body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 1rem; text-align: right;">
        <button onclick="window.print()" style="padding: 0.6rem 1.2rem; background: #4f46e5; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">
          Print / Save as Placement PDF
        </button>
      </div>

      <div class="dossier-header">
        <div>
          <h1 class="dossier-title">${escapeHtml(g.name)}</h1>
          <div class="dossier-meta">${escapeHtml(g.department)} • ${escapeHtml(g.student_class)} • ${escapeHtml(g.division)} • ${escapeHtml(g.batch)}</div>
        </div>
        <div style="text-align: right;">
          <span class="tag-pill">E&amp;DM CAPSTONE DOSSIER</span>
          <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">Group Leader: ${escapeHtml(g.creator_name)}</div>
        </div>
      </div>

      <div class="section-box">
        <h3>1. Executive Placement Summary &amp; Elevator Pitch</h3>
        <p><strong>Tagline:</strong> "${escapeHtml(pitch.hook_tagline || 'N/A')}"</p>
        <p>${escapeHtml(emp.executive_summary || g.step1_problem_statement || 'Venture summary recorded.')}</p>
      </div>

      <div class="section-box">
        <h3>2. 5-Step Sequential Milestone Validation</h3>
        <p><strong>Step 1 (Problem &amp; Need):</strong> ${escapeHtml(g.step1_problem_statement || '—')}</p>
        <p><strong>Step 2 (Market Validation):</strong> ${escapeHtml(g.step2_market_research || '—')}</p>
        <p><strong>Step 3 (Technical Prototype):</strong> ${escapeHtml(g.step3_innovative_solution || '—')}</p>
        <p><strong>Step 4 (Feasibility &amp; Economics):</strong> ${escapeHtml(g.step4_feasibility_business_model || '—')}</p>
        <p><strong>Step 5 (Digital Marketing &amp; Pitch):</strong> ${escapeHtml(g.step5_marketing_presentation || '—')}</p>
      </div>

      <div class="section-box">
        <h3>3. Real-Time Digital Promotion &amp; Acquisition Strategy</h3>
        <p><strong>Inbound/Outbound Funnel:</strong> TOFU: ${escapeHtml(mkt.funnel_tofu_interest || '—')} | BOFU: ${escapeHtml(mkt.funnel_bofu_conversion || '—')}</p>
        <p><strong>MarTech Tools Configured:</strong> ${(mkt.martech_tools || []).join(', ') || 'Standard stack'}</p>
        <p><strong>Target Keywords &amp; SEO:</strong> ${escapeHtml(mkt.seo_keywords || '—')}</p>
        <p><strong>B2B LinkedIn Pitch:</strong> "${escapeHtml(mkt.social_linkedin_copy || '—')}"</p>
        <p><strong>Paid Ad Strategy:</strong> Budget: ₹${(mkt.ad_budget || 0).toLocaleString('en-IN')} | Headline: "${escapeHtml(mkt.ad_headline || '—')}"</p>
      </div>

      <div class="section-box">
        <h3>4. Team Specialization &amp; Employability Matrix</h3>
        <table>
          <thead>
            <tr>
              <th>Team Member Name</th>
              <th>Assigned Professional Role</th>
            </tr>
          </thead>
          <tbody>
            ${(g.member_names || []).map(m => `
              <tr>
                <td><strong>${escapeHtml(m)}</strong></td>
                <td>${escapeHtml(rolesObj[m] || 'Product Marketing Specialist')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `;

  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();
}

function renderStudentMarks(score) {
  const container = document.getElementById("studentMarksSection");
  if (!score) {
    container.innerHTML = `
      <div class="marks-pending">
        <i class="fa-regular fa-clock"></i>
        <div class="marks-pending-text">
          <h4>Not Yet Evaluated by Faculty</h4>
          <p>Your 5-step milestone submission is recorded. Faculty scores (out of 50) will appear here live once graded.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="marks-card">
      <div class="marks-awarded-container">
        <div class="marks-header-row">
          <div>
            <span class="role-tag">FACULTY RUBRIC EVALUATION</span>
            <h3 style="font-weight: 800; font-size: 1.15rem;">Project Evaluation Results</h3>
          </div>
          <div class="marks-total-badge">
            ${score.total} <small>/ 50</small>
          </div>
        </div>

        <div class="criteria-grid">
          <div class="criteria-cell">
            <span class="c-label">Innovation</span>
            <span class="c-score">${score.innovation}</span>
            <span class="c-max">/ 15</span>
          </div>
          <div class="criteria-cell">
            <span class="c-label">Feasibility</span>
            <span class="c-score">${score.feasibility}</span>
            <span class="c-max">/ 10</span>
          </div>
          <div class="criteria-cell">
            <span class="c-label">Solution</span>
            <span class="c-score">${score.solution}</span>
            <span class="c-max">/ 15</span>
          </div>
          <div class="criteria-cell">
            <span class="c-label">Presentation</span>
            <span class="c-score">${score.presentation}</span>
            <span class="c-max">/ 10</span>
          </div>
        </div>

        ${score.remarks ? `
          <div class="remarks-quote-box">
            <strong>Faculty Remarks:</strong> "${escapeHtml(score.remarks)}"
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

async function handleCreateGroup(e) {
  e.preventDefault();
  const name = document.getElementById("newGroupName").value.trim();
  const department = document.getElementById("newGroupDept").value;
  const student_class = document.getElementById("newGroupClass").value;
  const division = document.getElementById("newGroupDiv").value;
  const batch = document.getElementById("newGroupBatch").value;
  const rawMembers = document.getElementById("newMemberNames").value;
  const member_names = rawMembers.split(",").map(s => s.trim()).filter(Boolean);

  try {
    const res = await fetch(`${API_BASE}/api/groups`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name, department, student_class, division, batch, member_names })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to create group");

    showToast("Group registered! You are now Group Leader.", "success");
    loadMyGroup();
    if (data.group) syncGroupToFirestore(data.group);
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleJoinGroup(e) {
  e.preventDefault();
  const invite_code = document.getElementById("joinInviteCode").value.trim();

  try {
    const res = await fetch(`${API_BASE}/api/groups/join`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ invite_code })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to join group");

    showToast("Successfully joined team project!", "success");
    loadMyGroup();
    if (data.group) syncGroupToFirestore(data.group);
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleSaveSubmission(e) {
  if (e) e.preventDefault();
  if (!currentMyGroup) return;

  const step1_problem_statement = document.getElementById("inputStep1").value;
  const step2_market_research = document.getElementById("inputStep2").value;
  const step3_innovative_solution = document.getElementById("inputStep3").value;
  const step4_feasibility_business_model = document.getElementById("inputStep4").value;
  const step5_marketing_presentation = document.getElementById("inputStep5").value;
  const member_names = document.getElementById("inputMemberNamesEdit").value.split(",").map(s => s.trim()).filter(Boolean);

  const saveBtn = document.getElementById("saveGroupBtn");

  try {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

    const res = await fetch(`${API_BASE}/api/groups/${currentMyGroup.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        step1_problem_statement,
        step2_market_research,
        step3_innovative_solution,
        step4_feasibility_business_model,
        step5_marketing_presentation,
        member_names
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to save submission");

    currentMyGroup = data.group;
    renderMyGroupDetails(currentMyGroup);
    syncGroupToFirestore(currentMyGroup);

    showToast("All 5 project steps saved successfully!", "success");
    document.getElementById("lastSavedTime").textContent = `Last saved at ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save All Project Steps`;
  }
}

function copyInviteCode() {
  const code = document.getElementById("activeGroupInviteCode").textContent;
  navigator.clipboard.writeText(code).then(() => {
    showToast(`Invite code ${code} copied to clipboard!`, "success");
  });
}

let lastAdminGroupsJson = "";

// ----------------- FACULTY FLOW -----------------
async function loadAdminGroups(showToastNotice = false) {
  if (currentUser.role !== "faculty") return;

  const dept = document.getElementById("filterDept").value;
  const cls = document.getElementById("filterClass").value;
  const div = document.getElementById("filterDiv").value;
  const batch = document.getElementById("filterBatch").value;

  let url = `${API_BASE}/api/admin/groups`;
  const params = [];
  if (dept !== "All") params.push(`department=${encodeURIComponent(dept)}`);
  if (cls !== "All") params.push(`student_class=${encodeURIComponent(cls)}`);
  if (div !== "All") params.push(`division=${encodeURIComponent(div)}`);
  if (batch !== "All") params.push(`batch=${encodeURIComponent(batch)}`);
  if (params.length > 0) url += `?${params.join("&")}`;

  try {
    const res = await fetch(url, {
      headers: authHeaders()
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to load groups");
    }

    const fetchedGroups = await res.json();
    const fetchedJson = JSON.stringify(fetchedGroups);

    // Only re-render DOM if the data actually changed or if user explicitly requested reload
    if (showToastNotice || fetchedJson !== lastAdminGroupsJson) {
      lastAdminGroupsJson = fetchedJson;
      allAdminGroups = fetchedGroups;
      renderAdminGroups(allAdminGroups);
    }

    // Ensure Firestore listener is initialized once
    if (!adminGroupsFirestoreUnsub) {
      listenToFacultyGroupsFirestore();
    }

    if (showToastNotice) {
      showToast("Groups reloaded.", "info");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderAdminGroups(groups) {
  const container = document.getElementById("adminGroupsList");
  if (!groups || groups.length === 0) {
    container.innerHTML = `
      <div class="card text-center" style="padding: 2.5rem;">
        <i class="fa-solid fa-folder-open" style="font-size: 2rem; color: var(--text-muted); margin-bottom: 0.75rem;"></i>
        <h4>No Groups Found</h4>
        <p class="section-desc">No groups match the selected Department, Class, Division, or Batch filters.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = groups.map(g => {
    const s = g.score || { innovation: 0, feasibility: 0, solution: 0, presentation: 0, total: 0, remarks: "" };
    const memberStr = (g.member_names || []).join(", ") || "No members listed";
    
    // Count how many steps are approved out of 5
    let approvedCount = 0;
    if (g.step1_status === 'approved') approvedCount++;
    if (g.step2_status === 'approved') approvedCount++;
    if (g.step3_status === 'approved') approvedCount++;
    if (g.step4_status === 'approved') approvedCount++;
    if (g.step5_status === 'approved') approvedCount++;

    const isExpanded = expandedAdminGroupIds.has(g.id);

    return `
      <div class="admin-group-card ${isExpanded ? 'is-expanded' : ''}" id="group-card-${g.id}">
        <!-- Group Summary Header (Clickable) -->
        <div class="admin-group-summary-bar" onclick="toggleGroupDetails('${g.id}')">
          <div class="admin-group-info-left">
            <div class="card-dept-tags">
              <span class="badge-dept">${g.department}</span>
              <span class="badge-class">${g.student_class}</span>
              <span class="badge-div">${g.division}</span>
              <span class="badge-batch">${g.batch}</span>
              <span class="badge-code">Code: ${g.invite_code}</span>
              <span class="badge" style="background: ${approvedCount === 5 ? '#10b981' : (approvedCount > 0 ? '#f59e0b' : '#64748b')}; font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 999px;">
                <i class="fa-solid fa-bars-progress"></i> ${approvedCount}/5 Steps Approved
              </span>
              ${s.total > 0 ? `<span class="badge" style="background: var(--primary); font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 999px;">Score: ${s.total}/50</span>` : ''}
            </div>
            <h3>
              <i class="fa-solid fa-users-rectangle" style="color: var(--primary);"></i>
              ${escapeHtml(g.name)}
            </h3>
            <div class="admin-group-meta">
              <span><strong>Leader:</strong> ${escapeHtml(g.creator_name)}</span>
              <span>•</span>
              <span><strong>Team Members:</strong> ${escapeHtml(memberStr)}</span>
            </div>
          </div>

          <div class="admin-group-actions-right">
            <button type="button" class="btn btn-outline btn-sm" onclick="event.stopPropagation(); promptDeleteGroup('${g.id}', '${escapeHtml(g.name).replace(/'/g, "\\'")}')" title="Delete Group">
              <i class="fa-regular fa-trash-can" style="color: var(--danger);"></i> Delete
            </button>
            <div class="toggle-details-btn" id="toggle-btn-${g.id}" style="pointer-events: none;">
              <span class="btn-text-state">${isExpanded ? 'Hide Project Details' : 'View Project &amp; Steps'}</span>
              <i class="fa-solid fa-chevron-down"></i>
            </div>
          </div>
        </div>

        <!-- Group Full Details & 5-Step Evaluation Portal (Hidden by default, shown on click) -->
        <div class="admin-group-details-body" id="group-details-${g.id}" style="display: ${isExpanded ? 'block' : 'none'};">
          <!-- 5-Step Detailed Narrative with Per-Step Verification for Faculty -->
          <div class="admin-steps-container">
            <div class="admin-steps-title" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <span><i class="fa-solid fa-list-check"></i> Per-Step Verification &amp; Marking Portal</span>
              <small style="color: var(--text-muted); font-size: 0.8rem;">Students can only proceed to Step N once Step N-1 is Approved</small>
            </div>

            <!-- Step 1 Verification Card -->
            <div class="admin-step-verification-card">
              <div class="asv-header">
                <span class="asv-title">Step 1: Problem Statement &amp; Need (Max 15 Pts Innovation)</span>
                ${renderAdminStepBadge(g.step1_status)}
              </div>
              <div class="asv-content-preview">${g.step1_problem_statement ? escapeHtml(g.step1_problem_statement) : '<em class="empty-italic">No problem statement submitted yet</em>'}</div>
              <div class="asv-actions">
                <input type="text" id="asv-remarks-1-${g.id}" placeholder="Faculty evaluation remarks / instructions for Step 1..." value="${escapeHtml(g.step1_remarks || '')}">
                ${g.step1_status === 'approved' 
                  ? `<button type="button" class="btn btn-sm btn-success" disabled style="opacity: 0.9; cursor: not-allowed; background-color: var(--success); color: white; border-color: var(--success);">
                      <i class="fa-solid fa-circle-check"></i> Step 1 Completed &amp; Approved
                    </button>`
                  : `<button type="button" class="btn btn-sm btn-outline" onclick="handleVerifyStep('${g.id}', 1, 'approved')">
                      <i class="fa-solid fa-circle-check"></i> Mark Completed &amp; Approve Step 1
                    </button>`
                }
                <button type="button" class="btn btn-sm btn-outline" style="color: var(--danger); border-color: var(--danger);" onclick="handleVerifyStep('${g.id}', 1, 'rejected')">
                  <i class="fa-solid fa-xmark"></i> Request Changes
                </button>
              </div>
            </div>

            <!-- Step 2 Verification Card -->
            <div class="admin-step-verification-card">
              <div class="asv-header">
                <span class="asv-title">Step 2: Market Research &amp; Validation (Max 10 Pts Feasibility)</span>
                ${renderAdminStepBadge(g.step2_status)}
              </div>
              <div class="asv-content-preview">${g.step2_market_research ? escapeHtml(g.step2_market_research) : '<em class="empty-italic">No market research submitted yet</em>'}</div>
              <div class="asv-actions">
                <input type="text" id="asv-remarks-2-${g.id}" placeholder="Faculty evaluation remarks / instructions for Step 2..." value="${escapeHtml(g.step2_remarks || '')}">
                ${g.step2_status === 'approved'
                  ? `<button type="button" class="btn btn-sm btn-success" disabled style="opacity: 0.9; cursor: not-allowed; background-color: var(--success); color: white; border-color: var(--success);">
                      <i class="fa-solid fa-circle-check"></i> Step 2 Completed &amp; Approved
                    </button>`
                  : `<button type="button" class="btn btn-sm btn-outline" onclick="handleVerifyStep('${g.id}', 2, 'approved')">
                      <i class="fa-solid fa-circle-check"></i> Mark Completed &amp; Approve Step 2
                    </button>`
                }
                <button type="button" class="btn btn-sm btn-outline" style="color: var(--danger); border-color: var(--danger);" onclick="handleVerifyStep('${g.id}', 2, 'rejected')">
                  <i class="fa-solid fa-xmark"></i> Request Changes
                </button>
              </div>
            </div>

            <!-- Step 3 Verification Card -->
            <div class="admin-step-verification-card">
              <div class="asv-header">
                <span class="asv-title">Step 3: Innovative Solution &amp; Prototype (Max 15 Pts Solution)</span>
                ${renderAdminStepBadge(g.step3_status)}
              </div>
              <div class="asv-content-preview">${g.step3_innovative_solution ? escapeHtml(g.step3_innovative_solution) : '<em class="empty-italic">No prototype details submitted yet</em>'}</div>
              <div class="asv-actions">
                <input type="text" id="asv-remarks-3-${g.id}" placeholder="Faculty evaluation remarks / instructions for Step 3..." value="${escapeHtml(g.step3_remarks || '')}">
                ${g.step3_status === 'approved'
                  ? `<button type="button" class="btn btn-sm btn-success" disabled style="opacity: 0.9; cursor: not-allowed; background-color: var(--success); color: white; border-color: var(--success);">
                      <i class="fa-solid fa-circle-check"></i> Step 3 Completed &amp; Approved
                    </button>`
                  : `<button type="button" class="btn btn-sm btn-outline" onclick="handleVerifyStep('${g.id}', 3, 'approved')">
                      <i class="fa-solid fa-circle-check"></i> Mark Completed &amp; Approve Step 3
                    </button>`
                }
                <button type="button" class="btn btn-sm btn-outline" style="color: var(--danger); border-color: var(--danger);" onclick="handleVerifyStep('${g.id}', 3, 'rejected')">
                  <i class="fa-solid fa-xmark"></i> Request Changes
                </button>
              </div>
            </div>

            <!-- Step 4 Verification Card -->
            <div class="admin-step-verification-card">
              <div class="asv-header">
                <span class="asv-title">Step 4: Feasibility Study &amp; Business Model (Max 10 Pts Feasibility)</span>
                ${renderAdminStepBadge(g.step4_status)}
              </div>
              <div class="asv-content-preview">${g.step4_feasibility_business_model ? escapeHtml(g.step4_feasibility_business_model) : '<em class="empty-italic">No feasibility study submitted yet</em>'}</div>
              <div class="asv-actions">
                <input type="text" id="asv-remarks-4-${g.id}" placeholder="Faculty evaluation remarks / instructions for Step 4..." value="${escapeHtml(g.step4_remarks || '')}">
                ${g.step4_status === 'approved'
                  ? `<button type="button" class="btn btn-sm btn-success" disabled style="opacity: 0.9; cursor: not-allowed; background-color: var(--success); color: white; border-color: var(--success);">
                      <i class="fa-solid fa-circle-check"></i> Step 4 Completed &amp; Approved
                    </button>`
                  : `<button type="button" class="btn btn-sm btn-outline" onclick="handleVerifyStep('${g.id}', 4, 'approved')">
                      <i class="fa-solid fa-circle-check"></i> Mark Completed &amp; Approve Step 4
                    </button>`
                }
                <button type="button" class="btn btn-sm btn-outline" style="color: var(--danger); border-color: var(--danger);" onclick="handleVerifyStep('${g.id}', 4, 'rejected')">
                  <i class="fa-solid fa-xmark"></i> Request Changes
                </button>
              </div>
            </div>

            <!-- Step 5 Verification Card -->
            <div class="admin-step-verification-card">
              <div class="asv-header">
                <span class="asv-title">Step 5: Digital Marketing &amp; Pitch Deck (Max 10 Pts Presentation)</span>
                ${renderAdminStepBadge(g.step5_status)}
              </div>
              <div class="asv-content-preview">${g.step5_marketing_presentation ? escapeHtml(g.step5_marketing_presentation) : '<em class="empty-italic">No pitch presentation submitted yet</em>'}</div>
              <div class="asv-actions">
                <input type="text" id="asv-remarks-5-${g.id}" placeholder="Faculty evaluation remarks / instructions for Step 5..." value="${escapeHtml(g.step5_remarks || '')}">
                ${g.step5_status === 'approved'
                  ? `<button type="button" class="btn btn-sm btn-success" disabled style="opacity: 0.9; cursor: not-allowed; background-color: var(--success); color: white; border-color: var(--success);">
                      <i class="fa-solid fa-circle-check"></i> Step 5 Completed &amp; Approved
                    </button>`
                  : `<button type="button" class="btn btn-sm btn-outline" onclick="handleVerifyStep('${g.id}', 5, 'approved')">
                      <i class="fa-solid fa-circle-check"></i> Mark Completed &amp; Approve Step 5
                    </button>`
                }
                <button type="button" class="btn btn-sm btn-outline" style="color: var(--danger); border-color: var(--danger);" onclick="handleVerifyStep('${g.id}', 5, 'rejected')">
                  <i class="fa-solid fa-xmark"></i> Request Changes
                </button>
              </div>
            </div>
          </div>

          <!-- Budget & Pitch Strategy Overview for Faculty -->
          ${renderAdminBudgetAndPitchSummary(g)}

          <!-- Inline Scoring UI -->
          <form class="scoring-form" onsubmit="handleSaveScore(event, '${g.id}')">
            <div class="scoring-grid">
              <div class="score-col">
                <label for="innov-${g.id}">Innovation (0-15)</label>
                <input type="number" id="innov-${g.id}" min="0" max="15" value="${s.innovation}" required oninput="recalcInlineTotal('${g.id}')">
              </div>
              <div class="score-col">
                <label for="feas-${g.id}">Feasibility (0-10)</label>
                <input type="number" id="feas-${g.id}" min="0" max="10" value="${s.feasibility}" required oninput="recalcInlineTotal('${g.id}')">
              </div>
              <div class="score-col">
                <label for="sol-${g.id}">Solution (0-15)</label>
                <input type="number" id="sol-${g.id}" min="0" max="15" value="${s.solution}" required oninput="recalcInlineTotal('${g.id}')">
              </div>
              <div class="score-col">
                <label for="pres-${g.id}">Presentation (0-10)</label>
                <input type="number" id="pres-${g.id}" min="0" max="10" value="${s.presentation}" required oninput="recalcInlineTotal('${g.id}')">
              </div>
              <div class="score-total-display">
                <span class="st-label">Total / 50</span>
                <span class="st-num" id="total-${g.id}">${s.total}</span>
              </div>
            </div>

            <div class="scoring-footer">
              <input type="text" id="remarks-${g.id}" placeholder="Faculty evaluation remarks & feedback..." value="${escapeHtml(s.remarks || '')}">
              <button type="submit" class="btn btn-primary btn-sm" id="btn-score-${g.id}">
                <i class="fa-solid fa-check"></i> Save Score
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }).join("");
}

// Interactive Toggle for Faculty: Click a specific group to view/hide its detailed steps and evaluation forms
function toggleGroupDetails(groupId) {
  const card = document.getElementById(`group-card-${groupId}`);
  const details = document.getElementById(`group-details-${groupId}`);
  const btn = document.getElementById(`toggle-btn-${groupId}`);
  if (!details || !card) return;

  const isHidden = details.style.display === "none";
  if (isHidden) {
    expandedAdminGroupIds.add(groupId);
    details.style.display = "block";
    card.classList.add("is-expanded");
    if (btn) {
      btn.querySelector(".btn-text-state").textContent = "Hide Project Details";
    }
  } else {
    expandedAdminGroupIds.delete(groupId);
    details.style.display = "none";
    card.classList.remove("is-expanded");
    if (btn) {
      btn.querySelector(".btn-text-state").textContent = "View Project & Steps";
    }
  }
}

function renderAdminStepBadge(statusVal) {
  if (statusVal === "approved") {
    return `<span class="step-status-badge step-status-approved"><i class="fa-solid fa-circle-check"></i> Approved</span>`;
  } else if (statusVal === "rejected") {
    return `<span class="step-status-badge step-status-rejected"><i class="fa-solid fa-circle-xmark"></i> Changes Req</span>`;
  }
  return `<span class="step-status-badge step-status-pending"><i class="fa-regular fa-clock"></i> Pending Review</span>`;
}

function renderAdminBudgetAndPitchSummary(g) {
  const budget = g.budget_items || [];
  const pitch = g.pitch_strategy || {};
  const totalBudget = budget.reduce((acc, curr) => acc + (parseFloat(curr.cost) || 0), 0);

  return `
    <div style="margin-top: 1rem; margin-bottom: 1.25rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
      <div style="background-color: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 0.85rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <strong style="font-size: 0.85rem;"><i class="fa-solid fa-indian-rupee-sign" style="color: var(--success);"></i> ₹1 Lakh Budget Status:</strong>
          <span style="font-weight: 800; color: ${totalBudget > 100000 ? 'var(--danger)' : 'var(--primary)'};">₹${totalBudget.toLocaleString('en-IN')} / ₹1,00,000</span>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">
          ${budget.length === 0 ? '<em>No budget breakdown saved yet</em>' : `${budget.length} line items planned • Remaining: ₹${(100000 - totalBudget).toLocaleString('en-IN')}`}
        </div>
      </div>

      <div style="background-color: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 0.85rem;">
        <div style="margin-bottom: 0.35rem;">
          <strong style="font-size: 0.85rem;"><i class="fa-solid fa-microphone-lines" style="color: var(--accent);"></i> Pitch Strategy:</strong>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">
          ${pitch.hook_tagline ? `<strong>Hook:</strong> "${escapeHtml(pitch.hook_tagline)}"` : '<em>Pitch framework in draft</em>'}
          ${pitch.pitch_deck_url ? `<br><a href="${escapeHtml(pitch.pitch_deck_url)}" target="_blank" style="color: var(--primary); text-decoration: underline;"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open Deck / Demo Link</a>` : ''}
        </div>
      </div>

      <div style="background-color: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 0.85rem;">
        <div style="margin-bottom: 0.35rem;">
          <strong style="font-size: 0.85rem;"><i class="fa-solid fa-bullhorn" style="color: var(--primary);"></i> Digital Promotion Lab:</strong>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">
          ${g.digital_marketing?.seo_keywords ? `<strong>Keywords:</strong> ${escapeHtml(g.digital_marketing.seo_keywords)}` : '<em>SEO &amp; Funnel draft</em>'}
          ${g.digital_marketing?.landing_page_url ? `<br><a href="${escapeHtml(g.digital_marketing.landing_page_url)}" target="_blank" style="color: var(--primary); text-decoration: underline;"><i class="fa-solid fa-globe"></i> Live Landing Page</a>` : ''}
        </div>
      </div>

      <div style="background-color: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 0.85rem;">
        <div style="margin-bottom: 0.35rem;">
          <strong style="font-size: 0.85rem;"><i class="fa-solid fa-graduation-cap" style="color: #7c3aed;"></i> Employability &amp; Roles:</strong>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">
          ${g.employability_portfolio?.team_roles_json ? `<span class="badge-dept" style="font-size: 0.7rem;">Team Roles Configured</span>` : '<em>Roles pending</em>'}
          ${g.employability_portfolio?.analytics_visitors ? `<br>Traffic: <strong>${g.employability_portfolio.analytics_visitors} visitors</strong> • CTR: <strong>${g.employability_portfolio.analytics_ctr}%</strong>` : ''}
        </div>
      </div>

      <!-- Real-Time Marketing Performance (WhatsApp, Telegram, Deduplicated Views) for Faculty -->
      <div style="background-color: #f0fdf4; border: 1.5px solid #86efac; border-radius: var(--radius-md); padding: 0.85rem; grid-column: 1 / -1;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <strong style="font-size: 0.85rem; color: #166534;"><i class="fa-solid fa-chart-line"></i> Real-Time Marketing Performance (Deduplicated Unique Visitors):</strong>
          <span class="live-pill" style="font-size: 0.7rem; background-color: white;"><span class="pulse-dot"></span> Live Sync</span>
        </div>
        <div style="display: flex; gap: 1.25rem; flex-wrap: wrap; font-size: 0.825rem; color: #14532d;">
          <div><i class="fa-solid fa-users" style="color: #059669;"></i> Unique People: <strong>${(g.marketing_metrics?.total_unique_views || 0).toLocaleString()}</strong></div>
          <div><i class="fa-solid fa-arrow-pointer"></i> Raw Clicks: <strong>${(g.marketing_metrics?.total_raw_clicks || 0).toLocaleString()}</strong></div>
          <div><i class="fa-brands fa-whatsapp" style="color: #25d366;"></i> WhatsApp: <strong>${(g.marketing_metrics?.whatsapp_unique || 0).toLocaleString()}</strong></div>
          <div><i class="fa-brands fa-telegram" style="color: #229ed9;"></i> Telegram: <strong>${(g.marketing_metrics?.telegram_unique || 0).toLocaleString()}</strong></div>
          <div><i class="fa-brands fa-linkedin" style="color: #0a66c2;"></i> LinkedIn/Web: <strong>${((g.marketing_metrics?.linkedin_unique || 0) + (g.marketing_metrics?.direct_unique || 0)).toLocaleString()}</strong></div>
          <div><i class="fa-solid fa-bullseye" style="color: #7c3aed;"></i> Retention: <strong>${g.marketing_metrics?.engagement_rate || 0}%</strong></div>
          <div><a href="/p/${g.invite_code}" target="_blank" style="color: #2563eb; text-decoration: underline;"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open Public Showcase</a></div>
        </div>
      </div>
    </div>
  `;
}

async function handleVerifyStep(groupId, stepNum, statusVal) {
  const remarksInput = document.getElementById(`asv-remarks-${stepNum}-${groupId}`);
  const remarks = remarksInput ? remarksInput.value.trim() : "";

  try {
    const res = await fetch(`${API_BASE}/api/admin/groups/${groupId}/verify-step`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        step_number: stepNum,
        status: statusVal,
        remarks: remarks
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to verify step");

    if (data.group) syncGroupToFirestore(data.group);

    showToast(`Step ${stepNum} set to '${statusVal.toUpperCase()}'!`, "success");
    loadAdminGroups(false);
  } catch (err) {
    showToast(err.message, "error");
  }
}

function recalcInlineTotal(groupId) {
  const i = Math.min(15, Math.max(0, parseInt(document.getElementById(`innov-${groupId}`).value) || 0));
  const f = Math.min(10, Math.max(0, parseInt(document.getElementById(`feas-${groupId}`).value) || 0));
  const s = Math.min(15, Math.max(0, parseInt(document.getElementById(`sol-${groupId}`).value) || 0));
  const p = Math.min(10, Math.max(0, parseInt(document.getElementById(`pres-${groupId}`).value) || 0));

  const total = i + f + s + p;
  document.getElementById(`total-${groupId}`).textContent = total;
}

async function handleSaveScore(e, groupId) {
  e.preventDefault();
  const innovation = parseInt(document.getElementById(`innov-${groupId}`).value) || 0;
  const feasibility = parseInt(document.getElementById(`feas-${groupId}`).value) || 0;
  const solution = parseInt(document.getElementById(`sol-${groupId}`).value) || 0;
  const presentation = parseInt(document.getElementById(`pres-${groupId}`).value) || 0;
  const remarks = document.getElementById(`remarks-${groupId}`).value.trim();

  const submitBtn = document.getElementById(`btn-score-${groupId}`);

  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

    const res = await fetch(`${API_BASE}/api/admin/groups/${groupId}/score`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ innovation, feasibility, solution, presentation, remarks })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to save score");

    if (window.firestoreDb) {
      window.firestoreDb.collection("scores").doc(groupId).set({
        group_id: groupId,
        innovation,
        feasibility,
        solution,
        presentation,
        total: innovation + feasibility + solution + presentation,
        remarks,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => {});
    }

    showToast(`Score updated! Total: ${data.score.total}/50`, "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> Save Score`;
  }
}

function handleGroupSearch() {
  const q = document.getElementById("groupSearchInput").value.toLowerCase().trim();
  if (!q) {
    renderAdminGroups(allAdminGroups);
    return;
  }

  const filtered = allAdminGroups.filter(g => {
    const matchName = g.name.toLowerCase().includes(q);
    const matchLeader = (g.creator_name || "").toLowerCase().includes(q);
    const matchMembers = (g.member_names || []).some(m => m.toLowerCase().includes(q));
    const matchBatch = (g.batch || "").toLowerCase().includes(q);
    return matchName || matchLeader || matchMembers || matchBatch;
  });

  renderAdminGroups(filtered);
}

// Delete Group Modal
function promptDeleteGroup(groupId, groupName) {
  deleteTargetGroupId = groupId;
  document.getElementById("deleteTargetGroupName").textContent = `"${groupName}"`;
  document.getElementById("deleteModal").style.display = "flex";
  document.getElementById("confirmDeleteBtn").onclick = executeDeleteGroup;
}

function closeDeleteModal() {
  document.getElementById("deleteModal").style.display = "none";
  deleteTargetGroupId = null;
}

async function executeDeleteGroup() {
  if (!deleteTargetGroupId) return;

  try {
    const res = await fetch(`${API_BASE}/api/admin/groups/${deleteTargetGroupId}`, {
      method: "DELETE",
      headers: authHeaders()
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to delete group");

    if (window.firestoreDb) {
      window.firestoreDb.collection("groups").doc(deleteTargetGroupId).delete().catch(() => {});
      window.firestoreDb.collection("scores").doc(deleteTargetGroupId).delete().catch(() => {});
    }

    showToast(data.message, "success");
    closeDeleteModal();
    loadAdminGroups();
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ----------------- LEADERBOARD -----------------
async function loadLeaderboard(showToastNotice = false) {
  const dept = document.getElementById("lbFilterDept") ? document.getElementById("lbFilterDept").value : "All";
  const div = document.getElementById("lbFilterDiv") ? document.getElementById("lbFilterDiv").value : "All";
  const batch = document.getElementById("lbFilterBatch") ? document.getElementById("lbFilterBatch").value : "All";

  let url = `${API_BASE}/api/leaderboard`;
  const params = [];
  if (dept !== "All") params.push(`department=${encodeURIComponent(dept)}`);
  if (div !== "All") params.push(`division=${encodeURIComponent(div)}`);
  if (batch !== "All") params.push(`batch=${encodeURIComponent(batch)}`);
  if (params.length > 0) url += `?${params.join("&")}`;

  try {
    const res = await fetch(url, {
      headers: authHeaders()
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to load leaderboard");
    }

    const data = await res.json();
    renderLeaderboard(data.leaderboard, data.best_project);

    if (showToastNotice) {
      showToast("Leaderboard synced.", "info");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderLeaderboard(list, bestProject) {
  const showcase = document.getElementById("bestProjectShowcase");
  if (bestProject) {
    showcase.style.display = "block";
    showcase.innerHTML = `
      <div class="best-project-card">
        <div class="best-badge-row">
          <div class="champion-pill">
            <i class="fa-solid fa-crown"></i> #1 Best Performing Project
          </div>
          <div class="best-score-display">
            ${bestProject.total} <small>/ 50 Pts</small>
          </div>
        </div>

        <div class="best-meta-header">
          <span class="badge-dept">${bestProject.department}</span>
          <span class="badge-class">${bestProject.student_class}</span>
          <span class="badge-div">${bestProject.division}</span>
          <span class="badge-batch">${bestProject.batch}</span>
          <h3>${escapeHtml(bestProject.name)}</h3>
        </div>
        <p class="best-members-list"><strong>Team Members:</strong> ${(bestProject.members || []).join(", ") || "N/A"}</p>

        <div class="best-narratives-grid">
          <div class="narrative-item">
            <h5><i class="fa-solid fa-bullseye"></i> Step 1: Problem Statement</h5>
            <p>${bestProject.step1_problem_statement ? escapeHtml(bestProject.step1_problem_statement) : "<em>Details submitted</em>"}</p>
          </div>
          <div class="narrative-item">
            <h5><i class="fa-solid fa-lightbulb"></i> Step 3: Innovative Solution</h5>
            <p>${bestProject.step3_innovative_solution ? escapeHtml(bestProject.step3_innovative_solution) : "<em>Details submitted</em>"}</p>
          </div>
          <div class="narrative-item">
            <h5><i class="fa-solid fa-chart-line"></i> Step 4: Feasibility &amp; Economics</h5>
            <p>${bestProject.step4_feasibility_business_model ? escapeHtml(bestProject.step4_feasibility_business_model) : "<em>Details submitted</em>"}</p>
          </div>
        </div>
      </div>
    `;
  } else {
    showcase.style.display = "none";
  }

  const tbody = document.getElementById("leaderboardBody");
  if (!list || list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-center" style="padding: 2rem; color: var(--text-muted);">
          No groups registered in this department / batch filter.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(item => {
    let rankBadgeClass = "rank-badge";
    if (item.rank === 1) rankBadgeClass += " rank-1";
    else if (item.rank === 2) rankBadgeClass += " rank-2";
    else if (item.rank === 3) rankBadgeClass += " rank-3";

    return `
      <tr>
        <td class="text-center">
          <span class="${rankBadgeClass}">${item.rank}</span>
        </td>
        <td>
          <span class="group-name-cell">${escapeHtml(item.name)}</span>
        </td>
        <td>
          <strong>${item.department}</strong><br><small class="text-muted">${item.student_class}</small>
        </td>
        <td>
          <span class="badge-div">${item.division}</span> <span class="badge-batch">${item.batch}</span>
        </td>
        <td>
          <small style="color: var(--text-secondary);">${(item.members || []).join(", ") || "—"}</small>
        </td>
        <td class="text-center cell-score-num">${item.is_marked ? item.innovation : '—'}</td>
        <td class="text-center cell-score-num">${item.is_marked ? item.feasibility : '—'}</td>
        <td class="text-center cell-score-num">${item.is_marked ? item.solution_score : '—'}</td>
        <td class="text-center cell-score-num">${item.is_marked ? item.presentation : '—'}</td>
        <td class="text-center">
          <span class="total-score-pill">${item.is_marked ? item.total : 0}</span>
        </td>
        <td>
          ${item.is_marked 
            ? `<span class="status-badge status-marked"><i class="fa-solid fa-circle-check"></i> Marked</span>` 
            : `<span class="status-badge status-pending"><i class="fa-regular fa-clock"></i> Pending</span>`}
        </td>
      </tr>
    `;
  }).join("");
}

// ----------------- FACULTY SETTINGS: USER MANAGEMENT -----------------
async function loadAdminUsers() {
  if (currentUser.role !== "faculty") return;

  try {
    const res = await fetch(`${API_BASE}/api/admin/users`, {
      headers: authHeaders()
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to load users");
    }

    const users = await res.json();
    renderAdminUsers(users);
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderAdminUsers(users) {
  const tbody = document.getElementById("userTableBody");
  tbody.innerHTML = users.map(u => {
    const isSelf = u.id === currentUser.id;

    let allocInfo = "—";
    if (u.role === "faculty" && u.assignments && u.assignments.length > 0) {
      allocInfo = u.assignments.map(a => 
        `<div><strong>${a.department}</strong> (${a.student_class}, ${a.division}) • [${(a.batches || []).join(", ")}]</div>`
      ).join("");
    } else if (u.role === "student") {
      allocInfo = `<div>${u.department} • ${u.student_class} • ${u.division} • <strong>${u.batch}</strong></div>`;
    }

    return `
      <tr>
        <td><strong>${escapeHtml(u.name)}</strong> ${isSelf ? '<small class="rubric-badge">You</small>' : ''}</td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="role-tag">${u.role.toUpperCase()}</span></td>
        <td style="font-size: 0.8rem;">${allocInfo}</td>
        <td>
          ${isSelf ? '<small style="color: var(--text-muted);">Current Session</small>' : `
            <select class="role-select" onchange="changeUserRole('${u.id}', this.value)">
              <option value="student" ${u.role === 'student' ? 'selected' : ''}>Student</option>
              <option value="faculty" ${u.role === 'faculty' ? 'selected' : ''}>Faculty</option>
            </select>
          `}
        </td>
      </tr>
    `;
  }).join("");
}

async function changeUserRole(targetUserId, newRole) {
  try {
    const res = await fetch(`${API_BASE}/api/admin/promote`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ target_user_id: targetUserId, role: newRole })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to update role");

    showToast(data.message, "success");
    loadAdminUsers();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
  checkAuth();

  // Background sync fallback: check for any faculty updates every 8 seconds
  setInterval(() => {
    if (authToken && currentUser) {
      if (currentUser.role === "student" && currentMyGroup) {
        // Fetch latest group status quietly
        fetch(`${API_BASE}/api/groups/my-group`, { headers: authHeaders() })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data && data.has_group && data.group) {
              const g = data.group;
              let changed = false;
              for (let i = 1; i <= 5; i++) {
                if (g[`step${i}_status`] !== currentMyGroup[`step${i}_status`] || g[`step${i}_remarks`] !== currentMyGroup[`step${i}_remarks`]) {
                  currentMyGroup[`step${i}_status`] = g[`step${i}_status`];
                  currentMyGroup[`step${i}_remarks`] = g[`step${i}_remarks`];
                  changed = true;
                }
              }
              if (JSON.stringify(g.score) !== JSON.stringify(currentMyGroup.score)) {
                currentMyGroup.score = g.score;
                renderStudentMarks(currentMyGroup.score);
              }
              if (changed) {
                renderStudentStepStatusAndLocking(currentMyGroup);
              }
            }
          })
          .catch(() => {});
      } else if (currentUser.role === "faculty") {
        const activeTab = document.querySelector(".nav-item.active");
        if (activeTab && activeTab.id === "tabAdminGroupsBtn") {
          // Quietly update faculty dashboard if open
          loadAdminGroups(false);
        }
      }
    }
  }, 8000);
});

