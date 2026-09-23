// ============================================
// INITIALIZATION
// ============================================

async function initDashboard() {
    const pageContent = document.getElementById('pageContent');

    try {
        const isAuth = await window.checkAuth();
        if (!isAuth) return;

        await window.loadNavbar('dashboard');
        await window.loadTopbar('dashboard');
        await window.loadUserInfo();
        await window.loadNotificationCount();
        await window.loadTasks();
        await window.loadProjects();

        // Auto-promote any pending tasks whose start_date has arrived
        await autoPromoteDashboardTasks();

        const savedTheme = localStorage.getItem('taskflow-theme');
        if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

        renderDashboard();
    } catch (err) {
        console.error('Dashboard init error:', err);
        if (pageContent) {
            pageContent.innerHTML = `
                <div class="empty" style="padding:60px 20px;">
                    <div class="empty-icon">❌</div>
                    <h3>Error loading dashboard</h3>
                    <p>${err.message || 'Please try refreshing the page.'}</p>
                    <button class="btn primary" onclick="location.reload()" style="margin-top:20px;">
                        <i class="bx bx-refresh"></i> Retry
                    </button>
                </div>
            `;
        }
    }
}

/**
 * Auto-promotes pending tasks across ALL of the user's tasks (personal +
 * group) whose start_date has arrived.
 */
async function autoPromoteDashboardTasks() {
    const today = new Date().toISOString().slice(0, 10);

    const candidates = (window.allTasks || []).filter(t =>
        t.status === 'pending' &&
        t.start_date &&
        t.start_date <= today
    );
    if (candidates.length === 0) return;

    const ids = candidates.map(t => t.id);
    const { error } = await supabase
        .from('tasks')
        .update({ status: 'in-progress' })
        .in('id', ids);

    if (error) {
        console.error('Dashboard auto-promote failed:', error);
        return;
    }
    candidates.forEach(t => { t.status = 'in-progress'; });
}

// ============================================
// EFFECTIVE STATUS HELPER
// ============================================

/**
 * Same status model as personal.js and group.js.
 * "overdue" is derived from today's date at render time.
 */

/**
 * Returns true if the task is past its due date and not completed.
 * This is INDEPENDENT of status — a task can be "in-progress" AND overdue.
 */
function isTaskOverdue(task) {
    if (!task) return false;
    if (task.status === 'completed') return false;
    if (!task.due_date) return false;

    const today = new Date().toISOString().slice(0, 10);
    return task.due_date < today;
}

function getDashboardEffectiveStatus(task) {
    if (!task) return 'pending';
    if (task.status === 'completed') return 'completed';
    if (task.due_date) {
        const today = new Date().toISOString().slice(0, 10);
        if (task.due_date < today) return 'overdue';
    }
    if (task.status === 'in-progress') return 'in-progress';
    return 'pending';
}

// ============================================
// RENDER DASHBOARD
// ============================================

