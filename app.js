// app.js - Shared JavaScript for all pages

// Supabase configuration
const SUPABASE_URL = "https://vjtxicimwuovikifkwyb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_GKDi350FTcPpHWwXfMapTw_hk2-8qaH";

// Initialize Supabase client
if (!window.supabaseClientInitialized) {
    // Create a single supabase client for interacting with database
    window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            // Keep user logged in across page reloads and browser sessions
            persistSession: true,

            // Use localStorage to store the session (default is localStorage)
            storageKey: 'supabase-auth',

            // Saves the session permanently
            storage: window.localStorage,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });
    window.supabaseClientInitialized = true;
}

// ============================================
// GLOBAL STATE
// ============================================
window.currentUser = null;
window.userProfile = null;
window.allTasks = [];
window.personalTasks = [];
window.GroupTasks = [];
window.projects = [];

// ============================================
// AUTH CHECK
// ============================================
window.checkAuth = async function() {
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        // If there's no session or an error occurred, redirect to login page
        if (error || !session) {
            window.location.href = 'login.html';
            return false;
        }
        // If session exists, set the current user
        window.currentUser = session.user;
        return true;
    } catch (err) {
        // If there's an error (e.g., network issue), log it and redirect to login  
        console.error('Auth error:', err);
        window.location.href = 'login.html';
        return false;
    }
};

// ============================================
// LOAD USER INFO
// ============================================
window.loadUserInfo = async function() {
    try {
        // error handling for missing currentUser
        if (!window.currentUser) {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) window.currentUser = user;
            else return null;
        }

        const { data: profile, error } = await supabase
            // TABLE profiles
            .from('profiles')
            .select('*')
            // The value to filter with is the current user's ID
            .eq('id', window.currentUser.id)
            // We expect only one profile per user, so we use maybeSingle() to get a single object or null
            .maybeSingle();

        if (error) console.warn('Profile load warning:', error);

        window.userProfile = profile || {
            full_name: window.currentUser.user_metadata?.full_name || window.currentUser.email?.split('@')[0] || 'User',
            email: window.currentUser.email
        };

        const fullName = window.userProfile.full_name || 'Unknown User';
        const initials = fullName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || 'U';

        // Update all user elements
        const elements = {
            'userName': fullName,
            'userEmail': window.userProfile.email || window.currentUser.email || '',
            'userAvatar': initials,
            'bottomAvatar': initials,
            'profileTrigger': initials
        };

        Object.entries(elements).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });

        return window.currentUser;
    } catch (err) {
        console.error('Error loading user info:', err);
        return null;
    }
};

// ============================================
// LOAD NOTIFICATION COUNT
// ============================================
window.loadNotificationCount = async function() {
    try {
        if (!window.currentUser?.id) return 0;

        const { data: notifs, error } = await supabase
            .from('notifications')
            .select('id')
            .eq('user_id', window.currentUser.id)
            .eq('is_read', false);

        if (error) throw error;

        const count = notifs?.length || 0;
        ['sidebarBadge', 'bottomBadge', 'notificationBadge'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = count;
        });
        return count;
    } catch (err) {
        console.error('Error loading notification count:', err);
        return 0;
    }
};

