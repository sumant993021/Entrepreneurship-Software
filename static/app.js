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
let leaderboardFirestoreUnsub = null;
let adminUsersFirestoreUnsub = null;

const API_BASE = window.location.origin;
// Strictly Entirely Firebase only (Serverless Architecture via Firebase Auth & Cloud Firestore)
const IS_PURE_FIREBASE = true;

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

// WebSocket Setup (Optional notification channel when FastAPI is used; fallback cleanly on pure Firebase)
function setupWebSocket() {
  const indicator = document.getElementById("liveIndicator");
  if (IS_PURE_FIREBASE) {
    if (indicator) {
      indicator.style.display = "flex";
      indicator.title = "Real-Time Cloud Firestore Live Sync Active (100% Firebase)";
    }
    return;
  }
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
    };
    socket.onerror = () => {
      socket = null;
    };
  } catch (e) {
    // Clean fallback to Firestore
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

// Handle Public Shared Showcase URL (/track/whatsapp/:id, /track/telegram/:id, /track/linkedin/:id, /p/:id)
async function handlePublicShowcaseRoute() {
  const path = window.location.pathname;
  let code = null;
  let channel = "direct";

  const trackMatch = path.match(/^\/track\/(whatsapp|telegram|linkedin|direct)\/([a-zA-Z0-9_\-]+)/i);
  const pMatch = path.match(/^\/p\/([a-zA-Z0-9_\-]+)/i);

  if (trackMatch) {
    channel = trackMatch[1].toLowerCase();
    code = trackMatch[2];
  } else if (pMatch) {
    channel = "direct";
    code = pMatch[1];
  }

  if (!code) return false;

  console.log(`[Public Showcase] Loading public showcase for code=${code}, channel=${channel}`);

  try {
    if (window.firestoreDb) {
      // Lookup group by invite_code or doc id
      let groupDoc = null;
      let q = await window.firestoreDb.collection("groups").where("invite_code", "==", code).limit(1).get();
      if (!q.empty) {
        groupDoc = q.docs[0];
      } else {
        const docSnap = await window.firestoreDb.collection("groups").doc(code).get();
        if (docSnap.exists) groupDoc = docSnap;
      }

      if (groupDoc) {
        const groupData = groupDoc.data();
        const groupId = groupDoc.id;

        // Record deduplicated unique visitor click
        const visitorStorageKey = `edmg_visited_${groupId}_${channel}`;
        const isNewVisitor = !localStorage.getItem(visitorStorageKey);
        localStorage.setItem(visitorStorageKey, "1");

        const updatePayload = {
          "marketing_metrics.total_raw_clicks": firebase.firestore.FieldValue.increment(1)
        };
        if (isNewVisitor) {
          updatePayload["marketing_metrics.total_unique_views"] = firebase.firestore.FieldValue.increment(1);
          if (channel === "whatsapp") updatePayload["marketing_metrics.whatsapp_unique"] = firebase.firestore.FieldValue.increment(1);
          else if (channel === "telegram") updatePayload["marketing_metrics.telegram_unique"] = firebase.firestore.FieldValue.increment(1);
          else if (channel === "linkedin") updatePayload["marketing_metrics.linkedin_unique"] = firebase.firestore.FieldValue.increment(1);
          else updatePayload["marketing_metrics.direct_unique"] = firebase.firestore.FieldValue.increment(1);
        }

        window.firestoreDb.collection("groups").doc(groupId).update(updatePayload).catch(e => console.warn("Metrics increment notice:", e));

        renderPublicShowcase(groupData);
        return true;
      }
    }
  } catch (err) {
    console.warn("Public showcase lookup notice:", err);
  }

  return false;
}

function renderPublicShowcase(group) {
  const modal = document.getElementById("publicShowcaseView");
  if (!modal) return;

  const authSec = document.getElementById("authSection");
  const mainNav = document.getElementById("mainNav");
  const userBadge = document.getElementById("userBadge");
  if (authSec) authSec.style.display = "none";
  if (mainNav) mainNav.style.display = "none";
  if (userBadge) userBadge.style.display = "none";
  hideAllTabs();

  // Populate data
  document.getElementById("showcaseProjectName").textContent = group.name || "Engineering Project Showcase";
  
  let deptText = `${group.department || 'Engineering'} • ${group.student_class || 'Third Year'}`;
  if (group.division && group.division !== "—") deptText += ` • ${group.division}`;
  if (group.batch && group.batch !== "—" && group.department !== "ECS") deptText += ` • ${group.batch}`;
  document.getElementById("showcaseDeptBadges").textContent = deptText;
  document.getElementById("showcaseAllocation").textContent = `${group.department || ''} ${group.division || ''} (${group.student_class || 'Third Year'})`;

  document.getElementById("showcaseLeaderName").textContent = `Leader: ${group.creator_name || 'Group Leader'}`;
  document.getElementById("showcaseMembersList").textContent = `Members: ${(group.member_names || []).join(", ") || 'No members listed'}`;

  document.getElementById("showcaseProblemStatement").textContent = group.step1_problem_statement || "Problem statement under review by faculty.";
  document.getElementById("showcaseSolutionUSP").textContent = group.pitch_strategy?.solution_usp || group.step3_innovative_solution || "Innovative engineering solution and functional prototype.";

  // Pitch hook & Deck URL
  const pitchHook = group.pitch_strategy?.hook_tagline || group.step1_problem_statement || "Verified Capstone Presentation Deck";
  document.getElementById("showcasePitchHook").textContent = `"${pitchHook}"`;

  const deckUrl = group.pitch_strategy?.pitch_deck_url || "";
  const deckBtn = document.getElementById("showcaseDeckBtn");
  const deckArea = document.getElementById("showcaseDeckLinkArea");
  const noDeckMsg = document.getElementById("showcaseNoDeckMessage");

  if (deckUrl && deckUrl.trim().length > 0) {
    if (deckBtn) {
      deckBtn.href = deckUrl.trim();
      deckBtn.style.display = "inline-flex";
    }
    if (deckArea) deckArea.style.display = "block";
    if (noDeckMsg) noDeckMsg.style.display = "none";
  } else {
    if (deckArea) deckArea.style.display = "none";
    if (noDeckMsg) noDeckMsg.style.display = "block";
  }

  modal.style.display = "flex";
}

async function checkAuth() {
  // First, check if user is visiting a public shared project link (/track/... or /p/...)
  const isShowcase = await handlePublicShowcaseRoute();
  if (isShowcase) return;

  // If running pure Firebase, check Firebase Auth state
  if (IS_PURE_FIREBASE && window.firebaseAuth) {
    window.firebaseAuth.onAuthStateChanged(async (fbUser) => {
      if (fbUser) {
        authToken = await fbUser.getIdToken();
        localStorage.setItem("edmg_token", authToken);
        
        // Attempt to fetch profile from Firestore
        if (window.firestoreDb) {
          try {
            const userDoc = await window.firestoreDb.collection("users").doc(fbUser.uid).get();
            if (userDoc.exists) {
              currentUser = userDoc.data();
              localStorage.setItem("edmg_user", JSON.stringify(currentUser));
            } else {
              // Try finding user by email in users collection
              const q = await window.firestoreDb.collection("users").where("email", "==", fbUser.email.toLowerCase()).limit(1).get();
              if (!q.empty) {
                currentUser = q.docs[0].data();
                localStorage.setItem("edmg_user", JSON.stringify(currentUser));
              }
            }
          } catch (e) {
            console.warn("Firestore user fetch error in checkAuth:", e);
          }
        }

        // Check if user is known faculty or seeded in SEED_ACCOUNTS
        const userEmailLower = (fbUser.email || "").trim().toLowerCase();
        const seedProfile = SEED_ACCOUNTS[userEmailLower];

        if (!currentUser && seedProfile) {
          currentUser = { ...seedProfile, id: fbUser.uid };
          localStorage.setItem("edmg_user", JSON.stringify(currentUser));
          syncUserProfileToFirestore(currentUser);
        } else if (currentUser && seedProfile && seedProfile.role === "faculty" && currentUser.role !== "faculty") {
          // Self-heal: ensure faculty role and assignments are restored if demoted
          currentUser.role = "faculty";
          if (!currentUser.assignments || currentUser.assignments.length === 0) {
            currentUser.assignments = seedProfile.assignments;
          }
          localStorage.setItem("edmg_user", JSON.stringify(currentUser));
          syncUserProfileToFirestore(currentUser);
        }

        if (!currentUser) {
          const cached = localStorage.getItem("edmg_user");
          if (cached) {
            try { currentUser = JSON.parse(cached); } catch (e) {}
          }
        }

        if (currentUser) {
          showAppUI();
          loadInitialData();
          return;
        }
      }
      
      const cached = localStorage.getItem("edmg_user");
      if (cached && authToken) {
        try {
          currentUser = JSON.parse(cached);
          showAppUI();
          loadInitialData();
          return;
        } catch (e) {}
      }
      showAuthUI();
    });
    return;
  }

  if (!authToken) {
    showAuthUI();
    return;
  }

  // Restore cached user profile immediately if available so UI doesn't flicker/log out on refresh
  const cachedUserStr = localStorage.getItem("edmg_user");
  if (cachedUserStr) {
    try {
      currentUser = JSON.parse(cachedUserStr);
      showAppUI();
      loadInitialData();
    } catch (e) {}
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: authHeaders()
    });

    if (res.ok) {
      currentUser = await res.json();
      localStorage.setItem("edmg_user", JSON.stringify(currentUser));
      setupWebSocket();
      showAppUI();
      loadInitialData();
    } else if (res.status === 401) {
      // Only log out if backend explicitly returns 401 Unauthorized
      logout();
    }
  } catch (err) {
    // On network glitch / server spin-up delay, keep user logged in with cached credentials
    console.warn("Auth check network notice:", err);
    if (!currentUser && cachedUserStr) {
      try {
        currentUser = JSON.parse(cachedUserStr);
        showAppUI();
        loadInitialData();
      } catch (e) {
        showAuthUI();
      }
    } else if (!currentUser) {
      showAuthUI();
    }
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
    if (currentUser.department === "ECS") {
      roleDesc += ` • ${currentUser.department} ${currentUser.division}`;
    } else {
      roleDesc += ` • ${currentUser.department} ${currentUser.division} (${currentUser.batch || 'Batch 1'})`;
    }
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
    const isEcs = a.department === "ECS";
    const batchInfo = isEcs ? `<span class="ecs-batch-note"><i class="fa-solid fa-layer-group"></i> Divs Only (No Batches)</span>` : `• <strong>${(a.batches || []).join(", ")}</strong>`;
    return `
      <div class="assigned-pill">
        <span class="badge-dept">${a.department}</span>
        <span class="ap-details">${a.student_class} • ${a.division} ${batchInfo}</span>
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

function setAuthMode(mode) {
  isRegisterMode = (mode === "register");
  const loginForm = document.getElementById("loginForm");
  const regSelector = document.getElementById("registerRoleSelector");
  const stuForm = document.getElementById("studentRegisterForm");
  const facForm = document.getElementById("facultyRegisterForm");
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSubtitle");
  const prompt = document.getElementById("authTogglePrompt");
  const toggleBtn = document.getElementById("toggleAuthBtn");

  if (isRegisterMode) {
    if (loginForm) loginForm.style.display = "none";
    if (regSelector) regSelector.style.display = "block";
    switchRegRole("student");
    if (title) title.textContent = "Registration Portal";
    if (subtitle) subtitle.textContent = "Register with your Department, Class, Division, and Batches";
    if (prompt) prompt.textContent = "Already registered?";
    if (toggleBtn) {
      toggleBtn.textContent = "Sign in here";
    }
  } else {
    if (loginForm) loginForm.style.display = "block";
    if (regSelector) regSelector.style.display = "none";
    if (stuForm) stuForm.style.display = "none";
    if (facForm) facForm.style.display = "none";
    if (title) title.textContent = "E&DM Project Portal";
    if (subtitle) subtitle.textContent = "Sign in to access your project dashboard or evaluation portal";
    if (prompt) prompt.textContent = "Need an account?";
    if (toggleBtn) {
      toggleBtn.textContent = "Register here";
    }
  }
}

function toggleAuthMode() {
  setAuthMode(isRegisterMode ? "login" : "register");
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

// Department change handler for Student Registration form
function handleStudentDeptChange() {
  const deptSelect = document.getElementById("stuRegDept");
  const divGroup = document.getElementById("stuRegDivGroup");
  const divSelect = document.getElementById("stuRegDiv");
  const batchGroup = document.getElementById("stuRegBatchGroup");
  const batchSelect = document.getElementById("stuRegBatch");
  if (!deptSelect) return;

  if (deptSelect.value === "ECS") {
    // ECS: Divisions A & B only, No batches
    if (divGroup) divGroup.style.display = "block";
    if (divSelect) divSelect.required = true;
    if (batchGroup) batchGroup.style.display = "none";
    if (batchSelect) {
      batchSelect.required = false;
      batchSelect.value = "—";
    }
  } else {
    // Instrumentation: Batches B1 & B2 only, No divisions
    if (divGroup) divGroup.style.display = "none";
    if (divSelect) {
      divSelect.required = false;
      divSelect.value = "—";
    }
    if (batchGroup) batchGroup.style.display = "block";
    if (batchSelect) {
      batchSelect.required = true;
      if (batchSelect.value === "—" || !batchSelect.value) {
        batchSelect.value = "Batch 1";
      }
    }
  }
}

// Department change handler for Create Group form
function handleNewGroupDeptChange() {
  const deptSelect = document.getElementById("newGroupDept");
  const divGroup = document.getElementById("newGroupDivGroup");
  const divSelect = document.getElementById("newGroupDiv");
  const batchGroup = document.getElementById("newGroupBatchGroup");
  const batchSelect = document.getElementById("newGroupBatch");
  if (!deptSelect) return;

  if (deptSelect.value === "ECS") {
    // ECS: Divisions A & B only, No batches
    if (divGroup) divGroup.style.display = "block";
    if (divSelect) divSelect.required = true;
    if (batchGroup) batchGroup.style.display = "none";
    if (batchSelect) {
      batchSelect.required = false;
      batchSelect.value = "—";
    }
  } else {
    // Instrumentation: Batches B1 & B2 only, No divisions
    if (divGroup) divGroup.style.display = "none";
    if (divSelect) {
      divSelect.required = false;
      divSelect.value = "—";
    }
    if (batchGroup) batchGroup.style.display = "block";
    if (batchSelect) {
      batchSelect.required = true;
      if (batchSelect.value === "—" || !batchSelect.value) {
        batchSelect.value = "Batch 1";
      }
    }
  }
}

// Department change handler for a Faculty Assignment Row
function handleFacultyRowDeptChange(deptSelect, rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const divCol = row.querySelector(".rf-col-div");
  const batchContainer = row.querySelector(".rf-col-batch");
  if (!batchContainer) return;

  if (deptSelect.value === "ECS") {
    if (divCol) divCol.style.display = "block";
    batchContainer.innerHTML = `
      <label>Batches</label>
      <div class="ecs-batch-note">
        <i class="fa-solid fa-circle-check"></i> Div A / Div B Only (No Batches)
      </div>
    `;
  } else {
    if (divCol) divCol.style.display = "none";
    batchContainer.innerHTML = `
      <label>Batches (B1 &amp; B2 Only)</label>
      <div class="batch-checkboxes">
        <label><input type="checkbox" value="Batch 1" checked> B1</label>
        <label><input type="checkbox" value="Batch 2" checked> B2</label>
      </div>
    `;
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
        <select class="f-dept" required onchange="handleFacultyRowDeptChange(this, '${rowId}')">
          <option value="ECS">ECS</option>
          <option value="Instrumentation">Instrumentation</option>
        </select>
      </div>

      <div class="rf-col">
        <label>Class</label>
        <select class="f-class" required>
          <option value="Third Year">Third Year (TE)</option>
        </select>
      </div>

      <div class="rf-col rf-col-div">
        <label>Division</label>
        <select class="f-div" required>
          <option value="Div A">Division A</option>
          <option value="Div B">Division B</option>
        </select>
      </div>

      <div class="rf-col rf-col-batch">
        <label>Batches</label>
        <div class="ecs-batch-note">
          <i class="fa-solid fa-circle-check"></i> Div A / Div B Only (No Batches)
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

// Known seed accounts fallback for instant access if offline/unseeded in Firestore
const SEED_ACCOUNTS = {
  "sumantdeshmukh.in@gmail.com": {
    id: "37bfcb86-26ba-4253-a1f6-7d4ce822f4c0",
    email: "sumantdeshmukh.in@gmail.com",
    name: "Sumant Deshmukh",
    role: "faculty",
    department: "ECS",
    student_class: "Third Year",
    division: "Div A",
    batch: "Batch 1",
    assignments: [
      { department: "ECS", student_class: "Third Year", division: "Div A", batches: ["Batch 1", "Batch 2", "Batch 3", "Batch 4"] },
      { department: "Instrumentation", student_class: "Third Year", division: "Div A", batches: ["Batch 1", "Batch 2", "Batch 3", "Batch 4"] },
      { department: "ECS", student_class: "Third Year", division: "Div B", batches: ["Batch 1", "Batch 2", "Batch 3", "Batch 4"] }
    ]
  },
  "sumantdeshmukh39@gmail.com": {
    id: "d5d9b147-f371-4295-b5f0-71527ac30263",
    email: "sumantdeshmukh39@gmail.com",
    name: "Abhishek",
    role: "faculty",
    department: "ECS",
    student_class: "Third Year",
    division: "Div A",
    batch: "Batch 1",
    assignments: [
      { department: "ECS", student_class: "Third Year", division: "Div B", batches: ["Batch 1", "Batch 2", "Batch 3", "Batch 4"] },
      { department: "Instrumentation", student_class: "Third Year", division: "Div A", batches: ["Batch 3", "Batch 4"] }
    ]
  },
  "sumant9.cyber@gmail.com": {
    id: "ef5475b0-15ee-4e83-aeb1-cb13c771f7f0",
    email: "sumant9.cyber@gmail.com",
    name: "Ninad",
    role: "faculty",
    department: "ECS",
    student_class: "Third Year",
    division: "Div A",
    batch: "Batch 1",
    assignments: [
      { department: "ECS", student_class: "Third Year", division: "Div A", batches: ["Batch 1", "Batch 2", "Batch 3", "Batch 4"] },
      { department: "Instrumentation", student_class: "Third Year", division: "Div A", batches: ["Batch 1", "Batch 2"] }
    ]
  },
  "sd397388@gmail.com": {
    id: "d722a5e8-c353-409c-b04f-c93852c29842",
    email: "sd397388@gmail.com",
    name: "Sumant Sanjay Deshmukh",
    role: "student",
    department: "ECS",
    student_class: "Third Year",
    division: "Div A",
    batch: "Batch 4",
    assignments: []
  },
  "faculty.rajesh@college.edu": {
    id: "fac-rajesh-raman",
    email: "faculty.rajesh@college.edu",
    name: "Dr. Rajesh Raman",
    role: "faculty",
    department: "ECS",
    student_class: "Third Year",
    division: "Div A",
    batch: "Batch 1",
    assignments: [
      { department: "ECS", student_class: "Third Year", division: "Div A", batches: ["Batch 1", "Batch 2"] },
      { department: "Instrumentation", student_class: "Third Year", division: "Div A", batches: ["Batch 1"] }
    ]
  },
  "faculty.ananya@college.edu": {
    id: "fac-ananya-sen",
    email: "faculty.ananya@college.edu",
    name: "Prof. Ananya Sen",
    role: "faculty",
    department: "ECS",
    student_class: "Third Year",
    division: "Div A",
    batch: "Batch 2",
    assignments: [
      { department: "ECS", student_class: "Third Year", division: "Div A", batches: ["Batch 3", "Batch 4"] },
      { department: "Instrumentation", student_class: "Third Year", division: "Div A", batches: ["Batch 2"] }
    ]
  },
  "aarav.b1@college.edu": {
    id: "stu-aarav-patel",
    email: "aarav.b1@college.edu",
    name: "Aarav Patel",
    role: "student",
    department: "ECS",
    student_class: "Third Year",
    division: "Div A",
    batch: "—",
    assignments: []
  },
  "rohit.b3@college.edu": {
    id: "stu-rohit-verma",
    email: "rohit.b3@college.edu",
    name: "Rohit Verma",
    role: "student",
    department: "ECS",
    student_class: "Third Year",
    division: "Div A",
    batch: "—",
    assignments: []
  },
  "priya.inst1@college.edu": {
    id: "stu-priya-nair",
    email: "priya.inst1@college.edu",
    name: "Priya Nair",
    role: "student",
    department: "Instrumentation",
    student_class: "Third Year",
    division: "—",
    batch: "Batch 1",
    assignments: []
  },
  "siddharth.inst2@college.edu": {
    id: "stu-siddharth-rao",
    email: "siddharth.inst2@college.edu",
    name: "Siddharth Rao",
    role: "student",
    department: "Instrumentation",
    student_class: "Third Year",
    division: "—",
    batch: "Batch 2",
    assignments: []
  }
};

// Authentication Submissions with Firebase Auth & Firestore Sync
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const password = document.getElementById("loginPassword").value;
  const submitBtn = document.getElementById("loginSubmitBtn");

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Signing In...`;
    }

    if (IS_PURE_FIREBASE) {
      if (!window.firebaseAuth) {
        throw new Error("Firebase Auth service is unavailable. Please check your internet connection.");
      }

      let fbUser = null;
      try {
        const cred = await window.firebaseAuth.signInWithEmailAndPassword(email, password);
        fbUser = cred.user;
      } catch (fbErr) {
        // If account not created yet in Firebase Auth, auto-create it with user's credentials
        if (fbErr.code === "auth/user-not-found" || fbErr.code === "auth/invalid-credential") {
          try {
            const newCred = await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
            fbUser = newCred.user;
          } catch (createErr) {
            if (createErr.code === "auth/email-already-in-use") {
              throw new Error("Incorrect password for this email. If you registered previously, please re-enter your password or click quick login.");
            }
            throw new Error(createErr.message || "Failed to sign in via Firebase Auth.");
          }
        } else if (fbErr.code === "auth/wrong-password") {
          throw new Error("Incorrect password for this account. Please enter the password you used during registration or click quick login.");
        } else {
          throw new Error(fbErr.message || "Firebase login failed.");
        }
      }

      authToken = await fbUser.getIdToken();
      localStorage.setItem("edmg_token", authToken);

      // Load User Profile from Firestore
      let userProfile = null;
      if (window.firestoreDb) {
        try {
          const doc = await window.firestoreDb.collection("users").doc(fbUser.uid).get();
          if (doc.exists) {
            userProfile = doc.data();
          } else {
            // Check by email query
            const q = await window.firestoreDb.collection("users").where("email", "==", email).limit(1).get();
            if (!q.empty) {
              userProfile = q.docs[0].data();
            }
          }
        } catch (dbErr) {
          console.warn("Firestore user profile fetch notice:", dbErr);
        }
      }

      const seed = SEED_ACCOUNTS[email];

      // If user profile not yet in Firestore, seed from defaults or fallback
      if (!userProfile) {
        if (seed) {
          userProfile = { ...seed, id: fbUser.uid };
        } else {
          // Default profile based on role assumption
          userProfile = {
            id: fbUser.uid,
            name: email.split("@")[0],
            email: email,
            role: "student",
            department: "ECS",
            student_class: "Third Year",
            division: "Div A",
            batch: "Batch 1",
            assignments: []
          };
        }
        syncUserProfileToFirestore(userProfile);
      } else if (seed && seed.role === "faculty" && userProfile.role !== "faculty") {
        // Guarantee faculty status and department allocations for known faculty
        userProfile.role = "faculty";
        if (!userProfile.assignments || userProfile.assignments.length === 0) {
          userProfile.assignments = seed.assignments;
        }
        syncUserProfileToFirestore(userProfile);
      }

      currentUser = userProfile;
      localStorage.setItem("edmg_user", JSON.stringify(currentUser));

      showToast(`Welcome back, ${currentUser.name}!`, "success");
      setupWebSocket();
      showAppUI();
      loadInitialData();
      return;
    }

    // Server-backed environment (FastAPI on localhost)
    if (window.firebaseAuth) {
      try {
        await window.firebaseAuth.signInWithEmailAndPassword(email, password);
      } catch (fbErr) {
        if (fbErr.code === "auth/user-not-found" || fbErr.code === "auth/invalid-credential") {
          try {
            await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
          } catch (e2) {}
        }
      }
    }

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
    localStorage.setItem("edmg_user", JSON.stringify(currentUser));

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
  if (e && e.preventDefault) e.preventDefault();
  const submitBtn = document.getElementById("studentRegisterSubmitBtn");
  const name = document.getElementById("stuRegName") ? document.getElementById("stuRegName").value.trim() : "";
  const email = document.getElementById("stuRegEmail") ? document.getElementById("stuRegEmail").value.trim().toLowerCase() : "";
  const department = document.getElementById("stuRegDept") ? document.getElementById("stuRegDept").value : "ECS";
  const student_class = document.getElementById("stuRegClass") ? document.getElementById("stuRegClass").value : "Third Year";
  const division = department === "Instrumentation" ? "—" : (document.getElementById("stuRegDiv") ? document.getElementById("stuRegDiv").value : "Div A");
  const rawBatch = document.getElementById("stuRegBatch") ? document.getElementById("stuRegBatch").value : "Batch 1";
  const batch = department === "ECS" ? "—" : rawBatch;
  const password = document.getElementById("stuRegPassword") ? document.getElementById("stuRegPassword").value : "";

  if (!name || !email || !password) {
    showToast("Please fill in your full name, college email, and password.", "error");
    return;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registering Account...`;
    }

    if (IS_PURE_FIREBASE) {
      if (!window.firebaseAuth) throw new Error("Firebase Auth service is unavailable. Please check your internet connection.");

      let fbUser = null;
      try {
        const cred = await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
        fbUser = cred.user;
      } catch (fbErr) {
        if (fbErr.code === "auth/email-already-in-use") {
          try {
            const cred = await window.firebaseAuth.signInWithEmailAndPassword(email, password);
            fbUser = cred.user;
          } catch (signInErr) {
            throw new Error("This email is already registered. If it is yours, please sign in with your password from the login screen.");
          }
        } else if (fbErr.code === "auth/weak-password") {
          throw new Error("Password must be at least 6 characters long.");
        } else if (fbErr.code === "auth/invalid-email") {
          throw new Error("Please enter a valid college email address.");
        } else {
          throw new Error(fbErr.message || "Student registration failed.");
        }
      }

      authToken = await fbUser.getIdToken();
      localStorage.setItem("edmg_token", authToken);

      const userProfile = {
        id: fbUser.uid,
        name: name,
        email: email,
        role: "student",
        department: department,
        student_class: student_class,
        division: division,
        batch: batch,
        assignments: []
      };

      currentUser = userProfile;
      localStorage.setItem("edmg_user", JSON.stringify(currentUser));
      syncUserProfileToFirestore(currentUser);

      const regMsg = department === "ECS" 
        ? `Registered as student for ECS ${division}` 
        : `Registered as student for Instrumentation (${batch})`;
      showToast(regMsg, "success");
      setupWebSocket();
      showAppUI();
      loadInitialData();
      return;
    }

    if (window.firebaseAuth) {
      try {
        await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
      } catch (fbErr) {
        if (fbErr.code !== "auth/email-already-in-use") {
          console.warn("Firebase Auth notice:", fbErr.message);
        }
      }
    }

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
    localStorage.setItem("edmg_user", JSON.stringify(currentUser));

    syncUserProfileToFirestore(currentUser);

    const regMsg = department === "ECS" 
      ? `Registered as student for ${department} ${division}` 
      : `Registered as student for ${department} ${division} (${batch})`;
    showToast(regMsg, "success");
    setupWebSocket();
    showAppUI();
    loadInitialData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Register as Student / Leader`;
    }
  }
}

