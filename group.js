// group.js — Group (collaborative) projects page

// ============================================================================
// 1. STATE + INIT
// ============================================================================

window._GroupState = {
    activeProject: null,
    view: 'list',
    search: '',
    status: '',
    priority: '',
    sort: 'due_asc',
    subtasksByTask: {},
    commentTaskId: null,
    subtaskDetailId: null,
    comments: {},
    attachments: {},
    loadingAttachments: false
};

window.initGroup = async function () {
    try {
        const isAuth = await window.checkAuth();
        if (!isAuth) return;

        await window.loadNavbar('group');
        await window.loadTopbar('group');
        await window.loadUserInfo();
        await window.loadNotificationCount();
        await window.loadProjects();
        await window.loadTasks();
        await loadAllGroupProjectTasks();
        await loadAllProfilesCache();  

        const savedTheme = localStorage.getItem('taskflow-theme');
        if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

        await autoPromoteStartedTasks();

        window._GroupState = {
            activeProject: null,
            view: 'list',
            search: '',
            status: '',
            priority: '',
            subtasksByTask: {},
            commentTaskId: null,
            subtaskDetailId: null,
            comments: {},
            attachments: {},
            loadingAttachments: false,
            projectSearch: ''
        };
        window.refreshTaskViewCallback = renderGroupPage;

        renderGroupPage();
    } catch (err) {
        console.error('Error initializing Group page:', err);
        const pageContent = document.getElementById('pageContent');
        if (pageContent) {
            pageContent.innerHTML = `
                <div class="empty">
                    <div class="empty-icon">\u26a0</div>
                    <h3>Something went wrong</h3>
                    <p>${err.message || 'Please refresh and try again.'}</p>
                </div>`;
        }
    }
};

async function loadAllGroupProjectTasks() {
    const projectIds = (window.projects || []).map(p => p.id).filter(Boolean);
    if (projectIds.length === 0) {
        window.GroupTasks = [];
        window._projectLeaders = {};
        return;
    }

    const { data: tasks, error } = await supabase
        .from('tasks')
        .select('*')
        .in('project_id', projectIds)
        .order('due_date', { ascending: true, nullsFirst: false });
    if (error) throw error;
    window.GroupTasks = tasks || [];

    // 👇 NEW: resolve each project's leader name
    await loadProjectLeaders(projectIds);
}

async function loadAllProfilesCache() {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .limit(500);
        if (error) throw error;
        window._allProfiles = {};
        (data || []).forEach(p => { window._allProfiles[String(p.id)] = p; });
    } catch (err) {
        console.error('Failed to load profile cache:', err);
        window._allProfiles = {};
    }
}

async function loadProjectLeaders(projectIds) {
    window._projectLeaders = window._projectLeaders || {};

    // Collect unique leader user IDs from the projects we already have
    const leaderIds = new Set();
    (window.projects || []).forEach(p => {
        const id = p.created_by || p.owner_id;
        if (id) leaderIds.add(String(id));
    });

    const ids = Array.from(leaderIds);
    if (ids.length === 0) return;

    try {
        const { data: profiles, error } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', ids);
        if (error) throw error;

        const byId = {};
        (profiles || []).forEach(prof => { byId[String(prof.id)] = prof; });

        (window.projects || []).forEach(p => {
            const leaderId = String(p.created_by || p.owner_id || '');
            window._projectLeaders[p.id] = byId[leaderId] || null;
        });
    } catch (err) {
        console.error('Failed to load project leaders:', err);
    }
}

async function autoPromoteStartedTasks() {
    const today = new Date().toISOString().slice(0, 10);
    const candidates = (window.GroupTasks || []).filter(t =>
        t.status === 'pending' && t.start_date && t.start_date <= today
    );
    if (candidates.length === 0) return;
    const ids = candidates.map(t => t.id);
    const { error } = await supabase.from('tasks').update({ status: 'in-progress' }).in('id', ids);
    if (error) { console.error('Auto-promote failed:', error); return; }
    candidates.forEach(t => { t.status = 'in-progress'; });
}

function renderGroupPage() {
    renderGroupRoot();
}

// ============================================================================
// 2. HELPERS
// ============================================================================

function isProjectLeader(projectOrId) {
    const project = typeof projectOrId === 'object'
        ? projectOrId
        : (window.projects || []).find(p => String(p.id) === String(projectOrId));
    if (!project) return false;
    const leaderId = project.created_by;
    return String(leaderId) === String(window.currentUser?.id);
}

function getEffectiveStatus(task) {
    if (!task) return 'pending';
    if (task.status === 'completed') return 'completed';

    if (task.due_date) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const due = new Date(task.due_date + 'T00:00:00');
        if (!Number.isNaN(due.getTime())) {
            // Due today or earlier (and not completed) → overdue
            if (due <= today) return 'overdue';
        }
    }

    if (task.status === 'in-progress') return 'in-progress';
    return 'pending';
}

const STATUS_ORDER = { 'overdue': 0, 'in-progress': 1, 'pending': 2, 'completed': 3 };
function statusRank(status) { return STATUS_ORDER[status] ?? 99; }

function sortTasksForCardView(tasks) {
    const pr = { high: 0, medium: 1, low: 2 };
    return [...tasks].sort((a, b) => {
        const s = statusRank(getEffectiveStatus(a)) - statusRank(getEffectiveStatus(b));
        if (s !== 0) return s;
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        if (da !== db) return da - db;
        return (pr[a.priority] ?? 99) - (pr[b.priority] ?? 99);
    });
}

function renderCountdown(dueDate) {
    if (!dueDate) return '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate + 'T00:00:00');
    if (Number.isNaN(due.getTime())) return '';

    const diffMs = due - today;
    const days = Math.round(diffMs / 86400000);

    let label = '';
    let cls = 'ok';

    if (days < 0) {
        label = `⏱ ${Math.abs(days)}d overdue`;
        cls = 'overdue';
    } else if (days === 0) {
        label = '⏱ Due today';
        cls = 'soon';
    } else if (days === 1) {
        label = '⏱ Due tomorrow';
        cls = 'soon';
    } else if (days <= 3) {
        label = `⏱ ${days}d left`;
        cls = 'soon';
    } else {
        label = `⏱ ${days}d left`;
        cls = 'ok';
    }

    return `<div class="countdown ${cls}">${label}</div>`;
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentIcon(file) {
    const type = file.file_type || '';
    const name = (file.file_name || '').toLowerCase();
    if (type.startsWith('image/')) return 'bx-image';
    if (type === 'application/pdf') return 'bx-file';
    if (name.endsWith('.doc') || name.endsWith('.docx')) return 'bx-file-doc';
    if (name.endsWith('.zip')) return 'bx-archive';
    if (name.endsWith('.txt')) return 'bx-file-blank';
    return 'bx-paperclip';
}

function formatCommentTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

function parseLegacyAttachments(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; }
        catch { return []; }
    }
    return [];
}

function renderAssignee(members, userId) {
    if (!userId) return '<span style="color:var(--muted)">Unassigned</span>';

    // 1. Try the passed-in member list
    let m = memberById(members, userId);

    // 2. Fall back to the current user's own profile
    if (!m && String(userId) === String(window.currentUser?.id) && window.userProfile) {
        m = window.userProfile;
    }

    // 3. Fall back to the project-leader cache (already loaded)
    if (!m && window._projectLeaders) {
        m = Object.values(window._projectLeaders).find(
            p => p && String(p.id) === String(userId)
        ) || null;
    }

    if (!m) {
        // Last resort — show a short ID fragment so it's not a lie
        return `<span style="color:var(--muted)" title="User ${window.escapeHtml(String(userId))}">Team member</span>`;
    }

        // 4. Fall back to the global profile cache
    if (!m && window._allProfiles) {
        m = window._allProfiles[String(userId)] || null;
    }

    const isMe = String(userId) === String(window.currentUser?.id);
    if (isMe) {
        return `<span class="assignee-me"><i class="bx bx-user-check"></i>You</span>`;
    }
    return window.escapeHtml(m.full_name || 'Team member');
}

function memberById(members, userId) {
    if (!userId) return null;
    if (!Array.isArray(members)) return null;
    return members.find(mm => String(mm.id) === String(userId)) || null;
}

function userInitialBadge(members, userId) {
    const m = memberById(members, userId);
    const name = m?.full_name || 'Team member';
    const initial = name.charAt(0).toUpperCase();
    const colors = ['#5865f2', '#20a66a', '#d99118', '#e45454', '#3b82f6'];
    const idx = Math.abs(String(userId || 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % colors.length;
    return `<span class="avatar-initial" style="background:${colors[idx]}" title="${window.escapeHtml(name)}">${initial}</span>`;
}

function getGroupSortState() {
    if (!window._GroupState.sort) {
        window._GroupState.sort = 'due_asc';
    }
    return window._GroupState.sort;
}

function getGroupSortIndicator(sortKey) {
    const active = getGroupSortState();
    const activeKey = active.replace(/_(asc|desc)$/, '');
    if (activeKey !== sortKey) return '';
    return active.endsWith('_desc') ? ' ↓' : ' ↑';
}

function toggleGroupSort(sortKey) {
    const active = getGroupSortState();
    const activeKey = active.replace(/_(asc|desc)$/, '');
    const nextDir = activeKey === sortKey && active.endsWith('_asc') ? 'desc' : 'asc';
    window._GroupState.sort = `${sortKey}_${nextDir}`;
    renderProjectWorkspace(window._GroupState.activeProject);
}

function applyGroupSort(tasks) {
    const active = getGroupSortState();
    const sortKey = active.replace(/_(asc|desc)$/, '');
    const dir = active.endsWith('_desc') ? -1 : 1;

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const statusOrder = { 'overdue': 0, 'in-progress': 1, 'pending': 2, 'completed': 3 };

    const sorters = {
        assigned: (a, b) =>
            String(a.assignee_id || '').localeCompare(String(b.assignee_id || '')),
        priority: (a, b) =>
            (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3),
        status: (a, b) =>
            (statusOrder[getEffectiveStatus(a)] ?? 9) - (statusOrder[getEffectiveStatus(b)] ?? 9),
        due: (a, b) =>
            new Date(a.due_date || '9999-12-31') - new Date(b.due_date || '9999-12-31')
    };

    return [...tasks].sort((a, b) => (sorters[sortKey] || sorters.due)(a, b) * dir);
}

// ============================================================================
// 3. DATA LOADERS
// ============================================================================

async function loadSubtasksForTasks(taskIds) {
    window._GroupState.subtasksByTask = {};
    if (!taskIds || taskIds.length === 0) return;
    try {
        const { data, error } = await supabase
            .from('subtasks')
            .select('id, task_id, title, completed, assignee_id')
            .in('task_id', taskIds);
        if (error) throw error;
        (data || []).forEach(s => {
            if (!window._GroupState.subtasksByTask[s.task_id]) {
                window._GroupState.subtasksByTask[s.task_id] = [];
            }
            window._GroupState.subtasksByTask[s.task_id].push(s);
        });
    } catch (err) { console.error('Error loading subtasks:', err); }
}

async function loadGroupComments(taskIds) {
    if (!taskIds?.length) { window._GroupState.comments = {}; return; }
    const { data, error } = await supabase
        .from('comments')
        .select(`id, task_id, user_id, content, created_at, updated_at, attachments,
                 profiles:user_id ( full_name, email )`)
        .in('task_id', taskIds)
        .order('created_at', { ascending: true });
    if (error) { console.error('Failed to load group comments:', error); return; }
    const grouped = {};
    (data || []).forEach(c => {
        if (!grouped[c.task_id]) grouped[c.task_id] = [];
        const profile = c.profiles || {};
        grouped[c.task_id].push({
            id: c.id, userId: c.user_id,
            author: profile.full_name || 'Team member',
            email: profile.email || '',
            text: c.content || '', content: c.content || '',
            createdAt: c.created_at, updatedAt: c.updated_at,
            time: formatCommentTime(c.created_at),
            attachments: parseLegacyAttachments(c.attachments)
        });
    });
    window._GroupState.comments = grouped;
}

/**
 * Loads task-level, subtask-level, comment-level, AND project-level
 * attachments.
 *
 * Task/subtask attachments are grouped by their parent id.
 * Comment attachments are merged into the matching comment objects.
 * Project-level attachments are stored under a `__project__<id>` key
 * so `renderFinalDeliverables` can pick them up.
 */
async function loadGroupAttachments(taskIds, projectId = null) {
    if (!taskIds?.length && !projectId) {
        window._GroupState.attachments = {};
        return;
    }

    window._GroupState.loadingAttachments = true;
    try {
        // --- 1. Task-level attachments ---
        let taskFiles = [];
        if (taskIds?.length) {
            const { data } = await supabase
                .from('task_attachments').select('*').in('task_id', taskIds)
                .order('created_at', { ascending: true });
            taskFiles = data || [];
        }

        // --- 2. Subtask-level attachments ---
        const subtaskIds = Object.values(window._GroupState.subtasksByTask || {})
            .flat().map(s => s.id).filter(Boolean);
        let subtaskFiles = [];
        if (subtaskIds.length) {
            const { data } = await supabase
                .from('task_attachments').select('*').in('subtask_id', subtaskIds)
                .order('version', { ascending: true, nullsFirst: false })
                .order('created_at', { ascending: true });
            subtaskFiles = data || [];
        }

        // --- 3. Comment-level attachments ---
        const commentIds = Object.values(window._GroupState.comments || {})
            .flat().map(c => c.id).filter(Boolean);
        let commentFiles = [];
        if (commentIds.length) {
            const { data } = await supabase
                .from('task_attachments').select('*').in('comment_id', commentIds)
                .order('created_at', { ascending: true });
            commentFiles = data || [];
        }

        // --- 4. Project-level attachments ---
        let projectFiles = [];
        if (projectId) {
            const { data } = await supabase
                .from('task_attachments').select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: true });
            projectFiles = data || [];
        }

        // --- Group task + subtask attachments by parent id ---
        const grouped = {};
        [...(taskFiles || []), ...subtaskFiles].forEach(file => {
            const parentId = file.task_id || file.subtask_id;
            if (!parentId) return;
            if (!grouped[parentId]) grouped[parentId] = [];
            grouped[parentId].push(file);
        });

        // Store project-level files under a special key
        if (projectId) {
            grouped[`__project__${projectId}`] = projectFiles;
        }

        window._GroupState.attachments = grouped;

        // --- Merge comment attachments into comments themselves ---
        if (commentFiles.length) {
            Object.keys(window._GroupState.comments).forEach(taskId => {
                window._GroupState.comments[taskId] = window._GroupState.comments[taskId].map(comment => ({
                    ...comment,
                    attachments: [
                        ...(comment.attachments || []),
                        ...commentFiles.filter(f => f.comment_id === comment.id)
                    ]
                }));
            });
        }
    } finally {
        window._GroupState.loadingAttachments = false;
    }
}