// ============================================
// LOAD NOTIFICATIONS
// ============================================
window.loadNotifications = async function() {
    try {
        if (!window.currentUser?.id) return [];

        const { data: notifs, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', window.currentUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        window.notifications = notifs || [];
        return window.notifications;
    } catch (err) {
        console.error('Error loading notifications:', err);
        return [];
    }
};

// ============================================
// LOAD TASKS
// ============================================
window.loadTasks = async function() {
    try {
        if (!window.currentUser?.id) {
            window.allTasks = [];
            window.personalTasks = [];
            window.groupTasks = [];
            return { allTasks: [], personalTasks: [], groupTasks: [] };
        }

        const userId = window.currentUser.id;

        const { data: tasks, error } = await supabase
            .from("tasks")
            .select("*")
            .or(`assignee_id.eq.${userId},created_by.eq.${userId}`)
            .order("due_date", { ascending: true, nullsFirst: false });

        if (error) throw error;

        window.allTasks = tasks || [];
        window.personalTasks = window.allTasks.filter(task => task.is_group_task === false || task.is_group_task === null);
        window.groupTasks = window.allTasks.filter(task => task.is_group_task === true);

        return {
            allTasks: window.allTasks,
            personalTasks: window.personalTasks,
            groupTasks: window.groupTasks
        };
    } catch (error) {
        console.error('loadTasks failed:', error);
        window.allTasks = [];
        window.personalTasks = [];
        window.groupTasks = [];
        throw error;
    }
};

// ============================================
// LOAD PROJECTS
// ============================================
window.loadProjects = async function() {
    try {
        if (!window.currentUser?.id) {
            window.projects = [];
            return [];
        }

        const userId = window.currentUser.id;

        const { data: createdProjects, error: createdError } = await supabase
            .from("projects")
            .select("*")
            .eq("created_by", userId);

        if (createdError) throw createdError;

        const { data: memberships, error: membershipError } = await supabase
            .from("project_members")
            .select("project_id")
            .eq("user_id", userId);

        if (membershipError) throw membershipError;

        const projectIds = (memberships || []).map(row => row.project_id).filter(Boolean);

        let memberProjects = [];
        if (projectIds.length > 0) {
            const { data, error } = await supabase
                .from("projects")
                .select("*")
                .in("id", projectIds);

            if (error) throw error;
            memberProjects = data || [];
        }

        const combined = [...(createdProjects || []), ...memberProjects];
        const uniqueProjects = Array.from(new Map(combined.map(p => [p.id, p])).values());
        uniqueProjects.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

        window.projects = uniqueProjects;
        return window.projects;
    } catch (error) {
        console.error('loadProjects failed:', error);
        window.projects = [];
        throw error;
    }
};

// ============================================
// SHARED UTILITY FUNCTIONS
// ============================================
window.escapeHtml = function(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
};

window.fmtDate = function(dateStr) {
    if (!dateStr) return 'No date';
    let d;
    if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateStr.trim())) {
        const [y, m, day] = dateStr.trim().slice(0, 10).split('-').map(Number);
        d = new Date(y, m - 1, day);
    } else {
        d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return 'No date';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

window.timeAgo = function(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return window.fmtDate(dateStr);
};

window.renderEmptyState = function(icon, title, message) {
    return `
        <div class="empty">
            <div class="empty-icon">${icon || '○'}</div>
            <h3>${title}</h3>
            <p>${message}</p>
        </div>
    `;
};


// ============================================
// NAVBAR & TOPBAR
// ============================================
function getPageTitle(activePage) {
    const titles = {
        'dashboard': 'Dashboard',
        'personal': 'Personal Tasks',
        'group': 'Group Tasks',
        'notifications': 'Notifications',
        'profile': 'Profile',
    };
    return titles[activePage] || 'TaskFlow';
}

window.loadTopbar = function(activePage) {
    const top_container = document.getElementById('topbar-container');
    if (!top_container) return Promise.resolve();

    top_container.innerHTML = `
        <header class="topbar">
            <div class="topbar-left">   
            </div>
            <div class="topbar-actions">                
                <button class="icon-btn notification-trigger" id="notificationBtn" title="Notifications">
                    <i class="bx bx-bell"></i>
                    <b id="notificationBadge">0</b>
                </button>
                
                <button class="theme-toggle" id="themeToggle" title="Toggle theme" aria-label="Switch to dark theme" aria-pressed="false">
                    <span class="theme-toggle-icon theme-toggle-light"><i class="bx bx-sun"></i></span>
                    <span class="theme-toggle-icon theme-toggle-dark"><i class="bx bx-moon"></i></span>
                    <span class="theme-toggle-thumb" aria-hidden="true"></span>
                </button>
                
                <button class="avatar profile-trigger" id="profileTrigger" title="Profile">
                    <span id="topbarAvatar">U</span>
                </button>
            </div>
        </header>
    `;

    const themeToggle = document.getElementById('themeToggle');
    const currentThemeIsDark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeToggle?.setAttribute('aria-pressed', String(currentThemeIsDark));
    themeToggle?.setAttribute('aria-label', currentThemeIsDark ? 'Switch to light theme' : 'Switch to dark theme');

    // Bind topbar events
    themeToggle?.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const nextTheme = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
        localStorage.setItem('taskflow-theme', nextTheme);
        document.getElementById('themeToggle')?.setAttribute('aria-pressed', String(nextTheme === 'dark'));
        document.getElementById('themeToggle')?.setAttribute('aria-label', nextTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    });

    document.getElementById('notificationBtn')?.addEventListener('click', () => {
        window.location.href = 'notifications.html';
    });

    document.getElementById('profileTrigger')?.addEventListener('click', () => {
        window.location.href = 'profile.html';
    });

    return Promise.resolve();
};

