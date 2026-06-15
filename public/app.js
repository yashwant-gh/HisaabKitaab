// Application State
let token = localStorage.getItem('token') || '';
let currentUser = JSON.parse(localStorage.getItem('user')) || null;
let activeTab = 'dashboard';
let activeViewFormat = 'audit'; // View style: audit, debts, currency, timeline
let balancesData = null;     // Computed balance, audits, simplified debts
let expensesList = [];       // Loaded expenses
let membersList = [];        // Loaded group members
let currentGroupId = 1;      // Seeded group ID
let activeGroupCreator = null; // Creator of active group
let myChart = null;          // ChartJS reference
let isSettlementForm = false; // Toggle for expense vs settlement creation

// CSV Import state
let rawCSVRows = [];
let importIssues = [];
let resolvedActions = {}; // Maps issueId -> selectedOption/resolvedValue

const API_BASE = '';

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    showMainScreen();
  } else {
    showAuthScreen();
  }
  
  // Load Google Client configuration securely
  loadGoogleConfig();
  
  // Set up forms and triggers
  updateExchangeRatePreview();
});

// --- SCREEN TRANSITIONS ---
function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('main-screen').classList.add('hidden');
}

function showMainScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('main-screen').classList.remove('hidden');
  
  if (currentUser) {
    document.getElementById('user-display-name').innerText = currentUser.name;
    document.getElementById('user-avatar').src = currentUser.avatar_url;
  }
  
  // Set default view format selector
  const viewFormatDropdown = document.getElementById('view-format-dropdown');
  if (viewFormatDropdown) {
    viewFormatDropdown.value = 'audit';
  }
  activeViewFormat = 'audit';
  
  // Load user's groups first
  loadGroups();
}

async function refreshData() {
  await fetchGroupMembers();
  await fetchExpenses();
  await fetchBalances();
  
  // Update view
  updatePerspectiveView();
}

// --- GROUP & INVITATION MANAGEMENT ---
let groupsList = [];
async function loadGroups() {
  try {
    const res = await fetch(`${API_BASE}/api/groups`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      groupsList = data;
      populateGroupsDropdown();
      
      if (groupsList.length > 0) {
        // If currentGroupId is not set or not in the user's groups, pick the first one
        if (!groupsList.some(g => g.id === currentGroupId)) {
          currentGroupId = groupsList[0].id;
        }
        document.getElementById('group-dropdown').value = currentGroupId;
        
        // Show dashboard elements, hide no-groups-panel
        document.getElementById('no-groups-panel').classList.add('hidden');
        document.getElementById('perspective-info-banner').classList.remove('hidden');
        document.querySelector('.dashboard-grid').classList.remove('hidden');
        document.querySelector('.chart-container').classList.remove('hidden');
        document.getElementById('audit-trail-container').classList.remove('hidden');
        
        // Update header group name
        const activeGroup = groupsList.find(g => g.id === currentGroupId);
        document.getElementById('current-group-name').innerText = activeGroup ? activeGroup.name : '';
        
        refreshData();
      } else {
        // No groups found!
        // Hide dashboard elements, show no-groups-panel
        document.getElementById('no-groups-panel').classList.remove('hidden');
        document.getElementById('perspective-info-banner').classList.add('hidden');
        document.querySelector('.dashboard-grid').classList.add('hidden');
        document.querySelector('.chart-container').classList.add('hidden');
        document.getElementById('audit-trail-container').classList.add('hidden');
        document.getElementById('current-group-name').innerText = 'None';
      }
      
      // Fetch notifications (invitations and approvals) regardless
      fetchNotifications();
    } else {
      console.error('Failed to load groups:', data.error);
    }
  } catch (err) {
    console.error('Failed to connect to groups API:', err);
  }
}

function populateGroupsDropdown() {
  const dropdown = document.getElementById('group-dropdown');
  if (dropdown) {
    dropdown.innerHTML = '';
    groupsList.forEach(g => {
      dropdown.innerHTML += `<option value="${g.id}">${g.name}</option>`;
    });
  }
}

function changeActiveGroup() {
  const dropdown = document.getElementById('group-dropdown');
  if (dropdown) {
    currentGroupId = parseInt(dropdown.value);
    
    const activeGroup = groupsList.find(g => g.id === currentGroupId);
    document.getElementById('current-group-name').innerText = activeGroup ? activeGroup.name : '';
    
    refreshData();
  }
}

async function createNewGroupSubmit() {
  const name = document.getElementById('new-group-name').value.trim();
  const desc = document.getElementById('new-group-desc').value.trim();
  if (!name) return alert('Please enter a group name');
  
  try {
    const res = await fetch(`${API_BASE}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name, description: desc })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      document.getElementById('new-group-name').value = '';
      document.getElementById('new-group-desc').value = '';
      currentGroupId = data.groupId;
      loadGroups();
    } else {
      alert(data.error || 'Failed to create group');
    }
  } catch (err) {
    alert('Error creating group');
  }
}

async function fetchNotifications() {
  if (!token) return;
  try {
    const invitesRes = await fetch(`${API_BASE}/api/invitations`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const invitations = invitesRes.ok ? await invitesRes.json() : [];

    const approvalsRes = await fetch(`${API_BASE}/api/pending-approvals`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const approvals = approvalsRes.ok ? await approvalsRes.json() : [];

    renderNotifications(invitations, approvals);
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
  }
}

function renderNotifications(invitations, approvals) {
  const container = document.getElementById('dashboard-notifications-container');
  if (!container) return;
  container.innerHTML = '';

  const hasInvites = invitations && invitations.length > 0;
  const hasApprovals = approvals && approvals.length > 0;

  if (!hasInvites && !hasApprovals) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  if (hasInvites) {
    invitations.forEach(inv => {
      container.innerHTML += `
        <div class="notification-card info animate-slide-in">
          <div class="notification-content">
            <span class="notification-emoji">✉️</span>
            <div>
              <strong>Group Invitation!</strong><br>
              <span>${inv.invited_by} invited you to join the group "<strong>${inv.group_name}</strong>".</span>
            </div>
          </div>
          <div class="notification-actions">
            <button class="btn btn-success btn-sm" onclick="respondToInvitation(${inv.id}, 'accept')">Accept</button>
            <button class="btn btn-danger btn-sm" onclick="respondToInvitation(${inv.id}, 'decline')">Decline</button>
          </div>
        </div>`;
    });
  }

  if (hasApprovals) {
    approvals.forEach(appr => {
      container.innerHTML += `
        <div class="notification-card info animate-slide-in" style="border-left: 5px solid var(--warning-color);">
          <div class="notification-content">
            <span class="notification-emoji">⚖️</span>
            <div>
              <strong>Approval Request!</strong><br>
              <span>${appr.paid_by} logged a <strong>${appr.category || 'General'}</strong> expense "<strong>${appr.description}</strong>" of <strong>${appr.amount} ${appr.currency}</strong> in group "<strong>${appr.group_name}</strong>". Your share is <strong>${appr.calculated_amount.toFixed(2)} ${appr.currency}</strong>.</span>
            </div>
          </div>
          <div class="notification-actions">
            <button class="btn btn-success btn-sm" onclick="respondToApproval(${appr.approval_id}, 'approve')">Approve</button>
            <button class="btn btn-danger btn-sm" onclick="respondToApproval(${appr.approval_id}, 'reject')">Decline</button>
          </div>
        </div>`;
    });
  }
}

async function respondToInvitation(inviteId, action) {
  try {
    const res = await fetch(`${API_BASE}/api/invitations/${inviteId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      if (action === 'accept') {
        currentGroupId = data.groupId;
      }
      loadGroups();
    } else {
      alert(data.error || 'Failed to respond to invitation');
    }
  } catch (err) {
    alert('Error responding to invitation');
  }
}

async function respondToApproval(approvalId, action) {
  try {
    const res = await fetch(`${API_BASE}/api/approvals/${approvalId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      fetchNotifications();
      refreshData();
    } else {
      alert(data.error || 'Failed to respond to approval request');
    }
  } catch (err) {
    console.error(err);
    alert('Error responding to approval request');
  }
}

function showInviteMemberForm() {
  const container = document.getElementById('member-invite-form-container');
  if (container) container.classList.remove('hidden');
}

function hideInviteMemberForm() {
  const container = document.getElementById('member-invite-form-container');
  if (container) container.classList.add('hidden');
}

async function submitInvitation(event) {
  event.preventDefault();
  const email = document.getElementById('invite-email').value.trim();
  if (!email) return alert('Please enter email');
  
  try {
    const res = await fetch(`${API_BASE}/api/groups/${currentGroupId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ email })
    });
    
    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = { error: 'Server returned an invalid response. Please verify the server is running.' };
    }
    
    if (res.ok) {
      alert(data.message || 'Invitation sent successfully!');
      document.getElementById('invite-email').value = '';
      hideInviteMemberForm();
    } else {
      alert(data.error || 'Failed to send invitation');
    }
  } catch (err) {
    alert('Error sending invitation: ' + err.message);
  }
}