async function handleFacultyRegister(e) {
  if (e && e.preventDefault) e.preventDefault();
  const submitBtn = document.getElementById("facultyRegisterSubmitBtn");
  const name = document.getElementById("facRegName").value.trim();
  const email = document.getElementById("facRegEmail").value.trim().toLowerCase();
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
    const division = r.querySelector(".f-div") ? r.querySelector(".f-div").value : "Div A";

    if (department === "ECS") {
      // ECS has no batches: assign whole division
      assignments.push({ department, student_class, division, batches: ["—"] });
    } else {
      const checkedBatches = Array.from(r.querySelectorAll(".batch-checkboxes input:checked")).map(cb => cb.value);
      if (checkedBatches.length > 0) {
        assignments.push({ department, student_class, division, batches: checkedBatches });
      } else {
        // Fallback default batch for Instrumentation if not explicitly checked
        assignments.push({ department, student_class, division: "—", batches: ["Batch 1", "Batch 2"] });
      }
    }
  });

  if (assignments.length === 0) {
    showToast("Please select at least one batch for your assigned department.", "error");
    return;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registering Faculty...`;
    }

    if (IS_PURE_FIREBASE) {
      if (!window.firebaseAuth) throw new Error("Firebase Auth service is unavailable. Please check your internet connection.");

      let fbUser = null;
      try {
        const cred = await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
        fbUser = cred.user;
      } catch (fbErr) {
        if (fbErr.code === "auth/email-already-in-use") {
          try {
            const cred = await window.firebaseAuth.signInWithEmailAndPassword(email, password);
            fbUser = cred.user;
          } catch (signInErr) {
            throw new Error("This email is already registered. Please sign in with your password from the login screen.");
          }
        } else if (fbErr.code === "auth/weak-password") {
          throw new Error("Password must be at least 6 characters long.");
        } else {
          throw new Error(fbErr.message || "Faculty registration failed");
        }
      }

      authToken = await fbUser.getIdToken();
      localStorage.setItem("edmg_token", authToken);

      const userProfile = {
        id: fbUser.uid,
        name: name,
        email: email,
        role: "faculty",
        department: assignments[0].department,
        student_class: assignments[0].student_class,
        division: assignments[0].division,
        batch: assignments[0].batches[0] || "Batch 1",
        assignments: assignments
      };

      currentUser = userProfile;
      localStorage.setItem("edmg_user", JSON.stringify(currentUser));
      syncUserProfileToFirestore(currentUser);

      showToast(`Faculty registered with ${assignments.length} department allocations!`, "success");
      setupWebSocket();
      showAppUI();
      loadInitialData();
      return;
    }

    if (window.firebaseAuth) {
      try {
        await window.firebaseAuth.createUserWithEmailAndPassword(email, password);
      } catch (fbErr) {
        if (fbErr.code !== "auth/email-already-in-use") {
          console.warn("Firebase Auth notice:", fbErr.message);
        }
      }
    }

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
    localStorage.setItem("edmg_user", JSON.stringify(currentUser));

    syncUserProfileToFirestore(currentUser);

    showToast(`Faculty registered with ${assignments.length} department allocations!`, "success");
    setupWebSocket();
    showAppUI();
    loadInitialData();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-chalkboard-user"></i> Register Faculty Account`;
    }
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
      budget_items: group.budget_items || [],
      pitch_strategy: group.pitch_strategy || {},
      digital_marketing: group.digital_marketing || {},
      employability_portfolio: group.employability_portfolio || {},
      marketing_metrics: group.marketing_metrics || {},
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
  if (leaderboardFirestoreUnsub) {
    leaderboardFirestoreUnsub();
    leaderboardFirestoreUnsub = null;
  }
  if (adminUsersFirestoreUnsub) {
    adminUsersFirestoreUnsub();
    adminUsersFirestoreUnsub = null;
  }
  authToken = null;
  currentUser = null;
  localStorage.removeItem("edmg_token");
  localStorage.removeItem("edmg_user");
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
    if (IS_PURE_FIREBASE && window.firestoreDb) {
      // Find group where user is a member or creator
      let groupDoc = null;
      try {
        const q1 = await window.firestoreDb.collection("groups").where("member_user_ids", "array-contains", currentUser.id).limit(1).get();
        if (!q1.empty) {
          groupDoc = q1.docs[0];
        } else {
          // Fallback 1: check created_by
          const q2 = await window.firestoreDb.collection("groups").where("created_by", "==", currentUser.id).limit(1).get();
          if (!q2.empty) {
            groupDoc = q2.docs[0];
          } else {
            // Fallback 2: Check by user's full name in member_names array across existing groups
            const allSnap = await window.firestoreDb.collection("groups").get();
            const myNameLower = (currentUser.name || "").trim().toLowerCase();
            allSnap.forEach(doc => {
              if (groupDoc) return;
              const gData = doc.data();
              const mNames = (gData.member_names || []).map(m => m.trim().toLowerCase());
              if (mNames.includes(myNameLower)) {
                groupDoc = doc;
                // Auto-link user's UID to member_user_ids for future instant lookups
                const curMemberIds = gData.member_user_ids || [];
                if (!curMemberIds.includes(currentUser.id)) {
                  curMemberIds.push(currentUser.id);
                  doc.ref.update({ member_user_ids: curMemberIds }).catch(() => {});
                }
              }
            });
          }
        }
      } catch (e) {
        console.warn("Firestore find group notice:", e);
      }

      const noGroupState = document.getElementById("noGroupState");
      const hasGroupState = document.getElementById("hasGroupState");

      if (!groupDoc) {
        currentMyGroup = null;
        document.getElementById("studentGreetingName").textContent = currentUser.name;
        const allocStr = currentUser.department === "ECS"
          ? `${currentUser.department} • ${currentUser.student_class} • ${currentUser.division}`
          : `${currentUser.department} • ${currentUser.student_class} • ${currentUser.division} • ${currentUser.batch || 'Batch 1'}`;
        document.getElementById("studentGreetingAlloc").textContent = allocStr;
        
        if (document.getElementById("newGroupDept")) {
          document.getElementById("newGroupDept").value = currentUser.department;
          handleNewGroupDeptChange();
          document.getElementById("newGroupClass").value = currentUser.student_class;
          document.getElementById("newGroupDiv").value = currentUser.division;
          if (currentUser.department !== "ECS" && currentUser.batch) {
            document.getElementById("newGroupBatch").value = currentUser.batch;
          }
        }
        
        noGroupState.style.display = "block";
        hasGroupState.style.display = "none";
      } else {
        currentMyGroup = { id: groupDoc.id, ...groupDoc.data() };
        currentMyGroup.is_leader = (currentMyGroup.created_by === currentUser.id);
        noGroupState.style.display = "none";
        hasGroupState.style.display = "block";
        renderMyGroupDetails(currentMyGroup);
        listenToMyGroupFirestore(currentMyGroup.id);
      }
      return;
    }

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
      const allocStr = currentUser.department === "ECS"
        ? `${currentUser.department} • ${currentUser.student_class} • ${currentUser.division}`
        : `${currentUser.department} • ${currentUser.student_class} • ${currentUser.division} • ${currentUser.batch || 'Batch 1'}`;
      document.getElementById("studentGreetingAlloc").textContent = allocStr;
      
      // Pre-fill creation form fields from student registration
      if (document.getElementById("newGroupDept")) {
        document.getElementById("newGroupDept").value = currentUser.department;
        handleNewGroupDeptChange();
        document.getElementById("newGroupClass").value = currentUser.student_class;
        document.getElementById("newGroupDiv").value = currentUser.division;
        if (currentUser.department !== "ECS" && currentUser.batch) {
          document.getElementById("newGroupBatch").value = currentUser.batch;
        }
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
  const inviteCodeEl = document.getElementById("activeGroupInviteCode");
  if (inviteCodeEl) inviteCodeEl.textContent = group.invite_code || "";
  document.getElementById("activeGroupDept").textContent = group.department;
  document.getElementById("activeGroupClass").textContent = group.student_class;
  document.getElementById("activeGroupDiv").textContent = group.division;
  const batchEl = document.getElementById("activeGroupBatch");
  if (batchEl) {
    if (group.department === "ECS" || !group.batch || group.batch === "—") {
      batchEl.style.display = "none";
    } else {
      batchEl.style.display = "inline-block";
      batchEl.textContent = group.batch;
    }
  }

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
  renderStudentCustomerReviews(group);
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

  const isStep4Approved = currentMyGroup && currentMyGroup.step4_status === "approved";
  const addBtn = document.querySelector("button[onclick='addBudgetRow()']");
  const saveBtn = document.getElementById("saveBudgetBtn");
  if (addBtn) addBtn.disabled = isStep4Approved;
  if (saveBtn) {
    saveBtn.disabled = isStep4Approved;
    if (isStep4Approved) {
      saveBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Budget Finalized &amp; Locked`;
      saveBtn.style.opacity = "0.7";
      saveBtn.style.cursor = "not-allowed";
    }
  }

  tbody.innerHTML = "";
  currentBudgetItems.forEach((b, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <select ${isStep4Approved ? "disabled" : ""} onchange="updateBudgetItem(${idx}, 'category', this.value)">
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
        <input type="text" ${isStep4Approved ? "disabled" : ""} value="${escapeHtml(b.item || '')}" placeholder="Item description" oninput="updateBudgetItem(${idx}, 'item', this.value)">
      </td>
      <td>
        <input type="number" ${isStep4Approved ? "disabled" : ""} min="0" max="100000" step="500" value="${b.cost || 0}" placeholder="Cost in ₹" oninput="updateBudgetItem(${idx}, 'cost', parseFloat(this.value) || 0)">
      </td>
      <td>
        <input type="text" ${isStep4Approved ? "disabled" : ""} value="${escapeHtml(b.notes || '')}" placeholder="Spec / justification" oninput="updateBudgetItem(${idx}, 'notes', this.value)">
      </td>
      <td style="text-align: center;">
        ${isStep4Approved ? `<span style="color: var(--text-muted); font-size: 0.8rem;"><i class="fa-solid fa-lock"></i></span>` : `
          <button type="button" class="btn-icon" style="color: var(--danger);" onclick="removeBudgetRow(${idx})" title="Remove item">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        `}
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

    if (IS_PURE_FIREBASE && window.firestoreDb) {
      currentMyGroup.budget_items = currentBudgetItems;
      await window.firestoreDb.collection("groups").doc(currentMyGroup.id).update({
        budget_items: currentBudgetItems,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast("₹1,00,000 Budget allocation saved successfully!", "success");
      return;
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
  const isStep5Approved = currentMyGroup && currentMyGroup.step5_status === "approved";
  const pitchIds = ["pitchHook", "pitchProblem", "pitchUSP", "pitchMarket", "pitchModel", "pitchAsk", "pitchDeckUrl"];

  pitchIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = isStep5Approved;
  });

  const btn = document.getElementById("savePitchBtn");
  if (btn) {
    btn.disabled = isStep5Approved;
    if (isStep5Approved) {
      btn.innerHTML = `<i class="fa-solid fa-lock"></i> Pitch Strategy Finalized &amp; Locked`;
      btn.style.opacity = "0.7";
      btn.style.cursor = "not-allowed";
    }
  }

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

  const pitchData = {
    hook_tagline,
    problem_urgency,
    solution_usp,
    target_market_tam,
    business_model_monetization,
    ask_budget_milestone,
    pitch_deck_url
  };

  const btn = document.getElementById("savePitchBtn");
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
    }

    if (IS_PURE_FIREBASE && window.firestoreDb) {
      currentMyGroup.pitch_strategy = pitchData;
      await window.firestoreDb.collection("groups").doc(currentMyGroup.id).update({
        pitch_strategy: pitchData,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast("Pitching strategy framework saved!", "success");
      return;
    }

    const res = await fetch(`${API_BASE}/api/groups/${currentMyGroup.id}/pitch`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(pitchData)
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

    if (IS_PURE_FIREBASE && window.firestoreDb) {
      currentMyGroup.digital_marketing = payload;
      await window.firestoreDb.collection("groups").doc(currentMyGroup.id).update({
        digital_marketing: payload,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast("Digital Promotion Lab (Points 5-10) saved successfully!", "success");
      return;
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

    if (IS_PURE_FIREBASE && window.firestoreDb) {
      currentMyGroup.employability_portfolio = payload;
      await window.firestoreDb.collection("groups").doc(currentMyGroup.id).update({
        employability_portfolio: payload,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast("Analytics & Employability Portfolio (Points 11-12) saved!", "success");
      return;
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
          <div class="dossier-meta">${escapeHtml(g.department)} • ${escapeHtml(g.student_class)} • ${escapeHtml(g.division)}${(g.department !== "ECS" && g.batch && g.batch !== "—") ? ` • ${escapeHtml(g.batch)}` : ''}</div>
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

// Render Customer Reviews & Star Ratings in Student Dashboard
function renderStudentCustomerReviews(group) {
  const container = document.getElementById("studentReviewsListContainer");
  const countBadge = document.getElementById("reviewCountDisplay");
  const avgBadge = document.getElementById("avgRatingDisplay");
  if (!container) return;

  const revs = group.customer_reviews || [];
  const metrics = group.marketing_metrics || {};
  const avg = group.average_rating !== undefined ? group.average_rating : (metrics.average_rating || 5.0);

  if (countBadge) countBadge.textContent = revs.length;
  if (avgBadge) avgBadge.textContent = avg.toFixed(1);

  if (revs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 1.5rem; background: var(--bg-card); border-radius: 8px; color: var(--text-muted); border: 1px dashed var(--border-color);">
        <i class="fa-regular fa-comments" style="font-size: 1.75rem; margin-bottom: 0.5rem; color: #f59e0b;"></i>
        <p style="margin: 0; font-size: 0.9rem;">No customer reviews logged yet. Share your live product showcase link or log pilot user testimonials above!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 0.75rem;">
      ${revs.map(r => {
        const stars = "★".repeat(r.rating || 5) + "☆".repeat(5 - (r.rating || 5));
        return `
          <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.85rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                <strong style="font-size: 0.95rem; color: var(--text-main);">${escapeHtml(r.customer_name)}</strong>
                <span style="color: #f59e0b; font-size: 0.85rem;">${stars} (${r.rating}/5)</span>
              </div>
              <p style="margin: 0; font-size: 0.88rem; color: var(--text-secondary);">${escapeHtml(r.comment || '')}</p>
            </div>
            ${r.created_at ? `<small style="color: var(--text-muted); white-space: nowrap; font-size: 0.75rem;">${new Date(r.created_at).toLocaleDateString()}</small>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Handler for logging a customer review directly from the student dashboard
async function handleLogPilotReview(e) {
  e.preventDefault();
  if (!currentMyGroup) return;

  const name = document.getElementById("pilotCustName").value.trim();
  const rating = parseInt(document.getElementById("pilotCustRating").value);
  const comment = document.getElementById("pilotCustComment").value.trim();

  const revObj = {
    id: "rev_" + Date.now(),
    customer_name: name,
    rating: rating,
    comment: comment,
    created_at: new Date().toISOString()
  };

  try {
    if (IS_PURE_FIREBASE && window.firestoreDb) {
      const revs = currentMyGroup.customer_reviews || [];
      revs.unshift(revObj);
      const totalSum = revs.reduce((acc, r) => acc + (r.rating || 5), 0);
      const newAvg = roundTo1(totalSum / revs.length);

      await window.firestoreDb.collection("groups").doc(currentMyGroup.id).update({
        customer_reviews: revs,
        average_rating: newAvg,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      currentMyGroup.customer_reviews = revs;
      currentMyGroup.average_rating = newAvg;
      renderStudentCustomerReviews(currentMyGroup);
      showToast("Customer review recorded successfully!", "success");
      document.getElementById("pilotCustomerReviewForm").reset();
      return;
    }

    const res = await fetch(`${API_BASE}/api/groups/${currentMyGroup.id}/reviews`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ customer_name: name, rating, comment })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to log customer review");

    if (!currentMyGroup.customer_reviews) currentMyGroup.customer_reviews = [];
    currentMyGroup.customer_reviews.unshift(data.review || revObj);
    renderStudentCustomerReviews(currentMyGroup);
    showToast("Customer review recorded successfully!", "success");
    document.getElementById("pilotCustomerReviewForm").reset();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function roundTo1(val) {
  return Math.round(val * 10) / 10;
}

// Comprehensive Product Performance & Growth Potential Report
function exportProductPerformanceReport() {
  if (!currentMyGroup) return;
  const g = currentMyGroup;
  const mkt = g.digital_marketing || {};
  const metrics = g.marketing_metrics || {};
  const pitch = g.pitch_strategy || {};
  const reviews = g.customer_reviews || [];
  const score = g.score || {};

  const totalReviews = reviews.length;
  const avgRating = g.average_rating !== undefined ? g.average_rating : (metrics.average_rating || 5.0);

  // Compute Growth Potential Index (0-100)
  const reachScore = Math.min(25, (metrics.total_unique_views || 0) * 2.5);
  const ratingScore = (avgRating / 5.0) * 25;
  const milestonesScore = (['step1_status', 'step2_status', 'step3_status', 'step4_status', 'step5_status']
    .filter(s => g[s] === 'approved').length) * 5; // max 25
  const academicScore = ((score.total || 0) / 50.0) * 25;
  const growthIndex = Math.min(100, Math.round(reachScore + ratingScore + milestonesScore + academicScore));

  let growthTier = "High Market Growth Potential";
  let tierColor = "#10b981";
  if (growthIndex < 50) {
    growthTier = "Early Validation Phase";
    tierColor = "#f59e0b";
  } else if (growthIndex < 75) {
    growthTier = "Promising Commercial Traction";
    tierColor = "#3b82f6";
  }

  const printWin = window.open("", "_blank");
  if (!printWin) {
    showToast("Please allow popups to open the Product Performance Report.", "error");
    return;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(g.name)} - Product Performance & Growth Potential Report</title>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Plus Jakarta Sans', sans-serif; padding: 2.5rem; color: #0f172a; max-width: 950px; margin: 0 auto; line-height: 1.6; background: #ffffff; }
        .rep-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #10b981; padding-bottom: 1.5rem; margin-bottom: 2rem; }
        .rep-title { font-size: 2rem; font-weight: 800; color: #0f172a; margin: 0; }
        .rep-badge { display: inline-block; background: #ecfdf5; color: #065f46; font-size: 0.8rem; font-weight: 700; padding: 0.3rem 0.8rem; border-radius: 999px; margin-top: 0.5rem; border: 1px solid #a7f3d0; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-bottom: 1.5rem; }
        .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
        .metric-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; }
        .metric-num { font-size: 1.85rem; font-weight: 800; color: #0f172a; margin: 0.25rem 0; font-family: 'JetBrains Mono', monospace; }
        .metric-label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 700; }
        .growth-meter-box { background: linear-gradient(135deg, #0f172a, #1e293b); color: white; border-radius: 14px; padding: 1.75rem; margin-bottom: 2rem; }
        .growth-score { font-size: 3rem; font-weight: 800; color: #34d399; font-family: 'JetBrains Mono', monospace; line-height: 1; }
        .progress-bar-wrap { background: #334155; border-radius: 999px; height: 12px; overflow: hidden; margin: 1rem 0; }
        .progress-bar-fill { background: linear-gradient(90deg, #10b981, #38bdf8); height: 100%; width: ${growthIndex}%; }
        .section-box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 1.5rem; margin-bottom: 1.5rem; background: #ffffff; }
        .section-box h3 { margin-top: 0; font-size: 1.15rem; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; margin-bottom: 1rem; }
        table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        th, td { border: 1px solid #cbd5e1; padding: 0.6rem 0.85rem; text-align: left; }
        th { background: #f1f5f9; font-weight: 700; }
        .review-quote { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 0.75rem 1rem; margin-bottom: 0.75rem; border-radius: 0 8px 8px 0; }
        @media print { .no-print { display: none; } body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 1.5rem; text-align: right;">
        <button onclick="window.print()" style="padding: 0.75rem 1.5rem; background: #10b981; color: white; border: none; border-radius: 8px; font-weight: 800; cursor: pointer; font-size: 0.95rem;">
          Print / Download Executive PDF Report
        </button>
      </div>

      <div class="rep-header">
        <div>
          <span style="font-size: 0.8rem; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em;">Product Performance &amp; Commercial Growth Dossier</span>
          <h1 class="rep-title">${escapeHtml(g.name)}</h1>
          <div style="font-size: 0.9rem; color: #475569; margin-top: 0.35rem;">
            Group ID: <strong>${escapeHtml(g.id)}</strong> • ${escapeHtml(g.department)} • ${escapeHtml(g.student_class)} • ${escapeHtml(g.division)}${(g.department !== "ECS" && g.batch && g.batch !== "—") ? ` • ${escapeHtml(g.batch)}` : ''}
          </div>
        </div>
        <div style="text-align: right;">
          <span class="rep-badge">Verified E&amp;DM Capstone Venture</span>
          <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.5rem;">Group Leader: ${escapeHtml(g.creator_name)}</div>
        </div>
      </div>

      <!-- Growth Potential Meter -->
      <div class="growth-meter-box">
        <div style="display: flex; justify-content: space-between; align-items: flex-end;">
          <div>
            <span style="text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.1em; color: #94a3b8;">Commercial Scalability Index</span>
            <div class="growth-score">${growthIndex} <span style="font-size: 1.5rem; color: #cbd5e1;">/ 100</span></div>
          </div>
          <div style="text-align: right;">
            <span style="background: ${tierColor}; color: white; padding: 0.35rem 0.85rem; border-radius: 999px; font-weight: 800; font-size: 0.85rem;">
              ${growthTier}
            </span>
          </div>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill"></div>
        </div>
        <p style="margin: 0; font-size: 0.85rem; color: #94a3b8;">Calculated live across deduplicated marketing reach, authentic customer reviews, approved curriculum milestones, and academic rubric evaluation.</p>
      </div>

      <!-- Real-Time Traction & Audience Reach -->
      <div class="grid-3">
        <div class="metric-card">
          <span class="metric-label">Deduplicated People Reached</span>
          <div class="metric-num">${(metrics.total_unique_views || 0).toLocaleString()}</div>
          <small style="color: #64748b;">Unique Viewers</small>
        </div>
        <div class="metric-card">
          <span class="metric-label">Customer Star Rating</span>
          <div class="metric-num" style="color: #f59e0b;">★ ${avgRating.toFixed(1)} <small style="font-size: 0.9rem; color: #64748b;">/ 5.0</small></div>
          <small style="color: #64748b;">Based on ${totalReviews} Customer Reviews</small>
        </div>
        <div class="metric-card">
          <span class="metric-label">Total Marketing Clicks</span>
          <div class="metric-num">${(metrics.total_raw_clicks || 0).toLocaleString()}</div>
          <small style="color: #64748b;">${metrics.engagement_rate || 0}% Engagement Ratio</small>
        </div>
      </div>

      <!-- Channel Breakdown -->
      <div class="section-box">
        <h3>1. Digital Acquisition &amp; Multi-Channel Distribution</h3>
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Attribution Channel Type</th>
              <th>Unique People Reached</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>WhatsApp Viral Distribution</strong></td>
              <td>Peer-to-Peer Outreach</td>
              <td>${metrics.whatsapp_unique || 0}</td>
            </tr>
            <tr>
              <td><strong>Telegram Tech Channels</strong></td>
              <td>Developer &amp; Hardware Communities</td>
              <td>${metrics.telegram_unique || 0}</td>
            </tr>
            <tr>
              <td><strong>LinkedIn &amp; Direct Links</strong></td>
              <td>B2B Industry &amp; Faculty Outreach</td>
              <td>${(metrics.linkedin_unique || 0) + (metrics.direct_unique || 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Customer Reviews & Testimonials -->
      <div class="section-box">
        <h3>2. Authenticated Customer Feedback &amp; Product Testimonials (${totalReviews} Reviews)</h3>
        ${reviews.length === 0 ? '<p style="color: #64748b; font-style: italic;">No customer reviews recorded yet.</p>' : reviews.map(r => `
          <div class="review-quote">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
              <strong>${escapeHtml(r.customer_name)}</strong>
              <span style="color: #d97706; font-weight: bold;">${"★".repeat(r.rating || 5)}${"☆".repeat(5 - (r.rating || 5))} (${r.rating}/5)</span>
            </div>
            <div style="font-size: 0.9rem; color: #334155;">"${escapeHtml(r.comment || '')}"</div>
          </div>
        `).join('')}
      </div>

      <!-- Milestone Approval & Academic Scorecard -->
      <div class="section-box">
        <h3>3. 5-Step Academic Rubric Assessment</h3>
        <table>
          <thead>
            <tr>
              <th>Step Milestone</th>
              <th>Approval Status</th>
              <th>Marks Awarded</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Step 1: Problem Statement &amp; Need</td><td>${g.step1_status === 'approved' ? 'Approved' : 'Pending'}</td><td><strong>${g.step1_score !== undefined ? g.step1_score : (score.step1_score || 0)} / 10</strong></td></tr>
            <tr><td>Step 2: Market Research &amp; TAM Validation</td><td>${g.step2_status === 'approved' ? 'Approved' : 'Pending'}</td><td><strong>${g.step2_score !== undefined ? g.step2_score : (score.step2_score || 0)} / 10</strong></td></tr>
            <tr><td>Step 3: Innovative Solution &amp; Prototype</td><td>${g.step3_status === 'approved' ? 'Approved' : 'Pending'}</td><td><strong>${g.step3_score !== undefined ? g.step3_score : (score.step3_score || 0)} / 10</strong></td></tr>
            <tr><td>Step 4: Feasibility &amp; Business Model</td><td>${g.step4_status === 'approved' ? 'Approved' : 'Pending'}</td><td><strong>${g.step4_score !== undefined ? g.step4_score : (score.step4_score || 0)} / 10</strong></td></tr>
            <tr><td>Step 5: Digital Marketing &amp; Pitch Deck</td><td>${g.step5_status === 'approved' ? 'Approved' : 'Pending'}</td><td><strong>${g.step5_score !== undefined ? g.step5_score : (score.step5_score || 0)} / 10</strong></td></tr>
            <tr style="background: #f8fafc;"><td><strong>Total Capstone Evaluation</strong></td><td><strong>${score.total ? 'Evaluated' : 'In Progress'}</strong></td><td><strong style="color: #10b981; font-size: 1.05rem;">${score.total || 0} / 50 Pts</strong></td></tr>
          </tbody>
        </table>
      </div>

      <!-- Growth Potential Analysis -->
      <div class="section-box">
        <h3>4. Venture Growth Potential &amp; Scalability Assessment</h3>
        <p><strong>Value Proposition:</strong> ${escapeHtml(pitch.hook_tagline || g.step1_problem_statement || 'High-performance engineering capstone.')}</p>
        <p><strong>Target Customer Persona:</strong> ${escapeHtml(mkt.buyer_persona || pitch.target_audience || 'Engineering and enterprise pilot clients.')}</p>
        <p><strong>Revenue Model:</strong> ${escapeHtml(pitch.revenue_stream || g.step4_feasibility_business_model || 'Subscription / Commercial MVP unit deployment.')}</p>
        <p><strong>Growth Summary:</strong> Team demonstrates validated customer feedback with a <strong>${avgRating.toFixed(1)}/5.0</strong> satisfaction score, disciplined milestone completions, and strong employability readiness.</p>
      </div>

      <div style="text-align: center; margin-top: 2.5rem; font-size: 0.8rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
        Official Record • Department of Entrepreneurship &amp; Digital Marketing • Third Year (TE) Academic Cohort
      </div>
    </body>
    </html>
  `;

  printWin.document.open();
  printWin.document.write(html);
  printWin.document.close();
}

// ----------------- Certificate Generation Feature -----------------
let currentCertificateData = null;

function openCertificateModalForGroup(groupId, memberName) {
  const g = allAdminGroups.find(group => group.id === groupId) || currentMyGroup;
  if (!g) {
    showToast("Group details not found.", "error");
    return;
  }

  const score = g.score || {};
  const totalScore = score.total || 0;
  const metrics = g.marketing_metrics || {};

  currentCertificateData = {
    studentName: memberName,
    projectName: g.name,
    groupId: g.id,
    department: g.department,
    studentClass: g.student_class || "Third Year",
    division: g.division,
    batch: g.batch,
    totalScore: totalScore,
    facultyName: currentUser ? currentUser.name : "Course Coordinator",
    issueDate: new Date().toLocaleDateString("en-IN", { day: 'numeric', month: 'long', year: 'numeric' })
  };

  const container = document.getElementById("certificateContainer");
  if (!container) return;

  container.innerHTML = `
    <div class="official-certificate-sheet" id="officialCertificateSheet">
      <div class="cert-outer-border">
        <div class="cert-inner-border">
          <div class="cert-corner tl"></div>
          <div class="cert-corner tr"></div>
          <div class="cert-corner bl"></div>
          <div class="cert-corner br"></div>

          <div class="cert-header">
            <div class="cert-institution-badge">DEPARTMENT OF ENTREPRENEURSHIP &amp; DIGITAL MARKETING</div>
            <h1 class="cert-title">Certificate of Excellence</h1>
            <div class="cert-subtitle">CAPSTONE ENGINEERING &amp; DIGITAL VENTURE ACCREDITATION</div>
          </div>

          <div class="cert-body">
            <p class="cert-text-lead">This is proudly presented to</p>
            <h2 class="cert-student-name">${escapeHtml(currentCertificateData.studentName)}</h2>
            <p class="cert-paragraph">
              of <strong>${escapeHtml(currentCertificateData.department)} Engineering</strong> (${escapeHtml(currentCertificateData.studentClass)}${currentCertificateData.division !== '—' ? ` • ${escapeHtml(currentCertificateData.division)}` : ''}${currentCertificateData.batch && currentCertificateData.batch !== '—' ? ` • ${escapeHtml(currentCertificateData.batch)}` : ''})
              for outstanding capstone execution and commercialization of the project:
            </p>
            <h3 class="cert-project-title">"${escapeHtml(currentCertificateData.projectName)}"</h3>
            <p class="cert-skills-list">
              Demonstrated verified mastery in <strong>Problem Discovery</strong>, <strong>Market Validation</strong>, 
              <strong>Rapid Prototyping</strong>, <strong>Unit Economics Modeling</strong>, and <strong>Multi-Channel Digital Marketing</strong>.
            </p>

            <div class="cert-score-pill">
              Academic Assessment Score: <strong>${currentCertificateData.totalScore} / 50 Points</strong> • Project ID: <strong>${escapeHtml(currentCertificateData.groupId)}</strong>
            </div>
          </div>

          <div class="cert-footer">
            <div class="cert-signature-block">
              <div class="cert-sig-line"></div>
              <span class="cert-sig-name">${escapeHtml(currentCertificateData.facultyName)}</span>
              <span class="cert-sig-title">Faculty Evaluator / Course In-Charge</span>
            </div>

            <div class="cert-seal-wrap">
              <div class="cert-gold-seal">
                <i class="fa-solid fa-award"></i>
                <span>VERIFIED RECORD</span>
              </div>
            </div>

            <div class="cert-signature-block">
              <div class="cert-sig-line"></div>
              <span class="cert-sig-name">Dean / Academic Head</span>
              <span class="cert-sig-title">Date: ${currentCertificateData.issueDate}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const modal = document.getElementById("certificateModal");
  if (modal) modal.style.display = "flex";
}

function closeCertificateModal() {
  const modal = document.getElementById("certificateModal");
  if (modal) modal.style.display = "none";
}

function printOfficialCertificate() {
  if (!currentCertificateData) return;
  const d = currentCertificateData;

  const printWin = window.open("", "_blank");
  if (!printWin) {
    showToast("Please allow popups to print certificate.", "error");
    return;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Certificate - ${escapeHtml(d.studentName)} - ${escapeHtml(d.projectName)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;800;900&family=Plus+Jakarta+Sans:wght@400;600;700&family=Pinyon+Script&display=swap" rel="stylesheet">
      <style>
        @page { size: landscape; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 2rem; background: #fdfbf7; font-family: 'Plus Jakarta Sans', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .cert-outer-border { width: 1000px; height: 680px; padding: 18px; border: 8px solid #b45309; background: #fffdfa; box-shadow: 0 10px 30px rgba(0,0,0,0.15); position: relative; }
        .cert-inner-border { width: 100%; height: 100%; border: 2px solid #d97706; padding: 2rem 2.5rem; text-align: center; position: relative; display: flex; flex-direction: column; justify-content: space-between; }
        .cert-institution-badge { font-family: 'Cinzel', serif; font-size: 0.95rem; font-weight: 800; letter-spacing: 0.18em; color: #92400e; margin-bottom: 0.5rem; }
        .cert-title { font-family: 'Cinzel', serif; font-size: 2.5rem; font-weight: 900; color: #1e293b; letter-spacing: 0.08em; margin: 0 0 0.35rem 0; text-transform: uppercase; }
        .cert-subtitle { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.15em; color: #64748b; text-transform: uppercase; }
        .cert-text-lead { font-size: 1.05rem; color: #64748b; margin: 1rem 0 0.25rem 0; font-style: italic; }
        .cert-student-name { font-family: 'Cinzel', serif; font-size: 2.2rem; font-weight: 900; color: #b45309; margin: 0.25rem 0 0.75rem 0; border-bottom: 2px solid #fde68a; display: inline-block; padding: 0 2rem 0.25rem 2rem; }
        .cert-paragraph { font-size: 0.95rem; color: #334155; line-height: 1.6; max-width: 800px; margin: 0 auto; }
        .cert-project-title { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0.5rem 0; }
        .cert-skills-list { font-size: 0.85rem; color: #475569; margin: 0.25rem 0 0.75rem 0; }
        .cert-score-pill { display: inline-block; background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 0.35rem 1rem; border-radius: 999px; font-weight: 700; font-size: 0.85rem; }
        .cert-footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 1rem; }
        .cert-signature-block { width: 230px; text-align: center; }
        .cert-sig-line { border-bottom: 1.5px solid #0f172a; margin-bottom: 0.35rem; }
        .cert-sig-name { font-weight: 800; font-size: 0.9rem; color: #0f172a; display: block; }
        .cert-sig-title { font-size: 0.75rem; color: #64748b; display: block; }
        .cert-gold-seal { width: 90px; height: 90px; border-radius: 50%; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; display: flex; flex-direction: column; justify-content: center; align-items: center; font-size: 0.65rem; font-weight: 800; box-shadow: 0 4px 10px rgba(217, 119, 6, 0.4); border: 3px dashed #fef3c7; margin: 0 auto; }
        @media print { body { padding: 0; background: white; } .cert-outer-border { box-shadow: none; border-color: #b45309; } }
      </style>
    </head>
    <body onload="window.print()">
      <div class="cert-outer-border">
        <div class="cert-inner-border">
          <div>
            <div class="cert-institution-badge">DEPARTMENT OF ENTREPRENEURSHIP &amp; DIGITAL MARKETING</div>
            <h1 class="cert-title">Certificate of Excellence</h1>
            <div class="cert-subtitle">CAPSTONE ENGINEERING &amp; DIGITAL VENTURE ACCREDITATION</div>
          </div>

          <div>
            <p class="cert-text-lead">This is proudly awarded to</p>
            <h2 class="cert-student-name">${escapeHtml(d.studentName)}</h2>
            <p class="cert-paragraph">
              of <strong>${escapeHtml(d.department)} Engineering</strong> (${escapeHtml(d.studentClass)}${d.division !== '—' ? ` • ${escapeHtml(d.division)}` : ''}${d.batch && d.batch !== '—' ? ` • ${escapeHtml(d.batch)}` : ''})
              for outstanding engineering diligence and commercialization execution of capstone project:
            </p>
            <h3 class="cert-project-title">"${escapeHtml(d.projectName)}"</h3>
            <p class="cert-skills-list">
              Verified Competencies: <strong>Problem Validation</strong> • <strong>Prototype Engineering</strong> • <strong>Unit Economics</strong> • <strong>Paid &amp; Organic Digital Acquisition</strong>
            </p>
            <div class="cert-score-pill">
              Academic Evaluation Score: <strong>${d.totalScore} / 50 Points</strong> • Project ID: <strong>${escapeHtml(d.groupId)}</strong>
            </div>
          </div>

          <div class="cert-footer">
            <div class="cert-signature-block">
              <div class="cert-sig-line"></div>
              <span class="cert-sig-name">${escapeHtml(d.facultyName)}</span>
              <span class="cert-sig-title">Faculty Evaluator / Course Lead</span>
            </div>

            <div class="cert-seal-wrap">
              <div class="cert-gold-seal">
                <span style="font-size: 1.1rem; line-height: 1;">★</span>
                <span>OFFICIAL</span>
                <span>SEAL</span>
              </div>
            </div>

            <div class="cert-signature-block">
              <div class="cert-sig-line"></div>
              <span class="cert-sig-name">Dean of Academics</span>
              <span class="cert-sig-title">Date: ${d.issueDate}</span>
            </div>
          </div>
        </div>
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

  const s1 = score.step1_score !== undefined ? score.step1_score : (score.innovation ? Math.round(score.innovation * 10 / 15) : 0);
  const s2 = score.step2_score !== undefined ? score.step2_score : (score.feasibility || 0);
  const s3 = score.step3_score !== undefined ? score.step3_score : (score.solution ? Math.round(score.solution * 10 / 15) : 0);
  const s4 = score.step4_score !== undefined ? score.step4_score : (score.presentation ? Math.round(score.presentation / 2) : 0);
  const s5 = score.step5_score !== undefined ? score.step5_score : (score.presentation ? Math.round(score.presentation / 2) : 0);

  container.innerHTML = `
    <div class="marks-card">
      <div class="marks-awarded-container">
        <div class="marks-header-row">
          <div>
            <span class="role-tag">FACULTY RUBRIC EVALUATION</span>
            <h3 style="font-weight: 800; font-size: 1.15rem;">5-Step Milestone Assessment Marks</h3>
          </div>
          <div class="marks-total-badge">
            ${score.total} <small>/ 50 Pts</small>
          </div>
        </div>

        <div class="criteria-grid" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));">
          <div class="criteria-cell">
            <span class="c-label">Step 1: Need</span>
            <span class="c-score">${s1}</span>
            <span class="c-max">/ 10</span>
          </div>
          <div class="criteria-cell">
            <span class="c-label">Step 2: Market</span>
            <span class="c-score">${s2}</span>
            <span class="c-max">/ 10</span>
          </div>
          <div class="criteria-cell">
            <span class="c-label">Step 3: Solution</span>
            <span class="c-score">${s3}</span>
            <span class="c-max">/ 10</span>
          </div>
          <div class="criteria-cell">
            <span class="c-label">Step 4: Business</span>
            <span class="c-score">${s4}</span>
            <span class="c-max">/ 10</span>
          </div>
          <div class="criteria-cell">
            <span class="c-label">Step 5: Marketing</span>
            <span class="c-score">${s5}</span>
            <span class="c-max">/ 10</span>
          </div>
        </div>

        ${score.remarks ? `
          <div class="remarks-quote-box" style="margin-top: 1rem;">
            <strong>Faculty Remarks:</strong> "${escapeHtml(score.remarks)}"
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function generateRandomInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function handleCreateGroup(e) {
  e.preventDefault();
  const name = document.getElementById("newGroupName").value.trim();
  const department = document.getElementById("newGroupDept").value;
  const student_class = document.getElementById("newGroupClass").value;
  const division = department === "Instrumentation" ? "—" : (document.getElementById("newGroupDiv") ? document.getElementById("newGroupDiv").value : "—");
  const rawBatch = document.getElementById("newGroupBatch") ? document.getElementById("newGroupBatch").value : "—";
  const batch = department === "ECS" ? "—" : rawBatch;
  const rawMembers = document.getElementById("newMemberNames").value;
  const member_names = rawMembers.split(",").map(s => s.trim()).filter(Boolean);

  if (!member_names.includes(currentUser.name)) {
    member_names.unshift(currentUser.name);
  }

  try {
    if (IS_PURE_FIREBASE && window.firestoreDb) {
      // 1. Verify if user or any member is already in a group
      const existingSnap = await window.firestoreDb.collection("groups").get();
      existingSnap.forEach(doc => {
        const g = doc.data();
        const memberIds = g.member_user_ids || [];
        const memberNames = (g.member_names || []).map(m => m.toLowerCase());
        
        if (memberIds.includes(currentUser.id)) {
          throw new Error("You are already in a group.");
        }
        for (const m of member_names) {
          if (memberNames.includes(m.toLowerCase())) {
            if (m.toLowerCase() === currentUser.name.toLowerCase()) {
              throw new Error("You are already in a group.");
            } else {
              throw new Error(`Member "${m}" is already in a group (${g.name}).`);
            }
          }
        }
      });

      const invite_code = generateRandomInviteCode();
      const groupId = "GRP-" + Math.random().toString(36).substring(2, 7).toUpperCase();

      const groupPayload = {
        id: groupId,
        name: name,
        department: department,
        student_class: student_class,
        division: division,
        batch: batch,
        invite_code: invite_code,
        created_by: currentUser.id,
        creator_name: currentUser.name,
        member_names: member_names,
        member_user_ids: [currentUser.id],
        step1_problem_statement: "",
        step2_market_research: "",
        step3_innovative_solution: "",
        step4_feasibility_business_model: "",
        step5_marketing_presentation: "",
        step1_status: "pending",
        step2_status: "pending",
        step3_status: "pending",
        step4_status: "pending",
        step5_status: "pending",
        step1_score: 0,
        step2_score: 0,
        step3_score: 0,
        step4_score: 0,
        step5_score: 0,
        step1_remarks: "",
        step2_remarks: "",
        step3_remarks: "",
        step4_remarks: "",
        step5_remarks: "",
        budget_items: [],
        pitch_strategy: {},
        digital_marketing: {},
        employability_portfolio: {},
        customer_reviews: [],
        average_rating: 5.0,
        marketing_metrics: {
          total_unique_views: 0,
          total_raw_clicks: 0,
          whatsapp_unique: 0,
          telegram_unique: 0,
          linkedin_unique: 0,
          engagement_rate: 0,
          total_reviews: 0,
          average_rating: 5.0
        },
        score: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      await window.firestoreDb.collection("groups").doc(groupId).set(groupPayload);
      showToast(`Group registered successfully! Assigned Group ID: ${groupId}`, "success");
      await loadMyGroup();
      return;
    }

    const res = await fetch(`${API_BASE}/api/groups`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name, department, student_class, division, batch, member_names })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to create group");

    const assignedId = data.group ? data.group.id : "Registered";
    showToast(`Group registered successfully! Assigned Group ID: ${assignedId}`, "success");
    loadMyGroup();
    if (data.group) syncGroupToFirestore(data.group);
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleJoinGroup(e) {
  e.preventDefault();
  const invite_code = document.getElementById("joinInviteCode").value.trim().toUpperCase();

  try {
    if (IS_PURE_FIREBASE && window.firestoreDb) {
      const q = await window.firestoreDb.collection("groups").where("invite_code", "==", invite_code).limit(1).get();
      if (q.empty) {
        throw new Error("Invalid invite code. No matching group found.");
      }
      const targetDoc = q.docs[0];
      const targetData = targetDoc.data();

      const memberIds = targetData.member_user_ids || [];
      const memberNames = targetData.member_names || [];

      if (!memberIds.includes(currentUser.id)) memberIds.push(currentUser.id);
      if (!memberNames.includes(currentUser.name)) memberNames.push(currentUser.name);

      await window.firestoreDb.collection("groups").doc(targetDoc.id).update({
        member_user_ids: memberIds,
        member_names: memberNames,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      showToast("Successfully joined team project!", "success");
      await loadMyGroup();
      return;
    }

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

    if (IS_PURE_FIREBASE && window.firestoreDb) {
      const updateData = {
        member_names: member_names,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (currentMyGroup.step1_status !== "approved") {
        updateData.step1_problem_statement = step1_problem_statement;
        currentMyGroup.step1_problem_statement = step1_problem_statement;
      }
      if (currentMyGroup.step2_status !== "approved") {
        updateData.step2_market_research = step2_market_research;
        currentMyGroup.step2_market_research = step2_market_research;
      }
      if (currentMyGroup.step3_status !== "approved") {
        updateData.step3_innovative_solution = step3_innovative_solution;
        currentMyGroup.step3_innovative_solution = step3_innovative_solution;
      }
      if (currentMyGroup.step4_status !== "approved") {
        updateData.step4_feasibility_business_model = step4_feasibility_business_model;
        currentMyGroup.step4_feasibility_business_model = step4_feasibility_business_model;
      }
      if (currentMyGroup.step5_status !== "approved") {
        updateData.step5_marketing_presentation = step5_marketing_presentation;
        currentMyGroup.step5_marketing_presentation = step5_marketing_presentation;
      }
      currentMyGroup.member_names = member_names;

      await window.firestoreDb.collection("groups").doc(currentMyGroup.id).update(updateData);
      renderMyGroupDetails(currentMyGroup);
      showToast("All 5 project steps saved successfully!", "success");
      document.getElementById("lastSavedTime").textContent = `Last saved at ${new Date().toLocaleTimeString()}`;
      return;
    }

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
  const rawDiv = document.getElementById("filterDiv").value;
  const rawBatch = document.getElementById("filterBatch").value;
  
  // Instrumentation has no divisions; ECS has no batches
  const div = dept === "Instrumentation" ? "All" : rawDiv;
  const batch = dept === "ECS" ? "All" : rawBatch;

  const divSelect = document.getElementById("filterDiv");
  if (divSelect) {
    if (dept === "Instrumentation") {
      divSelect.disabled = true;
      divSelect.title = "No divisions in Instrumentation department (Batches B1 and B2 only)";
    } else {
      divSelect.disabled = false;
      divSelect.title = "";
    }
  }

  const batchSelect = document.getElementById("filterBatch");
  if (batchSelect) {
    if (dept === "ECS") {
      batchSelect.disabled = true;
      batchSelect.title = "No batches in ECS department (Divisions A and B only)";
    } else {
      batchSelect.disabled = false;
      batchSelect.title = "";
    }
  }

  let totalAllGroupsList = [];

  if (IS_PURE_FIREBASE && window.firestoreDb) {
    try {
      // 1. Fetch total registered groups across all departments to maintain global counts
      const allDocsSnap = await window.firestoreDb.collection("groups").get();
      const allDedupeMap = new Map();
      allDocsSnap.forEach(doc => {
        const d = doc.data();
        const gid = doc.id;
        const normKey = (d.name && d.department) 
          ? `${d.name.trim().toLowerCase()}::${d.department}::${d.student_class}::${d.division}` 
          : gid;
        if (!allDedupeMap.has(normKey)) {
          allDedupeMap.set(normKey, { id: gid, ...d });
        }
      });
      totalAllGroupsList = Array.from(allDedupeMap.values());

      // 2. Filter in-memory using active faculty dropdowns
      const filteredGroups = totalAllGroupsList.filter(g => {
        if (dept !== "All" && g.department !== dept) return false;
        if (cls !== "All" && g.student_class !== cls) return false;
        if (div !== "All" && g.division !== div) return false;
        if (batch !== "All" && g.batch !== batch) return false;
        return true;
      });

      allAdminGroups = filteredGroups;
      updateFacultyGroupCounters(totalAllGroupsList, filteredGroups);
      renderAdminGroups(allAdminGroups);

      if (!adminGroupsFirestoreUnsub) {
        listenToFacultyGroupsFirestore();
      }

      if (showToastNotice) {
        showToast("Groups reloaded from Firestore.", "info");
      }
    } catch (err) {
      showToast("Error loading groups: " + err.message, "error");
    }
    return;
  }

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
    
    // Deduplicate fetched groups by ID or Name/Dept
    const groupsMap = new Map();
    (fetchedGroups || []).forEach(g => {
      const normKey = (g.name && g.department)
        ? `${g.name.trim().toLowerCase()}::${g.department}::${g.student_class}::${g.division}`
        : g.id;
      if (!groupsMap.has(normKey)) {
        groupsMap.set(normKey, g);
      }
    });
    const uniqueGroups = Array.from(groupsMap.values());
    const fetchedJson = JSON.stringify(uniqueGroups);

    // Only re-render DOM if the data actually changed or if user explicitly requested reload
    if (showToastNotice || fetchedJson !== lastAdminGroupsJson) {
      lastAdminGroupsJson = fetchedJson;
      allAdminGroups = uniqueGroups;
      updateFacultyGroupCounters(allAdminGroups, allAdminGroups);
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

// Update Faculty Group Statistics Widgets (Total and per-department)
function updateFacultyGroupCounters(allGroups, filteredList) {
  const list = allGroups || [];
  const currentList = filteredList || allAdminGroups || [];

  const total = list.length;
  const ecsCount = list.filter(g => (g.department || "").toUpperCase() === "ECS").length;
  const instCount = list.filter(g => (g.department || "").toLowerCase().includes("instrumentation")).length;

  const totalEl = document.getElementById("statTotalGroupsCount");
  const ecsEl = document.getElementById("statEcsGroupsCount");
  const instEl = document.getElementById("statInstGroupsCount");
  const filteredEl = document.getElementById("statFilteredGroupsCount");
  const descEl = document.getElementById("statFilteredDeptDesc");

  if (totalEl) totalEl.textContent = total.toLocaleString();
  if (ecsEl) ecsEl.textContent = ecsCount.toLocaleString();
  if (instEl) instEl.textContent = instCount.toLocaleString();
  if (filteredEl) filteredEl.textContent = currentList.length.toLocaleString();

  if (descEl) {
    const deptVal = document.getElementById("filterDept")?.value || "All";
    const divVal = document.getElementById("filterDiv")?.value || "All";
    const batchVal = document.getElementById("filterBatch")?.value || "All";
    
    let parts = [];
    if (deptVal !== "All") parts.push(deptVal);
    if (divVal !== "All") parts.push(divVal);
    if (batchVal !== "All") parts.push(batchVal);
    
    descEl.textContent = parts.length > 0 ? `Filtered by: ${parts.join(" • ")}` : "All registered groups shown";
  }
}

// 1-Click quick filter by clicking stat cards
function setFacultyDeptFilter(dept) {
  const deptSelect = document.getElementById("filterDept");
  if (!deptSelect) return;
  deptSelect.value = dept;
  loadAdminGroups();
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
              ${(g.department !== "ECS" && g.batch && g.batch !== "—") ? `<span class="badge-batch">${g.batch}</span>` : ''}
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
            <button type="button" class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openEditGroupModal('${g.id}')" title="Edit Group Name &amp; Members" style="color: var(--primary); border-color: var(--primary);">
              <i class="fa-solid fa-pen-to-square"></i> Edit Group
            </button>
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

          <!-- Certificate Generation Section for Faculty -->
          <div class="card" style="margin-top: 1rem; background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 1rem; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
              <h4 style="margin: 0; font-size: 0.95rem; color: #d97706;"><i class="fa-solid fa-award"></i> Issue Student Performance &amp; Skills Certificates</h4>
              <small style="color: var(--text-muted);">Generate verifiable completion certificate for individual members</small>
            </div>
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              ${(g.member_names || []).map(m => `
                <button type="button" class="btn btn-sm btn-outline" style="border-color: #f59e0b; color: #b45309;" onclick="openCertificateModalForGroup('${g.id}', '${escapeHtml(m).replace(/'/g, "\\'")}')">
                  <i class="fa-solid fa-certificate"></i> Certify ${escapeHtml(m)}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Budget & Pitch Strategy Overview for Faculty -->
          ${renderAdminBudgetAndPitchSummary(g)}

          <!-- Per-Step Inline Scoring UI (Each Step: 0 to 10 Pts, Total: 50 Pts) -->
          <form class="scoring-form" onsubmit="handleSaveScore(event, '${g.id}')">
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 0.85rem; font-weight: 700; color: var(--primary); text-transform: uppercase;">
                <i class="fa-solid fa-pen-ruler"></i> Faculty Per-Step Marking Schema (0-10 Pts per Step)
              </span>
              <small style="color: var(--text-muted);">Enter marks earned for each validated milestone</small>
            </div>
            <div class="scoring-grid" style="grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));">
              <div class="score-col">
                <label for="s1-${g.id}">Step 1 (/10)</label>
                <input type="number" id="s1-${g.id}" min="0" max="10" value="${s.step1_score !== undefined ? s.step1_score : (s.innovation ? Math.round(s.innovation * 10 / 15) : 0)}" required oninput="recalcInlineTotal('${g.id}')">
              </div>
              <div class="score-col">
                <label for="s2-${g.id}">Step 2 (/10)</label>
                <input type="number" id="s2-${g.id}" min="0" max="10" value="${s.step2_score !== undefined ? s.step2_score : (s.feasibility || 0)}" required oninput="recalcInlineTotal('${g.id}')">
              </div>
              <div class="score-col">
                <label for="s3-${g.id}">Step 3 (/10)</label>
                <input type="number" id="s3-${g.id}" min="0" max="10" value="${s.step3_score !== undefined ? s.step3_score : (s.solution ? Math.round(s.solution * 10 / 15) : 0)}" required oninput="recalcInlineTotal('${g.id}')">
              </div>
              <div class="score-col">
                <label for="s4-${g.id}">Step 4 (/10)</label>
                <input type="number" id="s4-${g.id}" min="0" max="10" value="${s.step4_score !== undefined ? s.step4_score : (s.presentation ? Math.round(s.presentation / 2) : 0)}" required oninput="recalcInlineTotal('${g.id}')">
              </div>
              <div class="score-col">
                <label for="s5-${g.id}">Step 5 (/10)</label>
                <input type="number" id="s5-${g.id}" min="0" max="10" value="${s.step5_score !== undefined ? s.step5_score : (s.presentation ? Math.round(s.presentation / 2) : 0)}" required oninput="recalcInlineTotal('${g.id}')">
              </div>
              <div class="score-total-display">
                <span class="st-label">Total / 50</span>
                <span class="st-num" id="total-${g.id}">${s.total}</span>
              </div>
            </div>

            <div class="scoring-footer">
              <input type="text" id="remarks-${g.id}" placeholder="Faculty evaluation remarks & feedback..." value="${escapeHtml(s.remarks || '')}">
              <button type="submit" class="btn btn-primary btn-sm" id="btn-score-${g.id}">
                <i class="fa-solid fa-check"></i> Save Step Marks
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
    if (IS_PURE_FIREBASE && window.firestoreDb) {
      const updateData = {
        [`step${stepNum}_status`]: statusVal,
        [`step${stepNum}_remarks`]: remarks,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await window.firestoreDb.collection("groups").doc(groupId).update(updateData);
      showToast(`Step ${stepNum} set to '${statusVal.toUpperCase()}'!`, "success");
      await loadAdminGroups(false);
      return;
    }

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
  const s1 = Math.min(10, Math.max(0, parseInt(document.getElementById(`s1-${groupId}`) ? document.getElementById(`s1-${groupId}`).value : 0) || 0));
  const s2 = Math.min(10, Math.max(0, parseInt(document.getElementById(`s2-${groupId}`) ? document.getElementById(`s2-${groupId}`).value : 0) || 0));
  const s3 = Math.min(10, Math.max(0, parseInt(document.getElementById(`s3-${groupId}`) ? document.getElementById(`s3-${groupId}`).value : 0) || 0));
  const s4 = Math.min(10, Math.max(0, parseInt(document.getElementById(`s4-${groupId}`) ? document.getElementById(`s4-${groupId}`).value : 0) || 0));
  const s5 = Math.min(10, Math.max(0, parseInt(document.getElementById(`s5-${groupId}`) ? document.getElementById(`s5-${groupId}`).value : 0) || 0));

  const total = s1 + s2 + s3 + s4 + s5;
  const totDisplay = document.getElementById(`total-${groupId}`);
  if (totDisplay) totDisplay.textContent = total;
}

async function handleSaveScore(e, groupId) {
  e.preventDefault();
  const s1 = Math.min(10, Math.max(0, parseInt(document.getElementById(`s1-${groupId}`).value) || 0));
  const s2 = Math.min(10, Math.max(0, parseInt(document.getElementById(`s2-${groupId}`).value) || 0));
  const s3 = Math.min(10, Math.max(0, parseInt(document.getElementById(`s3-${groupId}`).value) || 0));
  const s4 = Math.min(10, Math.max(0, parseInt(document.getElementById(`s4-${groupId}`).value) || 0));
  const s5 = Math.min(10, Math.max(0, parseInt(document.getElementById(`s5-${groupId}`).value) || 0));
  const remarks = document.getElementById(`remarks-${groupId}`).value.trim();
  const total = s1 + s2 + s3 + s4 + s5;

  // Proportional legacy mapping
  const innovation = Math.min(15, Math.round(s1 * 1.5));
  const feasibility = Math.min(10, s2);
  const solution = Math.min(15, Math.round(s3 * 1.5));
  let presentation = total - (innovation + feasibility + solution);
  if (presentation < 0) presentation = 0;
  if (presentation > 10) presentation = 10;

  const submitBtn = document.getElementById(`btn-score-${groupId}`);

  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

    if (IS_PURE_FIREBASE && window.firestoreDb) {
      const scoreObj = {
        group_id: groupId,
        step1_score: s1,
        step2_score: s2,
        step3_score: s3,
        step4_score: s4,
        step5_score: s5,
        innovation,
        feasibility,
        solution,
        presentation,
        total,
        remarks,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await window.firestoreDb.collection("scores").doc(groupId).set(scoreObj, { merge: true });
      await window.firestoreDb.collection("groups").doc(groupId).update({
        score: scoreObj,
        step1_score: s1,
        step2_score: s2,
        step3_score: s3,
        step4_score: s4,
        step5_score: s5,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast(`Step marks updated! Total: ${total}/50`, "success");
      await loadAdminGroups(false);
      return;
    }

    const res = await fetch(`${API_BASE}/api/admin/groups/${groupId}/score`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ 
        step1_score: s1,
        step2_score: s2,
        step3_score: s3,
        step4_score: s4,
        step5_score: s5,
        innovation, 
        feasibility, 
        solution, 
        presentation, 
        remarks 
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to save score");

    if (window.firestoreDb) {
      window.firestoreDb.collection("scores").doc(groupId).set({
        group_id: groupId,
        step1_score: s1,
        step2_score: s2,
        step3_score: s3,
        step4_score: s4,
        step5_score: s5,
        innovation,
        feasibility,
        solution,
        presentation,
        total,
        remarks,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => {});
    }

    showToast(`Step marks updated! Total: ${data.score.total}/50`, "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> Save Step Marks`;
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
    if (IS_PURE_FIREBASE && window.firestoreDb) {
      await window.firestoreDb.collection("groups").doc(deleteTargetGroupId).delete();
      await window.firestoreDb.collection("scores").doc(deleteTargetGroupId).delete().catch(() => {});
      showToast("Group and all associated milestone records deleted.", "success");
      closeDeleteModal();
      await loadAdminGroups();
      return;
    }

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

// ----------------- EDIT GROUP MODAL (FACULTY) -----------------
function handleEditGroupDeptChange() {
  const dept = document.getElementById("editGroupDept").value;
  const divGroup = document.getElementById("editGroupDivGroup");
  const batchGroup = document.getElementById("editGroupBatchGroup");
  const divSelect = document.getElementById("editGroupDiv");
  const batchSelect = document.getElementById("editGroupBatch");

  if (dept === "ECS") {
    if (divGroup) divGroup.style.display = "block";
    if (batchGroup) batchGroup.style.display = "none";
    if (divSelect) divSelect.value = "A";
    if (batchSelect) batchSelect.value = "—";
  } else if (dept === "Instrumentation") {
    if (divGroup) divGroup.style.display = "none";
    if (batchGroup) batchGroup.style.display = "block";
    if (divSelect) divSelect.value = "—";
    if (batchSelect) batchSelect.value = "B1";
  } else {
    if (divGroup) divGroup.style.display = "block";
    if (batchGroup) batchGroup.style.display = "block";
  }
}

function openEditGroupModal(groupId) {
  const g = allAdminGroups.find(group => group.id === groupId);
  if (!g) {
    showToast("Group details not found.", "error");
    return;
  }

  document.getElementById("editGroupId").value = g.id;
  document.getElementById("editGroupName").value = g.name || "";
  document.getElementById("editGroupLeader").value = g.creator_name || "";
  
  const deptSelect = document.getElementById("editGroupDept");
  if (deptSelect) deptSelect.value = g.department || "ECS";
  
  handleEditGroupDeptChange();

  const classSelect = document.getElementById("editGroupClass");
  if (classSelect) classSelect.value = g.student_class || "Third Year";

  const divSelect = document.getElementById("editGroupDiv");
  if (divSelect && g.division && g.division !== "—") {
    divSelect.value = g.division;
  }

  const batchSelect = document.getElementById("editGroupBatch");
  if (batchSelect && g.batch && g.batch !== "—") {
    batchSelect.value = g.batch;
  }

  const memberList = (g.member_names || []).join(", ");
  document.getElementById("editGroupMembers").value = memberList;

  document.getElementById("editGroupModal").style.display = "flex";
}

function closeEditGroupModal() {
  document.getElementById("editGroupModal").style.display = "none";
  document.getElementById("editGroupId").value = "";
}

async function handleSaveEditedGroup(e) {
  if (e) e.preventDefault();
  const groupId = document.getElementById("editGroupId").value;
  if (!groupId) return;

  const name = document.getElementById("editGroupName").value.trim();
  const creator_name = document.getElementById("editGroupLeader").value.trim();
  const department = document.getElementById("editGroupDept").value;
  const student_class = document.getElementById("editGroupClass").value;
  const division = department === "Instrumentation" ? "—" : document.getElementById("editGroupDiv").value;
  const batch = department === "ECS" ? "—" : document.getElementById("editGroupBatch").value;

  const rawMembers = document.getElementById("editGroupMembers").value;
  const member_names = rawMembers
    .split(/[,;\n]+/)
    .map(m => m.trim())
    .filter(m => m.length > 0);

  if (!name) {
    showToast("Please enter a group name.", "error");
    return;
  }

  const saveBtn = document.getElementById("saveEditGroupBtn");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const updateData = {
      name,
      creator_name,
      department,
      student_class,
      division,
      batch,
      member_names,
      updatedAt: (window.firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
    };

    if (IS_PURE_FIREBASE && window.firestoreDb) {
      await window.firestoreDb.collection("groups").doc(groupId).update(updateData);
      showToast(`Group "${name}" details and members updated successfully!`, "success");
      closeEditGroupModal();
      await loadAdminGroups(false);
      return;
    }

    const res = await fetch(`${API_BASE}/api/admin/groups/${groupId}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(updateData)
    });

    if (!res.ok) {
      // Fallback: update in firestore directly
      if (window.firestoreDb) {
        await window.firestoreDb.collection("groups").doc(groupId).update(updateData);
      } else {
        const err = await res.json();
        throw new Error(err.detail || "Failed to update group details");
      }
    }

    if (window.firestoreDb) {
      window.firestoreDb.collection("groups").doc(groupId).update(updateData).catch(() => {});
    }

    showToast(`Group "${name}" updated successfully!`, "success");
    closeEditGroupModal();
    loadAdminGroups(false);
  } catch (err) {
    showToast("Error updating group: " + err.message, "error");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Group Details`;
    }
  }
}

// ----------------- LEADERBOARD -----------------
async function loadLeaderboard(showToastNotice = false) {
  const dept = document.getElementById("lbFilterDept") ? document.getElementById("lbFilterDept").value : "All";
  const div = document.getElementById("lbFilterDiv") ? document.getElementById("lbFilterDiv").value : "All";
  const rawBatch = document.getElementById("lbFilterBatch") ? document.getElementById("lbFilterBatch").value : "All";
  const batch = dept === "ECS" ? "All" : rawBatch;

  const lbBatchSelect = document.getElementById("lbFilterBatch");
  if (lbBatchSelect) {
    if (dept === "ECS") {
      lbBatchSelect.disabled = true;
      lbBatchSelect.title = "No batches in ECS department";
    } else {
      lbBatchSelect.disabled = false;
      lbBatchSelect.title = "";
    }
  }

  if (IS_PURE_FIREBASE && window.firestoreDb) {
    try {
      let query = window.firestoreDb.collection("groups");
      if (dept !== "All") query = query.where("department", "==", dept);
      if (div !== "All") query = query.where("division", "==", div);
      if (batch !== "All") query = query.where("batch", "==", batch);

      // Function to process snapshot into leaderboard
      const processLeaderboardSnapshot = (snapshot) => {
        const leaderboard = [];
        snapshot.forEach(doc => {
          const g = doc.data();
          const s = g.score || null;
          const s1 = s ? (s.step1_score !== undefined ? s.step1_score : (s.innovation ? Math.round(s.innovation * 10 / 15) : 0)) : (g.step1_score || 0);
          const s2 = s ? (s.step2_score !== undefined ? s.step2_score : (s.feasibility || 0)) : (g.step2_score || 0);
          const s3 = s ? (s.step3_score !== undefined ? s.step3_score : (s.solution ? Math.round(s.solution * 10 / 15) : 0)) : (g.step3_score || 0);
          const s4 = s ? (s.step4_score !== undefined ? s.step4_score : (s.presentation ? Math.round(s.presentation / 2) : 0)) : (g.step4_score || 0);
          const s5 = s ? (s.step5_score !== undefined ? s.step5_score : (s.presentation ? Math.round(s.presentation / 2) : 0)) : (g.step5_score || 0);
          const total = s ? (s.total || (s1 + s2 + s3 + s4 + s5)) : 0;

          leaderboard.push({
            id: doc.id,
            name: g.name,
            department: g.department,
            student_class: g.student_class,
            division: g.division,
            batch: g.batch,
            members: g.member_names || [],
            is_marked: (s !== null && s !== undefined),
            step1_score: s1,
            step2_score: s2,
            step3_score: s3,
            step4_score: s4,
            step5_score: s5,
            total: total,
            remarks: s ? s.remarks || "" : "",
            step1_problem_statement: g.step1_problem_statement || "",
            step2_market_research: g.step2_market_research || "",
            step3_innovative_solution: g.step3_innovative_solution || "",
            step4_feasibility_business_model: g.step4_feasibility_business_model || "",
            step5_marketing_presentation: g.step5_marketing_presentation || ""
          });
        });

        leaderboard.sort((a, b) => {
          if (a.is_marked !== b.is_marked) return b.is_marked ? 1 : -1;
          if (a.total !== b.total) return b.total - a.total;
          if (a.step1_score !== b.step1_score) return b.step1_score - a.step1_score;
          return b.step3_score - a.step3_score;
        });

        const ranked = leaderboard.map((item, idx) => ({ ...item, rank: idx + 1 }));
        const topProject = (ranked.length > 0 && ranked[0].is_marked) ? ranked[0] : null;

        renderLeaderboard(ranked, topProject);
      };

      // Unsubscribe previous real-time leaderboard listener
      if (leaderboardFirestoreUnsub) {
        leaderboardFirestoreUnsub();
        leaderboardFirestoreUnsub = null;
      }

      // Real-time Firestore onSnapshot listener
      leaderboardFirestoreUnsub = query.onSnapshot((snapshot) => {
        processLeaderboardSnapshot(snapshot);
      }, (err) => console.warn("Firestore leaderboard live sync notice:", err));

      if (showToastNotice) {
        showToast("Live Leaderboard synced from Firestore in real-time.", "info");
      }
    } catch (err) {
      showToast("Leaderboard error: " + err.message, "error");
    }
    return;
  }


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
    const bestHasBatch = bestProject.department !== "ECS" && bestProject.batch && bestProject.batch !== "—";
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
          ${bestHasBatch ? `<span class="badge-batch">${bestProject.batch}</span>` : ''}
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
        <td colspan="12" class="text-center" style="padding: 2rem; color: var(--text-muted);">
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

    const itemHasBatch = item.department !== "ECS" && item.batch && item.batch !== "—";

    const s1 = item.step1_score !== undefined ? item.step1_score : (item.innovation ? Math.round(item.innovation * 10 / 15) : '—');
    const s2 = item.step2_score !== undefined ? item.step2_score : (item.feasibility !== undefined ? item.feasibility : '—');
    const s3 = item.step3_score !== undefined ? item.step3_score : (item.solution_score ? Math.round(item.solution_score * 10 / 15) : '—');
    const s4 = item.step4_score !== undefined ? item.step4_score : (item.presentation !== undefined ? Math.round(item.presentation / 2) : '—');
    const s5 = item.step5_score !== undefined ? item.step5_score : (item.presentation !== undefined ? Math.round(item.presentation / 2) : '—');

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
          <span class="badge-div">${item.division}</span> ${itemHasBatch ? `<span class="badge-batch">${item.batch}</span>` : ''}
        </td>
        <td>
          <small style="color: var(--text-secondary);">${(item.members || []).join(", ") || "—"}</small>
        </td>
        <td class="text-center cell-score-num">${item.is_marked ? s1 : '—'}</td>
        <td class="text-center cell-score-num">${item.is_marked ? s2 : '—'}</td>
        <td class="text-center cell-score-num">${item.is_marked ? s3 : '—'}</td>
        <td class="text-center cell-score-num">${item.is_marked ? s4 : '—'}</td>
        <td class="text-center cell-score-num">${item.is_marked ? s5 : '—'}</td>
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

  if (IS_PURE_FIREBASE && window.firestoreDb) {
    try {
      if (adminUsersFirestoreUnsub) {
        adminUsersFirestoreUnsub();
        adminUsersFirestoreUnsub = null;
      }
      adminUsersFirestoreUnsub = window.firestoreDb.collection("users").onSnapshot((snapshot) => {
        const users = [];
        snapshot.forEach(doc => {
          users.push({ id: doc.id, ...doc.data() });
        });
        renderFacultySettingsProfile();
        renderAdminUsers(users);
      }, (err) => console.warn("Firestore admin users live sync notice:", err));
    } catch (err) {
      showToast("Error loading users: " + err.message, "error");
    }
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/users`, {
      headers: authHeaders()
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to load users");
    }

    const users = await res.json();
    renderFacultySettingsProfile();
    renderAdminUsers(users);
  } catch (err) {
    showToast(err.message, "error");
  }
}

// Render logged-in faculty details in Faculty Settings Tab
function renderFacultySettingsProfile() {
  if (!currentUser || currentUser.role !== "faculty") return;

  const avatar = document.getElementById("facultySettingsAvatar");
  const nameEl = document.getElementById("facultySettingsName");
  const emailEl = document.getElementById("facultySettingsCurrentEmail");
  const uidEl = document.getElementById("facultySettingsUserId");
  const allocList = document.getElementById("facultySettingsAllocationsList");

  if (avatar) avatar.textContent = (currentUser.name || "F").charAt(0).toUpperCase();
  if (nameEl) nameEl.textContent = currentUser.name || "Faculty Member";
  if (emailEl) {
    emailEl.innerHTML = `<i class="fa-regular fa-envelope" style="color: var(--primary);"></i> ${escapeHtml(currentUser.email || "No email on record")}`;
  }
  if (uidEl) uidEl.textContent = currentUser.id || "N/A";

  if (allocList) {
    if (currentUser.assignments && currentUser.assignments.length > 0) {
      allocList.innerHTML = currentUser.assignments.map(a => {
        const isEcs = a.department === "ECS";
        const batches = isEcs ? "All Batches" : (a.batches || []).join(", ");
        return `
          <div style="background: var(--bg-hover); padding: 0.5rem 0.75rem; border-radius: var(--radius-sm); border: 1px solid var(--border-color); font-size: 0.85rem;">
            <strong>${escapeHtml(a.department)}</strong> • ${escapeHtml(a.student_class)} • ${escapeHtml(a.division)}
            <span style="color: var(--text-muted); font-size: 0.8rem;">[${escapeHtml(batches)}]</span>
          </div>
        `;
      }).join("");
    } else {
      allocList.innerHTML = `<em style="color: var(--text-muted); font-size: 0.85rem;">Universal Access (All Departments &amp; Divisions Assigned)</em>`;
    }
  }
}

// Handle Faculty Updating their Login Email Address
async function handleChangeFacultyEmail(e) {
  if (e) e.preventDefault();
  if (!currentUser || currentUser.role !== "faculty") return;

  const newEmailInput = document.getElementById("newFacultyEmail");
  const passwordInput = document.getElementById("confirmFacultyPassword");
  const submitBtn = document.getElementById("changeFacultyEmailBtn");

  const newEmail = newEmailInput ? newEmailInput.value.trim().toLowerCase() : "";
  const currentPassword = passwordInput ? passwordInput.value : "";

  if (!newEmail) {
    showToast("Please enter a valid new email address.", "error");
    return;
  }
  if (!currentPassword) {
    showToast("Please confirm your current password to verify identity.", "error");
    return;
  }
  if (newEmail === (currentUser.email || "").toLowerCase()) {
    showToast("The new email must be different from your current email.", "error");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating Email...`;
  }

  try {
    if (IS_PURE_FIREBASE && window.firebaseAuth) {
      const fbUser = window.firebaseAuth.currentUser;
      if (!fbUser) throw new Error("No active Firebase session. Please re-login.");

      // 1. Re-authenticate user to satisfy Firebase credential freshness requirements
      const credential = firebase.auth.EmailAuthProvider.credential(fbUser.email, currentPassword);
      await fbUser.reauthenticateWithCredential(credential);

      // 2. Update email in Firebase Auth
      await fbUser.updateEmail(newEmail);

      // 3. Update email in Firestore users collection
      if (window.firestoreDb) {
        await window.firestoreDb.collection("users").doc(currentUser.id).update({
          email: newEmail,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      // 4. Update local state
      currentUser.email = newEmail;
      localStorage.setItem("edmg_user", JSON.stringify(currentUser));
      renderFacultySettingsProfile();

      showToast(`Login email successfully updated to: ${newEmail}! Use this email for your next login.`, "success");
      if (newEmailInput) newEmailInput.value = "";
      if (passwordInput) passwordInput.value = "";
      return;
    }

    // Backend REST API fallback
    const res = await fetch(`${API_BASE}/api/admin/change-email`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ new_email: newEmail, current_password: currentPassword })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to update email address");

    currentUser.email = newEmail;
    localStorage.setItem("edmg_user", JSON.stringify(currentUser));
    renderFacultySettingsProfile();
    showToast(data.message || "Email updated successfully!", "success");
    if (newEmailInput) newEmailInput.value = "";
    if (passwordInput) passwordInput.value = "";
  } catch (err) {
    console.error("Change faculty email error:", err);
    let msg = err.message;
    if (err.code === "auth/wrong-password") msg = "Incorrect current password. Please verify and try again.";
    if (err.code === "auth/email-already-in-use") msg = "This email is already in use by another account.";
    if (err.code === "auth/invalid-email") msg = "The new email address format is invalid.";
    if (err.code === "auth/requires-recent-login") msg = "Security timeout. Please sign out and sign back in to change your email.";
    showToast("Error updating email: " + msg, "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> Update Dashboard Login Email`;
    }
  }
}

function renderAdminUsers(users) {
  const tbody = document.getElementById("userTableBody");
  tbody.innerHTML = users.map(u => {
    const isSelf = u.id === currentUser.id;

    let allocInfo = "—";
    if (u.role === "faculty" && u.assignments && u.assignments.length > 0) {
      allocInfo = u.assignments.map(a => {
        const isEcs = a.department === "ECS";
        const batchesStr = isEcs ? "All Batches" : (a.batches || []).join(", ");
        return `<div><strong>${a.department}</strong> (${a.student_class}, ${a.division}) • [${batchesStr}]</div>`;
      }).join("");
    } else if (u.role === "student") {
      if (u.department === "ECS") {
        allocInfo = `<div>${u.department} • ${u.student_class} • ${u.division}</div>`;
      } else {
        allocInfo = `<div>${u.department} • ${u.student_class} • ${u.division} • <strong>${u.batch || 'Batch 1'}</strong></div>`;
      }
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
    if (IS_PURE_FIREBASE && window.firestoreDb) {
      await window.firestoreDb.collection("users").doc(targetUserId).update({
        role: newRole,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showToast(`User role updated to ${newRole}`, "success");
      await loadAdminUsers();
      return;
    }

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
  // Bind registration forms explicitly
  const stuForm = document.getElementById("studentRegisterForm");
  if (stuForm) {
    stuForm.addEventListener("submit", (e) => {
      e.preventDefault();
      handleStudentRegister(e);
    });
  }

  const facForm = document.getElementById("facultyRegisterForm");
  if (facForm) {
    facForm.addEventListener("submit", (e) => {
      e.preventDefault();
      handleFacultyRegister(e);
    });
  }

  checkAuth();

  // Background sync fallback: check for any faculty updates every 8 seconds (only needed when running FastAPI without WebSocket)
  setInterval(() => {
    if (IS_PURE_FIREBASE) return; // In pure Firebase mode, Firestore onSnapshot provides 100% real-time instant sync for free!

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

// Explicit window bindings for HTML inline onclick attributes
window.setAuthMode = setAuthMode;
window.toggleAuthMode = toggleAuthMode;
window.switchRegRole = switchRegRole;
window.handleStudentDeptChange = handleStudentDeptChange;
window.handleNewGroupDeptChange = handleNewGroupDeptChange;
window.handleFacultyRowDeptChange = handleFacultyRowDeptChange;
window.addFacultyAssignmentRow = addFacultyAssignmentRow;
window.removeAssignmentRow = removeAssignmentRow;
window.fillCreds = fillCreds;
window.handleLogin = handleLogin;
window.handleStudentRegister = handleStudentRegister;
window.handleFacultyRegister = handleFacultyRegister;
window.logout = logout;
window.switchTab = switchTab;
window.openEditGroupModal = openEditGroupModal;
window.closeEditGroupModal = closeEditGroupModal;
window.handleEditGroupDeptChange = handleEditGroupDeptChange;
window.handleSaveEditedGroup = handleSaveEditedGroup;
window.promptDeleteGroup = promptDeleteGroup;
window.closeDeleteModal = closeDeleteModal;
window.executeDeleteGroup = executeDeleteGroup;
window.setFacultyDeptFilter = setFacultyDeptFilter;
window.updateFacultyGroupCounters = updateFacultyGroupCounters;
window.handleChangeFacultyEmail = handleChangeFacultyEmail;
window.renderFacultySettingsProfile = renderFacultySettingsProfile;



