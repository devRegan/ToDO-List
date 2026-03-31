/* --- EMAILJS CONFIG --- */
const EMAILJS_SERVICE_ID  = '';
const EMAILJS_TEMPLATE_ID = '';
const EMAILJS_PUBLIC_KEY  = '';
const NOTIFY_EMAIL        = '';

let tasks = JSON.parse(localStorage.getItem('tasks')) || [];
let currentFilter = 'all';
let sortBy = 'newest';
let searchQuery = '';
let editingId = null;
let selectedTasks = new Set();
let isDirty = false;

/* Debounce timers */
let searchDebounceTimer = null;
let saveDebounceTimer = null;

/* Cached today string — recomputed at midnight only */
let todayStr = new Date().toISOString().split('T')[0];
const msUntilMidnight = 86400000 - (Date.now() % 86400000);
setTimeout(function refreshDay() {
    todayStr = new Date().toISOString().split('T')[0];
    setTimeout(refreshDay, 86400000);
}, msUntilMidnight);

/* Cached DOM refs — looked up once, reused everywhere */
const DOM = {};

/* Priority sort weights — defined once, not inside sort() */
const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };

/* --- INITIALIZATION --- */
document.addEventListener('DOMContentLoaded', () => {
    /* Cache all frequently accessed DOM nodes up front */
    DOM.taskList        = document.getElementById('task-list');
    DOM.completedList   = document.getElementById('completed-task-list');
    DOM.completedSection= document.getElementById('completed-section');
    DOM.emptyState      = document.getElementById('empty-state');
    DOM.statTotal       = document.getElementById('stat-total');
    DOM.statPending     = document.getElementById('stat-pending');
    DOM.statCompleted   = document.getElementById('stat-completed');
    DOM.pageTitle       = document.getElementById('page-title');
    DOM.toast           = document.getElementById('toast');
    DOM.bulkDeleteBtn   = document.getElementById('bulk-delete-btn');
    DOM.selectedCount   = document.getElementById('selected-count');
    DOM.selectAllChk    = document.getElementById('select-all-checkbox');
    DOM.searchInput     = document.getElementById('search-input');
    DOM.sortSelect      = document.getElementById('sort-select');
    DOM.modal           = document.getElementById('task-modal');
    DOM.modalTitle      = document.getElementById('modal-title');
    DOM.taskForm        = document.getElementById('task-form');
    DOM.inputTitle      = document.getElementById('input-title');
    DOM.inputDesc       = document.getElementById('input-desc');
    DOM.inputDate       = document.getElementById('input-date');
    DOM.inputTime       = document.getElementById('input-time');
    DOM.saveBtn         = document.getElementById('save-btn');
    DOM.errorTitle      = document.getElementById('error-title');
    DOM.errorDate       = document.getElementById('error-date');
    DOM.errorTime       = document.getElementById('error-time');

    /* Normalise titles of any pre-existing tasks loaded from storage */
    tasks.forEach(t => { if (!t.titleLower) t.titleLower = t.title.toLowerCase(); });

    renderTasks();
    updateStats();
    setupDate();
    setupEventListeners();
    requestNotificationPermission();
    setInterval(checkReminders, 60000);
    initEmailJS();
});

/* --- EVENT LISTENERS SETUP --- */
function setupEventListeners() {
    document.querySelector('.nav-links').addEventListener('click', (e) => {
        const btn = e.target.closest('.nav-btn');
        if (btn) filterTasks(btn.getAttribute('data-filter'), btn);
    });

    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    DOM.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            searchQuery = e.target.value.toLowerCase(); /* normalise once here */
            renderTasks();
        }, 300);
    });

    DOM.sortSelect.addEventListener('change', (e) => {
        sortBy = e.target.value;
        renderTasks();
    });

    DOM.selectAllChk.addEventListener('change', (e) => toggleSelectAll(e.target.checked));
    DOM.bulkDeleteBtn.addEventListener('click', deleteSelected);
    document.getElementById('add-task-btn').addEventListener('click', () => openModal());
    document.getElementById('close-modal-btn').addEventListener('click', closeModal);
    document.getElementById('cancel-btn').addEventListener('click', closeModal);

    DOM.modal.addEventListener('click', (e) => { if (e.target.id === 'task-modal') closeModal(); });
    DOM.taskForm.addEventListener('submit', (e) => { e.preventDefault(); saveTask(); });

    /* Single delegated listener covers both lists */
    DOM.taskList.addEventListener('click', handleTaskAction);
    DOM.completedList.addEventListener('click', handleTaskAction);
}