// --- AUTHENTICATION ---
function switchAuthTab(type) {
  const isGoogle = type === 'google';
  const googleBtn = document.getElementById('tab-google');
  const emailBtn = document.getElementById('tab-email');
  const googleSection = document.getElementById('google-auth-section');
  const emailSection = document.getElementById('email-auth-section');
  
  if (googleBtn) googleBtn.classList.toggle('active', isGoogle);
  if (emailBtn) emailBtn.classList.toggle('active', !isGoogle);
  if (googleSection) googleSection.classList.toggle('hidden', !isGoogle);
  if (emailSection) emailSection.classList.toggle('hidden', isGoogle);
}

// Secure Google Authentication Flow
let googleClientId = '';
async function loadGoogleConfig() {
  try {
    const res = await fetch('/api/auth/google-config');
    const data = await res.json();
    googleClientId = data.clientId;
    if (googleClientId) {
      initializeGoogleSignIn();
    } else {
      renderGoogleWarning();
    }
  } catch (err) {
    console.error('Failed to load Google OAuth config:', err);
  }
}

function initializeGoogleSignIn() {
  if (typeof google === 'undefined') {
    // Retry loading once the SDK loads
    setTimeout(initializeGoogleSignIn, 500);
    return;
  }
  
  google.accounts.id.initialize({
    client_id: googleClientId,
    callback: handleCredentialResponse
  });
  
  const container = document.getElementById("google-signin-button-container");
  if (container) {
    container.innerHTML = ''; // Clear prior message
    google.accounts.id.renderButton(
      container,
      { theme: "outline", size: "large", width: "320" }
    );
  }
}

async function handleCredentialResponse(response) {
  const idToken = response.credential;
  try {
    const res = await fetch(`${API_BASE}/api/auth/google-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    const data = await res.json();
    if (res.ok) {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(currentUser));
      showMainScreen();
    } else {
      alert(data.error || 'Google Login verification failed');
    }
  } catch (err) {
    alert('Failed to connect to backend for Google sign-in');
  }
}

function renderGoogleWarning() {
  const container = document.getElementById("google-signin-button-container");
  if (container) {
    container.innerHTML = `
      <div class="alert alert-warning" style="text-align: left; font-size: 0.95rem; padding: 15px; border-radius: var(--border-radius-md); background: #fff8e1; border: 1px solid #ffe082; color: #5d4037; max-width: 480px; margin: 0 auto; line-height: 1.5;">
        <strong>⚠️ Google Client ID not configured!</strong><br>
        To enable secure Google login, follow these quick steps:<br>
        1. Set up credentials in the <a href="https://console.cloud.google.com/" target="_blank" style="color: var(--primary-color); font-weight: bold; text-decoration: underline;">Google Cloud Console</a>.<br>
        2. Set Authorized Javascript Origins to: <code>http://localhost:3000</code>.<br>
        3. Add the Client ID to your <code>.env</code> file:
        <pre style="margin-top: 5px; background: rgba(0,0,0,0.05); padding: 6px; border-radius: var(--border-radius-sm); font-size: 0.8rem; overflow-x: auto;">GOOGLE_CLIENT_ID=your-google-client-id-here</pre>
        4. Restart the node server process.
      </div>`;
  }
}

// Request Email OTP
async function requestOTP() {
  const email = document.getElementById('auth-email').value.trim();
  if (!email) return alert('Please enter email');
  
  try {
    const res = await fetch(`${API_BASE}/api/auth/signup-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      document.getElementById('email-initial-form').classList.add('hidden');
      document.getElementById('otp-form-section').classList.remove('hidden');
      document.getElementById('target-email-display').innerText = email;
      
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert('Error sending OTP');
  }
}

// Verify OTP
async function verifyOTP() {
  const email = document.getElementById('auth-email').value.trim();
  const otp = document.getElementById('auth-otp').value.trim();
  
  try {
    const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      document.getElementById('signup-details-section').classList.remove('hidden');
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert('Verification error');
  }
}

// Complete Signup
async function completeSignup() {
  const email = document.getElementById('auth-email').value.trim();
  const name = document.getElementById('signup-name').value;
  const password = document.getElementById('signup-password').value;
  
  if (!password || password.length < 6) return alert('Password must be at least 6 characters');
  
  try {
    const res = await fetch(`${API_BASE}/api/auth/signup-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, password })
    });
    const data = await res.json();
    if (res.ok) {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(currentUser));
      showMainScreen();
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert('Signup completion error');
  }
}

// Password Login
async function loginWithPassword() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return alert('Enter email and password');
  
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      token = data.token;
      currentUser = data.user;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(currentUser));
      showMainScreen();
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert('Login connection error');
  }
}

function logout() {
  token = '';
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  showAuthScreen();
}

// --- PROFILE SETTINGS & GROUP MANAGEMENT ---
function populateProfileTab() {
  if (!currentUser) return;
  document.getElementById('profile-page-avatar').src = currentUser.avatar_url;
  document.getElementById('profile-page-name').innerText = currentUser.name;
  document.getElementById('profile-page-email').innerText = currentUser.email;
  
  const activeGroup = groupsList.find(g => g.id === currentGroupId);
  const exitNameLabel = document.getElementById('active-group-exit-name');
  if (exitNameLabel) {
    exitNameLabel.innerText = activeGroup ? activeGroup.name : 'None';
  }
}

async function createGroupFromProfile() {
  const name = document.getElementById('profile-new-group-name').value.trim();
  const desc = document.getElementById('profile-new-group-desc').value.trim();
  if (!name) return alert('Please enter a group name');
  
  try {
    const res = await fetch(`${API_BASE}/api/groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name, description: desc })
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message);
      document.getElementById('profile-new-group-name').value = '';
      document.getElementById('profile-new-group-desc').value = '';
      currentGroupId = data.groupId;
      loadGroups();
      switchTab('dashboard');
    } else {
      alert(data.error || 'Failed to create group');
    }
  } catch (err) {
    alert('Error creating group');
  }
}

async function exitActiveGroup() {
  if (!currentUser) return;
  if (!currentGroupId || groupsList.length === 0) {
    return alert('You are not in any group!');
  }
  const activeGroup = groupsList.find(g => g.id === currentGroupId);
  const groupName = activeGroup ? activeGroup.name : 'this group';
  if (!confirm(`Are you sure you want to exit the group "${groupName}"? You will lose access to its expenses.`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/groups/${currentGroupId}/exit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message || 'You have successfully exited the group.');
      loadGroups();
      switchTab('dashboard');
    } else {
      alert(data.error || 'Failed to exit group');
    }
  } catch (err) {
    alert('Error exiting group');
  }
}

