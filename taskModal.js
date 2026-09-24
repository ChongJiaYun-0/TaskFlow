// ============================================
// taskModal.js


// A plain object used as a cache: { projectId: [ {id, full_name, email}, ... ] }.
// "window._projectMemberCache || {}" means: if this cache was already created
// by an earlier script/page load, keep using it; otherwise start a fresh one.
window._projectMemberCache = window._projectMemberCache || {};

// Fetches the list of members (as profile objects) for a given project.
// Exposed on window so other files (Group.js, priority.js) can call it too.
window.loadProjectMembers = async function(projectId) {
    // No project selected yet -> nothing to fetch, return an empty list.
    if (!projectId) return [];

    // Already fetched this project's members before -> reuse the cached
    // result instead of hitting Supabase again.
    if (window._projectMemberCache[projectId]) return window._projectMemberCache[projectId];

    try {
        // Step 1: get the list of user_ids that belong to this project,
        // by querying the project_members join table.
        const { data: members, error } = await supabase
            .from('project_members')
            .select('user_id')
            .eq('project_id', projectId);
        if (error) throw error; // jump to the catch block below on failure

        // Pull just the user_id values out into a plain array.
        const ids = (members || []).map(m => m.user_id);

        // No members found -> cache an empty array and stop here (avoids
        // an unnecessary second query below).
        if (ids.length === 0) { window._projectMemberCache[projectId] = []; return []; }

        // Step 2: fetch the actual profile info (name, email) for each of
        // those user_ids from the profiles table, in a single query.
        const { data: profiles, error: profErr } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', ids); // "id IN (ids)"
        if (profErr) throw profErr;

        // Store the result in the cache (keyed by projectId) and return it.
        window._projectMemberCache[projectId] = profiles || [];
        return window._projectMemberCache[projectId];
    } catch (err) {
        // Any failure above (network, permissions, etc.) lands here.
        console.error('Error loading project members:', err);
        return []; // fail safe: treat it as "no members" rather than crashing
    }
};

// ============================================
// ADD / EDIT MODAL
// ============================================