// ============================================================================
// 4. ROOT RENDER
// ============================================================================

function renderGroupRoot() {
    const pageContent = document.getElementById('pageContent');
    const projects = window.projects || [];
    const expandedId = window._GroupState.activeProject;
    const searchQuery = (window._GroupState.projectSearch || '').toLowerCase();

    const filteredProjects = searchQuery
        ? projects.filter(p =>
            (p.name || '').toLowerCase().includes(searchQuery) ||
            (p.description || '').toLowerCase().includes(searchQuery))
        : projects;

    pageContent.innerHTML = `
        <div class="page-head group-page-head">
            <div>
                <h2>Group Projects</h2>
                <p>Collaborative projects you own or are a member of.</p>
            </div>
            <div class="page-actions">
                <button type="button" class="btn secondary" id="createProjectBtn">
                    <i class="bx bx-folder-plus"></i> <span class="btn-text">New Project</span>
                </button>
                <button type="button" class="btn primary" id="addGroupTaskFromProjects">
                    <i class="bx bx-plus"></i> <span class="btn-text">Add Task</span>
                </button>
            </div>
        </div>

        <div class="project-search">
            <i class="bx bx-search"></i>
            <input type="text" id="projectSearchInput"
                   placeholder="Search projects..."
                   value="${window.escapeHtml(window._GroupState.projectSearch || '')}">
        </div>

        <div class="Group-projects" id="projectGrid">
            ${filteredProjects.length === 0
                ? window.renderEmptyState('\u25eb', 'No projects found', searchQuery ? 'Try a different search.' : "You're not part of any project yet.")
                : filteredProjects.map(p => renderProjectCard(p, String(p.id) === String(expandedId))).join('')}
        </div>

        ${expandedId ? `<div id="groupWorkspaceMount" class="group-workspace-mount"></div>` : ''}
    `;

    // ===== NEW PROJECT BUTTON =====
    const createProjectBtn = document.getElementById('createProjectBtn');
    if (createProjectBtn) {
        createProjectBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openCreateProjectModal();
        });
    }

    // ===== ADD TASK FROM PROJECTS BUTTON =====
    document.getElementById('addGroupTaskFromProjects').addEventListener('click', () => {
        if (window._GroupState.activeProject) {
            window.openTaskModal({
                mode: 'add',
                taskType: 'Group',
                projectId: window._GroupState.activeProject
            });
        } else {
            if (!window.projects || window.projects.length === 0) {
                window.showToast('Create a project first before adding a task', 'warning');
                return;
            }
            window.openTaskModal({
                mode: 'add',
                taskType: 'Group'
            });
        }
    });

    // ===== PROJECT SEARCH =====
    const searchInput = document.getElementById('projectSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', e => {
            window._GroupState.projectSearch = e.target.value;
            renderGroupRoot();
            const newInput = document.getElementById('projectSearchInput');
            if (newInput) {
                newInput.focus();
                newInput.setSelectionRange(e.target.value.length, e.target.value.length);
            }
        });
    }

    // ===== PROJECT CARD EXPANSION =====
    document.querySelectorAll('.project-card[data-project]').forEach(card => {
        const projectId = card.dataset.project;
        card.querySelector('.project-card-header')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            toggleProjectExpansion(projectId);
        });
    });

    if (expandedId) {
        renderProjectWorkspace(expandedId);
    }
}