async function deleteUserAccount() {
  if (!currentUser) return;
  if (!confirm('🚨 WARNING: Are you sure you want to permanently delete your entire account? This will delete your profile credentials, remove you from all groups, and log you out. This action CANNOT be undone.')) return;

  try {
    const res = await fetch(`${API_BASE}/api/auth/delete-account`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (res.ok) {
      alert(data.message || 'Your account has been successfully deleted.');
      logout();
    } else {
      alert(data.error || 'Failed to delete account');
    }
  } catch (err) {
    alert('Error deleting account');
  }
}

// --- NAVIGATION ---
function switchTab(tabId) {
  activeTab = tabId;
  const tabs = ['dashboard', 'expenses', 'add', 'import', 'members', 'profile'];
  tabs.forEach(t => {
    const panel = document.getElementById(`panel-${t}`);
    const btn = document.getElementById(`nav-btn-${t}`);
    if (panel) panel.classList.toggle('hidden', t !== tabId);
    if (btn) btn.classList.toggle('active', t === tabId);
  });
  
  if (tabId === 'add') {
    resetExpenseForm();
  } else if (tabId === 'profile') {
    populateProfileTab();
  }
}

// --- FETCH DATA ---
async function fetchGroupMembers() {
  try {
    const res = await fetch(`${API_BASE}/api/groups/${currentGroupId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      membersList = data.members;
      activeGroupCreator = data.created_by;
      populatePayerDropdowns();
      renderMembersGrid();
    }
  } catch (err) {
    console.error('Failed to fetch members', err);
  }
}

async function fetchExpenses() {
  try {
    const res = await fetch(`${API_BASE}/api/groups/${currentGroupId}/expenses`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      expensesList = data;
      renderExpensesList();
      renderChart();
    }
  } catch (err) {
    console.error('Failed to fetch expenses', err);
  }
}

async function fetchBalances() {
  try {
    const res = await fetch(`${API_BASE}/api/groups/${currentGroupId}/balances`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
      balancesData = data;
    }
  } catch (err) {
    console.error('Failed to fetch balances', err);
  }
}

// --- PERSPECTIVES AND AUDITS ---
// --- FORMAT SWITCHING AND AUDITS ---
function changeViewFormat() {
  activeViewFormat = document.getElementById('view-format-dropdown').value;
  updatePerspectiveView();
}

function updatePerspectiveView() {
  if (!balancesData || !currentUser) return;
  
  const netBalance = balancesData.balances[currentUser.name] || 0;
  const avatarUrl = currentUser.avatar_url;
  
  // Update Header details
  document.getElementById('perspective-avatar').src = avatarUrl;
  document.getElementById('perspective-title').innerText = `Logged in as ${currentUser.name}`;
  
  const banner = document.getElementById('perspective-info-banner');
  // Reset styles
  if (banner) {
    banner.className = 'perspective-info-card ' + activeViewFormat;
  }
  
  let subtitleText = '';
  if (activeViewFormat === 'debts') {
    subtitleText = 'Simplified view: See exactly who you owe and who owes you — your settlements only.';
  } else if (activeViewFormat === 'audit') {
    subtitleText = 'Rohan requested: “No magic numbers. If the app says I owe, I want to see exactly why.”';
  } else if (activeViewFormat === 'currency') {
    subtitleText = 'Priya wants USD vs INR check: “Half the trip was in dollars. Do not pretend a dollar is a rupee.”';
  } else if (activeViewFormat === 'timeline') {
    subtitleText = 'Sam joined mid-April: “Why would March electricity affect my balance?”';
  } else {
    subtitleText = 'Perspective view active.';
  }
  document.getElementById('perspective-subtitle').innerText = subtitleText;

  // Net Balance card
  const balText = document.getElementById('dashboard-net-balance');
  const balLabel = document.getElementById('dashboard-net-balance-label');
  
  balText.innerText = `₹${Math.abs(netBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (netBalance > 0.01) {
    balText.className = 'balance-amount positive';
    balLabel.innerText = 'You are owed in total';
  } else if (netBalance < -0.01) {
    balText.className = 'balance-amount negative';
    balLabel.innerText = 'You owe in total';
  } else {
    balText.className = 'balance-amount';
    balText.innerText = '₹0.00';
    balLabel.innerText = 'Fully settled!';
  }

  // Dynamic Dashboard Card Content
  const dynTitle = document.getElementById('perspective-card-title');
  const dynContent = document.getElementById('perspective-dynamic-content');
  
  if (activeViewFormat === 'debts') {
    dynTitle.innerText = "My Settlements: Who I Owe & Who Owes Me";
    // PRIVACY: Only show settlements that involve the current user.
    // Other members' debts with each other are hidden.
    const myPayments = balancesData.payments.filter(pay =>
      pay.from === currentUser.name || pay.to === currentUser.name
    );
    const fmt = (n) => Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let html = '<div class="debt-simplification-list">';
    if (myPayments.length === 0) {
      // Only say "fully settled" if net balance is truly zero
      if (netBalance > 0.01) {
        html += `
          <div class="debt-status-banner" style="background: linear-gradient(135deg, #e8f5e9, #f1f8e9); border: 1px solid #a5d6a7; border-radius: 12px; padding: 18px 20px; margin-bottom: 12px;">
            <div style="font-size: 1.5rem; margin-bottom: 6px;">💚</div>
            <div style="font-weight: 700; color: #2e7d32; font-size: 1.05rem;">You are owed ₹${fmt(netBalance)}</div>
            <div style="color: #558b2f; font-size: 0.85rem; margin-top: 4px;">
              The people who owe you are listed below. You don't need to pay anyone — wait for them to settle up.
            </div>
          </div>`;
        // Show who owes the user from the payments list (they appear as 'to')
        // Since backend now tracks all members, there should be entries. If still empty,
        // show a helpful hint to check the audit trail.
        html += `<div style="text-align:center; color:#888; padding: 10px;">
          Check the <strong>Audit Trail</strong> view below for a detailed per-transaction breakdown.
        </div>`;
      } else if (netBalance < -0.01) {
        html += `
          <div class="debt-status-banner" style="background: linear-gradient(135deg, #fff3e0, #fbe9e7); border: 1px solid #ffab91; border-radius: 12px; padding: 18px 20px; margin-bottom: 12px;">
            <div style="font-size: 1.5rem; margin-bottom: 6px;">⚠️</div>
            <div style="font-weight: 700; color: #bf360c; font-size: 1.05rem;">You owe ₹${fmt(netBalance)}</div>
            <div style="color: #e64a19; font-size: 0.85rem; margin-top: 4px;">
              Your payment details are loading. Check the Audit Trail for a full breakdown.
            </div>
          </div>`;
      } else {
        html += '<div style="text-align:center; padding: 20px;"><span style="font-size:2rem;">🎉</span><br><strong style="color: var(--success-color);">You are fully settled!</strong><br><span style="color:#888; font-size:0.85rem;">No outstanding debts with anyone in this group.</span></div>';
      }
    } else {
      myPayments.forEach(pay => {
        const isFromMe = pay.from === currentUser.name;
        const highlights = isFromMe ? 'color: var(--error-color)' : 'color: var(--success-color)';
        const icon = isFromMe ? '🔴' : '💚';
        const label = isFromMe
          ? `You owe <strong>${pay.to}</strong>`
          : `<strong>${pay.from}</strong> owes you`;
        html += `
          <div class="debt-item">
            <span class="names">${icon} ${pay.from} ➔ ${pay.to}</span>
            <span class="debt-label" style="font-size:0.75rem; color:#888; margin-left:8px;">${label}</span>
            <span class="amount" style="${highlights}">₹${pay.amount.toFixed(2)}</span>
          </div>`;
      });
    }
    html += '</div>';
    dynContent.innerHTML = html;
  } else if (activeViewFormat === 'audit') {
    dynTitle.innerText = "Rohan's Vibe: Zero Magic Numbers";
    dynContent.innerHTML = `
      <p>Every single transaction below is calculated with full transparency. Your net balance of 
      <strong>₹${netBalance.toFixed(2)}</strong> is the sum of:
      <ul style="padding-left: 20px; margin-top: 10px;">
        <li>All expense shares you owe</li>
        <li>Payments you made on behalf of the flat</li>
        <li>Direct cash settlements recorded</li>
      </ul>
      Scroll down to view your audit table!</p>`;
  } else if (activeViewFormat === 'currency') {
    dynTitle.innerText = "Priya's View: Dollar Trip Conversions";
    // Count USD items
    const usdExpenses = expensesList.filter(e => e.currency === 'USD');
    let html = `
      <p>We found <strong>${usdExpenses.length} trip expenses</strong> recorded in USD. We converted them dynamically based on historical exchange rates to keep balances correct:</p>
      <div class="debt-simplification-list mt-2">`;
    usdExpenses.forEach(exp => {
      const mySplit = exp.splits.find(s => s.user_name === currentUser.name);
      const share = mySplit ? mySplit.calculated_amount : 0;
      html += `
        <div class="debt-item">
          <div>
            <strong>${exp.description}</strong><br>
            <small>Total: $${exp.amount} | Rate: ₹${exp.exchange_rate.toFixed(2)}</small>
          </div>
          <span class="amount">Your Share: ₹${(mySplit ? mySplit.calculated_amount_inr : 0).toFixed(2)}</span>
        </div>`;
    });
    html += '</div>';
    dynContent.innerHTML = html;
  } else if (activeViewFormat === 'timeline') {
    dynTitle.innerText = "Sam's View: Joining Timeline Check";
    const myTimeline = balancesData.memberMap[currentUser.name];
    const joined = myTimeline ? myTimeline.joined : 'N/A';
    const left = myTimeline && myTimeline.left ? myTimeline.left : 'present';
    
    // Find one example pre-joined expense if any
    const preJoinExp = expensesList.find(e => e.date < joined);
    
    let timelineExplanation = `
      <p>📅 <strong>Your Membership Active Range:</strong> ${joined} to ${left}.</p>
      <p class="mt-2">Because you joined on ${joined}, you are only split into expenses after that date.</p>`;
      
    if (preJoinExp) {
      timelineExplanation += `
        <p class="mt-2">For example, <strong>${preJoinExp.description}</strong> (dated ${preJoinExp.date}) split list did not include you. You owe <strong>₹0.00</strong> for it!</p>
        <div class="debt-item mt-2">
          <span>${preJoinExp.description} (${preJoinExp.date})</span>
          <span class="amount positive" style="color:var(--success-color)">₹0.00 Share</span>
        </div>`;
    } else {
      timelineExplanation += `<p class="mt-2">No expenses recorded before your joined date.</p>`;
    }
    
    dynContent.innerHTML = timelineExplanation;
  } else {
    dynTitle.innerText = `${currentUser.name}'s Balance Summary`;
    dynContent.innerHTML = `<p>Active member details and ledger records are compiled below.</p>`;
  }

  // Draw Audit Table for the perspective
  renderAuditTrail();
}

function renderAuditTrail() {
  const auditContainer = document.getElementById('audit-trail-container');
  const auditUsername = document.getElementById('audit-username');
  const auditCount = document.getElementById('audit-count');
  const tbody = document.getElementById('audit-trail-rows');
  
  if (auditUsername) {
    auditUsername.innerText = currentUser ? currentUser.name : 'You';
  }
  tbody.innerHTML = '';
  
  const auditData = balancesData.myAudit;
  if (!auditData || !auditData.auditTrail || auditData.auditTrail.length === 0) {
    if (auditCount) auditCount.innerText = '0 items';
    tbody.innerHTML = `<tr><td colspan="8" class="text-center">No transactions logged for this member.</td></tr>`;
    return;
  }

  if (auditCount) auditCount.innerText = `${auditData.auditTrail.length} transactions`;

  auditData.auditTrail.forEach(row => {
    const isPayer = row.paidAmount > 0;
    const dateFormatted = row.date;
    const changeClass = row.changeInr > 0 ? 'change positive' : (row.changeInr < -0.01 ? 'change negative' : '');
    const changePrefix = row.changeInr > 0 ? '+' : '';
    
    tbody.innerHTML += `
      <tr>
        <td>${dateFormatted}</td>
        <td>
          <strong>${row.description}</strong><br>
          <small class="text-muted">${row.details}</small>
        </td>
        <td>${isPayer ? 'You' : row.description.includes('Settled') ? '-' : 'Others'}</td>
        <td>${row.originalAmount} ${row.currency}</td>
        <td>${row.shareAmount > 0 ? `${row.shareAmount.toFixed(2)} ${row.currency}` : '-'}</td>
        <td>${row.paidAmount > 0 ? `${row.paidAmount.toFixed(2)} ${row.currency}` : '-'}</td>
        <td class="${changeClass}">${changePrefix}₹${row.changeInr.toFixed(2)}</td>
        <td><strong>₹${row.runningSumInr.toFixed(2)}</strong></td>
      </tr>`;
  });
}

// --- GRAPHING ---
function renderChart() {
  if (!currentUser) return;
  const ctx = document.getElementById('monthlyChart').getContext('2d');

  // Aggregate MY personal share per month (only expenses I'm a participant in)
  const monthlyTotals = {};

  expensesList.forEach(exp => {
    if (exp.is_settlement) return; // skip settlements
    const date = new Date(exp.date);
    if (isNaN(date.getTime())) return;

    // Only count expenses where the current user is a payer or split participant
    const mySplit = exp.splits ? exp.splits.find(sp => sp.user_name === currentUser.name) : null;
    const isPayer = exp.paid_by === currentUser.name;
    if (!mySplit && !isPayer) return;

    // My personal share = what I owe (split amount) if I'm in splits, else 0
    // If I paid, my "cost" is my split share (what I personally consumed)
    const myShareInr = mySplit ? (mySplit.calculated_amount_inr || mySplit.calculated_amount * (exp.exchange_rate || 1.0)) : 0;

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = date.toLocaleString('default', { month: 'short', year: 'numeric' });
    if (!monthlyTotals[monthKey]) monthlyTotals[monthKey] = { label: monthLabel, total: 0 };
    monthlyTotals[monthKey].total += myShareInr;
  });

  // Sort by date key (YYYY-MM)
  const sortedKeys = Object.keys(monthlyTotals).sort();
  const labels = sortedKeys.map(k => monthlyTotals[k].label);
  const data = sortedKeys.map(k => parseFloat(monthlyTotals[k].total.toFixed(2)));

  if (myChart) myChart.destroy();

  // Build a gradient fill for the line chart
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(5, 44, 40, 0.25)');
  gradient.addColorStop(0.6, 'rgba(5, 44, 40, 0.05)');
  gradient.addColorStop(1, 'rgba(5, 44, 40, 0.0)');

  myChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'My Share (₹)',
        data,
        borderColor: '#052c28',
        borderWidth: 2.5,
        backgroundColor: gradient,
        fill: true,
        tension: 0.45,
        pointRadius: 4,
        pointHoverRadius: 8,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#052c28',
        pointBorderWidth: 2.5,
        pointHoverBackgroundColor: '#052c28',
        pointHoverBorderColor: '#ffffff',
        pointHoverBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.97)',
          titleColor: '#052c28',
          bodyColor: '#052c28',
          borderColor: 'rgba(5,44,40,0.15)',
          borderWidth: 1,
          cornerRadius: 12,
          padding: 12,
          titleFont: { family: 'Outfit', size: 13, weight: 'bold' },
          bodyFont: { family: 'Plus Jakarta Sans', size: 14, weight: 'bold' },
          callbacks: {
            label: (ctx) => `  ₹${ctx.parsed.y.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false },
          ticks: {
            font: { family: 'Plus Jakarta Sans', size: 11 },
            color: '#94a3b8',
            callback: v => '₹' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v)
          },
          border: { display: false }
        },
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' }, color: '#64748b' },
          border: { display: false }
        }
      },
      animation: {
        duration: 800,
        easing: 'easeInOutQuart'
      }
    }
  });
}

// Download Monthly Expense Statement as CSV
function downloadMonthlyStatement() {
  if (!currentUser) return alert('Please log in first.');
  if (!expensesList || expensesList.length === 0) return alert('No expenses to export.');

  const activeGroup = groupsList.find(g => g.id === currentGroupId);
  const groupName = activeGroup ? activeGroup.name : 'Group';

  // Build rows: only expenses involving the current user
  const rows = [
    ['Month', 'Date', 'Description', 'Category', 'Paid By', 'Total Amount', 'Currency', 'Your Share (INR)', 'Status']
  ];

  expensesList.forEach(exp => {
    if (exp.is_settlement) return;
    const mySplit = exp.splits ? exp.splits.find(sp => sp.user_name === currentUser.name) : null;
    const isPayer = exp.paid_by === currentUser.name;
    if (!mySplit && !isPayer) return;

    const date = new Date(exp.date);
    const monthLabel = isNaN(date.getTime()) ? '' : date.toLocaleString('default', { month: 'long', year: 'numeric' });
    const myShareInr = mySplit
      ? (mySplit.calculated_amount_inr || mySplit.calculated_amount * (exp.exchange_rate || 1.0))
      : 0;

    rows.push([
      monthLabel,
      exp.date,
      `"${(exp.description || '').replace(/"/g, '""')}"`,
      exp.category || 'General',
      exp.paid_by,
      exp.amount,
      exp.currency || 'INR',
      myShareInr.toFixed(2),
      exp.status || 'approved'
    ]);
  });

  // Add a monthly summary at the bottom
  rows.push([]);
  rows.push(['--- MONTHLY SUMMARY ---']);
  rows.push(['Month', 'My Total Share (INR)']);

  const monthlySums = {};
  expensesList.forEach(exp => {
    if (exp.is_settlement) return;
    const mySplit = exp.splits ? exp.splits.find(sp => sp.user_name === currentUser.name) : null;
    if (!mySplit) return;
    const date = new Date(exp.date);
    if (isNaN(date.getTime())) return;
    const month = date.toLocaleString('default', { month: 'long', year: 'numeric' });
    const amt = mySplit.calculated_amount_inr || mySplit.calculated_amount * (exp.exchange_rate || 1.0);
    monthlySums[month] = (monthlySums[month] || 0) + amt;
  });

  Object.entries(monthlySums).sort().forEach(([month, total]) => {
    rows.push([month, total.toFixed(2)]);
  });

  const csvContent = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const today = new Date().toISOString().split('T')[0];
  link.href = url;
  link.download = `HisaabKitaab_Statement_${currentUser.name}_${groupName}_${today}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


// --- EXPENSES LIST VIEW ---
function renderExpensesList() {
  const container = document.getElementById('expense-list');
  container.innerHTML = '';
  
  if (expensesList.length === 0) {
    container.innerHTML = '<p class="text-center py-5 text-muted">No expenses found. Import some or create one!</p>';
    return;
  }
  
  const categoryIcons = {
    'Food': '🍔 Food',
    'Grocery': '🛒 Grocery',
    'Travel': '✈️ Travel',
    'Others': '📦 Others'
  };

  expensesList.forEach(exp => {
    const dateFormatted = exp.date;
    const isSettlement = exp.is_settlement === 1;
    const currencySymbol = exp.currency === 'USD' ? '$' : (exp.currency === 'INR' ? '₹' : exp.currency);
    const convertedSuffix = exp.currency !== 'INR' ? ` <small class="text-muted">(₹${(exp.amount * exp.exchange_rate).toFixed(2)})</small>` : '';
    
    // Split names list
    const splitNames = exp.splits.map(s => s.user_name).join(', ');

    // Category display
    const catText = isSettlement ? '🤝 Settlement' : (categoryIcons[exp.category] || `📦 ${exp.category || 'General'}`);

    // Approval status badge
    let approvalBadge = '';
    if (exp.status === 'pending') {
      const approvedList = exp.approvals ? exp.approvals.filter(a => a.status === 'approved').map(a => a.user_name) : [];
      const pendingList = exp.approvals ? exp.approvals.filter(a => a.status === 'pending').map(a => a.user_name) : [];
      approvalBadge = `
        <div class="approval-status-badge pending mt-2" style="font-size:0.75rem; background: #fff8e1; border: 1px solid #ffe082; padding: 4px 8px; border-radius: 8px; color: #b78103; display: inline-block;">
          ⏳ Pending (${approvedList.length}/${(exp.approvals || []).length} approved)
          <br><small style="color: #666;">Approved: ${approvedList.join(', ') || 'None'}</small>
          <br><small style="color: #666;">Pending: ${pendingList.join(', ')}</small>
        </div>
      `;
    } else if (exp.status === 'rejected') {
      approvalBadge = `
        <div class="approval-status-badge rejected mt-2" style="font-size:0.75rem; background: #ffe5e5; border: 1px solid #ffcccc; padding: 4px 8px; border-radius: 8px; color: #cc0000; display: inline-block;">
          ❌ Rejected (Legitimacy declined)
        </div>
      `;
    } else if (exp.status === 'approved' && exp.approvals && exp.approvals.length > 0) {
      approvalBadge = `
        <div class="approval-status-badge approved mt-2" style="font-size:0.75rem; background: #e6f9f0; border: 1px solid #b3f0d2; padding: 4px 8px; border-radius: 8px; color: #1e7e4e; display: inline-block;">
          ✓ Legit (Approved by all)
        </div>
      `;
    }
    
    container.innerHTML += `
      <div class="expense-card-item ${isSettlement ? 'settlement' : ''}">
        <div class="details-left">
          <h4>${isSettlement ? '🤝 ' : '🛒 '}${exp.description} <span class="badge badge-secondary" style="font-size: 0.75rem; vertical-align: middle; background: rgba(93, 91, 246, 0.1); color: var(--primary-color); border: 1px solid rgba(93, 91, 246, 0.2); padding: 2px 8px; border-radius: 12px; margin-left: 8px;">${catText}</span></h4>
          <div class="meta">
            <span>Paid by <strong>${exp.paid_by}</strong></span> | 
            <span>Split with: <code>${splitNames}</code></span> | 
            <span>Date: ${dateFormatted}</span>
          </div>
          ${exp.notes ? `<div class="notes mt-1" style="font-size:0.8rem; color:#888;">📝 ${exp.notes}</div>` : ''}
          ${approvalBadge}
        </div>
        <div class="details-right">
          <div class="amount-box">
            <span class="amount-val">${currencySymbol}${exp.amount}${convertedSuffix}</span>
            <div style="font-size:0.7rem; color:#a0aec0">${exp.split_type ? exp.split_type.toUpperCase() : 'SETTLEMENT'}</div>
          </div>
          <button class="btn-delete" onclick="deleteExpense(${exp.id})" title="Delete Expense">🗑️</button>
        </div>
      </div>`;
  });
}

function filterExpenses() {
  const query = document.getElementById('expense-search').value.toLowerCase();
  const curr = document.getElementById('expense-currency-filter').value;
  const cards = document.getElementsByClassName('expense-card-item');
  
  expensesList.forEach((exp, index) => {
    const card = cards[index];
    if (!card) return;
    
    const matchesSearch = exp.description.toLowerCase().includes(query) || exp.paid_by.toLowerCase().includes(query);
    const matchesCurrency = curr === 'all' || exp.currency === curr;
    
    if (matchesSearch && matchesCurrency) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

async function deleteExpense(id) {
  if (!confirm('Are you sure you want to delete this expense?')) return;
  
  try {
    const res = await fetch(`${API_BASE}/api/groups/${currentGroupId}/expenses/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      refreshData();
    } else {
      alert('Delete failed');
    }
  } catch (err) {
    alert('Delete network error');
  }
}