// Builds the modal's HTML and inserts it into the page, but only once.
// Every subsequent call to openTaskModal() reuses the same DOM elements
// instead of creating duplicates.
function ensureTaskModal() {
    // If the modal's backdrop already exists in the page, it was already
    // built on a previous call -> do nothing and exit early.
    if (document.getElementById('taskModalBackdrop')) return;

    // Create a throwaway <div> just to hold the HTML string below, so we
    // can build multiple elements (backdrop + modal) in one go.
    const wrap = document.createElement('div');
    wrap.innerHTML = `
        <div class="modal-backdrop" id="taskModalBackdrop"></div>
        <div class="modal" id="taskModal">
            <div class="modal-head">
                <div>
                    <!-- Small label above the title, e.g. "New Task" / "Edit Task" -->
                    <div class="eyebrow" id="taskModalEyebrow">New Task</div>
                    <!-- Main heading, e.g. "Add Personal Task" -->
                    <h2 id="taskModalTitle">Add Task</h2>
                </div>
                <!-- X button to close the modal -->
                <button class="icon-btn" id="taskModalClose"><i class="bx bx-x"></i></button>
            </div>
            <form id="taskForm">
                <!-- Hidden field: holds the task's id when EDITING.
                     Empty string means "we are ADDING a new task". -->
                <input type="hidden" id="tfId">
                <!-- Hidden field: "personal" or "Group" - tells the form
                     which extra fields to show and what to save. -->
                <input type="hidden" id="tfType">
                <div class="form-grid">
                    <div class="full">
                        <label>Task Title *</label>
                        <input type="text" id="tfTitle" required maxlength="150" placeholder="e.g. Finish assignment draft">
                    </div>
                    <div class="full">
                        <label>* Description</label>
                        <textarea id="tfDescription" rows="3" placeholder="Optional details..." required></textarea>
                    </div>
                    <!-- Group-ONLY: starts hidden (class="hidden"); shown
                         via JS only when editing/adding a Group task. -->
                    <div class="full hidden" id="tfProjectRow">
                        <label>Project</label>
                        <select id="tfProject"></select>
                    </div>
                    <!-- Group-ONLY: same idea - hidden for personal tasks. -->
                    <div class="full hidden" id="tfAssigneeRow">
                        <label>Assign To</label>
                        <select id="tfAssignee"></select>
                    </div>
                    <div>
                        <label>Due Date</label>
                        <input type="date" id="tfDueDate">
                    </div>
                    <div>
                        <label>Due Time</label>
                        <input type="time" id="tfDueTime">
                    </div>
                    <div>
                        <label>Priority</label>
                        <select id="tfPriority">
                            <option value="high">High</option>
                            <option value="medium" selected>Medium</option>
                            <option value="low">Low</option>
                        </select>
                    </div>
                    <div>
                        <label>Category</label>
                        <select id="tfCategory">
                            <option value="Study">Study</option>
                            <option value="Work" selected>Work</option>
                            <option value="Personal">Personal</option>
                            <option value="Meeting">Meeting</option>
                            <option value="Assignment">Assignment</option>
                            <option value="Research">Research</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                    <div class="full">
                        <label>Reminder</label>
                        <select id="tfReminder">
                            <option value="No reminder" selected>No reminder</option>
                            <option value="At due time">At due time</option>
                            <option value="5 minutes before">5 minutes before</option>
                            <option value="15 minutes before">15 minutes before</option>
                            <option value="30 minutes before">30 minutes before</option>
                            <option value="1 hour before">1 hour before</option>
                            <option value="1 day before">1 day before</option>
                        </select>
                    </div>
                </div>
                <!-- Validation / Supabase error messages get written in here -->
                <p class="form-note" id="tfError"></p>
                <div class="modal-actions">
                    <button type="button" class="btn secondary" id="taskModalCancel">Cancel</button>
                    <!-- type="submit" -> pressing this fires the form's
                         "submit" event, which submitTaskModal() listens for -->
                    <button type="submit" class="btn primary" id="taskModalSubmit">Create Task</button>
                </div>
            </form>
        </div>
    `;
    // Move the built HTML (backdrop + modal) into the real page <body>.
    document.body.appendChild(wrap);

        // Track edits so we can warn before discarding them
    document.getElementById('taskForm').addEventListener('input', () => {
        window._taskModalDirty = true;
    });
    document.getElementById('taskForm').addEventListener('change', () => {
        window._taskModalDirty = true;
    });

    // All three close paths go through the same "are you sure?" check
    const tryCloseTaskModal = async () => {
        const modal = document.getElementById('taskModal');
        if (!modal || !modal.classList.contains('show')) return;

        if (!window._taskModalDirty) {
            closeTaskModal();
            return;
        }

        const discard = await window.showConfirm({
            title: 'Discard changes?',
            message: 'You have unsaved edits. Are you sure you want to close this form?',
            confirmText: 'Discard',
            cancelText: 'Keep editing',
            variant: 'warning',
            icon: 'bx-error-circle'
        });

        if (discard) {
            window._taskModalDirty = false;
            closeTaskModal();
        }
    };

    document.getElementById('taskModalClose').addEventListener('click', tryCloseTaskModal);
    document.getElementById('taskModalCancel').addEventListener('click', tryCloseTaskModal);
    document.getElementById('taskModalBackdrop').addEventListener('click', tryCloseTaskModal);

    // Submitting the form (clicking "Create Task"/"Save Changes", or
    // pressing Enter inside it) runs submitTaskModal() instead of doing
    // a normal HTML form submit (page reload).
    document.getElementById('taskForm').addEventListener('submit', submitTaskModal);

    // Escape: use the same discard-check logic
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('taskModal');
            if (modal && modal.classList.contains('show')) tryCloseTaskModal();
        }
    });
}