/* --- EVENT DELEGATION FOR TASK ACTIONS --- */
function handleTaskAction(e) {
    const taskItem = e.target.closest('.task-item');
    if (!taskItem) return;
    const taskId = parseInt(taskItem.dataset.taskId, 10);

    if (e.target.closest('.custom-checkbox')) {
        toggleComplete(taskId);
    } else if (e.target.closest('.hidden-checkbox')) {
        toggleSelection(taskId);
    } else if (e.target.closest('.icon-btn.delete')) {
        deleteTask(taskId);
    } else if (e.target.closest('.icon-btn:not(.delete):not(.select-icon-btn)')) {
        const btn = e.target.closest('.icon-btn');
        if (btn.title.includes('Calendar')) {
            addToCalendar(taskId);
        } else if (btn.title.includes('Edit') || btn.querySelector('.material-icons-round')?.textContent === 'edit') {
            openModal(taskId);
        }
    }
}

/* --- MAIN FUNCTIONS --- */

function saveTask() {
    const title = DOM.inputTitle.value.trim();
    const desc  = DOM.inputDesc.value.trim();
    const date  = DOM.inputDate.value;
    const time  = DOM.inputTime.value;
    const priorityInput = document.querySelector('input[name="priority"]:checked');
    const priority = priorityInput ? priorityInput.value : 'medium';

    /* Clear previous errors */
    DOM.errorTitle.classList.add('hidden');
    DOM.errorDate.classList.add('hidden');
    DOM.errorTime.classList.add('hidden');
    DOM.inputTitle.classList.remove('error');
    DOM.inputDate.classList.remove('error');
    DOM.inputTime.classList.remove('error');

    let hasError = false;
    if (!title) { DOM.errorTitle.classList.remove('hidden'); DOM.inputTitle.classList.add('error'); hasError = true; }
    if (!date)  { DOM.errorDate.classList.remove('hidden');  DOM.inputDate.classList.add('error');  hasError = true; }
    if (!time)  { DOM.errorTime.classList.remove('hidden');  DOM.inputTime.classList.add('error');  hasError = true; }

    if (hasError) { showToast("Please fill in all required fields"); return; }

    DOM.saveBtn.disabled = true;

    const taskObj = {
        id: editingId || Date.now(),
        title,
        titleLower: title.toLowerCase(), /* pre-normalised for fast search */
        desc,
        dueDate: date,
        dueTime: time,
        priority,
        completed: false,
        createdAt: new Date().toISOString()
    };

    if (editingId) {
        const index = tasks.findIndex(t => t.id === editingId);
        const oldStatus = tasks[index].completed;
        tasks[index] = { ...tasks[index], ...taskObj, completed: oldStatus };
        showToast("Task Updated Successfully");
    } else {
        tasks.push(taskObj);
        showToast("Task Created Successfully");
        sendEmailNotification('created', taskObj);
    }

    markDirty();
    closeModal();
    renderTasks();
    updateStats();

    setTimeout(() => { DOM.saveBtn.disabled = false; }, 500);
}

function deleteTask(id) {
    const taskToDelete = tasks.find(t => t.id === id);
    if (!taskToDelete) return;

    showToast(`Delete "${taskToDelete.title}"?`, true, () => {
        tasks = tasks.filter(t => t.id !== id);
        selectedTasks.delete(id);
        markDirty();
        renderTasks();
        updateStats();
        showToast("Task Deleted");
    });
}

function toggleComplete(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    task.completed = !task.completed;
    markDirty();
    updateTaskInDOM(id, task);
    updateStats();
    if (task.completed) {
        sendEmailNotification('completed', task);
    }
}

/* Surgically update a single task node — no full re-render */
function updateTaskInDOM(id, task) {
    const taskItem = document.querySelector(`.task-item[data-task-id="${id}"]`);
    if (!taskItem) { renderTasks(); return; }

    const checkbox = taskItem.querySelector('.custom-checkbox');
    const titleEl  = taskItem.querySelector('.task-title');

    if (task.completed) {
        taskItem.classList.add('completed');
        checkbox.innerHTML = '<span class="material-icons-round" style="font-size:16px">check</span>';
        titleEl.style.textDecoration = 'line-through';
        titleEl.style.color = 'var(--text-muted)';
        DOM.completedList.appendChild(taskItem);
        DOM.completedSection.classList.remove('hidden');
    } else {
        taskItem.classList.remove('completed');
        checkbox.innerHTML = '';
        titleEl.style.textDecoration = 'none';
        titleEl.style.color = '';
        DOM.taskList.appendChild(taskItem);
    }
}

/* --- BULK ACTIONS --- */