// --- ADD EXPENSE FORM LOGIC ---
function setExpenseFormType(settlement) {
  isSettlementForm = settlement;
  document.getElementById('form-is-settlement').value = settlement ? '1' : '0';
  
  document.getElementById('btn-type-expense').classList.toggle('active', !settlement);
  document.getElementById('btn-type-settlement').classList.toggle('active', settlement);
  
  document.getElementById('lbl-form-desc').innerText = settlement ? 'Settlement Label' : 'Description';
  document.getElementById('form-desc').placeholder = settlement ? 'e.g. Rohan paid Aisha back' : 'e.g. WiFi Bill March';
  
  document.getElementById('splits-configuration-section').classList.toggle('hidden', settlement);
  document.getElementById('settlement-configuration-section').classList.toggle('hidden', !settlement);
  
  if (settlement) {
    document.getElementById('form-currency').value = 'INR';
    updateExchangeRatePreview();
  }
}

function populatePayerDropdowns() {
  const payer = document.getElementById('form-paid-by');
  const receiver = document.getElementById('form-settlement-to');
  
  payer.innerHTML = '';
  receiver.innerHTML = '';
  
  membersList.forEach(m => {
    payer.innerHTML += `<option value="${m.user_name}">${m.user_name}</option>`;
    receiver.innerHTML += `<option value="${m.user_name}">${m.user_name}</option>`;
  });
  
  adjustSplitInputs();
}