function renderDashboard() {
    const pageContent = document.getElementById('pageContent');
    const tasks = window.allTasks || [];
    const stats = getTaskStats(tasks);
    const todayTasks = getTodayTasks(tasks);
    const timeOfDay = getTimeOfDay();
    const userName = document.getElementById('userName')?.textContent || 'User';
    const scheduleState = window._dashboardScheduleState || {
        view: 'calendar',
        month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        selectedDate: dateKey(new Date())
    };
    window._dashboardScheduleState = scheduleState;

    pageContent.innerHTML = `
        <div class="page-head">
            <div>
                <h2>Good ${timeOfDay}, ${userName}</h2>
                <p>Here's an overview of your tasks and schedule.</p>
            </div>
            <div class="page-actions">
                <button class="btn primary" id="addTaskBtn">
                    <i class="bx bx-plus"></i> Add New Task
                </button>
            </div>
        </div>

        <!-- Stats -->
        <div class="stats">
            ${createStatCard('Total Tasks', stats.total, 'bx-task', 'total')}
            ${createStatCard('Completed', stats.completed, 'bx-check-circle', 'completed')}
            ${createStatCard('Pending', stats.pending, 'bx-time', 'pending')}
            ${createStatCard('In Progress', stats.inprogress, 'bx-loader-circle', 'in-progress')}
        </div>

        ${renderProductivityOverview(stats)}

        <section class="dashboard-schedule card">
            <div class="card-head schedule-head">
                <div>
                    <h3>Task Schedule</h3>
                    <p>Review tasks by date or timeline.</p>
                </div>
                <div class="segmented" id="scheduleViewToggle">
                    <button data-schedule-view="calendar" class="${scheduleState.view === 'calendar' ? 'active' : ''}">
                        <i class="bx bx-calendar"></i> Calendar
                    </button>
                    <button data-schedule-view="timeline" class="${scheduleState.view === 'timeline' ? 'active' : ''}">
                        <i class="bx bx-bar-chart-alt-2"></i> Timeline
                    </button>
                </div>
            </div>
            <div id="scheduleContent">
                ${scheduleState.view === 'timeline'
                    ? renderDashboardTimeline(tasks)
                    : renderDashboardCalendar(tasks, scheduleState)}
            </div>
        </section>
    `;

    bindDashboardEvents();
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Statistics for the dashboard.
 *
 * IMPORTANT: "overdue" is NOT a status — it's a time-based flag that can
 * overlay either pending or in-progress tasks. Therefore:
 *   - pending + in-progress + completed = total
 *   - overdue is counted SEPARATELY and can overlap with pending/in-progress
 */
function getTaskStats(tasks) {
    let completed = 0;
    let inprogress = 0;
    let pending = 0;
    let overdue = 0;

    const today = new Date().toISOString().slice(0, 10);

    for (const t of tasks) {
        // Overdue flag: past due AND not completed
        const isOverdue = t.due_date && t.status !== 'completed' && t.due_date < today;
        if (isOverdue) overdue++;

        // Status counts (independent of overdue)
        if (t.status === 'completed') {
            completed++;
        } else if (t.status === 'in-progress') {
            inprogress++;
        } else {
            pending++;
        }
    }

    return {
        total: tasks.length,
        completed,
        inprogress,
        pending,
        overdue
    };
}
function getTodayTasks(tasks) {
    const today = dateKey(new Date());
    return tasks.filter(t =>
        t.due_date &&
        dateKey(t.due_date) === today &&
        t.status !== 'completed'
    );
}

function getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
}

function renderProductivityOverview(stats) {
    const productivityIndex = stats.total
        ? Math.round((stats.completed / stats.total) * 100)
        : 0;
    const remaining = Math.max(stats.total - stats.completed, 0);
    const segments = [
        { label: 'Completed', value: stats.completed, className: 'completed' },
        { label: 'Remaining', value: remaining, className: 'remaining' }
    ];

    return `
        <section class="productivity-overview card">
            <div class="card-head">
                <div>
                    <h3>Productivity Overview</h3>
                    <p>Overall To-Do Productivity Index</p>
                </div>
                <strong class="productivity-index">${productivityIndex}%</strong>
            </div>
            <div class="productivity-body">
                <div class="productivity-chart" style="--productivity:${productivityIndex}%">
                    <div class="productivity-chart-center">
                        <strong>${productivityIndex}%</strong><span>PI</span>
                    </div>
                </div>
                <div class="productivity-summary">
                    <div class="productivity-summary-head">
                        <span>Completion progress</span>
                        <strong>${stats.completed}/${stats.total}</strong>
                    </div>
                    <div class="productivity-track"><span style="width:${productivityIndex}%"></span></div>
                    ${segments.map(seg => `
                        <div class="productivity-legend">
                            <span><i class="${seg.className}"></i>${seg.label}</span>
                            <strong>${seg.value}</strong>
                        </div>
                    `).join('')}
                </div>
            </div>
        </section>
    `;
}