window.loadNavbar = function(activePage) {
    const container = document.getElementById('navbar-container');
    if (!container) return Promise.resolve();

    container.innerHTML = `
        <aside class="sidebar" id="sidebar">
            <div class="brand">
                <div class="brand-mark">
                    <i class="bx bx-task"></i>
                </div>
                <div>
                    <strong>TaskFlow</strong>
                    <span>Work organize</span>
                </div>
            </div>
            
            <nav class="main-nav">
                <div class="nav-label">Menu</div>
                <ul class="nav-ul">
                    <li>
                        <button class="nav-item ${activePage === 'dashboard' ? 'active' : ''}" data-page="dashboard" data-href="dashboard.html">
                            <i class="bx bx-grid-alt"></i>
                            <span class="nav-label-text">Dashboard</span>
                        </button>
                    </li>
                    <li>
                        <button class="nav-item ${activePage === 'personal' ? 'active' : ''}" data-page="personal" data-href="personal.html">
                            <i class="bx bx-check-circle"></i>
                            <span class="nav-label-text">Personal</span>
                        </button>
                    </li>
                    <li>
                        <button class="nav-item ${activePage === 'group' ? 'active' : ''}" data-page="group" data-href="group.html">
                            <i class="bx bx-group"></i>
                            <span class="nav-label-text">Group</span>
                        </button>
                    </li>
                </ul>
            </nav>
            
            <div class="sidebar-bottom">
                <div class="mini-user">
                    <div class="avatar" id="userAvatar">U</div>
                    <div>
                        <strong id="userName">User</strong>
                        <span id="userEmail">user@email.com</span>
                    </div>
                    <button class="icon-btn" id="logoutBtn">
                        <i class="bx bx-log-out"></i>
                    </button>
                </div>
            </div>
        </aside>

        <nav class="bottom-nav" id="bottomNav">
            <ul>
                <li>
                    <button class="bottom-nav-item ${activePage === 'dashboard' ? 'active' : ''}" data-page="dashboard" data-href="dashboard.html">
                        <i class="bx bx-grid-alt bottom-nav-icon"></i>
                        <span class="bottom-nav-label">Dashboard</span>
                    </button>
                </li>
                <li>
                    <button class="bottom-nav-item ${activePage === 'personal' ? 'active' : ''}" data-page="personal" data-href="personal.html">
                        <i class="bx bx-check-circle bottom-nav-icon"></i>
                        <span class="bottom-nav-label">Personal</span>
                    </button>
                </li>
                <li>
                    <button class="bottom-nav-item ${activePage === 'group' ? 'active' : ''}" data-page="group" data-href="group.html">
                        <i class="bx bx-group bottom-nav-icon"></i>
                        <span class="bottom-nav-label">Group</span>
                    </button>
                </li>
                <li>
                    <button class="bottom-nav-item" id="bottomProfile" data-href="profile.html">
                        <span class="avatar-sm" id="bottomAvatar">U</span>
                        <span class="bottom-nav-label">Profile</span>
                    </button>
                </li>
                <li>
                    <button class="bottom-nav-item" id="bottomLogout">
                        <i class="bx bx-log-out bottom-nav-icon"></i>
                        <span class="bottom-nav-label">Logout</span>
                    </button>
                </li>
            </ul>
        </nav>
    `;

    // Bind navigation events
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(item => {
        item.addEventListener('click', function() {
            const href = this.dataset.href;
            if (href) {
                window.location.href = href;
            }
        });
    });

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    const bottomLogout = document.getElementById('bottomLogout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to logout?')) {
                await supabase.auth.signOut();
                window.location.href = 'login.html';
            }
        });
    }
    if (bottomLogout) {
        bottomLogout.addEventListener('click', async () => {
            if (confirm('Are you sure you want to logout?')) {
                await supabase.auth.signOut();
                window.location.href = 'login.html';
            }
        });
    }
};

console.log('✅ TaskFlow App initialized');
console.log('🔌 Connected to Supabase:', SUPABASE_URL); 