function adjustSplitInputs() {
  const container = document.getElementById('split-inputs-container');
  container.innerHTML = '';
  
  const type = document.getElementById('form-split-type').value;
  
  membersList.forEach(m => {
    let inputField = '';
    if (type === 'equal') {
      inputField = `<input type="checkbox" name="split-members" value="${m.user_name}" checked style="width:20px;height:20px;">`;
    } else if (type === 'unequal') {
      inputField = `
        <div class="input-container">
          <span>₹</span>
          <input type="number" step="0.01" class="split-val-input" data-user="${m.user_name}" placeholder="0.00">
        </div>`;
    } else if (type === 'share') {
      inputField = `
        <div class="input-container">
          <input type="number" class="split-val-input" data-user="${m.user_name}" value="1">
          <span>shares</span>
        </div>`;
    } else if (type === 'percentage') {
      inputField = `
        <div class="input-container">
          <input type="number" class="split-val-input" data-user="${m.user_name}" placeholder="0">
          <span>%</span>
        </div>`;
    }
    
    container.innerHTML += `
      <div class="split-member-input-row">
        <label>${m.user_name}</label>
        ${inputField}
      </div>`;
  });
}

function onPayerChange() {
  // Can adapt selection logic if needed
}

async function updateExchangeRatePreview() {
  const currency = document.getElementById('form-currency').value;
  const amount = parseFloat(document.getElementById('form-amount').value) || 0;
  const preview = document.getElementById('exchange-rate-preview');
  
  if (currency === 'INR') {
    preview.classList.add('hidden');
    return;
  }
  
  try {
    const res = await fetch(`${API_BASE}/api/exchange-rate?currency=${currency}`);
    const data = await res.json();
    if (res.ok) {
      const rate = data.rate;
      document.getElementById('exchange-rate-val').innerText = rate.toFixed(4);
      document.getElementById('exchange-converted-val').innerText = `₹${(amount * rate).toFixed(2)}`;
      preview.classList.remove('hidden');
    }
  } catch (err) {
    console.error(err);
  }
}