function dateKey(date) {
    if (!date) return '';
    if (typeof date === 'string') {
        if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
        date = new Date(date);
    }
    if (date instanceof Date && !isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return '';
}

function formatDisplayDate(dateKeyStr) {
    if (!dateKeyStr) return '';
    const parts = String(dateKeyStr).slice(0, 10).split('-').map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    const d = new Date(dateKeyStr);
    return isNaN(d.getTime())
        ? dateKeyStr
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderDashboardCalendar(tasks, state) {
    const month = state.month;
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const firstDay = new Date(year, monthIndex, 1).getDay();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const previousMonthDays = new Date(year, monthIndex, 0).getDate();
    const cells = [];
    const selectedTasks = tasks.filter(task =>
        task.due_date && dateKey(task.due_date) === state.selectedDate
    );

    for (let index = 0; index < 42; index++) {
        const dayOffset = index - firstDay + 1;
        let cellDate;
        let muted = false;
        if (dayOffset < 1) {
            cellDate = new Date(year, monthIndex - 1, previousMonthDays + dayOffset);
            muted = true;
        } else if (dayOffset > daysInMonth) {
            cellDate = new Date(year, monthIndex + 1, dayOffset - daysInMonth);
            muted = true;
        } else {
            cellDate = new Date(year, monthIndex, dayOffset);
        }
        const key = dateKey(cellDate);
        const dayTasks = tasks.filter(task => task.due_date && dateKey(task.due_date) === key);
        cells.push(`
            <button class="dashboard-cal-cell ${muted ? 'muted' : ''} ${key === dateKey(new Date()) ? 'today' : ''} ${key === state.selectedDate ? 'selected' : ''}" data-calendar-date="${key}">
                <span class="cal-date">${cellDate.getDate()}</span>
                ${dayTasks.slice(0, 2).map(task => `<span class="event-dot ${task.priority || ''}">${window.escapeHtml(task.title)}</span>`).join('')}
                ${dayTasks.length > 2 ? `<span class="calendar-more">+${dayTasks.length - 2} more</span>` : ''}
            </button>
        `);
    }

    return `
        <div class="calendar-layout dashboard-calendar-layout">
            <div class="calendar-card">
                <div class="calendar-toolbar">
                    <button class="icon-btn" data-calendar-nav="prev" title="Previous month"><i class="bx bx-chevron-left"></i></button>
                    <strong class="calendar-title">${month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>
                    <button class="icon-btn" data-calendar-nav="next" title="Next month"><i class="bx bx-chevron-right"></i></button>
                </div>
                <div class="calendar dashboard-calendar">
                    <div class="calendar-weekdays">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<span>${day}</span>`).join('')}</div>
                    <div class="calendar-grid">${cells.join('')}</div>
                </div>
            </div>
            <div class="card task-panel dashboard-day-panel">
                <div class="card-head">
                    <div>
                        <h3>${formatDisplayDate(state.selectedDate)}</h3>
                        <p>${selectedTasks.length} task${selectedTasks.length === 1 ? '' : 's'} scheduled</p>
                    </div>
                </div>
                <div class="dashboard-day-tasks">
                    ${selectedTasks.length
                        ? selectedTasks.map(task => renderDashboardTask(task)).join('')
                        : '<div class="empty"><div class="empty-icon"><i class="bx bx-calendar-x"></i></div><p>No tasks scheduled for this day.</p></div>'}
                </div>
            </div>
        </div>
    `;
}

function renderDashboardTask(task) {
    const eff = getDashboardEffectiveStatus(task);
    const isCompleted = task.status === 'completed';
    const isInProgress = task.status === 'in-progress';

    return `
        <div class="task-row dashboard-task-row">
            <div class="task-row-main">
                <div class="dashboard-task-title">
                    <button class="schedule-check ${isCompleted ? 'completed' : ''}" data-schedule-complete="${task.id}" aria-label="${isCompleted ? 'Reopen task' : 'Complete task'}">
                        ${isCompleted ? '<i class="bx bx-check"></i>' : '<i class="bx bx-check"></i>'}
                    </button>
                    <strong class="task-title ${isCompleted ? 'done' : ''}">${window.escapeHtml(task.title)}</strong>
                </div>
                <span class="status-pill ${eff}">
                    <span class="status-dot"></span>${eff.replace('-', ' ')}
                </span>
            </div>
            <div class="task-meta">
                <span>${window.escapeHtml(task.category || 'Uncategorized')}</span>
                <span>${task.due_time || 'No time'}</span>
                <span class="badge ${task.priority || 'medium'}">${task.priority || 'medium'}</span>
                ${!isCompleted && !isInProgress
                    ? `<button class="btn ghost sm" data-schedule-start="${task.id}" title="Start task"><i class="bx bx-play"></i></button>`
                    : ''}
                ${!isCompleted && isInProgress
                    ? `<button class="btn ghost sm" data-schedule-pause="${task.id}" title="Pause task"><i class="bx bx-pause"></i></button>`
                    : ''}
            </div>
        </div>
    `;
}

function renderDashboardTimeline(tasks) {
    const datedTasks = tasks
        .filter(task => task.due_date)
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    if (datedTasks.length === 0) {
        return '<div class="empty"><p>No dated tasks to show.</p></div>';
    }

    // Compute range
    const dates = datedTasks.map(t => new Date(t.due_date).getTime());
    const rangeStart = Math.min(...dates);
    const rangeEnd = Math.max(...dates);
    const range = Math.max(rangeEnd - rangeStart, 24 * 60 * 60 * 1000);

    return `
        <div class="dashboard-timeline timeline">
            ${datedTasks.map(task => {
                const eff = getDashboardEffectiveStatus(task);
                const tMs = new Date(task.due_date).getTime();
                const left = ((tMs - rangeStart) / range) * 100;
                const barClass =
                    eff === 'completed' ? 'green' :
                    eff === 'overdue' ? 'red' :
                    eff === 'in-progress' ? '' : 'amber';
                return `
                    <div class="dashboard-timeline-row timeline-row">
                        <div class="timeline-label">
                            <strong>${window.escapeHtml(task.title)}</strong>
                            <span>${window.fmtDate(task.due_date)}</span>
                        </div>
                        <div class="timeline-track">
                            <span class="timeline-bar ${barClass}"
                                  style="left:${left}%;width:6px;transform:translateX(-50%)"></span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}
function createStatCard(label, count, icon, status) {
    return `
        <div class="stat-card stat-${status}">
            <div class="stat-top">
                <span>${label}</span>
                <span class="stat-icon"><i class="bx ${icon}"></i></span>
            </div>
            <div class="stat-number">${count}</div>
        </div>
    `;
}   

// ============================================
// BIND EVENTS
// ============================================

function bindDashboardEvents() {
    document.getElementById('addTaskBtn')?.addEventListener('click', () => {
        openTaskModal({ mode: 'add', taskType: 'personal' });
    });

    document.querySelectorAll('[data-complete]').forEach(btn => {
        btn.addEventListener('click', async function (e) {
            e.stopPropagation();
            await toggleTaskStatus(this.dataset.complete);
        });
    });

    document.querySelectorAll('[data-schedule-complete]').forEach(button => {
        button.addEventListener('click', async event => {
            event.stopPropagation();
            await toggleTaskStatus(button.dataset.scheduleComplete);
        });
    });

    document.querySelectorAll('[data-schedule-start]').forEach(button => {
        button.addEventListener('click', async event => {
            event.stopPropagation();
            await startDashboardTask(button.dataset.scheduleStart);
        });
    });

    document.querySelectorAll('[data-schedule-pause]').forEach(button => {
        button.addEventListener('click', async event => {
            event.stopPropagation();
            await pauseDashboardTask(button.dataset.schedulePause);
        });
    });

    document.querySelectorAll('[data-schedule-view]').forEach(button => {
        button.addEventListener('click', () => {
            window._dashboardScheduleState.view = button.dataset.scheduleView;
            renderDashboard();
        });
    });

    document.querySelectorAll('[data-calendar-date]').forEach(cell => {
        cell.addEventListener('click', () => {
            window._dashboardScheduleState.selectedDate = cell.dataset.calendarDate;
            renderDashboard();
        });
    });
    
    document.querySelectorAll('[data-quicknav]').forEach(btn => {
        btn.addEventListener('click', () => {
            // Route to personal page with a filter applied
            sessionStorage.setItem('taskflow-quicknav-status', btn.dataset.quicknav);
            window.location.href = 'personal.html';
        });
    });

    document.querySelectorAll('[data-calendar-nav]').forEach(button => {
        button.addEventListener('click', () => {
            const state = window._dashboardScheduleState;
            state.month = new Date(
                state.month.getFullYear(),
                state.month.getMonth() + (button.dataset.calendarNav === 'next' ? 1 : -1),
                1
            );
            renderDashboard();
        });
    });
}

// ============================================
// TASK ACTIONS
// ============================================

/**
 * Toggle a task between completed and its previous active state.
 * Uses an undo toast, just like personal.js and group.js.
 */
async function toggleTaskStatus(taskId) {
    try {
        const task = window.allTasks.find(t => String(t.id) === String(taskId));
        if (!task) return;

        const previous = task.status;
        const newStatus = task.status === 'completed' ? 'pending' : 'completed';

        task.status = newStatus;
        renderDashboard();

        const { error } = await supabase
            .from('tasks')
            .update({ status: newStatus })
            .eq('id', taskId);

        if (error) {
            task.status = previous;
            renderDashboard();
            throw error;
        }

        window.showToast(
            newStatus === 'completed' ? `"${task.title}" completed` : `"${task.title}" reopened`,
            'success',
            5000,
            {
                actionText: 'Undo',
                onAction: async () => {
                    task.status = previous;
                    renderDashboard();
                    await supabase.from('tasks').update({ status: previous }).eq('id', taskId);
                    window.showToast('Change reverted', 'info', 1800);
                }
            }
        );
    } catch (err) {
        console.error('Error updating task:', err);
        window.showToast('Failed to update task status', 'error');
    }
}

async function startDashboardTask(taskId) {
    const task = window.allTasks.find(t => String(t.id) === String(taskId));
    if (!task) return;
    const previous = task.status;

    task.status = 'in-progress';
    renderDashboard();

    const { error } = await supabase
        .from('tasks')
        .update({ status: 'in-progress' })
        .eq('id', taskId);

    if (error) {
        task.status = previous;
        renderDashboard();
        window.showToast('Failed to start task', 'error');
        return;
    }

    window.showToast(`"${task.title}" started`, 'success', 5000, {
        actionText: 'Undo',
        onAction: async () => {
            task.status = previous;
            renderDashboard();
            await supabase.from('tasks').update({ status: previous }).eq('id', taskId);
            window.showToast('Task paused', 'info', 1800);
        }
    });
}

async function pauseDashboardTask(taskId) {
    const task = window.allTasks.find(t => String(t.id) === String(taskId));
    if (!task) return;
    const previous = task.status;

    task.status = 'pending';
    renderDashboard();

    const { error } = await supabase
        .from('tasks')
        .update({ status: 'pending' })
        .eq('id', taskId);

    if (error) {
        task.status = previous;
        renderDashboard();
        window.showToast('Failed to pause task', 'error');
        return;
    }

    window.showToast(`"${task.title}" paused`, 'success', 5000, {
        actionText: 'Undo',
        onAction: async () => {
            task.status = previous;
            renderDashboard();
            await supabase.from('tasks').update({ status: previous }).eq('id', taskId);
            window.showToast('Task resumed', 'info', 1800);
        }
    });
}

function viewTaskDetails(taskId) {
    const task = window.allTasks.find(t => t.id == taskId);
    if (!task) {
        window.showToast('Task not found', 'error', 3000);
        return;
    }
    alert(
        `📋 Task Details\n\n` +
        `Title: ${task.title}\n` +
        `Description: ${task.description || 'No description'}\n` +
        `Priority: ${task.priority || 'medium'}\n` +
        `Status: ${getDashboardEffectiveStatus(task)}\n` +
        `Due: ${task.due_date ? (window.fmtDate ? window.fmtDate(task.due_date) : task.due_date) : 'No date'}\n` +
        `Category: ${task.category || 'Uncategorized'}\n` +
        `Reminder: ${task.reminder || 'No reminder'}`
    );
}

// ============================================
// LOAD TASKS
// ============================================

window.loadTasks = async function () {
    try {
        if (!window.currentUser?.id) {
            console.error('❌ loadTasks: No authenticated user');
            window.allTasks = [];
            window.personalTasks = [];
            window.GroupTasks = [];
            return { allTasks: [], personalTasks: [], GroupTasks: [] };
        }

        const userId = window.currentUser.id;

        const { data: tasks, error } = await supabase
            .from("tasks")
            .select("*")
            .or(`assignee_id.eq.${userId},created_by.eq.${userId}`)
            .order("due_date", { ascending: true, nullsFirst: false });

        if (error) {
            console.error('❌ SUPABASE TASK ERROR:', error);
            throw error;
        }

        window.allTasks = tasks || [];
        window.personalTasks = window.allTasks.filter(
            task => task.is_group_task === false || task.is_group_task === null
        );
        window.GroupTasks = window.allTasks.filter(task => task.is_group_task === true);

        console.log(
            `✅ Loaded ${window.allTasks.length} tasks ` +
            `(${window.personalTasks.length} personal, ${window.GroupTasks.length} Group)`
        );

        return {
            allTasks: window.allTasks,
            personalTasks: window.personalTasks,
            GroupTasks: window.GroupTasks
        };
    } catch (error) {
        console.error('🔥 loadTasks failed:', error);
        window.allTasks = [];
        window.personalTasks = [];
        window.GroupTasks = [];
        throw error;
    }
};

// ============================================
// LOAD PROJECTS
// ============================================

window.loadProjects = async function () {
    try {
        if (!window.currentUser?.id) {
            console.error('❌ loadProjects: No authenticated user');
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
        uniqueProjects.sort((a, b) =>
            new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );

        window.projects = uniqueProjects;
        console.log(`✅ Loaded ${window.projects.length} projects`);
        return window.projects;
    } catch (error) {
        console.error('🔥 loadProjects failed:', error);
        window.projects = [];
        throw error;
    }
};


// ============================================
// EXPOSE GLOBALLY
// ============================================

window.renderDashboard = renderDashboard;
window.initDashboard = initDashboard;
window.toggleTaskStatus = toggleTaskStatus;
window.startDashboardTask = startDashboardTask;
window.pauseDashboardTask = pauseDashboardTask;
window.viewTaskDetails = viewTaskDetails;
window.getTaskStats = getTaskStats;
window.getTodayTasks = getTodayTasks;
window.getTimeOfDay = getTimeOfDay;
window.createStatCard = createStatCard;
window.bindDashboardEvents = bindDashboardEvents;
window.dateKey = dateKey;
window.formatDisplayDate = formatDisplayDate;
window.getDashboardEffectiveStatus = getDashboardEffectiveStatus;

console.log('✅ Dashboard loaded!');