// Opens the ADD / EDIT modal and fills it in appropriately according to the types (PERSONAL / Group)
// opts: { mode: 'add'|'edit', taskType: 'personal'|'Group', task: obj|null, projectId: id|null }
window.openTaskModal = async function(opts = {}) {
    try {
        ensureTaskModal();
        const { mode, taskType, task, projectId } = opts;
        window._taskModalContext = {
            projectId: projectId || null,
            taskType,
            mode,
            assigneeId: task?.assignee_id || null
        };
    const isGroup = taskType === 'Group';

        const form = document.getElementById('taskForm');
    form.reset();                                    // clear any leftover values from last time it was open
    window._taskModalDirty = false;                  // reset the "unsaved edits" flag
    document.getElementById('tfError').textContent = ''; // clear any old error message
    document.getElementById('tfId').value = task ? task.id : ''; // set id if editing, blank if adding
    document.getElementById('tfType').value = taskType;

    // Show the Project/Assignee fields only for Group tasks; hide them
    // for personal tasks by toggling the CSS "hidden" class.
    document.getElementById('tfProjectRow').classList.toggle('hidden', !isGroup);
    document.getElementById('tfAssigneeRow').classList.toggle('hidden', !isGroup);

    // Only bother filling in Project/Assignee dropdowns if this is a Group task.
    if (isGroup) {
        const projectSelect = document.getElementById('tfProject');
        const assigneeSelect = document.getElementById('tfAssignee');
        const projectRow    = document.getElementById('tfProjectRow');
        const assigneeRow   = document.getElementById('tfAssigneeRow');

        const hasKnownProject = !!projectId;

        if (hasKnownProject && mode !== 'edit') {
            projectRow.classList.add('hidden');
            assigneeRow.classList.add('hidden');
        } else {
            projectRow.classList.remove('hidden');
            assigneeRow.classList.remove('hidden');

            const targetProjectId = (task && task.project_id) || projectId;

            const projectList = Array.isArray(window.projects) ? window.projects : [];

            if (projectList.length === 0) {
                // No projects at all → show a helpful message instead of a broken dropdown
                projectSelect.innerHTML = `<option value="">— No projects available —</option>`;
                assigneeSelect.innerHTML = `<option value="">—</option>`;
            } else {
                projectSelect.innerHTML = projectList
                    .filter(p => p && p.id)
                    .map(p => `<option value="${p.id}" ${
                        String(p.id) === String(targetProjectId) ? 'selected' : ''
                    }>${window.escapeHtml(p.name || 'Untitled project')}</option>`)
                    .join('');

                const refillAssignees = async () => {
                    try {
                        const members = await window.loadProjectMembers(projectSelect.value);
                        if (members && members.length > 0) {
                            assigneeSelect.innerHTML = members
                                .map(m => `<option value="${m.id}" ${
                                    task && task.assignee_id === m.id ? 'selected' : ''
                                }>${window.escapeHtml(m.full_name || 'Unnamed')}</option>`)
                                .join('');
                        } else {
                            const fallbackName =
                                (window.userProfile && window.userProfile.full_name) || 'Me';
                            assigneeSelect.innerHTML =
                                `<option value="${window.currentUser.id}">${window.escapeHtml(fallbackName)}</option>`;
                        }
                    } catch (err) {
                        console.error('refillAssignees failed:', err);
                        const fallbackName =
                            (window.userProfile && window.userProfile.full_name) || 'Me';
                        assigneeSelect.innerHTML =
                            `<option value="${window.currentUser?.id || ''}">${window.escapeHtml(fallbackName)}</option>`;
                    }
                };

                await refillAssignees();
                projectSelect.onchange = refillAssignees;
            }
        }
    }

    // Set the modal's header text based on whether we're adding or
    // editing, and personal vs Group.
    document.getElementById('taskModalEyebrow').textContent = mode === 'edit' ? 'Edit Task' : 'New Task';
    document.getElementById('taskModalTitle').textContent = mode === 'edit'
        ? (isGroup ? 'Edit Group Task' : 'Edit Personal Task')
        : (isGroup ? 'Add Group Task' : 'Add Personal Task');
    document.getElementById('taskModalSubmit').textContent = mode === 'edit' ? 'Save Changes' : 'Create Task';

    // If editing an existing task, pre-fill every field with its current
    // values. (When adding, "task" is null/undefined, so this whole
    // block is skipped and the form stays at its default/empty values.)
    if (task) {
        document.getElementById('tfTitle').value = task.title || '';
        document.getElementById('tfDescription').value = task.description || '';
        // due_date comes back from Supabase as a full date string;
        // slice(0, 10) trims it down to "YYYY-MM-DD" which is what an
        // <input type="date"> expects.
        document.getElementById('tfDueDate').value = task.due_date ? String(task.due_date).slice(0, 10) : '';
        document.getElementById('tfDueTime').value = task.due_time || '';
        document.getElementById('tfPriority').value = task.priority || 'medium';
        document.getElementById('tfCategory').value = task.category || (isGroup ? 'Work' : 'Personal');
        document.getElementById('tfReminder').value = task.reminder || 'No reminder';
    }

    // Make the modal visible (CSS transitions handle the fade/scale-in
    // animation based on the "show" class).
    document.getElementById('taskModalBackdrop').classList.add('show');
    document.getElementById('taskModal').classList.add('show');
    // Put the cursor straight into the Title field for convenience.
    document.getElementById('tfTitle').focus();
        } catch (err) {
        console.error('openTaskModal failed:', err);
        window.showToast('Could not open the task form', 'error');
    }
};