function toggleProjectExpansion(projectId) {
    if (String(window._GroupState.activeProject) === String(projectId)) {
        window._GroupState.activeProject = null;
    } else {
        window._GroupState.activeProject = projectId;
    }
    renderGroupPage();
    if (window._GroupState.activeProject) {
        setTimeout(() => {
            document.getElementById('groupWorkspaceMount')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
    }
}

// ============================================================================
// 5. PROJECT CARD
// ============================================================================

function renderProjectCard(p, isExpanded) {
    const projectTasks = (window.GroupTasks || []).filter(t => String(t.project_id) === String(p.id));
    const taskCount = projectTasks.length;
    const completedCount = projectTasks.filter(t => t.status === 'completed').length;
    const overdueCount = projectTasks.filter(t => getEffectiveStatus(t) === 'overdue').length;
    const progress = taskCount
        ? Math.round((completedCount / taskCount) * 100)
        : (p.progress || 0);

    // ✅ Declared BEFORE it's used anywhere below
    const isLeader = isProjectLeader(p);

    // Progress bar color, based on project state
    let barClass = '';
    if (overdueCount > 0)      barClass = 'bar-danger';
    else if (progress === 100) barClass = 'bar-done';
    else if (progress > 0)     barClass = 'bar-active';

    return `
        <div class="card project-card ${isExpanded ? 'expanded' : ''}" data-project="${p.id}">
            <div class="project-card-header">
                <div class="project-top">
                    <strong>${window.escapeHtml(p.name)}</strong>
                    <span class="status-pill ${p.status === 'active' ? 'in-progress' : 'pending'}">
                        <span class="status-dot"></span>${p.status || 'planning'}
                    </span>
                </div>
                ${(() => {
                    const leaderId = p.created_by || p.owner_id;
                    const leaderMember = (window._projectLeaders && window._projectLeaders[p.id]) || null;
                    const leaderName = leaderMember?.full_name
                        || (String(leaderId) === String(window.currentUser?.id)
                                ? (window.userProfile?.full_name || 'You')
                                : 'Team member');

                    const badgeLabel = isLeader ? 'You are the leader' : `${leaderName} · Leader`;

                    return `
                        <span class="leader-badge ${isLeader ? '' : 'muted'}"
                            title="${window.escapeHtml(leaderName)}">
                            <i class="bx bx-crown"></i> ${window.escapeHtml(badgeLabel)}
                        </span>
                    `;
                })()}
                <p>${window.escapeHtml(p.description || 'No description')}</p>
                <div class="progress-track">
                    <div class="progress-fill ${barClass}" style="width:${progress}%"></div>
                </div>
                <div class="project-meta">
                    <span>${progress}% complete · ${taskCount} tasks</span>
                    <div class="members" id="members-${p.id}"></div>
                </div>
            </div>

            <div class="project-card-footer">
                ${isLeader
                    ? `<div class="project-corner-actions">
                        <button type="button"
                                class="project-corner-btn"
                                data-edit-project="${p.id}"
                                title="Edit project">
                            <i class="bx bx-edit"></i>
                        </button>
                        <button type="button"
                                class="project-corner-btn project-corner-danger"
                                data-delete-project="${p.id}"
                                title="Delete project">
                            <i class="bx bx-trash"></i>
                        </button>
                    </div>`
                    : ''}

                <div class="project-card-main-actions">
                    ${isLeader
                        ? `<button type="button" class="btn secondary btn-sm"
                                data-add-member="${p.id}"
                                title="Add member">
                            <i class="bx bx-user-plus"></i> Add member
                        </button>`
                        : ''}
                    <button type="button" class="btn ${isExpanded ? 'secondary' : 'primary'} project-expand-btn"
                            data-toggle-expand="${p.id}">
                        <i class="bx ${isExpanded ? 'bx-collapse-vertical' : 'bx-expand-vertical'}"></i>
                        ${isExpanded ? 'Collapse' : 'Open workspace'}
                    </button>
                </div>
            </div>
        </div>
    `;
}

function openEditProjectModal(projectId) {
    const project = (window.projects || []).find(p => String(p.id) === String(projectId));
    if (!project) {
        window.showToast('Project not found', 'error');
        return;
    }
    if (!isProjectLeader(project)) {
        window.showToast('Only the project leader can edit this project', 'warning');
        return;
    }

    document.getElementById('editProjectModalRoot')?.remove();

    const root = document.createElement('div');
    root.id = 'editProjectModalRoot';
    root.innerHTML = `
        <div class="modal-backdrop" id="editProjectBackdrop"></div>
        <div class="modal" id="editProjectModal" style="width:460px" role="dialog" aria-modal="true">
            <div class="modal-head">
                <div><div class="eyebrow">Edit Project</div><h2>Update Project</h2></div>
                <button type="button" class="icon-btn" id="closeEditProjectModal" title="Close">
                    <i class="bx bx-x"></i>
                </button>
            </div>
            <form id="editProjectForm">
                <div class="form-grid">
                    <div class="full">
                        <label>Project Name *</label>
                        <input type="text" id="epName" required maxlength="120"
                               value="${window.escapeHtml(project.name || '')}">
                    </div>
                    <div class="full">
                        <label>Description</label>
                        <textarea id="epDescription" rows="3"
                                  placeholder="Optional details...">${window.escapeHtml(project.description || '')}</textarea>
                    </div>
                    <div>
                        <label>Status</label>
                        <select id="epStatus">
                            <option value="planning"  ${project.status === 'planning'  ? 'selected' : ''}>Planning</option>
                            <option value="active"    ${project.status === 'active'    ? 'selected' : ''}>Active</option>
                            <option value="completed" ${project.status === 'completed' ? 'selected' : ''}>Completed</option>
                        </select>
                    </div>
                    <div>
                        <label>Due Date</label>
                        <input type="date" id="epDueDate"
                               value="${project.due_date ? String(project.due_date).slice(0, 10) : ''}">
                    </div>
                </div>
                <p class="form-note" id="epError"></p>
                <div class="modal-actions">
                    <button type="button" class="btn secondary" id="cancelEditProject">Cancel</button>
                    <button type="submit" class="btn primary" id="epSubmit">Save Changes</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(root);

    const closeModal = () => root.remove();
    document.getElementById('closeEditProjectModal').addEventListener('click', closeModal);
    document.getElementById('cancelEditProject').addEventListener('click', closeModal);
    document.getElementById('editProjectBackdrop').addEventListener('click', closeModal);

    document.getElementById('editProjectForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('epError');
        errorEl.textContent = '';

        const name = document.getElementById('epName').value.trim();
        const description = document.getElementById('epDescription').value.trim();
        const status = document.getElementById('epStatus').value;
        const due_date = document.getElementById('epDueDate').value || null;

        if (!name) {
            errorEl.textContent = 'Project name is required.';
            return;
        }

        const submitBtn = document.getElementById('epSubmit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        try {
            const { error } = await supabase
                .from('projects')
                .update({ name, description: description || null, status, due_date })
                .eq('id', projectId);
            if (error) throw error;

            // Update local state
            Object.assign(project, { name, description, status, due_date });

            closeModal();
            window.showToast(`Project "${name}" updated`, 'success');

            if (String(window._GroupState.activeProject) === String(projectId)) {
                renderProjectWorkspace(projectId);
            } else {
                renderGroupPage();
            }
        } catch (err) {
            console.error('Edit project failed:', err);
            errorEl.textContent = err.message || 'Failed to update project.';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Changes';
        }
    });

    requestAnimationFrame(() => {
        document.getElementById('editProjectBackdrop').classList.add('show');
        document.getElementById('editProjectModal').classList.add('show');
        document.getElementById('epName').focus();
    });
}

document.addEventListener('click', async (e) => {
    const addMemberBtn = e.target.closest('[data-add-member]');
    if (addMemberBtn) {
        e.preventDefault();
        e.stopPropagation();
        openAddMemberModal(addMemberBtn.dataset.addMember);
        return;
    }

    const editProjectBtn = e.target.closest('[data-edit-project]');
    if (editProjectBtn) {
        e.preventDefault();
        e.stopPropagation();
        openEditProjectModal(editProjectBtn.dataset.editProject);
        return;
    }

    const deleteProjectBtn = e.target.closest('[data-delete-project]');
    if (deleteProjectBtn) {
        e.preventDefault();
        e.stopPropagation();
        deleteProject(deleteProjectBtn.dataset.deleteProject);
        return;
    }

    const toggleBtn = e.target.closest('[data-toggle-expand]');
    if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleProjectExpansion(toggleBtn.dataset.toggleExpand);
    }
});

async function changeProjectStatus(project, newStatus, projectId) {
    const previous = project.status;
    if (previous === newStatus) return;

    // Optimistic UI
    project.status = newStatus;
    const sel = document.getElementById('projectStatusSelect');
    if (sel) sel.className = `select project-status-select status-${newStatus}`;

    const { error } = await supabase
        .from('projects')
        .update({ status: newStatus })
        .eq('id', project.id);

    if (error) {
        console.error('Status change failed:', error);
        project.status = previous;
        window.showToastMsg('Failed to update status');
        renderProjectWorkspace(projectId);
        return;
    }

    window.showToast(
        `Project marked as ${newStatus}`,
        'success',
        4000,
        {
            actionText: 'Undo',
            onAction: async () => {
                project.status = previous;
                await supabase.from('projects')
                    .update({ status: previous })
                    .eq('id', project.id);
                // Refresh so the header re-renders with the old colour
                await window.loadProjects?.();
                renderProjectWorkspace(projectId);
            }
        }
    );

    // Refresh the project list so status pills on cards update too
    await window.loadProjects?.();
    renderProjectWorkspace(projectId);
}

/**
 * Deletes a project (and all its related tasks, subtasks, comments,
 * attachments, and members). Only the project leader can do this.
 */
async function deleteProject(projectId) {
    const project = (window.projects || []).find(p => String(p.id) === String(projectId));
    if (!project) {
        window.showToast('Project not found', 'error');
        return;
    }

    // Guard: only the leader can delete
    if (!isProjectLeader(project)) {
        window.showToast('Only the project leader can delete this project', 'warning');
        return;
    }

    const confirmed = await window.showConfirm({
        title: 'Delete this project?',
        message: `"${project.name}" and all of its tasks, subtasks, comments, and files will be permanently deleted. This cannot be undone.`,
        confirmText: 'Delete project',
        cancelText: 'Cancel',
        variant: 'danger',
        icon: 'bx-trash'
    });
    if (!confirmed) return;

    try {
        // 1. Collect all task ids for this project
        const projectTaskIds = (window.GroupTasks || [])
            .filter(t => String(t.project_id) === String(projectId))
            .map(t => t.id);

        // 2. Collect all subtask ids under those tasks
        let subtaskIds = [];
        if (projectTaskIds.length) {
            const { data: subtasks } = await supabase
                .from('subtasks')
                .select('id')
                .in('task_id', projectTaskIds);
            subtaskIds = (subtasks || []).map(s => s.id);
        }

        // 3. Collect all comment ids under those tasks
        let commentIds = [];
        if (projectTaskIds.length) {
            const { data: comments } = await supabase
                .from('comments')
                .select('id')
                .in('task_id', projectTaskIds);
            commentIds = (comments || []).map(c => c.id);
        }

        // 4. Delete all attachments (storage + DB rows)
        const { data: attachments } = await supabase
            .from('task_attachments')
            .select('id, file_path')
            .or(
                [
                    projectTaskIds.length ? `task_id.in.(${projectTaskIds.join(',')})` : null,
                    subtaskIds.length ? `subtask_id.in.(${subtaskIds.join(',')})` : null,
                    commentIds.length ? `comment_id.in.(${commentIds.join(',')})` : null,
                    `project_id.eq.${projectId}`
                ].filter(Boolean).join(',')
            );

        if (attachments && attachments.length) {
            const paths = attachments.map(a => a.file_path).filter(Boolean);
            if (paths.length) {
                await supabase.storage.from('task-attachments').remove(paths);
            }
            await supabase
                .from('task_attachments')
                .delete()
                .in('id', attachments.map(a => a.id));
        }

        // 5. Delete comments
        if (commentIds.length) {
            await supabase.from('comments').delete().in('id', commentIds);
        }

        // 6. Delete subtasks
        if (subtaskIds.length) {
            await supabase.from('subtasks').delete().in('id', subtaskIds);
        }

        // 7. Delete tasks
        if (projectTaskIds.length) {
            await supabase.from('tasks').delete().in('id', projectTaskIds);
        }

        // 8. Delete project members
        await supabase.from('project_members').delete().eq('project_id', projectId);

        // 9. Delete the project itself
        const { error: projErr } = await supabase
            .from('projects')
            .delete()
            .eq('id', projectId);
        if (projErr) throw projErr;

        // 10. Clear local state
        if (window._projectMemberCache) delete window._projectMemberCache[projectId];
        window.GroupTasks = (window.GroupTasks || []).filter(
            t => String(t.project_id) !== String(projectId)
        );
        if (String(window._GroupState.activeProject) === String(projectId)) {
            window._GroupState.activeProject = null;
        }

        window.showToast(`Project "${project.name}" deleted`, 'success');

        // Clear from leader cache
        if (window._projectLeaders) delete window._projectLeaders[projectId];

        // Refresh projects + re-render
        await window.loadProjects?.();
        renderGroupPage();
    } catch (err) {
        console.error('Delete project failed:', err);
        window.showToast(
            err.message?.includes('policy') || err.message?.includes('RLS')
                ? 'Only the project owner can delete this project'
                : 'Failed to delete project',
            'error',
            4000
        );
    }
}

/**
 * Renders the "Final deliverables" strip at the bottom of the workspace.
 * Combines:
 *   - Task-level files (final versions attached to tasks in this project)
 *   - Project-level files (uploaded via the "Attach file" button)
 */
function renderFinalDeliverables(project, tasks, members) {
    const projectTaskIds = new Set(tasks.map(t => String(t.id)));
    const finalFiles = [];

    // --- Task-level attachments ---
    Object.values(window._GroupState.attachments || {}).forEach(files => {
        files.forEach(file => {
            if (file.task_id && projectTaskIds.has(String(file.task_id))) {
                finalFiles.push(file);
            }
        });
    });

    // --- Project-level attachments (stored under __project__<id>) ---
    const projectKey = `__project__${project.id}`;
    const projectFiles = window._GroupState.attachments[projectKey] || [];
    projectFiles.forEach(file => {
        finalFiles.push({ ...file, __isProjectLevel: true });
    });

    // Sort by most recent first
    finalFiles.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    if (finalFiles.length === 0) {
        return `
            <div class="final-deliverables">
                <div class="final-deliverables-head">
                    <h3><i class="bx bx-package"></i> Final deliverables</h3>
                    <span class="final-count">0 files</span>
                </div>
                <p class="final-empty">No final versions uploaded yet. Attach a file to any task, or click "Attach file" above to upload a project-level file.</p>
            </div>
        `;
    }

    return `
        <div class="final-deliverables">
            <div class="final-deliverables-head">
                <h3><i class="bx bx-package"></i> Final deliverables</h3>
                <span class="final-count">${finalFiles.length} file${finalFiles.length !== 1 ? 's' : ''}</span>
            </div>
            <ul class="final-list">
                ${finalFiles.map(file => {
                    const uploader = memberById(members, file.uploaded_by);
                    const uploaderName = uploader?.full_name || 'Team member';
                    const uploadedAt = formatCommentTime(file.created_at);

                    let sourceLabel;
                    if (file.__isProjectLevel) {
                        sourceLabel = 'Project file';
                    } else {
                        const task = tasks.find(t => String(t.id) === String(file.task_id));
                        sourceLabel = `on "${window.escapeHtml(task?.title || 'Unknown task')}"`;
                    }

                    return `
                        <li class="final-item">
                            <div class="final-icon">
                                <i class="bx ${attachmentIcon(file)}"></i>
                            </div>
                            <div class="final-info">
                                <button type="button"
                                        class="final-name"
                                        data-open-attachment="${file.id}"
                                        title="Preview">
                                    ${window.escapeHtml(file.file_name || 'Attachment')}
                                </button>
                                <div class="final-meta">
                                    ${userInitialBadge(members, file.uploaded_by)}
                                    <span>${window.escapeHtml(uploaderName)}</span>
                                    <span>·</span>
                                    <span>${window.escapeHtml(uploadedAt)}</span>
                                    <span>·</span>
                                    <span class="final-task-ref">${sourceLabel}</span>
                                    <span>·</span>
                                    <span>${formatFileSize(file.file_size)}</span>
                                </div>
                            </div>
                            <div class="final-actions">
                                <button type="button" class="btn ghost sm"
                                        data-open-attachment="${file.id}" title="Preview">
                                    <i class="bx bx-show"></i>
                                </button>
                                <button type="button" class="btn ghost sm text-red"
                                        data-remove-attachment="${file.id}" title="Remove">
                                    <i class="bx bx-trash"></i>
                                </button>
                            </div>
                        </li>
                    `;
                }).join('')}
            </ul>
        </div>
    `;
}

// ============================================================================
// 6. PROJECT WORKSPACE
// ============================================================================
// group.js — example renderer
function renderWorkspaceStats(stats) {
  const container = document.querySelector('.workspace-stats');
  if (!container) return;

  const map = {
    pending:      'stat--pending',
    'in-progress':'stat--in-progress',
    completed:    'stat--completed',
    cancelled:    'stat--cancelled',
  };

  container.innerHTML = Object.entries(stats).map(([status, count]) => `
    <div class="stat ${map[status] ?? ''}">
      <span class="stat__value">${count}</span>
      <span class="stat__label">${status.replace('-', ' ')}</span>
    </div>
  `).join('');
}

async function renderProjectWorkspace(projectId) {
    const mount = document.getElementById('groupWorkspaceMount');
    if (!mount) return;

    const project = (window.projects || []).find(p => String(p.id) === String(projectId));
    if (!project) {
        window._GroupState.activeProject = null;
        renderGroupPage();
        return;
    }

    mount.innerHTML = `<div class="loading-spinner"><div class="spinner"></div><span>Loading project...</span></div>`;

    const state = window._GroupState;
    const projectTasks = (window.GroupTasks || []).filter(t => String(t.project_id) === String(projectId));
    const members = await window.loadProjectMembers(projectId);
    const tasks = filterGroupTasks(projectTasks, state);

    const allTaskIds = projectTasks.map(t => t.id);
    await loadSubtasksForTasks(allTaskIds);
    await loadGroupComments(allTaskIds);
    await loadGroupAttachments(allTaskIds, projectId);

    const isLeader = isProjectLeader(project);

    mount.innerHTML = `
        <br>
        <div class="group-workspace card">
            <div class="workspace-header refined">
                <div class="workspace-title-block">
                    <span class="eyebrow">Now viewing</span>
                    <h2 class="project-title">${window.escapeHtml(project.name)}</h2>
                    <div class="workspace-subline">
                        ${isLeader
                            ? '<span class="leader-badge"><i class="bx bx-crown"></i> You are the leader</span>'
                            : '<span class="leader-badge muted"><i class="bx bx-user"></i> Member</span>'}
                        <span class="workspace-meta-sep">·</span>
                        <span class="workspace-date">Created ${window.fmtDate(project.created_at)}</span>
                        ${project.due_date ? `
                            <span class="workspace-meta-sep">·</span>
                            <span class="workspace-date">Due ${window.fmtDate(project.due_date)}</span>
                        ` : ''}
                    </div>
                </div>

                <div class="workspace-header-actions">
                    ${isLeader
                        ? `<div class="workspace-icon-group">
                            <button type="button" class="icon-btn danger" id="deleteProjectBtn" title="Delete project">
                                <i class="bx bx-trash"></i>
                            </button>
                            <button type="button" class="icon-btn" id="closeWorkspaceBtn" title="Close workspace">
                                <i class="bx bx-x"></i>
                            </button>
                        </div>`
                        : `<button type="button" class="icon-btn" id="closeWorkspaceBtn" title="Close workspace">
                            <i class="bx bx-x"></i>
                        </button>`}

                    ${isLeader
                        ? `<div class="project-status-control">
                            <label for="projectStatusSelect" class="status-control-label">Project status</label>
                            <select id="projectStatusSelect" class="select project-status-select status-${project.status || 'planning'}">
                                <option value="planning"  ${project.status === 'planning'  ? 'selected' : ''}>Planning</option>
                                <option value="active"    ${project.status === 'active'    ? 'selected' : ''}>Active</option>
                                <option value="completed" ${project.status === 'completed' ? 'selected' : ''}>Completed</option>
                            </select>
                        </div>`
                        : `<span class="status-badge ${project.status === 'active' ? 'in-progress' : project.status === 'completed' ? 'completed' : 'pending'}">
                            <span class="status-dot"></span>${project.status || 'planning'}
                        </span>`}
                        </div>
            <div class="workspace-toolbar">
                <div class="search-box">
                    <i class="bx bx-search"></i>
                    <input type="text" id="groupSearch"
                           placeholder="Search tasks..."
                           value="${window.escapeHtml(state.search || '')}">
                </div>

                <select class="select" id="groupStatusFilter">
                    <option value="">All statuses</option>
                    <option value="pending"     ${state.status === 'pending'     ? 'selected' : ''}>Pending</option>
                    <option value="in-progress" ${state.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
                    <option value="overdue"     ${state.status === 'overdue'     ? 'selected' : ''}>Overdue</option>
                    <option value="completed"   ${state.status === 'completed'   ? 'selected' : ''}>Completed</option>
                </select>

                <select class="select" id="groupPriorityFilter">
                    <option value="">All priorities</option>
                    <option value="high"   ${state.priority === 'high'   ? 'selected' : ''}>High</option>
                    <option value="medium" ${state.priority === 'medium' ? 'selected' : ''}>Medium</option>
                    <option value="low"    ${state.priority === 'low'    ? 'selected' : ''}>Low</option>
                </select>

                <button type="button" class="btn ghost" id="clearGroupFilters" title="Clear filters">
                    <i class="bx bx-x"></i>
                </button>

                <div class="view-toggle segmented">
                    <button type="button" data-gview="list"     class="${state.view === 'list'     ? 'active' : ''}">List</button>
                    <button type="button" data-gview="card"     class="${state.view === 'card'     ? 'active' : ''}">Cards</button>
                    <button type="button" data-gview="timeline" class="${state.view === 'timeline' ? 'active' : ''}">Timeline</button>
                </div>

                <div class="toolbar-cta">
                    ${isLeader ? `
                        <button type="button" class="btn secondary attach-btn" id="attachProjectFileBtn" title="Attach project file">
                            <i class="bx bx-paperclip"></i> <span class="btn-text">Attach file</span>
                        </button>
                    ` : ''}
                    <button type="button" class="btn primary" id="addGroupTaskBtn">
                        <i class="bx bx-plus"></i> <span class="btn-text">Add Task</span>
                    </button>
                </div>
            </div>

            <div id="GroupTasksContainer">
                ${tasks.length === 0
                    ? window.renderEmptyState('\u25cb', 'No tasks yet', 'Add the first task for this project.')
                    : (state.view === 'card'
                        ? renderGroupTaskCards(tasks, members, project)
                        : state.view === 'timeline'
                            ? renderGroupTimeline(tasks, members)
                            : renderGroupTaskList(tasks, members, project))}
            </div>

            ${renderFinalDeliverables(project, tasks, members)}

            ${renderGroupComments(tasks, members)}
            ${renderSubtaskDetailPanel(members)}
        </div>
    `;

    document.getElementById('closeWorkspaceBtn')?.addEventListener('click', () => {
        window._GroupState.activeProject = null;
        renderGroupPage();
    });
    document.getElementById('deleteProjectBtn')?.addEventListener('click', () => {
        deleteProject(projectId);
    });

    const statusSelect = document.getElementById('projectStatusSelect');
    if (statusSelect) {
        statusSelect.addEventListener('change', async (e) => {
            const newStatus = e.target.value;
            await changeProjectStatus(project, newStatus, projectId);
        });
    }

    bindGroupWorkspaceEvents(projectId, tasks, members, project);

    window.loadProjectMembers(projectId).then(m => {
        const el = document.getElementById(`members-${projectId}`);
        if (!el) return;
        el.innerHTML = m.slice(0, 4).map(mem =>
            `<span class="member" title="${window.escapeHtml(mem.full_name)}">${window.escapeHtml((mem.full_name || '?').charAt(0))}</span>`
        ).join('');
    });
}

function daysLeftLabel(dueDate) {
    if (!dueDate) return '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate + 'T00:00:00');
    if (Number.isNaN(due.getTime())) return '';
    const days = Math.round((due - today) / 86400000);

    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    if (days === -1) return '1 day overdue';
    if (days < 0) return `${Math.abs(days)} days overdue`;
    return `${days} days left`;
}

function filterGroupTasks(tasks, state) {
    const query = state.search.trim().toLowerCase();
    const filtered = tasks.filter(task => {
        const matchesSearch = !query || [task.title, task.description]
            .some(v => String(v || '').toLowerCase().includes(query));
        const matchesStatus = !state.status || getEffectiveStatus(task) === state.status;
        const matchesPriority = !state.priority || task.priority === state.priority;
        return matchesSearch && matchesStatus && matchesPriority;
    });
    return applyGroupSort(filtered);
}

// ============================================================================
// 7. TASK VIEWS
// ============================================================================

function subtaskChip(taskId) {
    const subs = window._GroupState.subtasksByTask[taskId];
    if (!subs || subs.length === 0) return '';
    const done = subs.filter(s => s.completed).length;
    return `<span class="badge ${done === subs.length ? 'low' : 'medium'}" style="margin-left:6px">
        <i class="bx bx-list-check"></i> ${done}/${subs.length} subtasks
    </span>`;
}

function memberNameFor(members, userId) {
    if (!userId) return 'Unassigned';
    let m = null;
    if (Array.isArray(members)) {
        m = members.find(mm => String(mm.id) === String(userId));
    }
    if (!m && window._allProfiles) {
        m = window._allProfiles[String(userId)] || null;
    }
    if (!m && String(userId) === String(window.currentUser?.id) && window.userProfile) {
        m = window.userProfile;
    }
    return m ? (m.full_name || 'Team member') : 'Unassigned';
}

function renderSubtaskDetails(taskId, members) {
    const subtasks = window._GroupState.subtasksByTask[taskId] || [];
    if (subtasks.length === 0) return '';

    return `<div class="group-subtasks">
        ${subtasks.map(subtask => {
            const files = window._GroupState.attachments[subtask.id] || [];
            return `
                <div class="group-subtask ${subtask.completed ? 'completed' : ''}">
                    <button type="button"
                            class="subtask-check ${subtask.completed ? 'completed' : ''}"
                            data-subtask-complete="${subtask.id}"
                            title="${subtask.completed ? 'Mark incomplete' : 'Mark complete'}">
                        <i class="bx ${subtask.completed ? 'bx-check' : ''}"></i>
                    </button>
                    <span class="subtask-title">${window.escapeHtml(subtask.title)}</span>
                    <small>
                        ${window.escapeHtml(memberNameFor(members, subtask.assignee_id))}
                        ${files.length
                            ? `<span class="version-badges">${files.map(f => `<span class="version-badge">v${f.version || '?'}</span>`).join('')}</span>`
                            : ''}
                    </small>
                    <div class="subtask-actions">
                        <button type="button" class="primary"
                                data-subtask-detail="${subtask.id}"
                                title="View details">
                            <i class="bx bx-show"></i>
                        </button>
                        <button type="button" class="primary"
                                data-subtask-edit="${subtask.id}"
                                title="Edit subtask">
                            <i class="bx bx-edit"></i>
                        </button>
                        <button type="button" class="primary"
                                data-subtask-attachment="${subtask.id}"
                                title="Add next version">
                            <i class="bx bx-paperclip"></i>
                        </button>
                        <button type="button" class="danger"
                                data-subtask-delete="${subtask.id}"
                                title="Delete subtask">
                            <i class="bx bx-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('')}
    </div>`;
}

function renderSubtaskAttachmentBadges(subtaskId) {
    const files = window._GroupState.attachments[subtaskId] || [];
    if (!files.length) return '';
    return `
        <span class="version-badges">
            ${files.map(f => `
                <span class="version-badge" title="${window.escapeHtml(f.file_name || '')}">
                    v${f.version || '?'}
                </span>
            `).join('')}
        </span>
    `;
}

function renderSubtaskCards(taskId, members) {
    const subtasks = window._GroupState.subtasksByTask[taskId] || [];
    if (subtasks.length === 0) return '<div class="subtask-empty">No subtasks yet</div>';

    return `<div class="group-subtask-cards">
        ${subtasks.map(subtask => {
            const files = window._GroupState.attachments[subtask.id] || [];
            return `
                <article class="group-subtask-card ${subtask.completed ? 'completed' : ''}">
                    <div class="group-subtask-card-main">
                        <button type="button"
                                class="subtask-check ${subtask.completed ? 'completed' : ''}"
                                data-subtask-complete="${subtask.id}">
                            <i class="bx ${subtask.completed ? 'bx-check' : ''}"></i>
                        </button>
                        <strong>${window.escapeHtml(subtask.title)}</strong>
                    </div>
                    <div class="group-subtask-card-meta">
                        <span>${window.escapeHtml(memberNameFor(members, subtask.assignee_id))}</span>
                        ${files.length
                            ? `<span class="version-badges">${files.map(f => `<span class="version-badge">v${f.version || '?'}</span>`).join('')}</span>`
                            : ''}
                    </div>
                    <div class="subtask-card-actions">
                        <button type="button" class="subtask-attachment-button"
                                data-subtask-detail="${subtask.id}" title="View details">
                            <i class="bx bx-show"></i>
                        </button>
                        <button type="button" class="subtask-attachment-button"
                                data-subtask-edit="${subtask.id}" title="Edit subtask">
                            <i class="bx bx-edit"></i>
                        </button>
                        <button type="button" class="subtask-attachment-button"
                                data-subtask-attachment="${subtask.id}" title="Add next version">
                            <i class="bx bx-paperclip"></i>
                        </button>
                        <button type="button" class="subtask-attachment-button danger"
                                data-subtask-delete="${subtask.id}" title="Delete subtask">
                            <i class="bx bx-trash"></i>
                        </button>
                    </div>
                </article>
            `;
        }).join('')}
    </div>`;
}
// ============================================================================
// EDIT SUBTASK MODAL
// ============================================================================

function editGroupSubtask(subtask, projectId, members = []) {
    document.getElementById('editSubtaskModalRoot')?.remove();

    const currentAssigneeId = subtask.assignee_id || '';

    const root = document.createElement('div');
    root.id = 'editSubtaskModalRoot';
    root.innerHTML = `
        <div class="modal-backdrop" id="editSubtaskModalBackdrop"></div>
        <div class="modal" id="editSubtaskModal" style="width:440px" role="dialog" aria-modal="true">
            <div class="modal-head">
                <div><div class="eyebrow">Edit Subtask</div><h2>Update Subtask</h2></div>
                <button type="button" class="icon-btn" id="closeEditSubtaskModal" title="Close">
                    <i class="bx bx-x"></i>
                </button>
            </div>
            <form id="editSubtaskForm">
                <div class="form-grid">
                    <div class="full">
                        <label>Title</label>
                        <input type="text" id="editSubtaskTitleInput"
                               value="${window.escapeHtml(subtask.title || '')}"
                               maxlength="150" required>
                    </div>
                    <div class="full">
                        <label>Assign to</label>
                        <select id="editSubtaskAssigneeSelect">
                            <option value="">Unassigned</option>
                            ${members.map(m => `
                                <option value="${window.escapeHtml(m.id)}"
                                    ${String(m.id) === String(currentAssigneeId) ? 'selected' : ''}>
                                    ${window.escapeHtml(m.full_name)}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                    <div class="full">
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                            <input type="checkbox" id="editSubtaskCompleted"
                                   ${subtask.completed ? 'checked' : ''}
                                   style="width:auto;margin:0">
                            <span>Mark as completed</span>
                        </label>
                    </div>
                </div>
                <p class="form-note" id="editSubtaskError"></p>
                <div class="modal-actions">
                    <button type="button" class="btn secondary" id="cancelEditSubtask">Cancel</button>
                    <button type="submit" class="btn primary">Save Changes</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(root);

    const closeModal = () => root.remove();

    document.getElementById('closeEditSubtaskModal').addEventListener('click', closeModal);
    document.getElementById('cancelEditSubtask').addEventListener('click', closeModal);
    document.getElementById('editSubtaskModalBackdrop').addEventListener('click', closeModal);

    document.getElementById('editSubtaskForm').addEventListener('submit', async (event) => {
        event.preventDefault();

        const errorEl = document.getElementById('editSubtaskError');
        errorEl.textContent = '';

        const newTitle = document.getElementById('editSubtaskTitleInput').value.trim();
        const newAssignee = document.getElementById('editSubtaskAssigneeSelect').value || null;
        const newCompleted = document.getElementById('editSubtaskCompleted').checked;

        if (!newTitle) {
            errorEl.textContent = 'Title is required.';
            return;
        }

        const previous = {
            title: subtask.title,
            assignee_id: subtask.assignee_id,
            completed: subtask.completed
        };

        // Optimistic UI update
        subtask.title = newTitle;
        subtask.assignee_id = newAssignee;
        subtask.completed = newCompleted;

        try {
            const { error } = await supabase
                .from('subtasks')
                .update({
                    title: newTitle,
                    assignee_id: newAssignee,
                    completed: newCompleted
                })
                .eq('id', subtask.id);

            if (error) throw error;

            closeModal();
            window.showToast('Subtask updated', 'success');

            // Refresh the workspace so the new assignee / title / state show up
            renderProjectWorkspace(projectId);

            // If a subtask just got completed, offer to complete the parent task
            if (newCompleted && !previous.completed) {
                await maybeOfferTaskCompletion(subtask.task_id, projectId);
            }
        } catch (err) {
            console.error('Edit subtask failed:', err);
            // Rollback optimistic update
            subtask.title = previous.title;
            subtask.assignee_id = previous.assignee_id;
            subtask.completed = previous.completed;
            errorEl.textContent = err.message || 'Failed to update subtask. Please try again.';
        }
    });

    requestAnimationFrame(() => {
        document.getElementById('editSubtaskModalBackdrop').classList.add('show');
        document.getElementById('editSubtaskModal').classList.add('show');
        document.getElementById('editSubtaskTitleInput').focus();
        document.getElementById('editSubtaskTitleInput').select();
    });
}

function renderGroupTaskList(tasks, members, project) {
    const today = new Date().toISOString().slice(0, 10);

    return `
        <div class="card task-table-wrap">
            <table class="task-table">
                <thead>
                    <tr>
                        <th>Task</th>
                        <th class="sortable-header" data-gsort="assigned">Assigned${getGroupSortIndicator('assigned')}</th>
                        <th class="sortable-header" data-gsort="priority">Priority${getGroupSortIndicator('priority')}</th>
                        <th class="sortable-header" data-gsort="status">Status${getGroupSortIndicator('status')}</th>
                        <th class="sortable-header" data-gsort="due">Due Date${getGroupSortIndicator('due')}</th>
                        <th class="actions-header">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${tasks.map(t => {
                        const eff = getEffectiveStatus(t);
                        const isCompleted = t.status === 'completed';
                        const isInProgress = t.status === 'in-progress';
                        const isOverdue = t.due_date && !isCompleted && t.due_date < today;

                        // 👇 count subtasks for this task
                        const subtasks = window._GroupState.subtasksByTask[t.id] || [];
                        const subtaskCount = subtasks.length;
                        const actionsRowSpan = subtaskCount + 1;  // main row + N subtask rows

                        const statusPills = isOverdue
                            ? `<span class="status-pill overdue"><span class="status-dot"></span>Overdue</span>
                               <span class="status-pill ${isInProgress ? 'in-progress' : 'pending'}">
                                   <span class="status-dot"></span>${isInProgress ? 'In Progress' : 'Pending'}
                               </span>`
                            : `<span class="status-pill ${eff}">
                                   <span class="status-dot"></span>${eff.replace('-', ' ')}
                               </span>`;

                        return `
                            <!-- 👇 MAIN ROW -->
                            <tr data-view="${t.id}" class="task-main-row">
                                <td class="title-cell">
                                    ${window.escapeHtml(t.title)}
                                    ${subtaskChip(t.id)}
                                    ${renderAttachmentChips(t.id)}
                                    <div class="desc-preview">${window.escapeHtml((t.description || '').slice(0, 60))}</div>
                                </td>
                                <td>${renderAssignee(members, t.assignee_id)}</td>
                                <td><span class="badge ${t.priority}">${t.priority || '-'}</span></td>
                                <td><div class="status-combo">${statusPills}</div></td>
                                <td class="due-cell" title="${dueTooltip(t.due_date, t.status)}">
                                    <div>${window.fmtDate(t.due_date)}</div>
                                    ${renderCountdown(t.due_date)}
                                </td>
                                <td class="row-actions" rowspan="${actionsRowSpan}">
                                    <div class="row-actions-inner">
                                        ${groupTaskActions(t, { showAttachment: false, project })}
                                    </div>
                                </td>
                            </tr>

                            <!-- 👇 ONE EXTRA ROW PER SUBTASK, sharing the actions cell -->
                            ${subtasks.map(sub => `
                                <tr class="subtask-row" data-subtask-of="${t.id}">
                                    <td colspan="5" class="subtask-row-cell">
                                        <div class="group-subtask ${sub.completed ? 'completed' : ''}">
                                            <button type="button"
                                                    class="subtask-check ${sub.completed ? 'completed' : ''}"
                                                    data-subtask-complete="${sub.id}"
                                                    title="${sub.completed ? 'Mark incomplete' : 'Mark complete'}">
                                                <i class="bx ${sub.completed ? 'bx-check' : ''}"></i>
                                            </button>
                                            <span class="subtask-title">${window.escapeHtml(sub.title)}</span>
                                            <small>
                                                ${window.escapeHtml(memberNameFor(members, sub.assignee_id))}
                                                ${(window._GroupState.attachments[sub.id] || []).length
                                                    ? `<span class="version-badges">${(window._GroupState.attachments[sub.id] || []).map(f => `<span class="version-badge">v${f.version || '?'}</span>`).join('')}</span>`
                                                    : ''}
                                            </small>
                                            <div class="subtask-actions">
                                                <button type="button" class="primary"
                                                        data-subtask-detail="${sub.id}"
                                                        title="View details">
                                                    <i class="bx bx-show"></i>
                                                </button>
                                                <button type="button" class="primary"
                                                        data-subtask-edit="${sub.id}"
                                                        title="Edit subtask">
                                                    <i class="bx bx-edit"></i>
                                                </button>
                                                <button type="button" class="primary"
                                                        data-subtask-attachment="${sub.id}"
                                                        title="Add next version">
                                                    <i class="bx bx-paperclip"></i>
                                                </button>
                                                <button type="button" class="danger"
                                                        data-subtask-delete="${sub.id}"
                                                        title="Delete subtask">
                                                    <i class="bx bx-trash"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function dueTooltip(dueDate, status) {
    if (!dueDate) return 'No due date';
    if (status === 'completed') return `Completed · was due ${window.fmtDate(dueDate)}`;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate + 'T00:00:00');
    if (Number.isNaN(due.getTime())) return '';

    const days = Math.round((due - today) / 86400000);

    if (days === 0)  return 'Due today';
    if (days === 1)  return 'Due tomorrow';
    if (days === -1) return '1 day overdue';
    if (days < 0)    return `${Math.abs(days)} days overdue`;
    return `${days} days left`;
}

function renderGroupTaskCards(tasks, members, project) {
    const ordered = sortTasksForCardView(tasks);
    return `
        <div class="card-grid">
            ${ordered.map(t => {
                const eff = getEffectiveStatus(t);
                const dLeft = daysLeftLabel(t.due_date);
                const dLeftClass = dLeft.includes('overdue')
                    ? 'text-red'
                    : dLeft === 'Due today' ? 'text-amber' : 'text-muted';
                return `
                    <div class="task-card" data-view="${t.id}">
                        <div class="project-top">
                            <span class="badge ${t.priority}">${t.priority}</span>
                            <span class="status-pill ${eff}">
                                <span class="status-dot"></span>${eff.replace('-', ' ')}
                            </span>
                        </div>
                        <h4>${window.escapeHtml(t.title)}</h4>
                        <p>${window.escapeHtml(t.description || 'No description')}</p>
                        ${subtaskChip(t.id)}
                        <div class="group-card-subtasks">
                            <span class="subtask-section-label">Subtasks</span>
                            ${renderSubtaskCards(t.id, members)}
                        </div>
                        <div class="card-bottom">
                            <div class="card-meta-block" title="${dueTooltip(t.due_date, t.status)}">
                                <span class="card-meta">${renderAssignee(members, t.assignee_id)}</span>
                                <span class="card-meta-date">${window.fmtDate(t.due_date)}</span>
                                ${dLeft ? `<span class="countdown ${dLeftClass}">${dLeft}</span>` : ''}
                            </div>
                            <div class="row-actions">${groupTaskActions(t, { project })}</div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderGroupTimeline(tasks, members) {
    const day = 24 * 60 * 60 * 1000;
    const rows = tasks.map(task => {
        const end = new Date(task.due_date || task.created_at || Date.now());
        const start = new Date(task.start_date || task.created_at || task.due_date || Date.now());
        const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
        const safeEnd = Number.isNaN(end.getTime()) ? new Date(safeStart) : end;
        return { task, start: safeStart.getTime(), end: Math.max(safeEnd.getTime(), safeStart.getTime() + day) };
    });
    if (rows.length === 0) return '';

    const rStart = Math.min(...rows.map(r => r.start));
    const rEnd = Math.max(...rows.map(r => r.end));
    const range = Math.max(rEnd - rStart, day);

    const weekLabels = [];
    const startDate = new Date(rStart);
    const firstMonday = new Date(startDate);
    const dayOfWeek = (firstMonday.getDay() + 6) % 7;
    firstMonday.setDate(firstMonday.getDate() - dayOfWeek);

    const today = new Date(); today.setHours(0, 0, 0, 0);

    let cursor = new Date(firstMonday);
    while (cursor.getTime() <= rEnd) {
        const weekStart = new Date(cursor);
        const weekEnd = new Date(cursor);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const isCurrent = today >= weekStart && today <= weekEnd;
        weekLabels.push({
            label: `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
            isCurrent
        });
        cursor.setDate(cursor.getDate() + 7);
    }

    return `
        <div class="group-timeline">
            <div class="group-timeline-week">
                ${weekLabels.map(w => `<span class="timeline-week-label ${w.isCurrent ? 'current' : ''}">${w.label}</span>`).join('')}
            </div>
            <div class="group-timeline-scale">
                <span>${window.fmtDate(new Date(rStart).toISOString())}</span>
                <span>${window.fmtDate(new Date(rEnd).toISOString())}</span>
            </div>
            ${rows.map(({ task, start, end }) => {
                const left = ((start - rStart) / range) * 100;
                const width = Math.max(((end - start) / range) * 100, 1.5);
                const eff = getEffectiveStatus(task);
                return `
                    <div class="group-timeline-row" data-view="${task.id}">
                        <div class="group-timeline-label">
                            <strong>${window.escapeHtml(task.title)}</strong>
                            <span>${window.escapeHtml(memberNameFor(members, task.assignee_id))} · ${window.fmtDate(task.due_date)}</span>
                        </div>
                        <div class="group-timeline-track">
                            <div class="group-timeline-bar ${eff}" style="left:${left}%;width:${width}%"></div>
                        </div>
                        <div class="row-actions timeline-actions">${groupTaskActions(task)}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/**
 * Renders the inline workflow actions (start/pause/complete/reopen,
 * comments, attachment, add subtask). Edit + Delete now live in the
 * top-right corner — see `groupTaskCornerActions()`.
 */
function groupTaskActions(task, options = {}) {
    const { showAttachment = true, project } = options;
    const subs = window._GroupState.subtasksByTask[task.id] || [];
    const allSubsDone = subs.length === 0 || subs.every(s => s.completed);

    // Resolve the project even if it wasn't passed in
    const resolvedProject = project
        || (window.projects || []).find(p => String(p.id) === String(task.project_id));
    const leader = resolvedProject ? isProjectLeader(resolvedProject) : false;

    const isCompleted  = task.status === 'completed';
    const isInProgress = task.status === 'in-progress';
    const isPending    = task.status === 'pending';

    // 👇 Anyone can start / pause / reopen
    const canStart  = !isCompleted && isPending;
    const canPause  = !isCompleted && isInProgress;
    const canReopen = !isCompleted && isInProgress;  // pause = reopen for non-leader

    // 👇 Only leader can finalize
    const canComplete = leader && allSubsDone && !isCompleted;
    const canFinalReopen = leader && isCompleted;

    return `
        ${canStart ? `
            <button type="button" data-gaction="start" data-id="${task.id}"
                    class="row-action-btn row-action-start" title="Start task">
                <i class="bx bx-play"></i>
            </button>` : ''}

        ${canPause ? `
            <button type="button" data-gaction="pause" data-id="${task.id}"
                    class="row-action-btn row-action-pause" title="Pause task">
                <i class="bx bx-pause"></i>
            </button>` : ''}

        ${canComplete ? `
            <button type="button" data-gaction="complete" data-id="${task.id}"
                    class="row-action-btn row-action-complete" title="Mark task complete">
                <i class="bx bx-check-double"></i>
            </button>` : ''}

        ${canFinalReopen ? `
            <button type="button" data-gaction="reopen" data-id="${task.id}"
                    class="row-action-btn row-action-reopen" title="Reopen task">
                <i class="bx bx-undo"></i>
            </button>` : ''}

        <button type="button" data-gaction="comments" data-id="${task.id}" title="View comments">
            <i class="bx bx-message-rounded-dots"></i>
        </button>

        ${showAttachment ? `
            <button type="button" data-gaction="attachment" data-id="${task.id}"
                    title="Upload final version">
                <i class="bx bx-paperclip"></i>
            </button>` : ''}

        <button type="button" data-gaction="add-subtask" data-id="${task.id}" title="Add subtask">
            <i class="bx bx-list-plus"></i>
        </button>

        <button type="button" data-gaction="edit" data-id="${task.id}" title="Edit task">
            <i class="bx bx-edit"></i>
        </button>

        <button type="button" data-gaction="delete" data-id="${task.id}" title="Delete task">
            <i class="bx bx-trash"></i>
        </button>
    `;
}

// ============================================================================
// 8. ATTACHMENTS
// ============================================================================

function renderAttachmentChips(itemId) {
    const files = window._GroupState.attachments[itemId] || [];
    if (!files.length) return '';

    return `
        <span class="attachment-list">
            ${files.map(file => {
                const isFinal = !file.version;
                const chipLabel = isFinal ? 'Final' : `v${file.version}`;
                return `
                    <span class="attachment-chip-wrap">
                        <button type="button" class="attachment-chip"
                                data-open-attachment="${file.id}"
                                title="${window.escapeHtml(file.file_name || 'Attachment')}">
                            <i class="bx ${attachmentIcon(file)}"></i>
                            <span class="attachment-version-tag">${chipLabel}</span>
                            ${window.escapeHtml(file.file_name || 'Attachment')}
                            <small>${formatFileSize(file.file_size)}</small>
                        </button>
                        <button type="button" class="attachment-remove-btn"
                                data-remove-attachment="${file.id}"
                                title="Remove file"><i class="bx bx-x"></i></button>
                    </span>
                `;
            }).join('')}
        </span>
    `;
}

async function uploadGroupAttachment(file, { taskId = null, subtaskId = null, commentId = null, version = null } = {}) {
    if (!file) return null;
    if (file.size > 10 * 1024 * 1024) {
        window.showToastMsg('File must be 10MB or smaller');
        return null;
    }
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
        window.showToastMsg('Please log in again');
        return null;
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
    const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

    const { error: upErr } = await supabase.storage
        .from('task-attachments')
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (upErr) {
        console.error('Upload failed:', upErr);
        window.showToastMsg('Upload failed: ' + upErr.message);
        return null;
    }

    const row = {
        task_id: taskId,
        subtask_id: subtaskId,
        comment_id: commentId,
        uploaded_by: user.id,
        file_name: file.name,
        file_path: path,
        file_type: file.type || null,
        file_size: file.size
    };
    if (version !== null) row.version = version;

    const { data, error: dbErr } = await supabase
        .from('task_attachments')
        .insert(row)
        .select().single();

    if (dbErr) {
        console.error('Metadata insert failed:', dbErr);
        await supabase.storage.from('task-attachments').remove([path]);
        return null;
    }
    return data;
}

async function attachGroupFile(itemId, projectId, isSubtask = false) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,.doc,.docx,.txt,.zip';
    input.multiple = false;

    input.addEventListener('change', async () => {
        const files = Array.from(input.files || []);
        if (!files.length) return;

        let version = null;
        if (isSubtask) {
            const existing = window._GroupState.attachments[itemId] || [];
            const maxV = existing.reduce((m, f) => Math.max(m, f.version || 0), 0);
            version = maxV + 1;
        }

        for (const file of files) {
            await uploadGroupAttachment(file, {
                taskId: isSubtask ? null : itemId,
                subtaskId: isSubtask ? itemId : null,
                version
            });
        }

        const projectTasks = (window.GroupTasks || []).filter(t => String(t.project_id) === String(projectId));
        const ids = projectTasks.map(t => t.id);
        await loadSubtasksForTasks(ids);
        await loadGroupComments(ids);
        await loadGroupAttachments(ids, projectId);

        window.showToastMsg(isSubtask ? `Version ${version} uploaded` : 'Final version uploaded');
        renderProjectWorkspace(projectId);
    });
    input.click();
}

async function getAttachmentUrl(filePath) {
    const { data, error } = await supabase.storage
        .from('task-attachments').createSignedUrl(filePath, 3600);
    if (error) { console.error('Signed URL failed:', error); return null; }
    return data?.signedUrl || null;
}

async function openGroupAttachment(attachmentId) {
    const all = [
        ...Object.values(window._GroupState.attachments || {}).flat(),
        ...Object.values(window._GroupState.comments || {}).flat().flatMap(c => c.attachments || [])
    ];
    const attachment = all.find(f => String(f.id) === String(attachmentId));
    if (!attachment) return;
    const url = await getAttachmentUrl(attachment.file_path);
    if (!url) { window.showToastMsg('Unable to open attachment'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
}

async function deleteGroupAttachment(attachmentId, projectId) {
    const all = [
        ...Object.values(window._GroupState.attachments || {}).flat(),
        ...Object.values(window._GroupState.comments || {}).flat().flatMap(c => c.attachments || [])
    ];
    const file = all.find(f => String(f.id) === String(attachmentId));
    const confirmed = await window.showConfirm({
        title: 'Remove this file?',
        message: `"${file?.file_name || 'This file'}" will be permanently removed.`,
        confirmText: 'Remove', cancelText: 'Cancel', variant: 'danger', icon: 'bx-trash'
    });
    if (!confirmed) return;
    try {
        if (file?.file_path) await supabase.storage.from('task-attachments').remove([file.file_path]);
        const { error } = await supabase.from('task_attachments').delete().eq('id', attachmentId);
        if (error) throw error;
        window.showToastMsg('File removed');
        renderProjectWorkspace(projectId);
    } catch (err) {
        console.error('Error removing attachment:', err);
        window.showToastMsg('Failed to remove file');
    }
}

// ============================================================================
// 9. SUBTASK ACTIONS
// ============================================================================

function addGroupSubtask(task, projectId, members = []) {
    document.getElementById('addSubtaskModalRoot')?.remove();

    const root = document.createElement('div');
    root.id = 'addSubtaskModalRoot';
    root.innerHTML = `
        <div class="modal-backdrop" id="addSubtaskModalBackdrop"></div>
        <div class="modal" id="addSubtaskModal" style="width:440px" role="dialog" aria-modal="true">
            <div class="modal-head">
                <div><div class="eyebrow">New Subtask</div><h2>Add Subtask</h2></div>
                <button type="button" class="icon-btn" id="closeAddSubtaskModal" title="Close"><i class="bx bx-x"></i></button>
            </div>
            <form id="addSubtaskForm">
                <div class="form-grid">
                    <p class="full" style="font-size:11px;color:var(--muted);margin:0">
                        For task "<strong>${window.escapeHtml(task.title)}</strong>"
                    </p>
                    <div class="full">
                        <label>Title</label>
                        <input type="text" id="subtaskTitleInput" placeholder="e.g. Draft outline" maxlength="150" required>
                    </div>
                    <div class="full">
                        <label>Assign to</label>
                        <select id="subtaskAssigneeSelect">
                            <option value="">Unassigned</option>
                            ${members.map(m => `<option value="${window.escapeHtml(m.id)}" ${String(m.id) === String(window.currentUser?.id) ? 'selected' : ''}>${window.escapeHtml(m.full_name)}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <p class="form-note" id="addSubtaskError"></p>
                <div class="modal-actions">
                    <button type="button" class="btn secondary" id="cancelAddSubtask">Cancel</button>
                    <button type="submit" class="btn primary">Add Subtask</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(root);

    const closeModal = () => root.remove();

    document.getElementById('closeAddSubtaskModal').addEventListener('click', closeModal);
    document.getElementById('cancelAddSubtask').addEventListener('click', closeModal);
    document.getElementById('addSubtaskModalBackdrop').addEventListener('click', closeModal);

    document.getElementById('addSubtaskForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const title = document.getElementById('subtaskTitleInput').value.trim();
        const errorEl = document.getElementById('addSubtaskError');
        if (!title) { errorEl.textContent = 'Please enter a title.'; return; }

        const assigneeId = document.getElementById('subtaskAssigneeSelect').value || null;

        try {
            const { data, error } = await supabase
                .from('subtasks')
                .insert({ task_id: task.id, title, completed: false, assignee_id: assigneeId })
                .select('id, task_id, title, completed, assignee_id').single();
            if (error) throw error;

            if (!window._GroupState.subtasksByTask[task.id]) {
                window._GroupState.subtasksByTask[task.id] = [];
            }
            window._GroupState.subtasksByTask[task.id].push(data);
            closeModal();
            window.showToastMsg('Subtask added');
            renderProjectWorkspace(projectId);
        } catch (err) {
            console.error('Add subtask failed:', err);
            errorEl.textContent = 'Failed to add subtask. Please try again.';
        }
    });

    requestAnimationFrame(() => {
        document.getElementById('addSubtaskModalBackdrop').classList.add('show');
        document.getElementById('addSubtaskModal').classList.add('show');
        document.getElementById('subtaskTitleInput').focus();
    });
}

async function deleteGroupSubtask(subtaskId, projectId) {
    console.log('[deleteGroupSubtask] called', { subtaskId, projectId });

    const subtask = Object.values(window._GroupState.subtasksByTask || {})
        .flat().find(s => String(s.id) === String(subtaskId));

    if (!subtask) {
        console.warn('[deleteGroupSubtask] subtask not found in state');
        window.showToast('Subtask not found — refreshing', 'warning', 2500);
        renderProjectWorkspace(projectId);
        return;
    }

    const confirmed = await window.showConfirm({
        title: 'Delete this subtask?',
        message: `"${subtask.title || 'This subtask'}" will be permanently deleted.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        variant: 'danger',
        icon: 'bx-trash'
    });
    console.log('[deleteGroupSubtask] confirmed?', confirmed);
    if (!confirmed) return;

    try {
        // 1. Remove any attachments tied to this subtask
        const attached = Object.values(window._GroupState.attachments || {})
            .flat().filter(f => String(f.subtask_id) === String(subtaskId));

        if (attached.length) {
            const paths = attached.map(f => f.file_path).filter(Boolean);
            if (paths.length) {
                const { error: storageErr } = await supabase.storage
                    .from('task-attachments').remove(paths);
                if (storageErr) console.warn('Storage cleanup failed:', storageErr);
            }
            const { error: attachDelErr } = await supabase
                .from('task_attachments')
                .delete()
                .in('id', attached.map(f => f.id));
            if (attachDelErr) console.warn('Attachment row delete failed:', attachDelErr);
        }

        // 2. Delete the subtask row itself
        const { error: delErr, count } = await supabase
            .from('subtasks')
            .delete({ count: 'exact' })
            .eq('id', subtaskId);

        console.log('[deleteGroupSubtask] delete result', { delErr, count });

        if (delErr) throw delErr;

        if (!count) {
            // Nothing was deleted → RLS blocked it
            throw new Error('Delete was blocked (no rows affected — check RLS).');
        }

        // 3. Update local state
        if (subtask.task_id && window._GroupState.subtasksByTask[subtask.task_id]) {
            window._GroupState.subtasksByTask[subtask.task_id] =
                window._GroupState.subtasksByTask[subtask.task_id]
                    .filter(s => String(s.id) !== String(subtaskId));
        }
        delete window._GroupState.attachments[subtaskId];

        window.showToast('Subtask deleted', 'success');
        renderProjectWorkspace(projectId);
    } catch (err) {
        console.error('[deleteGroupSubtask] failed:', err);
        window.showToast(
            err.message?.includes('RLS') || err.message?.includes('policy')
                ? 'Only the project owner or task creator can delete this subtask'
                : 'Failed to delete subtask',
            'error',
            4000
        );
    }
}



async function toggleGroupSubtask(subtaskId, projectId) {
    const subtask = Object.values(window._GroupState.subtasksByTask || {})
        .flat().find(item => String(item.id) === String(subtaskId));
    if (!subtask) return;
    const previous = subtask.completed;
    const next = !previous;

    subtask.completed = next;
    renderProjectWorkspace(projectId);

    const { error } = await supabase.from('subtasks').update({ completed: next }).eq('id', subtaskId);
    if (error) {
        subtask.completed = previous;
        renderProjectWorkspace(projectId);
        window.showToast('Failed to update subtask', 'error');
        return;
    }
    showUndoToast({
        message: next ? `"${subtask.title}" completed` : `"${subtask.title}" reopened`,
        duration: 5000,
        onUndo: async () => {
            subtask.completed = previous;
            renderProjectWorkspace(projectId);
            await supabase.from('subtasks').update({ completed: previous }).eq('id', subtaskId);
            window.showToast('Subtask restored', 'info', 1800);
        }
    });
    if (next) await maybeOfferTaskCompletion(subtask.task_id, projectId);
}

// ============================================================================
// 10. TASK ACTIONS
// ============================================================================

async function toggleTaskComplete(task, projectId) {
    const project = (window.projects || []).find(p => String(p.id) === String(projectId));
    const isCompleting = task.status !== 'completed';
    if (isCompleting) {
        if (!isProjectLeader(project)) {
            window.showToast('Only the project leader can mark tasks as complete', 'warning');
            return;
        }
        const subs = window._GroupState.subtasksByTask[task.id] || [];
        if (!(subs.length === 0 || subs.every(s => s.completed))) {
            window.showToast('All subtasks must be completed first', 'warning');
            return;
        }
    }
    const previousStatus = task.status;
    const nextStatus = isCompleting ? 'completed' : 'pending';
    task.status = nextStatus;
    renderProjectWorkspace(projectId);
    const { error } = await supabase.from('tasks').update({ status: nextStatus }).eq('id', task.id);
    if (error) {
        task.status = previousStatus;
        renderProjectWorkspace(projectId);
        window.showToast('Failed to update task', 'error');
        return;
    }
    showUndoToast({
        message: isCompleting ? `"${task.title}" completed` : `"${task.title}" reopened`,
        duration: 5000,
        onUndo: async () => {
            task.status = previousStatus;
            renderProjectWorkspace(projectId);
            await supabase.from('tasks').update({ status: previousStatus }).eq('id', task.id);
            window.showToast(isCompleting ? 'Task reopened' : 'Task marked completed', 'info', 1800);
        }
    });
}

async function startTask(task, projectId) {
    if (task.status === 'in-progress') return;
    const previousStatus = task.status;
    task.status = 'in-progress';
    renderProjectWorkspace(projectId);
    const { error } = await supabase.from('tasks').update({ status: 'in-progress' }).eq('id', task.id);
    if (error) {
        task.status = previousStatus;
        renderProjectWorkspace(projectId);
        window.showToast('Failed to start task', 'error');
        return;
    }
    showUndoToast({
        message: `"${task.title}" started`, duration: 5000,
        onUndo: async () => {
            task.status = previousStatus;
            renderProjectWorkspace(projectId);
            await supabase.from('tasks').update({ status: previousStatus }).eq('id', task.id);
            window.showToast('Task paused', 'info', 1800);
        }
    });
}

async function reopenTask(task, projectId) {
    if (task.status === 'pending') return;
    const previousStatus = task.status;
    task.status = 'pending';
    renderProjectWorkspace(projectId);
    const { error } = await supabase.from('tasks').update({ status: 'pending' }).eq('id', task.id);
    if (error) {
        task.status = previousStatus;
        renderProjectWorkspace(projectId);
        window.showToast('Failed to update task', 'error');
        return;
    }
    showUndoToast({
        message: previousStatus === 'completed' ? `"${task.title}" reopened` : `"${task.title}" paused`,
        duration: 5000,
        onUndo: async () => {
            task.status = previousStatus;
            renderProjectWorkspace(projectId);
            await supabase.from('tasks').update({ status: previousStatus }).eq('id', task.id);
            window.showToast('Change reverted', 'info', 1800);
        }
    });
}

function showUndoToast({ message, onUndo, duration = 5000, undoText = 'Undo' }) {
    window.showToast(message, 'success', duration, {
        actionText: undoText,
        onAction: () => { try { onUndo?.(); } catch (err) { console.error('Undo handler failed:', err); window.showToast('Could not undo', 'error'); } }
    });
}

async function maybeOfferTaskCompletion(taskId, projectId) {
    const subs = window._GroupState.subtasksByTask[taskId] || [];
    if (subs.length === 0) return;
    if (!subs.every(s => s.completed)) return;
    const task = (window.GroupTasks || []).find(t => String(t.id) === String(taskId));
    if (!task || task.status === 'completed') return;
    const project = (window.projects || []).find(p => String(p.id) === String(projectId));
    if (!isProjectLeader(project)) {
        window.showToast('All subtasks done — the project leader can now mark this task complete.', 'info', 4000);
        return;
    }
    const confirmed = await window.showConfirm({
        title: 'All subtasks complete',
        message: `Every subtask for "${task.title}" is done. Mark the whole task as completed?`,
        confirmText: 'Mark task complete', cancelText: 'Not yet',
        variant: 'primary', icon: 'bx-check-double'
    });
    if (!confirmed) return;
    await toggleTaskComplete(task, projectId);
}

// ============================================================================
// 11. ADD MEMBER MODAL
// ============================================================================

async function openAddMemberModal(projectId) {
    document.getElementById('addMemberModalRoot')?.remove();

    const project = (window.projects || []).find(p => String(p.id) === String(projectId));
    if (!project) return;

    const [currentMembers, allProfilesResponse] = await Promise.all([
        window.loadProjectMembers(projectId),
        supabase.from('profiles').select('id, full_name, email').limit(500)
    ]);

    const { data: allProfiles, error } = allProfilesResponse;
    if (error) {
        console.error('Failed to load profiles:', error);
        window.showToastMsg('Could not load users');
        return;
    }

    const currentIds = new Set(currentMembers.map(m => String(m.id)));
    const leaderId = String(project.created_by || '');
    const candidates = (allProfiles || []).filter(p => !currentIds.has(String(p.id)));

    const root = document.createElement('div');
    root.id = 'addMemberModalRoot';
    root.innerHTML = `
        <div class="modal-backdrop" id="addMemberBackdrop"></div>
        <div class="modal" id="addMemberModal" style="width:520px" role="dialog" aria-modal="true">
            <div class="modal-head">
                <div><div class="eyebrow">Add member</div><h2>${window.escapeHtml(project.name)}</h2></div>
                <button type="button" class="icon-btn" id="closeAddMemberModal" title="Close"><i class="bx bx-x"></i></button>
            </div>

            <div class="modal-body" style="padding:16px 20px; max-height:70vh; overflow-y:auto">
                <div class="add-member-section">
                    <h4 class="add-member-section-title">
                        <i class="bx bx-group"></i> Current members
                        <span class="badge-count">${currentMembers.length}</span>
                    </h4>
                    <div class="add-member-list static">
                        ${currentMembers.length === 0
                            ? '<p class="subtask-empty-text">Only the leader is in this project.</p>'
                            : currentMembers.map(m => {
                                const isLeader = String(m.id) === leaderId;
                                return `
                                    <div class="add-member-row current">
                                        <div class="add-member-info">
                                            <div class="avatar avatar-sm">${window.escapeHtml((m.full_name || '?').charAt(0).toUpperCase())}</div>
                                            <div>
                                                <strong>
                                                    ${window.escapeHtml(m.full_name || 'Team member')}
                                                    ${isLeader ? '<span class="leader-inline-badge"><i class="bx bx-crown"></i> Leader</span>' : ''}
                                                </strong>
                                                <div class="subtask-assignee-email">${window.escapeHtml(m.email || '')}</div>
                                            </div>
                                        </div>
                                        <span class="member-status-tag"><i class="bx bx-check"></i> Member</span>
                                    </div>
                                `;
                            }).join('')}
                    </div>
                </div>

                <div class="add-member-section">
                    <h4 class="add-member-section-title">
                        <i class="bx bx-user-plus"></i> Add new
                        <span class="badge-count">${candidates.length}</span>
                    </h4>
                    <div class="form-grid" style="padding:0;margin-bottom:8px">
                        <div class="full">
                            <input type="text" id="addMemberSearch" placeholder="Search by name or email...">
                        </div>
                    </div>
                    <div class="add-member-list" id="addMemberList">
                        ${candidates.length === 0
                            ? '<p class="subtask-empty-text">Everyone is already a member.</p>'
                            : candidates.map(u => `
                                <label class="add-member-row">
                                    <div class="add-member-info">
                                        <div class="avatar avatar-sm">${window.escapeHtml((u.full_name || '?').charAt(0).toUpperCase())}</div>
                                        <div>
                                            <strong>${window.escapeHtml(u.full_name || 'Team member')}</strong>
                                            <div class="subtask-assignee-email">${window.escapeHtml(u.email || '')}</div>
                                        </div>
                                    </div>
                                    <input type="checkbox" value="${u.id}">
                                </label>
                            `).join('')}
                    </div>
                </div>

                <p class="form-note" id="addMemberError" style="padding:8px 0 0"></p>
            </div>

            <div class="modal-actions">
                <button type="button" class="btn secondary" id="cancelAddMember">Cancel</button>
                <button type="button" class="btn primary" id="confirmAddMember">
                    <i class="bx bx-user-plus"></i> Add selected
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(root);

    const closeModal = () => root.remove();
    document.getElementById('closeAddMemberModal').addEventListener('click', closeModal);
    document.getElementById('cancelAddMember').addEventListener('click', closeModal);
    document.getElementById('addMemberBackdrop').addEventListener('click', closeModal);

    document.getElementById('addMemberSearch').addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase();
        root.querySelectorAll('#addMemberList .add-member-row').forEach(row => {
            row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    });

    document.getElementById('confirmAddMember').addEventListener('click', async () => {
        const selected = Array.from(root.querySelectorAll('#addMemberList input[type="checkbox"]:checked'));
        if (selected.length === 0) {
            document.getElementById('addMemberError').textContent = 'Select at least one user.';
            return;
        }

        const rows = selected.map(cb => ({
            project_id: projectId,
            user_id: cb.value
        }));

        const { error } = await supabase.from('project_members').insert(rows);

        if (error) {
            console.error('Add member failed:', error);
            document.getElementById('addMemberError').textContent = error.message || 'Failed to add members.';
            return;
        }

        if (window._projectMemberCache) delete window._projectMemberCache[projectId];

        closeModal();
        window.showToastMsg(`${rows.length} member${rows.length > 1 ? 's' : ''} added`);

        if (String(window._GroupState.activeProject) === String(projectId)) {
            renderProjectWorkspace(projectId);
        } else {
            renderGroupPage();
        }
    });

    requestAnimationFrame(() => {
        document.getElementById('addMemberBackdrop').classList.add('show');
        document.getElementById('addMemberModal').classList.add('show');
    });
}

function openCreateProjectModal() {
    document.getElementById('createProjectModalRoot')?.remove();

    const root = document.createElement('div');
    root.id = 'createProjectModalRoot';
    root.innerHTML = `
        <div class="modal-backdrop" id="createProjectBackdrop"></div>
        <div class="modal" id="createProjectModal" style="width:460px" role="dialog" aria-modal="true">
            <div class="modal-head">
                <div><div class="eyebrow">New Project</div><h2>Create a Group Project</h2></div>
                <button type="button" class="icon-btn" id="closeCreateProjectModal" title="Close">
                    <i class="bx bx-x"></i>
                </button>
            </div>
            <form id="createProjectForm">
                <div class="form-grid">
                    <div class="full">
                        <label>Project Name *</label>
                        <input type="text" id="cpName" required maxlength="120" placeholder="e.g. Website Redesign">
                    </div>
                    <div class="full">
                        <label>Description</label>
                        <textarea id="cpDescription" rows="3" placeholder="Optional details..."></textarea>
                    </div>
                    <div>
                        <label>Status</label>
                        <select id="cpStatus">
                            <option value="planning" selected>Planning</option>
                            <option value="active">Active</option>
                        </select>
                    </div>
                    <div>
                        <label>Due Date</label>
                        <input type="date" id="cpDueDate">
                    </div>
                </div>
                <p class="form-note" id="cpError"></p>
                <div class="modal-actions">
                    <button type="button" class="btn secondary" id="cancelCreateProject">Cancel</button>
                    <button type="submit" class="btn primary" id="cpSubmit">Create Project</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(root);

    const closeModal = () => root.remove();
    document.getElementById('closeCreateProjectModal').addEventListener('click', closeModal);
    document.getElementById('cancelCreateProject').addEventListener('click', closeModal);
    document.getElementById('createProjectBackdrop').addEventListener('click', closeModal);

    document.getElementById('createProjectForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById('cpError');
        errorEl.textContent = '';

        const name = document.getElementById('cpName').value.trim();
        const description = document.getElementById('cpDescription').value.trim();
        const status = document.getElementById('cpStatus').value;
        const due_date = document.getElementById('cpDueDate').value || null;

        if (!name) {
            errorEl.textContent = 'Project name is required.';
            return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            errorEl.textContent = 'Please log in again.';
            return;
        }

        const submitBtn = document.getElementById('cpSubmit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';

        try {
            // 1. Insert the project
            const { data: newProject, error: projErr } = await supabase
                .from('projects')
                .insert({
                    name,
                    description: description || null,
                    status,
                    due_date,
                    created_by: user.id,
                    progress: 0
                })
                .select()
                .single();

            if (projErr) throw projErr;

            // 2. Add the creator as a member too (so member queries return them)
            const { error: memberErr } = await supabase
                .from('project_members')
                .insert({
                    project_id: newProject.id,
                    user_id: user.id
                });
            if (memberErr) console.warn('Could not add creator as member:', memberErr);

            // 3. Clear member cache so the new project sees the right members
            if (window._projectMemberCache) delete window._projectMemberCache[newProject.id];

            // 4. Reload projects and refresh the grid
            await window.loadProjects();
            closeModal();
            window.showToast(`Project "${name}" created`, 'success');
            renderGroupRoot();
        } catch (err) {
            console.error('Create project failed:', err);
            errorEl.textContent = err.message || 'Failed to create project. Please try again.';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Project';
        }
    });

    requestAnimationFrame(() => {
        document.getElementById('createProjectBackdrop').classList.add('show');
        document.getElementById('createProjectModal').classList.add('show');
        document.getElementById('cpName').focus();
    });
}

// ============================================================================
// 12. COMMENTS
// ============================================================================

function getGroupComments(taskOrId) {
    const taskId = (taskOrId && typeof taskOrId === 'object') ? taskOrId.id : taskOrId;
    if (!taskId) return [];
    return window._GroupState.comments[taskId] || [];
}

function getCommentImage(comment) {
    const image = comment.img || comment.image;
    if (!image || !/\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(image)) return '';
    return image;
}

function renderCommentAttachments(attachments) {
    if (!attachments?.length) return '';
    return `
        <div class="comment-attachments">
            ${attachments.map(file => {
                if (file.url) {
                    return `<a class="attachment-chip" href="${file.url}"
                                download="${window.escapeHtml(file.name || 'file')}" target="_blank">
                                <i class="bx bx-show"></i>${window.escapeHtml(file.name || 'file')}
                            </a>`;
                }
                return `
                    <button type="button" class="attachment-chip"
                            data-open-attachment="${file.id}"
                            title="${window.escapeHtml(file.file_name || 'Attachment')}">
                        <i class="bx ${attachmentIcon(file)}"></i>
                        ${window.escapeHtml(file.file_name || 'Attachment')}
                        <small>${formatFileSize(file.file_size)}</small>
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

function renderGroupComments(tasks, members) {
    const task = tasks.find(item => String(item.id) === String(window._GroupState.commentTaskId));
    if (!task) return '';
    window._GroupState.commentMembers = members;
    const comments = getGroupComments(task);

    return `
        <div class="group-comments-backdrop" data-comments-close="true"></div>
        <section class="group-comments-panel" role="dialog" aria-modal="true">
            <div class="group-comments-head">
                <div><span class="eyebrow">Task Comments</span><h3>${window.escapeHtml(task.title)}</h3></div>
                <button type="button" class="icon-btn" data-comments-close="true" title="Close"><i class="bx bx-x"></i></button>
            </div>
            <div class="comments group-comments-list">
                ${comments.map(comment => `
                    <article class="comment">
                        <div class="comment-avatar-wrap" data-email="${window.escapeHtml(comment.email || 'Email unavailable')}">
                            <div class="avatar avatar-sm">
                                ${window.escapeHtml((comment.author || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase())}
                            </div>
                        </div>
                        <div>
                            <strong>${window.escapeHtml(comment.author || 'Team member')}</strong>
                            ${comment.email ? `<a class="comment-email" href="mailto:${window.escapeHtml(comment.email)}">${window.escapeHtml(comment.email)}</a>` : ''}
                            <p>${window.escapeHtml(comment.text || '')}</p>
                            ${renderCommentAttachments(comment.attachments)}
                            ${getCommentImage(comment) ? `<img class="comment-attachment" src="${window.escapeHtml(getCommentImage(comment))}" alt="Attachment" loading="lazy">` : ''}
                            <time>${window.escapeHtml(comment.time || '')}</time>
                        </div>
                    </article>
                `).join('')}
            </div>
            <form class="comment-form group-comment-form" id="groupCommentForm">
                <input id="groupCommentInput" type="text" maxlength="300" placeholder="Write a comment..." required>
                <select id="groupCommentMention">
                    <option value="">Tag a person</option>
                    ${members.map(m => `<option value="${window.escapeHtml(m.id)}">@${window.escapeHtml(m.full_name)}</option>`).join('')}
                </select>
                <label class="comment-attachment-button" id="groupCommentAttachmentLabel" title="Attach file">
                    <i class="bx bx-paperclip"></i>
                    <span class="attach-count">0</span>
                    <input id="groupCommentAttachment" type="file" accept="image/*,.pdf,.doc,.docx,.txt,.zip" multiple>
                </label>
                <button type="submit" class="btn primary"><i class="bx bx-send"></i></button>
            </form>
        </section>
    `;
}

// ============================================================================
// 13. SUBTASK DETAIL PANEL
// ============================================================================

function getSubtaskById(subtaskId) {
    return Object.values(window._GroupState.subtasksByTask)
        .flat().find(item => String(item.id) === String(subtaskId));
}

function renderSubtaskDetailPanel(members) {
    const subtask = getSubtaskById(window._GroupState.subtaskDetailId);
    if (!subtask) return '';

    const assignee = memberById(members, subtask.assignee_id);
    const assigneeName = assignee?.full_name || 'Unassigned';
    const assigneeEmail = assignee?.email || '';
    const assigneeInitial = (assigneeName || '?').charAt(0).toUpperCase();

    const files = window._GroupState.attachments[subtask.id] || [];
    files.sort((a, b) => (a.version || 9999) - (b.version || 9999));

    const filesHtml = files.length === 0
        ? `<p class="subtask-empty-text">No attachments yet. Click "Add version" to upload v1.</p>`
        : `<ul class="version-list">
            ${files.map(file => {
                const uploader = memberById(members, file.uploaded_by);
                const uploaderName = uploader?.full_name || 'Team member';
                const uploadedAt = formatCommentTime(file.created_at);
                const versionLabel = file.version ? `Version ${file.version}` : 'Final version';
                const isImage = (file.file_type || '').startsWith('image/');
                return `
                    <li class="version-item">
                        <div class="version-item-head">
                            <span class="version-tag">${versionLabel}</span>
                            <span class="version-time">${window.escapeHtml(uploadedAt)}</span>
                        </div>
                        <div class="version-item-body">
                            <div class="version-thumb">
                                ${isImage
                                    ? `<i class="bx bx-image"></i>`
                                    : `<i class="bx ${attachmentIcon(file)}"></i>`}
                            </div>
                            <div class="version-info">
                                <button type="button" class="subtask-attachment-name"
                                        data-open-attachment="${file.id}">
                                    ${window.escapeHtml(file.file_name || 'Attachment')}
                                </button>
                                <div class="version-meta">
                                    ${userInitialBadge(members, file.uploaded_by)}
                                    <span>${window.escapeHtml(uploaderName)}</span>
                                    <span>·</span>
                                    <span>${formatFileSize(file.file_size)}</span>
                                </div>
                            </div>
                            <div class="version-actions">
                                <button type="button" class="btn ghost sm"
                                        data-open-attachment="${file.id}"
                                        title="Preview">
                                    <i class="bx bx-show"></i>
                                </button>
                                <button type="button" class="btn ghost sm text-red"
                                        data-remove-attachment="${file.id}"
                                        title="Remove">
                                    <i class="bx bx-trash"></i>
                                </button>
                            </div>
                        </div>
                    </li>
                `;
            }).join('')}
        </ul>`;

    return `
        <div class="subtask-detail-backdrop" data-subtask-detail-close="true"></div>
        <section class="subtask-detail-panel" role="dialog" aria-modal="true">
            <div class="subtask-detail-head">
                <div><span class="eyebrow">Subtask Details</span><h3>${window.escapeHtml(subtask.title)}</h3></div>
                <button type="button" class="icon-btn" data-subtask-detail-close="true"><i class="bx bx-x"></i></button>
            </div>
            <div class="subtask-detail-body">
                <div class="subtask-detail-field">
                    <span>Status</span>
                    <strong>
                        ${subtask.completed
                            ? '<span class="status-pill completed"><span class="status-dot"></span>Completed</span>'
                            : '<span class="status-pill pending"><span class="status-dot"></span>Open</span>'}
                    </strong>
                </div>
                <div class="subtask-detail-field">
                    <span>Assigned to</span>
                    <div class="subtask-assignee">
                        <div class="avatar avatar-sm">${window.escapeHtml(assigneeInitial)}</div>
                        <div>
                            <strong>${window.escapeHtml(assigneeName)}</strong>
                            ${assigneeEmail ? `<div class="subtask-assignee-email">${window.escapeHtml(assigneeEmail)}</div>` : ''}
                        </div>
                    </div>
                </div>
                <div class="subtask-detail-field full">
                    <span>Versions (${files.length})</span>
                    ${filesHtml}
                </div>
                <div class="subtask-detail-actions">
                    <button type="button" class="btn secondary" id="subtaskDetailAttachBtn">
                        <i class="bx bx-plus"></i> Add next version
                    </button>
                    <button type="button" class="btn danger" id="subtaskDetailDeleteBtn">
                        <i class="bx bx-trash"></i> Delete subtask
                    </button>
                </div>
            </div>
        </section>
    `;
}

// ============================================================================
// 14. EVENT BINDING
// ============================================================================

function bindGroupWorkspaceEvents(projectId, tasks, members = [], project = null) {
    document.getElementById('addGroupTaskBtn')?.addEventListener('click', () => {
        window.openTaskModal({ mode: 'add', taskType: 'Group', projectId });
    });

    const projectAttachBtn = document.getElementById('attachProjectFileBtn');
    if (projectAttachBtn) {
        projectAttachBtn.addEventListener('click', () => {
            attachProjectFile(projectId, project);
        });
    }

    document.querySelectorAll('[data-subtask-edit]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const subtaskId = btn.dataset.subtaskEdit;
            const subtask = Object.values(window._GroupState.subtasksByTask || {})
                .flat().find(s => String(s.id) === String(subtaskId));
            if (!subtask) {
                window.showToast('Subtask not found', 'warning');
                return;
            }
            editGroupSubtask(subtask, projectId, members);
        });
    });

    document.querySelectorAll('[data-gview]').forEach(btn => {
        btn.addEventListener('click', () => {
            window._GroupState.view = btn.dataset.gview;
            renderProjectWorkspace(projectId);
        });
    });

    document.getElementById('groupSearch')?.addEventListener('input', e => {
        window._GroupState.search = e.target.value;
        renderProjectWorkspace(projectId);
    });
    document.getElementById('groupStatusFilter')?.addEventListener('change', e => {
        window._GroupState.status = e.target.value;
        renderProjectWorkspace(projectId);
    });
    document.getElementById('groupPriorityFilter')?.addEventListener('change', e => {
        window._GroupState.priority = e.target.value;
        renderProjectWorkspace(projectId);
    });
    document.getElementById('clearGroupFilters')?.addEventListener('click', () => {
        window._GroupState.search = '';
        window._GroupState.status = '';
        window._GroupState.priority = '';
        renderProjectWorkspace(projectId);
    });

    document.querySelectorAll('[data-gaction="comments"]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            window._GroupState.commentTaskId = btn.dataset.id;
            renderProjectWorkspace(projectId);
        });
    });

    document.querySelectorAll('[data-gaction="attachment"]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            attachGroupFile(btn.dataset.id, projectId, false);
        });
    });

    document.querySelectorAll(
        '[data-gaction="complete"], [data-gaction="reopen"], [data-gaction="start"], [data-gaction="pause"]'
    ).forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const task = tasks.find(t => String(t.id) === String(btn.dataset.id));
            if (!task) return;
            const action = btn.dataset.gaction;
            if (action === 'complete')      await toggleTaskComplete(task, projectId);
            else if (action === 'reopen')   await reopenTask(task, projectId);
            else if (action === 'start')    await startTask(task, projectId);
            else if (action === 'pause')    await reopenTask(task, projectId);
        });
    });

    document.querySelectorAll('[data-gaction="add-subtask"]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const task = tasks.find(item => String(item.id) === String(btn.dataset.id));
            if (task) addGroupSubtask(task, projectId, members);
        });
    });

    document.querySelectorAll('[data-gaction="edit"]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const task = tasks.find(t => String(t.id) === String(btn.dataset.id));
            if (task) window.openTaskModal({ mode: 'edit', taskType: 'Group', task });
        });
    });

    document.querySelectorAll('[data-gaction="delete"]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            window.deleteTaskById(btn.dataset.id);
        });
    });

    document.querySelectorAll('[data-subtask-complete]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            toggleGroupSubtask(btn.dataset.subtaskComplete, projectId);
        });
    });

    document.querySelectorAll('[data-subtask-attachment]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            attachGroupFile(btn.dataset.subtaskAttachment, projectId, true);
        });
    });

    document.querySelectorAll('[data-remove-attachment]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            deleteGroupAttachment(btn.dataset.removeAttachment, projectId);
        });
    });

    document.querySelectorAll('[data-subtask-detail]').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            window._GroupState.subtaskDetailId = el.dataset.subtaskDetail;
            renderProjectWorkspace(projectId);
        });
    });
    document.querySelectorAll('[data-subtask-detail-close="true"]').forEach(el => {
        el.addEventListener('click', () => {
            window._GroupState.subtaskDetailId = null;
            renderProjectWorkspace(projectId);
        });
    });

    const attachBtn = document.getElementById('subtaskDetailAttachBtn');
    if (attachBtn) {
        attachBtn.addEventListener('click', () => {
            const id = window._GroupState.subtaskDetailId;
            if (id) attachGroupFile(id, projectId, true);
        });
    }
    const delBtn = document.getElementById('subtaskDetailDeleteBtn');
    if (delBtn) {
        delBtn.addEventListener('click', async () => {
            const id = window._GroupState.subtaskDetailId;
            if (!id) return;
            window._GroupState.subtaskDetailId = null;
            await deleteGroupSubtask(id, projectId);
        });
    }

    document.querySelectorAll('[data-comments-close="true"]').forEach(el => {
        el.addEventListener('click', () => {
            window._GroupState.commentTaskId = null;
            renderProjectWorkspace(projectId);
        });
    });

    const commentFileInput = document.getElementById('groupCommentAttachment');
    commentFileInput?.addEventListener('change', () => {
        const label = document.getElementById('groupCommentAttachmentLabel');
        const countEl = label?.querySelector('.attach-count');
        const count = commentFileInput.files?.length || 0;
        if (countEl) countEl.textContent = String(count);
        label?.classList.toggle('has-files', count > 0);
    });

    document.querySelectorAll('[data-gsort]').forEach(th => {
        th.addEventListener('dblclick', () => toggleGroupSort(th.dataset.gsort));
    });

    document.getElementById('groupCommentForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        const input = document.getElementById('groupCommentInput');
        const text = input.value.trim();
        if (!text) return;
        const mentionId = document.getElementById('groupCommentMention').value;
        const mentioned = (window._GroupState.commentMembers || [])
            .find(m => String(m.id) === String(mentionId));
        const taggedText = mentioned ? `@${mentioned.full_name} ${text}` : text;
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { window.showToastMsg('Please log in again'); return; }
        const { data: newComment, error } = await supabase
            .from('comments')
            .insert({ task_id: window._GroupState.commentTaskId, user_id: user.id, content: taggedText })
            .select().single();
        if (error) {
            console.error('Post comment failed:', error);
            window.showToastMsg('Failed to post comment');
            return;
        }
        // Delegated handler — survives re-renders
        const container = document.getElementById('GroupTasksContainer');
        if (container && !container.dataset.subtaskDeleteBound) {
            container.dataset.subtaskDeleteBound = '1';
            container.addEventListener('click', (e) => {
                const delBtn = e.target.closest('[data-subtask-delete]');
                if (!delBtn) return;
                e.preventDefault();
                e.stopPropagation();
                deleteGroupSubtask(delBtn.dataset.subtaskDelete, projectId);
            });
        }

        const files = Array.from(document.getElementById('groupCommentAttachment')?.files || []);
        for (const file of files) await uploadGroupAttachment(file, { commentId: newComment.id });
        if (mentioned) notifyTaggedMember(mentioned, window._GroupState.commentTaskId, text);
        const projectTasks = (window.GroupTasks || []).filter(t => String(t.project_id) === String(projectId));
        const ids = projectTasks.map(t => t.id);
        await loadGroupComments(ids);
        await loadGroupAttachments(ids, projectId);
        window.showToastMsg('Comment posted');
        renderProjectWorkspace(projectId);
    });
}

async function attachProjectFile(projectId, project) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf,.doc,.docx,.txt,.zip';
    input.multiple = true;

    input.addEventListener('change', async () => {
        const files = Array.from(input.files || []);
        if (!files.length) return;

        for (const file of files) {
            await uploadProjectAttachment(file, projectId, project);
        }

        // Reload project attachments
        const projectTasks = (window.GroupTasks || []).filter(t => String(t.project_id) === String(projectId));
        const ids = projectTasks.map(t => t.id);
        await loadGroupAttachments(ids, projectId);

        window.showToastMsg(`${files.length} project file${files.length > 1 ? 's' : ''} uploaded`);
        renderProjectWorkspace(projectId);
    });
    input.click();
}

async function uploadProjectAttachment(file, projectId, project) {
    if (!file) return null;
    if (file.size > 10 * 1024 * 1024) {
        window.showToastMsg('File must be 10MB or smaller');
        return null;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.showToastMsg('Please log in again'); return null; }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
    const path = `projects/${projectId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

    const { error: upErr } = await supabase.storage
        .from('task-attachments')
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (upErr) {
        console.error('Project upload failed:', upErr);
        window.showToastMsg('Upload failed: ' + upErr.message);
        return null;
    }

    const { data, error: dbErr } = await supabase
        .from('task_attachments')
        .insert({
            task_id: null,
            subtask_id: null,
            comment_id: null,
            uploaded_by: user.id,
            file_name: file.name,
            file_path: path,
            file_type: file.type || null,
            file_size: file.size,
            project_id: projectId
        })
        .select().single();

    if (dbErr) {
        console.error('Project metadata insert failed:', dbErr);
        await supabase.storage.from('task-attachments').remove([path]);
        return null;
    }
    return data;
}

async function notifyTaggedMember(member, taskId, commentText) {
    try {
        const { error } = await supabase.from('notifications').insert({
            user_id: member.id, type: 'comment',
            title: 'You were tagged in a task comment',
            message: `${window.userProfile?.full_name || 'A teammate'} mentioned you: ${commentText}`,
            is_read: false
        });
        if (error) throw error;
        window.showToastMsg(`${member.full_name} was notified`);
    } catch (err) {
        console.error('Notification failed:', err);
        window.showToastMsg('Comment added, but notification could not be sent');
    }
}

// Global attachment opener
document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-open-attachment]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    await openGroupAttachment(button.dataset.openAttachment);
});

// Global delegated handler for subtask delete — attach ONCE on document
document.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-subtask-delete]');
    if (!delBtn) return;
    e.preventDefault();
    e.stopPropagation();

    const projectId = window._GroupState.activeProject;
    if (!projectId) return;

    deleteGroupSubtask(delBtn.dataset.subtaskDelete, projectId);
});

// Global delegated handler for subtask edit — survives re-renders
document.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-subtask-edit]');
    if (!editBtn) return;
    e.preventDefault();
    e.stopPropagation();

    const subtaskId = editBtn.dataset.subtaskEdit;
    const projectId = window._GroupState.activeProject;
    if (!projectId) return;

    const subtask = Object.values(window._GroupState.subtasksByTask || {})
        .flat().find(s => String(s.id) === String(subtaskId));

    if (!subtask) {
        window.showToast('Subtask not found — refreshing', 'warning', 2500);
        renderProjectWorkspace(projectId);
        return;
    }

    // Look up members of the current project so the dropdown is populated
    window.loadProjectMembers(projectId).then(members => {
        editGroupSubtask(subtask, projectId, members);
    });
});