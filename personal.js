// personal.js — Personal Tasks Page

// ============================================================================
// 1. INIT
// ============================================================================

window.initPersonal = async function () {
    const pageContent = document.getElementById('pageContent');
    try {
        const isAuth = await window.checkAuth();
        if (!isAuth) return;

        await window.loadNavbar('personal');
        await window.loadTopbar('personal');
        await window.loadUserInfo();
        await window.loadNotificationCount();
        await window.loadTasks();

        await autoPromotePersonalTasks();

        const savedTheme = localStorage.getItem('taskflow-theme');
        if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

        window._personalState = {
            view: 'list',
            status: '',
            priority: '',
            search: '',
            sort: 'due_asc'
        };
        window.refreshTaskViewCallback = renderPersonalPage;
        renderPersonalPage();
    } catch (err) {
        console.error('Personal page init error:', err);
        if (pageContent) {
            pageContent.innerHTML = window.renderEmptyState(
                '❌',
                'Error loading tasks',
                err.message || 'Please try refreshing the page.'
            );
        }
    }
};

// ============================================================================
// 2. STATUS HELPERS
// ============================================================================

function getPersonalEffectiveStatus(task) {
    if (!task) return 'pending';
    if (task.status === 'completed') return 'completed';
    if (task.due_date) {
        const today = new Date().toISOString().slice(0, 10);
        if (task.due_date < today) return 'overdue';
    }
    if (task.status === 'in-progress') return 'in-progress';
    return 'pending';
}

async function autoPromotePersonalTasks() {
    const today = new Date().toISOString().slice(0, 10);

    const candidates = (window.personalTasks || []).filter(t =>
        t.status === 'pending' && t.start_date && t.start_date <= today
    );
    if (candidates.length === 0) return;

    const ids = candidates.map(t => t.id);
    const { error } = await supabase
        .from('tasks')
        .update({ status: 'in-progress' })
        .in('id', ids);

    if (error) {
        console.error('Personal auto-promote failed:', error);
        return;
    }
    candidates.forEach(t => { t.status = 'in-progress'; });
}

async function startPersonalTask(task) {
    if (task.status === 'in-progress') return;
    const previous = task.status;

    task.status = 'in-progress';
    renderPersonalPage();

    const { error } = await supabase
        .from('tasks').update({ status: 'in-progress' }).eq('id', task.id);

    if (error) {
        task.status = previous;
        renderPersonalPage();
        window.showToast('Failed to start task', 'error');
        return;
    }

    window.showToast(`"${task.title}" started`, 'success', 5000, {
        actionText: 'Undo',
        onAction: async () => {
            task.status = previous;
            renderPersonalPage();
            await supabase.from('tasks').update({ status: previous }).eq('id', task.id);
            window.showToast('Task paused', 'info', 1800);
        }
    });
}

async function pausePersonalTask(task) {
    if (task.status === 'pending') return;
    const previous = task.status;

    task.status = 'pending';
    renderPersonalPage();

    const { error } = await supabase
        .from('tasks').update({ status: 'pending' }).eq('id', task.id);

    if (error) {
        task.status = previous;
        renderPersonalPage();
        window.showToast('Failed to pause task', 'error');
        return;
    }

    window.showToast(`"${task.title}" paused`, 'success', 5000, {
        actionText: 'Undo',
        onAction: async () => {
            task.status = previous;
            renderPersonalPage();
            await supabase.from('tasks').update({ status: previous }).eq('id', task.id);
            window.showToast('Task resumed', 'info', 1800);
        }
    });
}

async function togglePersonalTaskComplete(task) {
    const wasCompleted = task.status === 'completed';
    const previous = task.status;

    task.status = wasCompleted ? 'pending' : 'completed';
    renderPersonalPage();

    const { error } = await supabase
        .from('tasks').update({ status: task.status }).eq('id', task.id);

    if (error) {
        task.status = previous;
        renderPersonalPage();
        window.showToast('Failed to update task', 'error');
        return;
    }

    window.showToast(
        wasCompleted ? `"${task.title}" reopened` : `"${task.title}" completed`,
        'success', 5000,
        {
            actionText: 'Undo',
            onAction: async () => {
                task.status = previous;
                renderPersonalPage();
                await supabase.from('tasks').update({ status: previous }).eq('id', task.id);
                window.showToast('Change reverted', 'info', 1800);
            }
        }
    );
}