// Hides the modal (reverses the classList.add('show') calls above).
function closeTaskModal() {
    const backdrop = document.getElementById('taskModalBackdrop');
    const modal = document.getElementById('taskModal');
    if (backdrop) backdrop.classList.remove('show');
    if (modal) modal.classList.remove('show');
}

// Runs when the Add/Edit form is submitted (Add/Save button clicked).
async function submitTaskModal(e) {
    // Stop the browser's default form submission (which would reload
    // the page) - we're handling this with JS/Supabase instead.
    e.preventDefault();

    const errorEl = document.getElementById('tfError');
    errorEl.textContent = ''; // clear any previous error before validating again

    // Basic required-field validation: title can't be empty/whitespace.
    const title = document.getElementById('tfTitle').value.trim();
    if (!title) { errorEl.textContent = 'Task title is required.'; return; }

    const taskType = document.getElementById('tfType').value;   // "personal" or "Group"
    const editingId = document.getElementById('tfId').value;    // set if editing, "" if adding
    const isGroup = taskType === 'Group';

    // Group tasks with a known project auto-assign to the current user,
    // so only require an explicit assignee when the field is visible.
    const assigneeField = document.getElementById('tfAssignee');
    const assigneeVisible = assigneeField && assigneeField.offsetParent !== null;

    if (isGroup && assigneeVisible && !assigneeField.value) {
        errorEl.textContent = 'Please choose who this task is assigned to.';
        return;
    }

    // Build the object that will be sent to Supabase, reading every
    // field's current value straight from the form.
    const payload = {
        title,
        description: document.getElementById('tfDescription').value.trim() || null, // empty string -> null
        due_date: document.getElementById('tfDueDate').value || null,
        due_time: document.getElementById('tfDueTime').value || null,
        priority: document.getElementById('tfPriority').value,
        category: document.getElementById('tfCategory').value,
        reminder: document.getElementById('tfReminder').value
    };

    if (isGroup) {
        const projectField = document.getElementById('tfProject');
        const projectRow = document.getElementById('tfProjectRow');

        // If the dropdowns are hidden, use the values passed into openTaskModal.
        payload.project_id = (projectRow && !projectRow.classList.contains('hidden'))
            ? projectField.value
            : (window._taskModalContext?.projectId || payload.project_id);

        // Fallback chain: visible dropdown → stored context → current user
        payload.assignee_id = (assigneeField && assigneeVisible)
            ? assigneeField.value
            : (window._taskModalContext?.assigneeId || window.currentUser.id);
    }

    // Disable the submit button and show a "Saving..." state so the
    // user can't double-submit while the request is in flight.
    const submitBtn = document.getElementById('taskModalSubmit');
    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent; // remember the original text to restore later
    submitBtn.textContent = 'Saving...';

    try {
        if (editingId) {
            // EDIT: update the existing row in the "tasks" table that
            // matches this id, with the new field values from payload.
            const { error } = await supabase.from('tasks').update(payload).eq('id', editingId);
            if (error) throw error;
            window.showToast('Task updated', 'success');
        } else {
            // ADD: fill in the extra fields a brand-new task needs that
            // aren't on the form (status always starts as "pending", etc.)
            payload.status = 'pending';
            payload.is_group_task = isGroup;
            payload.created_by = window.currentUser.id;
            // Personal tasks are always assigned to yourself; Group tasks
            // already got their assignee_id set above from the dropdown.
            // if (!isGroup) payload.assignee_id = window.currentUser.id;
            if (isGroup && !payload.assignee_id) {
                payload.assignee_id = window.currentUser.id;
            }

            // INSERT: create a brand-new row in the "tasks" table.
            const { error } = await supabase.from('tasks').insert(payload);
            if (error) throw error;
            window.showToast('Task created', 'success');
        }

               window._taskModalDirty = false; // clear before close so the discard check doesn't fire
        closeTaskModal();               // hide the modal now that saving succeeded
        await window.loadTasks();       // re-fetch tasks from Supabase so window.allTasks/etc. are fresh
        // Tell whichever page opened this modal to re-render itself with
        // the updated data (if it registered a callback for that).
        if (typeof window.refreshTaskViewCallback === 'function') window.refreshTaskViewCallback();
    } catch (err) {
        // Insert/update failed (network issue, RLS policy blocked it, etc.)
        console.error('Error saving task:', err);
        errorEl.textContent = err.message || 'Failed to save task. Please try again.';
    } finally {
        // Whether it succeeded or failed, always re-enable the button
        // and restore its original label.
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
    }
}