function toggleSelection(id) {
    if (selectedTasks.has(id)) {
        selectedTasks.delete(id);
    } else {
        selectedTasks.add(id);
    }

    const taskItem = document.querySelector(`.task-item[data-task-id="${id}"]`);
    if (taskItem) {
        const isSelected = selectedTasks.has(id);
        taskItem.querySelector('.hidden-checkbox').checked = isSelected;
        const iconBtn = taskItem.querySelector('.select-icon-btn');
        iconBtn.classList.toggle('selected', isSelected);
        iconBtn.querySelector('.material-icons-round').textContent = isSelected ? 'check_box' : 'check_box_outline_blank';
    }

    updateBulkActionUI();
}

/* Patch checkboxes in-place — no full re-render needed */
function toggleSelectAll(isChecked) {
    const visibleTasks = getFilteredTasks();

    if (isChecked) {
        visibleTasks.forEach(t => selectedTasks.add(t.id));
    } else {
        selectedTasks.clear();
    }

    /* Update only the visual state of existing DOM nodes */
    document.querySelectorAll('.task-item').forEach(el => {
        const id = parseInt(el.dataset.taskId, 10);
        const isSelected = selectedTasks.has(id);
        el.querySelector('.hidden-checkbox').checked = isSelected;
        const iconBtn = el.querySelector('.select-icon-btn');
        iconBtn.classList.toggle('selected', isSelected);
        iconBtn.querySelector('.material-icons-round').textContent = isSelected ? 'check_box' : 'check_box_outline_blank';
    });

    updateBulkActionUI();
}

function deleteSelected() {
    if (selectedTasks.size === 0) return;

    showToast(`Delete ${selectedTasks.size} tasks?`, true, () => {
        tasks = tasks.filter(t => !selectedTasks.has(t.id));
        selectedTasks.clear();
        markDirty();
        renderTasks();
        updateStats();
        showToast("Selected Tasks Deleted");
        DOM.selectAllChk.checked = false;
    });
}

function updateBulkActionUI() {
    DOM.selectedCount.textContent = selectedTasks.size;
    DOM.bulkDeleteBtn.classList.toggle('hidden', selectedTasks.size === 0);
}

/* --- RENDERING --- */

function getFilteredTasks() {
    let filtered;

    /* Single-pass filter — no chained .filter() calls */
    if (currentFilter === 'all' && !searchQuery) {
        filtered = tasks.slice(); /* cheap copy, no predicate cost */
    } else {
        filtered = tasks.filter(t => {
            switch (currentFilter) {
                case 'completed': if (!t.completed) return false; break;
                case 'important': if (t.priority !== 'high' || t.completed) return false; break;
                case 'today':     if (t.dueDate !== todayStr || t.completed) return false; break;
            }
            if (searchQuery && !t.titleLower.includes(searchQuery)) return false;
            return true;
        });
    }

    /* Sort — timestamps pre-computed to avoid repeated Date construction */
    filtered.sort((a, b) => {
        switch (sortBy) {
            case 'newest':   return b.id - a.id;
            case 'oldest':   return a.id - b.id;
            case 'priority': return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
            case 'date':     return (a._ts || (a._ts = Date.parse(a.dueDate + 'T' + a.dueTime)))
                                  - (b._ts || (b._ts = Date.parse(b.dueDate + 'T' + b.dueTime)));
        }
    });

    return filtered;
}

function renderTasks() {
    const filtered = getFilteredTasks();

    if (filtered.length === 0) {
        DOM.emptyState.classList.remove('hidden');
        DOM.completedSection.classList.add('hidden');
        DOM.taskList.innerHTML = '';
        DOM.completedList.innerHTML = '';
        updateBulkActionUI();
        return;
    }

    DOM.emptyState.classList.add('hidden');

    /* Build HTML strings — one innerHTML write per list, not per task */
    let activeHTML = '';
    let completedHTML = '';
    let completedCount = 0;

    for (let i = 0; i < filtered.length; i++) {
        const task = filtered[i];
        const html = taskTemplate(task);
        if (task.completed) {
            completedHTML += html;
            completedCount++;
        } else {
            activeHTML += html;
        }
    }

    DOM.taskList.innerHTML = activeHTML;
    DOM.completedList.innerHTML = completedHTML;
    DOM.completedSection.classList.toggle('hidden', completedCount === 0);

    updateBulkActionUI();
}