// Attach listener to amount inputs to update conversion preview live
document.getElementById('form-amount').addEventListener('input', updateExchangeRatePreview);

function resetExpenseForm() {
  document.getElementById('expense-form').reset();
  document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
  setExpenseFormType(false);
  updateExchangeRatePreview();
}

async function submitExpense(event) {
  event.preventDefault();
  
  const isSettlement = document.getElementById('form-is-settlement').value === '1';
  const description = document.getElementById('form-desc').value.trim();
  const paid_by = document.getElementById('form-paid-by').value;
  const amount = parseFloat(document.getElementById('form-amount').value);
  const currency = document.getElementById('form-currency').value;
  const date = document.getElementById('form-date').value;
  const notes = document.getElementById('form-notes').value.trim();
  const category = isSettlement ? 'Others' : document.getElementById('form-category').value;
  
  let split_type = 'equal';
  let splits = [];
  
  if (isSettlement) {
    const receiver = document.getElementById('form-settlement-to').value;
    if (paid_by === receiver) return alert('Payer and Receiver cannot be the same person!');
    splits = [{ userName: receiver, value: amount }];
  } else {
    split_type = document.getElementById('form-split-type').value;
    
    if (split_type === 'equal') {
      const checkedBoxes = document.querySelectorAll('input[name="split-members"]:checked');
      if (checkedBoxes.length === 0) return alert('Select at least one member to split with');
      checkedBoxes.forEach(cb => {
        splits.push({ userName: cb.value, value: 1 });
      });
    } else {
      const inputs = document.querySelectorAll('.split-val-input');
      let totalVal = 0;
      inputs.forEach(input => {
        const val = parseFloat(input.value) || 0;
        if (val > 0) {
          splits.push({ userName: input.getAttribute('data-user'), value: val });
          totalVal += val;
        }
      });
      
      if (splits.length === 0) return alert('Assign split values to members');
      
      // Validation for percentages
      if (split_type === 'percentage' && Math.abs(totalVal - 100) > 0.01) {
        return alert(`Percentages must sum to exactly 100% (currently ${totalVal}%)`);
      }
      // Validation for unequal
      if (split_type === 'unequal' && Math.abs(totalVal - amount) > 0.05) {
        return alert(`Split sums (₹${totalVal}) must match total amount (₹${amount})`);
      }
    }
  }

  const payload = {
    description,
    paid_by,
    amount,
    currency,
    category,
    split_type: isSettlement ? 'equal' : split_type,
    date,
    notes,
    is_settlement: isSettlement ? 1 : 0,
    splits
  };

  try {
    const res = await fetch(`${API_BASE}/api/groups/${currentGroupId}/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      refreshData();
      switchTab('dashboard');
    } else {
      const err = await res.json();
      alert(err.error || 'Failed to submit transaction');
    }
  } catch (err) {
    alert('Server connection error');
  }
}

// --- MEMBERS TAB ACTIONS ---
function renderMembersGrid() {
  const container = document.getElementById('members-list-grid');
  container.innerHTML = '';
  
  const isCreator = currentUser && activeGroupCreator && currentUser.name.toLowerCase() === activeGroupCreator.toLowerCase();
  
  membersList.forEach(m => {
    const avatarUrl = `https://api.dicebear.com/7.x/adventurer/svg?seed=${m.user_name}`;
    const leftText = m.left_at ? `Left: ${m.left_at}` : 'Active Member';
    const isMe = currentUser && m.user_name.toLowerCase() === currentUser.name.toLowerCase();
    
    const removeButton = (isCreator && !isMe) ? `
      <button class="btn btn-danger btn-sm mt-3 w-100" onclick="removeGroupMember('${m.user_name}')">
        Remove Member
      </button>
    ` : '';

    container.innerHTML += `
      <div class="member-timeline-card">
        <img src="${avatarUrl}" alt="Avatar">
        <h4>${m.user_name}</h4>
        <span class="date-range">Joined: ${m.joined_at}</span><br>
        <span class="badge ${m.left_at ? 'badge-warning' : 'badge-success'} mt-2">${leftText}</span>
        ${removeButton}
      </div>`;
  });
}

async function removeGroupMember(userName) {
  if (!confirm(`Are you sure you want to remove ${userName} from this group?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/groups/${currentGroupId}/members/${encodeURIComponent(userName)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await res.json();
    if (res.ok) {
      alert(data.message || 'Member removed successfully.');
      refreshData();
    } else {
      alert(data.error || 'Failed to remove member.');
    }
  } catch (err) {
    console.error(err);
    alert('Error removing member.');
  }
}

function showAddMemberForm() {
  document.getElementById('member-add-form-container').classList.remove('hidden');
}
function hideAddMemberForm() {
  document.getElementById('member-add-form-container').classList.add('hidden');
}

async function submitMember(event) {
  event.preventDefault();
  const name = document.getElementById('member-name').value.trim();
  const joined = document.getElementById('member-joined').value;
  const left = document.getElementById('member-left').value || null;
  
  try {
    const res = await fetch(`${API_BASE}/api/groups/${currentGroupId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        user_name: name,
        joined_at: joined,
        left_at: left
      })
    });
    
    if (res.ok) {
      document.getElementById('member-form').reset();
      hideAddMemberForm();
      refreshData();
    } else {
      const err = await res.json();
      alert(err.error);
    }
  } catch (err) {
    alert('Error updating group member');
  }
}

// --- CSV IMPORT SYSTEM (MEERA'S WIZARD CORE) ---
function triggerFileInput() {
  document.getElementById('csv-file-input').click();
}

function handleFileSelected() {
  const fileInput = document.getElementById('csv-file-input');
  if (fileInput.files.length === 0) return;
  uploadCSVFile(fileInput.files[0]);
}

// Trigger parsing the default Expenses Export.csv directly in workspace
async function loadDefaultCSV() {
  try {
    // We fetch and load the local CSV in workspace by simulating an upload
    const response = await fetch('/Expenses Export.csv');
    if (!response.ok) {
      // Try lowercase
      const response2 = await fetch('/expenses_export.csv');
      if (!response2.ok) throw new Error('File not found');
      const blob = await response2.blob();
      uploadCSVFile(new File([blob], 'expenses_export.csv'));
    } else {
      const blob = await response.blob();
      uploadCSVFile(new File([blob], 'Expenses Export.csv'));
    }
  } catch (err) {
    alert('Failed to load workspace CSV. Please select it manually.');
  }
}