// ============================================
// VIEW DRAWER (fetches its own subtasks on open, so it stays
// self-contained regardless of which page opened it)
// ============================================

// Builds the drawer's HTML and inserts it into the page, but only once
// (same "build once, reuse forever" pattern as ensureTaskModal above).
function ensureTaskDrawer() {
    if (document.getElementById('taskDrawerBackdrop')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
        <div class="modal-backdrop" id="taskDrawerBackdrop"></div>
        <div class="drawer" id="taskDrawer">
            <div class="drawer-head">
                <div>
                    <div class="eyebrow" id="drawerEyebrow">Task</div>
                    <h2 id="drawerTitle">Task title</h2>
                </div>
                <button class="icon-btn" id="taskDrawerClose"><i class="bx bx-x"></i></button>
            </div>
            <!-- Filled in dynamically by openTaskDrawer() below -->
            <div class="drawer-body" id="drawerBody"></div>
        </div>
    `;
    document.body.appendChild(wrap);
    document.getElementById('taskDrawerClose').addEventListener('click', closeTaskDrawer);
    document.getElementById('taskDrawerBackdrop').addEventListener('click', closeTaskDrawer);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeTaskDrawer();
    });
}

// Opens the read-only detail drawer for a given task.
// task: the task object (already loaded in memory, not re-fetched here)
// taskType: 'personal' or 'Group'
window.openTaskDrawer = async function(task, taskType) {
    ensureTaskDrawer();
    const isGroup = taskType === 'Group';

    // Fill in the header immediately, and show a "Loading..." placeholder
    // in the body while we fetch anything extra (members/subtasks) below -
    // this makes the drawer feel instant even though some data is async.
    document.getElementById('drawerEyebrow').textContent = isGroup ? 'Group Task' : 'Personal Task';
    document.getElementById('drawerTitle').textContent = task.title;
    document.getElementById('drawerBody').innerHTML = `<div class="detail-section"><p style="color:var(--muted);font-size:12px">Loading...</p></div>`;
    // Slide the drawer into view right away (don't wait for the fetches).
    document.getElementById('taskDrawerBackdrop').classList.add('show');
    document.getElementById('taskDrawer').classList.add('open');

    // Personal tasks that are already "completed" are locked - editing
    // is disabled for them elsewhere in the app.
    const locked = !isGroup && task.status === 'completed';
    let assigneeName = null;
    let subtasksHtml = ''; // built up below only for Group tasks that have subtasks

    if (isGroup) {
        // Look up this project's members so we can show the assignee's
        // actual name instead of just their id.
        const members = await window.loadProjectMembers(task.project_id);
        const member = members.find(m => m.id === task.assignee_id);
        assigneeName = member ? member.full_name : 'Unassigned';

        try {
            // Fetch every subtask that belongs to this task.
            const { data: subtasks, error } = await supabase
                .from('subtasks')
                .select('id, title, completed, assignee_id')
                .eq('task_id', task.id);
            if (error) throw error;

            // Only build the "Subtasks" section if there actually are any.
            if (subtasks && subtasks.length > 0) {
                subtasksHtml = `
                    <div class="detail-section">
                        <!-- Heading shows a "done/total" count, e.g. "Subtasks (2/4)" -->
                        <h4>Subtasks (${subtasks.filter(s => s.completed).length}/${subtasks.length})</h4>
                        ${subtasks.map(s => {
                            // Look up each subtask's own assignee name too.
                            const subMember = members.find(m => m.id === s.assignee_id);
                            return `
                                <div class="subtask">
                                    <!-- Checked vs unchecked checkbox icon, colored green when done -->
                                    <i class="bx ${s.completed ? 'bx-check-square' : 'bx-square'}" style="font-size:16px;color:${s.completed ? 'var(--green)' : 'var(--muted)'}"></i>
                                    <!-- Subtask title, struck through + greyed out once completed -->
                                    <span class="${s.completed ? 'locked' : ''}" style="flex:1;text-decoration:${s.completed ? 'line-through' : 'none'}">${window.escapeHtml(s.title)}</span>
                                    <span style="color:var(--muted);font-size:10px">${window.escapeHtml(subMember ? subMember.full_name : 'Unassigned')}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            }
        } catch (err) {
            // If subtasks fail to load, just log it - the rest of the
            // drawer still works fine without them.
            console.error('Error loading subtasks:', err);
        }
    }

    // Now that everything's fetched, replace the "Loading..." placeholder
    // with the real, fully-built drawer content.
    document.getElementById('drawerBody').innerHTML = `
        <div class="detail-section">
            <h4>Description</h4>
            <p class="detail-description">${window.escapeHtml(task.description || 'No description provided.')}</p>
        </div>
        <div class="detail-section">
            <h4>Details</h4>
            <div class="detail-grid">
                <div><span class="detail-label">Status</span><span class="detail-value"><span class="status-pill ${task.status}"><span class="status-dot"></span>${(task.status || '').replace('-', ' ')}</span></span></div>
                <div><span class="detail-label">Priority</span><span class="detail-value"><span class="badge ${task.priority}">${task.priority}</span></span></div>
                <div><span class="detail-label">Due Date</span><span class="detail-value">${window.fmtDate(task.due_date)}${task.due_time ? ' \u00b7 ' + task.due_time : ''}</span></div>
                <div><span class="detail-label">Category</span><span class="detail-value">${window.escapeHtml(task.category || 'Uncategorized')}</span></div>
                <div><span class="detail-label">Reminder</span><span class="detail-value">${window.escapeHtml(task.reminder || 'No reminder')}</span></div>
                <!-- "Assigned to" row only shows for Group tasks -->
                ${isGroup ? `<div><span class="detail-label">Assigned to</span><span class="detail-value">${window.escapeHtml(assigneeName)}</span></div>` : ''}
            </div>
        </div>
        <!-- Subtasks section (empty string if this task has none) -->
        ${subtasksHtml}
        <div class="detail-section" style="display:flex;gap:9px">
            <!-- Edit button disabled + shows a tooltip if the task is locked -->
            <button class="btn secondary" id="drawerEditBtn" ${locked ? 'disabled title="Completed tasks are locked"' : ''}><i class="bx bx-edit"></i> Edit</button>
            <button class="btn secondary" id="drawerDeleteBtn"><i class="bx bx-trash"></i> Delete</button>
        </div>
    `;

    // Wire up the Edit button: close the drawer, then reopen the same
    // task in the Add/Edit modal (in "edit" mode).
    document.getElementById('drawerEditBtn').addEventListener('click', () => {
        if (locked) return; // do nothing if locked (extra safety, on top of "disabled")
        closeTaskDrawer();
        window.openTaskModal({ mode: 'edit', taskType, task });
    });
    // Wire up the Delete button: close the drawer, then run the shared
    // delete function below.
    document.getElementById('drawerDeleteBtn').addEventListener('click', () => {
        closeTaskDrawer();
        window.deleteTaskById(task.id);
    });
};

// Hides the drawer. Note: the drawer uses a "open" class (slides in from
// the right), while the modal above uses "show" (fades/scales in) - two
// different CSS animations, so two different class names.
function closeTaskDrawer() {
    const backdrop = document.getElementById('taskDrawerBackdrop');
    const drawer = document.getElementById('taskDrawer');
    if (backdrop) backdrop.classList.remove('show');
    if (drawer) drawer.classList.remove('open');
}

// ============================================
// DELETE
// ============================================

// Deletes a task by id. Used by every trash-can icon and the drawer's
// Delete button, for both personal and Group tasks - it doesn't need to
// know which type it is, since deleting just needs the id.
window.deleteTaskById = async function (taskId) {
    const task =
        (window.allTasks      || []).find(t => String(t.id) === String(taskId)) ||
        (window.personalTasks || []).find(t => String(t.id) === String(taskId)) ||
        (window.GroupTasks    || []).find(t => String(t.id) === String(taskId));

    const taskName = task?.title || 'this task';

    const confirmed = await window.showConfirm({
        title: 'Delete this task?',
        message: `"${taskName}" will be permanently deleted.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        variant: 'danger',
        icon: 'bx-trash'
    });
    if (!confirmed) return;

    // Optimistically remove from local arrays
    const removedFromAll      = (window.allTasks      || []).filter(t => String(t.id) === String(taskId));
    const removedFromPersonal = (window.personalTasks || []).filter(t => String(t.id) === String(taskId));
    const removedFromGroup    = (window.GroupTasks    || []).filter(t => String(t.id) === String(taskId));

    window.allTasks      = (window.allTasks      || []).filter(t => String(t.id) !== String(taskId));
    window.personalTasks = (window.personalTasks || []).filter(t => String(t.id) !== String(taskId));
    window.GroupTasks    = (window.GroupTasks    || []).filter(t => String(t.id) !== String(taskId));

    if (typeof window.refreshTaskViewCallback === 'function') window.refreshTaskViewCallback();

    let undone = false;
    const undoDuration = 10000;

    window.showToast(
        `"${taskName}" deleted`,
        'success',
        undoDuration,
        {
            actionText: 'Undo',
            onAction: () => {
                undone = true;
                // Restore to local arrays
                window.allTasks      = [...(window.allTasks      || []), ...removedFromAll];
                window.personalTasks = [...(window.personalTasks || []), ...removedFromPersonal];
                window.GroupTasks    = [...(window.GroupTasks    || []), ...removedFromGroup];
                if (typeof window.refreshTaskViewCallback === 'function') window.refreshTaskViewCallback();
                window.showToast('Task restored', 'info', 2000);
            }
        }
    );

    // After the undo window, actually delete on the server
    setTimeout(async () => {
        if (undone) return;
        try {
            const { error } = await supabase.from('tasks').delete().eq('id', taskId);
            if (error) throw error;
        } catch (err) {
            console.error('Error deleting task:', err);
            // Restore on failure
            window.allTasks      = [...(window.allTasks      || []), ...removedFromAll];
            window.personalTasks = [...(window.personalTasks || []), ...removedFromPersonal];
            window.GroupTasks    = [...(window.GroupTasks    || []), ...removedFromGroup];
            if (typeof window.refreshTaskViewCallback === 'function') window.refreshTaskViewCallback();
            window.showToast('Failed to delete task', 'error');
        }
    }, undoDuration);
};

// ============================================
// TOASTS — top-right stackable notifications
// ============================================

/**
 * Ensures a toast container exists at the top-right corner.
 * Created once; reused for every toast.
 */
function ensureToastContainer() {
    let container = document.getElementById('toastContainer');
    if (container) return container;

    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

/**
 * Shows a toast at the top-right corner.
 *
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} [type] - Default: 'success'
 * @param {number} [duration] - ms before auto-dismiss. Default: 3500
 * @param {Object} [opts]
 * @param {string} [opts.actionText]  - Optional action button label (e.g. "Undo")
 * @param {Function} [opts.onAction]  - Callback when the action button is clicked
 * @returns {{ dismiss: Function, element: HTMLElement }}
 */
window.showToast = function (message, type = 'success', duration = 3500, opts = {}) {
    const container = ensureToastContainer();

    const icons = {
        success: 'bx-check-circle',
        error:   'bx-error-circle',
        info:    'bx-info-circle',
        warning: 'bx-error'
    };

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="bx ${icons[type] || icons.info}"></i></div>
        <div class="toast-body">${String(message).replace(/</g, '&lt;')}</div>
        ${opts.actionText ? `<button class="toast-action" type="button">${opts.actionText}</button>` : ''}
        <button class="toast-close" type="button" aria-label="Dismiss">
            <i class="bx bx-x"></i>
        </button>
        <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    // Force reflow so the entry animation plays
    void toast.offsetWidth;
    toast.classList.add('show');

    // Auto-dismiss timer
    let dismissTimer = null;
    const dismiss = () => {
        if (!toast.isConnected) return;
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            if (toast.isConnected) toast.remove();
        }, 260);
    };

    if (duration > 0) {
        dismissTimer = setTimeout(dismiss, duration);
    }

    // Pause on hover
    toast.addEventListener('mouseenter', () => {
        if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    });
    toast.addEventListener('mouseleave', () => {
        if (duration > 0) dismissTimer = setTimeout(dismiss, duration);
    });

    // Wire up action button
    if (opts.actionText && typeof opts.onAction === 'function') {
        toast.querySelector('.toast-action')?.addEventListener('click', () => {
            try { opts.onAction(); } finally { dismiss(); }
        });
    }

    // Wire up close button
    toast.querySelector('.toast-close')?.addEventListener('click', dismiss);

    return { dismiss, element: toast };
};

// Back-compat: existing code calls window.showToastMsg(text)
window.showToastMsg = function (message, type = 'success', duration = 3000) {
    return window.showToast(message, type, duration);
};

// ============================================
// CONFIRM DIALOG (shared by all pages)
// ============================================

// Internal: holds the current promise's resolve function so buttons can call it
let _confirmResolver = null;

// Builds the confirm modal's HTML once.
function ensureConfirmModal() {
    if (document.getElementById('confirmModalBackdrop')) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
        <div class="modal-backdrop" id="confirmModalBackdrop"></div>
        <div class="confirm-modal" id="confirmModal" role="dialog" aria-modal="true">
            <div class="confirm-icon" id="confirmModalIcon">
                <i class="bx bx-trash"></i>
            </div>
            <h3 id="confirmModalTitle">Are you sure?</h3>
            <p id="confirmModalMessage">This action cannot be undone.</p>
            <div class="confirm-actions">
                <button class="btn secondary" id="confirmModalCancel" type="button">Cancel</button>
                <button class="btn danger" id="confirmModalOk" type="button">Confirm</button>
            </div>
        </div>
    `;
    document.body.appendChild(wrap);

    document.getElementById('confirmModalCancel').addEventListener('click', () => resolveConfirm(false));
    document.getElementById('confirmModalBackdrop').addEventListener('click', () => resolveConfirm(false));
    document.getElementById('confirmModalOk').addEventListener('click', () => resolveConfirm(true));

    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('confirmModal');
        if (e.key === 'Escape' && modal && modal.classList.contains('show')) {
            resolveConfirm(false);
        }
    });
}

// Internal: hides the modal and resolves the pending promise with `value`.
function resolveConfirm(value) {
    const modal = document.getElementById('confirmModal');
    const backdrop = document.getElementById('confirmModalBackdrop');
    if (modal) modal.classList.remove('show');
    if (backdrop) backdrop.classList.remove('show');

    if (_confirmResolver) {
        const resolve = _confirmResolver;
        _confirmResolver = null;
        resolve(value);
    }
}

/**
 * Replaces window.confirm() with a styled modal.
 * Returns a Promise<boolean>.
 */
window.showConfirm = function (opts = {}) {
    ensureConfirmModal();

    const {
        title = 'Are you sure?',
        message = 'This action cannot be undone.',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        variant = 'danger',
        icon = 'bx-trash'
    } = opts;

    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    document.getElementById('confirmModalIcon').innerHTML = `<i class="bx ${icon}"></i>`;

    const iconWrap = document.getElementById('confirmModalIcon');
    const okBtn = document.getElementById('confirmModalOk');

    // Reset then apply variant classes
    iconWrap.className = 'confirm-icon';
    okBtn.className = 'btn';

    if (variant === 'primary') {
        iconWrap.classList.add('confirm-icon-primary');
        okBtn.classList.add('primary');
    } else if (variant === 'warning') {
        iconWrap.classList.add('confirm-icon-warning');
        okBtn.classList.add('confirm-btn-warning');
    } else {
        okBtn.classList.add('danger');
    }

    okBtn.textContent = confirmText;
    document.getElementById('confirmModalCancel').textContent = cancelText;

    document.getElementById('confirmModalBackdrop').classList.add('show');
    document.getElementById('confirmModal').classList.add('show');

    setTimeout(() => okBtn.focus(), 50);

    return new Promise((resolve) => {
        _confirmResolver = resolve;
    });
};