/* Pure string template — zero DOM creation per task */
function taskTemplate(task) {
    const isSelected  = selectedTasks.has(task.id);
    const isCompleted = task.completed;
    const checkInner  = isCompleted ? '<span class="material-icons-round" style="font-size:16px">check</span>' : '';
    const highTag     = task.priority === 'high' ? '<span class="meta-tag" style="color:var(--danger)">High Priority</span>' : '';
    const selIcon     = isSelected ? 'check_box' : 'check_box_outline_blank';

    return `<li class="task-item priority-${task.priority}${isCompleted ? ' completed' : ''}" data-task-id="${task.id}">
        <div class="task-left">
            <div class="custom-checkbox">${checkInner}</div>
            <div class="task-details">
                <span class="task-title"${isCompleted ? ' style="text-decoration:line-through;color:var(--text-muted)"' : ''}>${escapeHtml(task.title)}</span>
                <div class="task-meta">
                    <span class="meta-tag"><span class="material-icons-round" style="font-size:12px">event</span> ${task.dueDate}</span>
                    <span class="meta-tag"><span class="material-icons-round" style="font-size:12px">schedule</span> ${task.dueTime}</span>
                    ${highTag}
                </div>
            </div>
        </div>
        <div class="task-actions">
            <label class="selection-control">
                <input type="checkbox" class="hidden-checkbox"${isSelected ? ' checked' : ''}>
                <div class="icon-btn select-icon-btn${isSelected ? ' selected' : ''}" title="Select for Bulk Action">
                    <span class="material-icons-round">${selIcon}</span>
                </div>
            </label>
            <button class="icon-btn" title="Add to Google Calendar">
                <span class="material-icons-round">calendar_today</span>
            </button>
            <button class="icon-btn" title="Edit Task">
                <span class="material-icons-round">edit</span>
            </button>
            <button class="icon-btn delete" title="Delete Task">
                <span class="material-icons-round">delete</span>
            </button>
        </div>
    </li>`;
}

/* --- HELPERS --- */

function updateStats() {
    let completed = 0;
    for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].completed) completed++;
    }
    const total   = tasks.length;
    const pending = total - completed;

    /* Only write to DOM if value actually changed — avoids layout thrash */
    if (DOM.statTotal.textContent     !== String(total))     DOM.statTotal.textContent     = total;
    if (DOM.statPending.textContent   !== String(pending))   DOM.statPending.textContent   = pending;
    if (DOM.statCompleted.textContent !== String(completed)) DOM.statCompleted.textContent = completed;
}

/* Mark data dirty and schedule a debounced save */
function markDirty() {
    isDirty = true;
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
        if (!isDirty) return;
        localStorage.setItem('tasks', JSON.stringify(tasks));
        isDirty = false;
    }, 500);
}

function setupDate() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('date-display').textContent = new Date().toLocaleDateString('en-US', options);
}

/* Reuse a single div node for HTML escaping — no allocation per call */
const _escDiv = document.createElement('div');
function escapeHtml(text) {
    _escDiv.textContent = text;
    return _escDiv.innerHTML;
}

let toastTimer = null;
function showToast(msg, isConfirm = false, onConfirm = null) {
    if (isConfirm) {
        if (confirm(msg) && onConfirm) onConfirm();
        return;
    }
    DOM.toast.textContent = msg;
    DOM.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => DOM.toast.classList.add('hidden'), 3000);
}

/* --- UI --- */

function openModal(id = null) {
    /* Clear errors */
    DOM.errorTitle.classList.add('hidden');
    DOM.errorDate.classList.add('hidden');
    DOM.errorTime.classList.add('hidden');
    DOM.inputTitle.classList.remove('error');
    DOM.inputDate.classList.remove('error');
    DOM.inputTime.classList.remove('error');

    if (id) {
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        editingId = id;
        DOM.modalTitle.textContent = "Edit Task";
        DOM.inputTitle.value = task.title;
        DOM.inputDesc.value  = task.desc;
        DOM.inputDate.value  = task.dueDate;
        DOM.inputTime.value  = task.dueTime;
        const r = document.querySelector(`input[name="priority"][value="${task.priority}"]`);
        if (r) r.checked = true;
    } else {
        editingId = null;
        DOM.modalTitle.textContent = "Create New Task";
        DOM.taskForm.reset();
        DOM.inputDate.value = todayStr; /* reuse cached string */
    }

    DOM.modal.classList.remove('hidden');
    DOM.inputTitle.focus();
}

function closeModal() {
    DOM.modal.classList.add('hidden');
    editingId = null;
}

const FILTER_TITLES = { all: 'All Tasks', today: "Today's Tasks", important: 'Important', completed: 'Completed' };

function filterTasks(type, btnElement) {
    currentFilter = type;
    selectedTasks.clear();
    DOM.selectAllChk.checked = false;

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');

    renderTasks();
    DOM.pageTitle.textContent = FILTER_TITLES[type] || 'Dashboard';
}

function toggleTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    if (isDark) {
        document.body.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    } else {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
}

/* Load saved theme before first paint — IIFE runs synchronously */
(() => {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
    }
})();

/* --- EXTRAS --- */

function addToCalendar(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    const startTime = new Date(`${task.dueDate}T${task.dueTime}`);
    const endTime   = new Date(startTime.getTime() + 3600000);
    const fmt       = d => d.toISOString().replace(/-|:|\.\d{3}/g, '');

    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(task.title)}&dates=${fmt(startTime)}/${fmt(endTime)}&details=${encodeURIComponent(task.desc || '')}`;
    window.open(url, '_blank');
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

/* checkReminders — builds comparison string once per call, not per task */
function checkReminders() {
    const now = new Date();
    const currentString = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    /* Timestamp 24 hours from now (ms), used for deadline warning window */
    const in24h = now.getTime() + 24 * 60 * 60 * 1000;

    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (t.completed) continue;

        const dueTimestamp = Date.parse(`${t.dueDate}T${t.dueTime}`);

        /* Exact-minute in-app notification (existing behaviour) */
        if (`${t.dueDate} ${t.dueTime}` === currentString) {
            sendNotification(t);
        }

        /* 24-hour deadline warning email — fire once per task */
        if (!t.notifiedDeadline && dueTimestamp > now.getTime() && dueTimestamp <= in24h) {
            t.notifiedDeadline = true;
            markDirty();
            sendEmailNotification('deadline', t);
        }
    }
}

function sendNotification(task) {
    if (Notification.permission === 'granted') {
        new Notification('Task Reminder!', {
            body: `It's time for: ${task.title}`,
            icon: 'https://cdn-icons-png.flaticon.com/512/2387/2387635.png'
        });
    }
}

/* --- EMAILJS NOTIFICATION SYSTEM --- */

function initEmailJS() {
    if (typeof emailjs !== 'undefined') {
        emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    }
}

/**
 * sendEmailNotification
 * type: 'created' | 'completed' | 'deadline'
 */
function sendEmailNotification(type, task) {
    if (typeof emailjs === 'undefined') return;

    const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
    const dueDateFormatted = formatDueDateForEmail(task.dueDate, task.dueTime);

    const templates = {
        created: {
            subject: `✅ New Task Created: ${task.title}`,
            message: `A new task has been added to your TaskFlow workspace.\n\n` +
                     `📌 Task: ${task.title}\n` +
                     `${task.desc ? `📝 Description: ${task.desc}\n` : ''}` +
                     `📅 Due: ${dueDateFormatted}\n` +
                     `🔴 Priority: ${priorityLabel}\n\n` +
                     `Stay on track and get it done!`,
            status: 'New Task'
        },
        completed: {
            subject: `🎉 Task Completed: ${task.title}`,
            message: `Great job! You've completed a task in TaskFlow.\n\n` +
                     `✅ Task: ${task.title}\n` +
                     `${task.desc ? `📝 Description: ${task.desc}\n` : ''}` +
                     `📅 Was due: ${dueDateFormatted}\n` +
                     `🔴 Priority: ${priorityLabel}\n\n` +
                     `Keep up the great work!`,
            status: 'Completed'
        },
        deadline: {
            subject: `⚠️ Deadline Tomorrow: ${task.title}`,
            message: `Heads up! One of your tasks is due in less than 24 hours.\n\n` +
                     `⏰ Task: ${task.title}\n` +
                     `${task.desc ? `📝 Description: ${task.desc}\n` : ''}` +
                     `📅 Due: ${dueDateFormatted}\n` +
                     `🔴 Priority: ${priorityLabel}\n\n` +
                     `Don't let it slip — log in to TaskFlow and finish it!`,
            status: 'Deadline Approaching'
        }
    };

    const tpl = templates[type];
    if (!tpl) return;

    const templateParams = {
        to_email:    NOTIFY_EMAIL,
        to_name:     'TaskFlow User',
        subject:     tpl.subject,
        message:     tpl.message,
        task_title:  task.title,
        task_status: tpl.status,
        task_due:    dueDateFormatted,
        task_priority: priorityLabel
    };

    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams)
        .then(() => console.log(`[EmailJS] ${type} notification sent for: ${task.title}`))
        .catch(err => console.warn('[EmailJS] Failed to send notification:', err));
}

function formatDueDateForEmail(dateStr, timeStr) {
    try {
        const dt = new Date(`${dateStr}T${timeStr}`);
        return dt.toLocaleString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long',
            day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    } catch (e) {
        return `${dateStr} at ${timeStr}`;
    }
}