async function uploadCSVFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const res = await fetch(`${API_BASE}/api/import/analyze`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    
    if (res.ok) {
      rawCSVRows = data.parsedRows;
      importIssues = data.issues;
      resolvedActions = {}; // clear
      
      // Client-side detection of missing members in group
      const csvNames = new Set();
      rawCSVRows.forEach(row => {
        if (row.paidBy) csvNames.add(row.paidBy);
        if (row.splitWith) row.splitWith.forEach(n => csvNames.add(n));
      });
      
      const currentMemberNames = new Set(membersList.map(m => m.user_name.toLowerCase()));
      const missingMembers = [];
      csvNames.forEach(name => {
        if (name && !currentMemberNames.has(name.toLowerCase())) {
          missingMembers.push(name);
        }
      });
      
      if (missingMembers.length > 0) {
        missingMembers.forEach((name) => {
          // Find first date they are referenced
          const matchingRow = rawCSVRows.find(r => r.paidBy === name || (r.splitWith && r.splitWith.includes(name)));
          const firstDate = matchingRow ? matchingRow.date : new Date().toISOString().split('T')[0];
          
          importIssues.push({
            id: `missing_member_${name}`,
            type: 'missing_member',
            name: name,
            message: `User "${name}" is referenced in the CSV but is not a member of the active group.`,
            suggestion: 'Add them to the group automatically or ignore.',
            date: firstDate
          });
        });
      }
      
      // Switch view and render issues wizard
      document.getElementById('import-step-upload').classList.add('hidden');
      document.getElementById('import-step-wizard').classList.remove('hidden');
      renderImportWizard();
    } else {
      alert(data.error || 'CSV Parsing failed');
    }
  } catch (err) {
    alert('CSV upload failed');
  }
}

function resetImport() {
  document.getElementById('import-step-wizard').classList.add('hidden');
  document.getElementById('import-step-upload').classList.remove('hidden');
  document.getElementById('import-step-success').classList.add('hidden');
  document.getElementById('csv-file-input').value = '';
}

function renderImportWizard() {
  const badge = document.getElementById('wizard-issue-badge');
  badge.innerText = `⚠️ ${importIssues.length} Anomaly Items Detected`;
  
  const container = document.getElementById('wizard-issues-container');
  container.innerHTML = '';
  
  if (importIssues.length === 0) {
    container.innerHTML = `
      <div class="status-badge info">✅ No anomalies detected! The spreadsheet looks perfectly clean.</div>
      <p class="mt-3">All records will be imported without modification.</p>`;
    return;
  }
  
  importIssues.forEach(issue => {
    let optionsHtml = '';
    
    if (issue.type === 'duplicate') {
      // Row options to choose which row to keep
      optionsHtml = `
        <div class="wizard-options-grid">
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="keep_first" checked>
            <span>Keep first record: "${issue.rows[0].description}" (has notes: "${issue.rows[0].notes || 'None'}")</span>
          </label>
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="keep_second">
            <span>Keep second record: "${issue.rows[1].description}" (has notes: "${issue.rows[1].notes || 'None'}")</span>
          </label>
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="keep_both">
            <span>Keep both (Do not delete anything)</span>
          </label>
        </div>`;
    } else if (issue.type === 'conflict') {
      // Conflict e.g. Thalassa dinner (logged twice with different amount/payer)
      optionsHtml = `
        <div class="wizard-options-grid">
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="keep_row_0" checked>
            <span>Keep ${issue.rows[0].paidBy}'s log: ₹${issue.rows[0].amount} ("${issue.rows[0].description}")</span>
          </label>
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="keep_row_1">
            <span>Keep ${issue.rows[1].paidBy}'s log: ₹${issue.rows[1].amount} ("${issue.rows[1].description}")</span>
          </label>
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="keep_both">
            <span>Keep both entries separately</span>
          </label>
        </div>`;
    } else if (issue.type === 'missing_payer') {
      optionsHtml = `
        <div class="wizard-options-grid">
          <p>Choose who paid for this expense:</p>
          <div class="wizard-field-edit">
            <select id="payer_select_${issue.id}">
              ${membersList.map(m => `<option value="${m.user_name}">${m.user_name}</option>`).join('')}
            </select>
          </div>
        </div>`;
    } else if (issue.type === 'missing_currency') {
      optionsHtml = `
        <div class="wizard-options-grid">
          <p>Choose the correct currency:</p>
          <div class="wizard-field-edit">
            <select id="currency_select_${issue.id}">
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
            </select>
          </div>
        </div>`;
    } else if (issue.type === 'invalid_percentage') {
      optionsHtml = `
        <div class="wizard-options-grid">
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="normalize" checked>
            <span>Auto-Normalize percentages to 100% proportionally (e.g. 30%, 30%, 30%, 20% becomes 27.27%, 27.27%, 27.27%, 18.18%)</span>
          </label>
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="ignore">
            <span>Keep raw percentages (balances may be distorted)</span>
          </label>
        </div>`;
    } else if (issue.type === 'membership_violation') {
      optionsHtml = `
        <div class="wizard-options-grid">
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="remove_member" checked>
            <span>Remove Meera from split (re-split her share among other participants)</span>
          </label>
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="keep_member">
            <span>Force split with Meera anyway</span>
          </label>
        </div>`;
    } else if (issue.type === 'ambiguous_date') {
      optionsHtml = `
        <div class="wizard-options-grid">
          <p>Verify correct date:</p>
          <div class="wizard-field-edit">
            <label><input type="radio" name="res_${issue.id}" value="2026-04-05" checked> April 5, 2026</label>
            <label><input type="radio" name="res_${issue.id}" value="2026-05-04"> May 4, 2026</label>
          </div>
        </div>`;
    } else if (issue.type === 'settlement_detected') {
      optionsHtml = `
        <div class="wizard-options-grid">
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="convert_settlement" checked>
            <span>Convert to a direct Settlement (Rohan paid Aisha)</span>
          </label>
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="keep_expense">
            <span>Keep as a standard split expense</span>
          </label>
        </div>`;
    } else if (issue.type === 'missing_member') {
      optionsHtml = `
        <div class="wizard-options-grid">
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="add_to_group" checked>
            <span>Automatically add "${issue.name}" to the active group (Joined date set to: ${issue.date})</span>
          </label>
          <label class="wizard-option-row">
            <input type="radio" name="res_${issue.id}" value="ignore">
            <span>Skip adding (Warning: Splits referencing this user might fail or cause anomalies)</span>
          </label>
        </div>`;
    }

    container.innerHTML += `
      <div class="issue-wizard-card ${issue.type}">
        <h4>${issue.type.replace('_', ' ').toUpperCase()}: ${issue.message}</h4>
        <p>💡 <em>Suggestion:</em> ${issue.suggestion}</p>
        ${optionsHtml}
      </div>`;
  });
}