// ============================================================================
// 3. FILTERING & SORTING
// ============================================================================

function getFilteredPersonalTasks() {
    const state = window._personalState;
    let tasks = (window.personalTasks || []).slice();

    if (state.status) tasks = tasks.filter(t => getPersonalEffectiveStatus(t) === state.status);
    if (state.priority) tasks = tasks.filter(t => t.priority === state.priority);
    if (state.search) {
        const q = state.search.toLowerCase();
        tasks = tasks.filter(t =>
            (t.title || '').toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q)
        );
    }

    const sortKey = state.sort.replace(/_(asc|desc)$/, '');
    const sortDirection = state.sort.endsWith('_desc') ? -1 : 1;
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const statusOrder = { 'overdue': 0, 'in-progress': 1, 'pending': 2, 'completed': 3 };

    const sorters = {
        title: (a, b) => (a.title || '').localeCompare(b.title || ''),
        priority: (a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3),
        status: (a, b) =>
            (statusOrder[getPersonalEffectiveStatus(a)] ?? 9) -
            (statusOrder[getPersonalEffectiveStatus(b)] ?? 9),
        due: (a, b) => new Date(a.due_date || '9999-12-31') - new Date(b.due_date || '9999-12-31')
    };
    tasks.sort((a, b) => (sorters[sortKey] || sorters.due)(a, b) * sortDirection);
    return tasks;
}

function getPersonalSortIndicator(sortKey) {
    const state = window._personalState;
    const activeKey = state.sort.replace(/_(asc|desc)$/, '');
    if (activeKey !== sortKey) return '';
    return state.sort.endsWith('_desc') ? ' ↓' : ' ↑';
}

function togglePersonalSort(sortKey) {
    const state = window._personalState;
    const activeKey = state.sort.replace(/_(asc|desc)$/, '');
    const direction = activeKey === sortKey && state.sort.endsWith('_asc') ? 'desc' : 'asc';
    state.sort = `${sortKey}_${direction}`;
    renderPersonalPage();
}

// ============================================================================
// 4. RENDER
// ============================================================================

function renderPersonalPage() {
    const pageContent = document.getElementById('pageContent');
    const state = window._personalState;
    const tasks = getFilteredPersonalTasks();

    pageContent.innerHTML = `
        <div class="page-head">
            <div>
                <h2>Personal Tasks</h2>
                <p>Tasks only you own.</p>
            </div>
            <div class="page-actions">
                <button class="btn primary" id="addPersonalTaskBtn">
                    <i class="bx bx-plus"></i> Add Task
                </button>
            </div>
        </div>

        <div class="toolbar">
            <div class="search-box">
                <i class="bx bx-search"></i>
                <input type="text" id="personalSearch" placeholder="Search tasks..." value="${window.escapeHtml(state.search)}">
            </div>
            <select id="personalStatusFilter" class="select">
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="in-progress">In Progress</option>
                <option value="overdue">Overdue</option>
                <option value="completed">Completed</option>
            </select>
            <select id="personalPriorityFilter" class="select">
                <option value="">All Priority</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
            </select>
            <button class="btn secondary" id="clearPersonalFilters">Clear</button>
            <div class="segmented">
                <button data-view="list" class="${state.view === 'list' ? 'active' : ''}">List</button>
                <button data-view="card" class="${state.view === 'card' ? 'active' : ''}">Card</button>
            </div>
        </div>

        <div class="card" id="personalTasksContainer">
            ${tasks.length === 0
                ? window.renderEmptyState('○', 'No tasks found', 'Try adjusting your filters or create a new task.')
                : state.view === 'list'
                    ? renderPersonalList(tasks)
                    : renderPersonalCards(tasks)}
        </div>
    `;

    document.getElementById('personalStatusFilter').value = state.status;
    document.getElementById('personalPriorityFilter').value = state.priority;
    bindPersonalEvents();
}

function renderPersonalList(tasks) {
    return `
        <div class="task-table-wrap">
            <table class="task-table">
                <thead><tr>
                    <th></th>
                    <th class="sortable-header" data-sort-key="title">Title${getPersonalSortIndicator('title')}</th>
                    <th class="sortable-header" data-sort-key="priority">Priority${getPersonalSortIndicator('priority')}</th>
                    <th class="sortable-header" data-sort-key="status">Status${getPersonalSortIndicator('status')}</th>
                    <th class="sortable-header" data-sort-key="due">Due Date${getPersonalSortIndicator('due')}</th>
                    <th>Actions</th>
                </tr></thead>
                <tbody>
                    ${tasks.map(t => {
    const eff = getPersonalEffectiveStatus(t);
    const isCompleted = t.status === 'completed';
    const isInProgress = t.status === 'in-progress';
    const today = new Date().toISOString().slice(0, 10);
    const isOverdue = t.due_date && !isCompleted && t.due_date < today;

    const statusPills = isOverdue
        ? `<span class="status-pill overdue"><span class="status-dot"></span>Overdue</span>
           <span class="status-pill ${isInProgress ? 'in-progress' : 'pending'}">
               <span class="status-dot"></span>${isInProgress ? 'In Progress' : 'Pending'}
           </span>`
        : `<span class="status-pill ${eff}">
               <span class="status-dot"></span>${eff.replace('-', ' ')}
           </span>`;

    return `
        <tr data-view="${t.id}">
            <td>
                <button class="check ${isCompleted ? 'completed' : ''}" data-complete="${t.id}">
                    ${isCompleted ? '<i class="bx bx-check"></i>' : ''}
                </button>
            </td>
            <td class="title-cell">
                ${window.escapeHtml(t.title)}
                <div class="desc-preview">${window.escapeHtml((t.description || '').slice(0, 60))}</div>
            </td>
            <td><span class="badge ${t.priority}">${t.priority || '-'}</span></td>
            <td><div class="status-combo">${statusPills}</div></td>
            <td>
                <div>${window.fmtDate(t.due_date)}</div>
                ${renderCountdown(t.due_date)}
            </td>
            <td class="row-actions">
                ${!isCompleted && !isInProgress
                    ? `<button data-action="start" data-id="${t.id}" class="row-action-btn row-action-start" title="Start task"><i class="bx bx-play"></i></button>`
                    : ''}
                ${!isCompleted && isInProgress
                    ? `<button data-action="pause" data-id="${t.id}" class="row-action-btn row-action-pause" title="Pause task"><i class="bx bx-pause"></i></button>`
                    : ''}
                <button data-action="edit" data-id="${t.id}" ${isCompleted ? 'disabled title="Completed tasks are locked"' : ''}>
                    <i class="bx bx-edit"></i>
                </button>
                <button data-action="delete" data-id="${t.id}"><i class="bx bx-trash"></i></button>
            </td>
        </tr>
    `;
}).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderPersonalCards(tasks) {
    const statusGroups = [
        { key: 'overdue', label: 'Overdue' },
        { key: 'in-progress', label: 'In Progress' },
        { key: 'pending', label: 'Pending' },
        { key: 'completed', label: 'Completed' }
    ];

    return `
        <div class="card-grid personal-card-grid">
            ${statusGroups.map(status => {
                const groupTasks = tasks.filter(t => getPersonalEffectiveStatus(t) === status.key);
                if (groupTasks.length === 0) return '';
                return `
                    <section class="status-column">
                        <h3 class="status-column-header status-badge ${status.key}">
                            <span class="status-dot"></span>${status.label}
                            <span class="status-column-count">${groupTasks.length}</span>
                        </h3>
                        <div class="status-column-tasks">
                            ${groupTasks.map(t => {
                                const isCompleted = t.status === 'completed';
                                const isInProgress = t.status === 'in-progress';
                                return `
                                    <div class="task-card" data-view="${t.id}">
                                        <div class="project-top">
                                            <strong>${window.escapeHtml(t.title)}</strong>
                                            <span class="badge ${t.priority}">${t.priority}</span>
                                        </div>
                                        <p>${window.escapeHtml(t.description || 'No description')}</p>
                                        <div class="task-meta">
                                            <span>${window.escapeHtml(t.category || 'Uncategorized')}</span>
                                            <span>•</span>
                                            <span>${window.fmtDate(t.due_date)}</span>
                                        </div>
                                        <div class="row-actions" style="margin-top:8px;">
                                            <button class="check ${isCompleted ? 'completed' : ''}" data-complete="${t.id}">
                                                ${isCompleted ? '<i class="bx bx-check"></i>' : ''}
                                            </button>
                                            ${!isCompleted && !isInProgress
                                                ? `<button data-action="start" data-id="${t.id}" class="row-action-btn row-action-start" title="Start task"><i class="bx bx-play"></i></button>`
                                                : ''}
                                            ${!isCompleted && isInProgress
                                                ? `<button data-action="pause" data-id="${t.id}" class="row-action-btn row-action-pause" title="Pause task"><i class="bx bx-pause"></i></button>`
                                                : ''}
                                            <button data-action="edit" data-id="${t.id}" ${isCompleted ? 'disabled' : ''}>
                                                <i class="bx bx-edit"></i>
                                            </button>
                                            <button data-action="delete" data-id="${t.id}">
                                                <i class="bx bx-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </section>
                `;
            }).join('')}
        </div>
    `;
}

// ============================================================================
// 5. EVENT BINDING
// ============================================================================

function bindPersonalEvents() {
    const state = window._personalState;

    document.getElementById('personalSearch').addEventListener('input', e => {
        state.search = e.target.value;
        renderPersonalPage();
    });
    document.getElementById('personalStatusFilter').addEventListener('change', e => {
        state.status = e.target.value;
        renderPersonalPage();
    });
    document.getElementById('personalPriorityFilter').addEventListener('change', e => {
        state.priority = e.target.value;
        renderPersonalPage();
    });
    document.getElementById('clearPersonalFilters').addEventListener('click', () => {
        window._personalState = { view: state.view, status: '', priority: '', search: '', sort: 'due_asc' };
        renderPersonalPage();
    });
    document.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.view = btn.dataset.view;
            renderPersonalPage();
        });
    });
    document.querySelectorAll('.sortable-header').forEach(header => {
        header.addEventListener('dblclick', () => togglePersonalSort(header.dataset.sortKey));
    });

    document.getElementById('addPersonalTaskBtn').addEventListener('click', () => {
        window.openTaskModal({ mode: 'add', taskType: 'personal' });
    });

    document.querySelectorAll('[data-complete]').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const task = window.personalTasks.find(t => String(t.id) === String(btn.dataset.complete));
            if (!task) return;
            await togglePersonalTaskComplete(task);
        });
    });

    document.querySelectorAll('[data-action="start"]').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const task = window.personalTasks.find(t => String(t.id) === String(btn.dataset.id));
            if (!task) return;
            await startPersonalTask(task);
        });
    });

    document.querySelectorAll('[data-action="pause"]').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const task = window.personalTasks.find(t => String(t.id) === String(btn.dataset.id));
            if (!task) return;
            await pausePersonalTask(task);
        });
    });

    document.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            if (btn.disabled) return;
            const task = window.personalTasks.find(t => String(t.id) === String(btn.dataset.id));
            if (task) window.openTaskModal({ mode: 'edit', taskType: 'personal', task });
        });
    });

    document.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            window.deleteTaskById(btn.dataset.id);
        });
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


// ============================================================================
// 6. EXPOSE
// ============================================================================

window.initPersonal = window.initPersonal;
window.renderPersonalPage = renderPersonalPage;
window.getPersonalEffectiveStatus = getPersonalEffectiveStatus;