// Compute final cleaned row list and hit backend import endpoint
async function executeFinalImport() {
  // Safe helper to fetch checked radio value without throwing DOMExceptions on spaces/quotes
  const getCheckedRadioValue = (name) => {
    const elements = document.getElementsByName(name);
    const checked = Array.from(elements).find(el => el.checked);
    return checked ? checked.value : '';
  };

  // Handle adding missing members first
  for (const issue of importIssues) {
    if (issue.type === 'missing_member') {
      const choice = getCheckedRadioValue(`res_${issue.id}`);
      if (choice === 'add_to_group') {
        try {
          await fetch(`${API_BASE}/api/groups/${currentGroupId}/members`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              user_name: issue.name,
              joined_at: issue.date,
              left_at: null
            })
          });
        } catch (err) {
          console.error(`Failed to automatically add missing member ${issue.name}:`, err);
        }
      }
    }
  }

  const finalizedExpenses = [];
  const excludedIndices = new Set();
  
  // First, resolve conflict options and duplicates to filter raw rows
  importIssues.forEach(issue => {
    if (issue.type === 'duplicate') {
      const choice = getCheckedRadioValue(`res_${issue.id}`);
      if (choice === 'keep_first') {
        excludedIndices.add(issue.rows[1].csvIndex);
      } else if (choice === 'keep_second') {
        excludedIndices.add(issue.rows[0].csvIndex);
      }
    } else if (issue.type === 'conflict') {
      const choice = getCheckedRadioValue(`res_${issue.id}`);
      if (choice === 'keep_row_0') {
        excludedIndices.add(issue.rows[1].csvIndex);
      } else if (choice === 'keep_row_1') {
        excludedIndices.add(issue.rows[0].csvIndex);
      }
    }
  });

  // Loop through rawParsedRows and apply fixes
  for (let i = 0; i < rawCSVRows.length; i++) {
    if (excludedIndices.has(i)) continue; // skip deleted duplicate rows
    
    let row = { ...rawCSVRows[i] };
    
    // Fix 1: Missing Payer
    const payerIssue = importIssues.find(iss => iss.type === 'missing_payer' && iss.row.csvIndex === i);
    if (payerIssue) {
      row.paidBy = document.getElementById(`payer_select_${payerIssue.id}`).value;
    }
    
    // Fix 2: Missing Currency
    const currencyIssue = importIssues.find(iss => iss.type === 'missing_currency' && iss.row.csvIndex === i);
    if (currencyIssue) {
      row.currency = document.getElementById(`currency_select_${currencyIssue.id}`).value;
    }

    // Fetch exchange rate based on date and currency
    let rate = 1.0;
    if (row.currency && row.currency !== 'INR') {
      try {
        const rateRes = await fetch(`${API_BASE}/api/exchange-rate?currency=${row.currency}&date=${row.date}`);
        const rateData = await rateRes.json();
        rate = rateData.rate || 83.5;
      } catch (err) {
        rate = 83.5; // fallback
      }
    }
    
    // Fix 3: Settlement Conversion
    const settlementIssue = importIssues.find(iss => iss.type === 'settlement_detected' && iss.row.csvIndex === i);
    let isSettlement = false;
    if (settlementIssue) {
      const choice = getCheckedRadioValue(`res_${settlementIssue.id}`);
      if (choice === 'convert_settlement') {
        isSettlement = true;
      }
    } else if (row.description.toLowerCase().includes('paid back') || !row.splitType) {
      isSettlement = true;
    }

    // Fix 4: Ambiguous Date
    const dateIssue = importIssues.find(iss => iss.type === 'ambiguous_date' && iss.row.csvIndex === i);
    if (dateIssue) {
      row.date = getCheckedRadioValue(`res_${dateIssue.id}`);
    }

    // Fix 5: Meera Membership violation
    const membershipIssue = importIssues.find(iss => iss.type === 'membership_violation' && iss.row.csvIndex === i);
    if (membershipIssue) {
      const choice = getCheckedRadioValue(`res_${membershipIssue.id}`);
      if (choice === 'remove_member') {
        row.splitWith = row.splitWith.filter(name => name !== 'Meera');
        if (row.splitDetails && row.splitDetails['Meera']) {
          delete row.splitDetails['Meera'];
        }
      }
    }

    // Fix 6: Normalizing percentage splits
    const percentageIssue = importIssues.find(iss => iss.type === 'invalid_percentage' && iss.row.csvIndex === i);
    if (percentageIssue && row.splitType === 'percentage') {
      const choice = getCheckedRadioValue(`res_${percentageIssue.id}`);
      if (choice === 'normalize') {
        const totalPct = Object.values(row.splitDetails).reduce((a, b) => a + b, 0);
        const normalized = {};
        for (const name in row.splitDetails) {
          normalized[name] = (row.splitDetails[name] / totalPct) * 100;
        }
        row.splitDetails = normalized;
      }
    }

    // Build splits payload structure
    let splitsPayload = [];
    
    if (isSettlement) {
      // Recipient gets the full value
      const recipient = row.splitWith[0] || 'Aisha';
      splitsPayload = [{
        userName: recipient,
        value: row.amount,
        calculatedAmount: row.amount,
        calculatedAmountInr: row.amount * rate
      }];
    } else {
      // Normal Split Calculations
      const splitType = row.splitType || 'equal';
      
      if (splitType === 'equal') {
        const share = row.amount / row.splitWith.length;
        splitsPayload = row.splitWith.map(name => ({
          userName: name,
          value: 1.0,
          calculatedAmount: share,
          calculatedAmountInr: share * rate
        }));
      } else if (splitType === 'unequal') {
        splitsPayload = Object.keys(row.splitDetails).map(name => ({
          userName: name,
          value: row.splitDetails[name],
          calculatedAmount: row.splitDetails[name],
          calculatedAmountInr: row.splitDetails[name] * rate
        }));
      } else if (splitType === 'share') {
        const totalShares = Object.values(row.splitDetails).reduce((a, b) => a + b, 0);
        splitsPayload = Object.keys(row.splitDetails).map(name => {
          const shares = row.splitDetails[name];
          const shareAmt = (shares / totalShares) * row.amount;
          return {
            userName: name,
            value: shares,
            calculatedAmount: shareAmt,
            calculatedAmountInr: shareAmt * rate
          };
        });
      } else if (splitType === 'percentage') {
        splitsPayload = Object.keys(row.splitDetails).map(name => {
          const pct = row.splitDetails[name];
          const shareAmt = (pct / 100) * row.amount;
          return {
            userName: name,
            value: pct,
            calculatedAmount: shareAmt,
            calculatedAmountInr: shareAmt * rate
          };
        });
      }
    }

    finalizedExpenses.push({
      description: row.description,
      paidBy: row.paidBy,
      amount: row.amount,
      currency: row.currency || 'INR',
      exchangeRate: rate,
      splitType: isSettlement ? 'equal' : (row.splitType || 'equal'),
      date: row.date,
      notes: row.notes,
      isSettlement: isSettlement ? 1 : 0,
      splits: splitsPayload
    });
  }

  // Compile anomaly resolution report
  const anomalyReport = importIssues.map(issue => {
    let action = 'Unknown';
    try {
      if (issue.type === 'duplicate') {
        const val = getCheckedRadioValue(`res_${issue.id}`);
        action = val ? (val === 'keep_first' ? 'Keep first, discard duplicates' : val === 'keep_second' ? 'Keep second, discard duplicates' : 'Keep both') : 'No action selected';
      } else if (issue.type === 'conflict') {
        const val = getCheckedRadioValue(`res_${issue.id}`);
        action = val ? (val === 'keep_row_0' ? "Keep first log" : val === 'keep_row_1' ? "Keep second log" : 'Keep both') : 'No action selected';
      } else if (issue.type === 'missing_payer') {
        const el = document.getElementById(`payer_select_${issue.id}`);
        action = el ? `Set payer to ${el.value}` : 'No action selected';
      } else if (issue.type === 'missing_currency') {
        const el = document.getElementById(`currency_select_${issue.id}`);
        action = el ? `Set currency to ${el.value}` : 'No action selected';
      } else if (issue.type === 'settlement_detected') {
        const val = getCheckedRadioValue(`res_${issue.id}`);
        action = val ? (val === 'convert_settlement' ? 'Convert to direct settlement' : 'Keep as split expense') : 'No action selected';
      } else if (issue.type === 'invalid_percentage') {
        const val = getCheckedRadioValue(`res_${issue.id}`);
        action = val ? (val === 'normalize' ? 'Normalize percentages to 100%' : 'Keep raw percentages') : 'No action selected';
      } else if (issue.type === 'ambiguous_date') {
        const val = getCheckedRadioValue(`res_${issue.id}`);
        action = val ? `Set date to ${val}` : 'No action selected';
      } else if (issue.type === 'membership_violation') {
        const val = getCheckedRadioValue(`res_${issue.id}`);
        action = val ? (val === 'remove_member' ? 'Remove from split' : 'Force split anyway') : 'No action selected';
      } else if (issue.type === 'missing_member') {
        const val = getCheckedRadioValue(`res_${issue.id}`);
        action = val ? (val === 'add_to_group' ? 'Automatically add user to group' : 'Skip adding') : 'No action selected';
      }
    } catch (e) {
      console.error(e);
    }
    return {
      id: issue.id,
      type: issue.type,
      message: issue.message,
      actionTaken: action
    };
  });

  // Submit finalized records to database
  try {
    const res = await fetch(`${API_BASE}/api/import/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        groupId: currentGroupId,
        expenses: finalizedExpenses,
        report: anomalyReport
      })
    });
    const data = await res.json();
    
    if (res.ok) {
      document.getElementById('import-success-message').innerText = data.message;
      document.getElementById('import-step-wizard').classList.add('hidden');
      document.getElementById('import-step-success').classList.remove('hidden');
      refreshData();
    } else {
      alert(data.error || 'Confirm import failed');
    }
  } catch (err) {
    alert('Import confirmation request failed');
  }
}
