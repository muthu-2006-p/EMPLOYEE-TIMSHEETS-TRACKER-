// Manager projects page script
document.addEventListener('DOMContentLoaded', async () => {
    const user = getUser();
    if (!user || !user.id) return window.location.href = 'index.html';
    // populate nav/profile
    const navImg = document.getElementById('navPhoto');
    if (navImg && user.photo) navImg.src = user.photo;
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value || ''; };
    setText('mgrProfileName2', user.name);
    setText('mgrProfileEmail2', user.email);
    setText('mgrProfileRole2', `Role: ${user.role}`);

    await loadProjects();
    await loadTeam();
    // wire create project modal
    const openBtn = document.getElementById('openCreateProject');
    if (openBtn) {
        openBtn.addEventListener('click', async () => {
            console.log('Opening create project modal');
            // refresh team before showing modal so the checkbox list is up-to-date
            try {
                await loadTeam();
            } catch (e) {
                console.warn('Failed to refresh team before opening modal', e);
            }
            document.getElementById('createProjectModal').style.display = 'block';
            wireEmployeeSelection();
        });
    }
    const cancel = document.getElementById('createCancel');
    if (cancel) cancel.addEventListener('click', () => document.getElementById('createProjectModal').style.display = 'none');
    const save = document.getElementById('createSave');
    if (save) save.addEventListener('click', createProject);
});

async function loadProjects() {
    try {
        const projects = await apiCall('/projects');
        const grid = document.getElementById('projectsGrid');
        if (!grid) return;
        grid.innerHTML = projects.length ? projects.map(p => projectCardHtml(p)).join('') : '<p class="muted">No projects yet</p>';
        document.getElementById('mgrProjectsCount').textContent = `Projects: ${projects.length}`;
        // attach event handlers for remind buttons
        document.querySelectorAll('.btn-remind').forEach(btn => btn.addEventListener('click', (e) => {
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            openReminderModal(id, name);
        }));
    } catch (err) {
        console.error('loadProjects', err);
    }
}

function projectCardHtml(p) {
    const initials = p.icon || (p.name ? p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'P');
    return `
    <div class="stat-card project-card">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="project-icon">${initials}</div>
        <div style="flex:1">
          <div style="font-weight:700">${p.name}</div>
                    <div class="muted" style="font-size:13px">${p.description ? (p.description.substring(0, 120) + '...') : ''}</div>
                    <div style="margin-top:8px; display:flex; align-items:center; gap:8px;">
                        ${Array.isArray(p.employees) && p.employees.length ? (`
                            <div style="display:flex;align-items:center;gap:6px">
                                ${p.employees.slice(0, 4).map(emp => `<img src="${emp.photo || 'assets/images/avatar-placeholder.svg'}" title="${emp.name}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;border:1px solid rgba(0,0,0,0.06)" />`).join('')}
                            </div>
                            <div class="muted" style="font-size:12px">${p.employees.length} member${p.employees.length > 1 ? 's' : ''}</div>
                        `) : '<div class="muted" style="font-size:12px">No members assigned</div>'}
                    </div>
        </div>
        <div style="text-align:right">
          <button class="btn btn-remind" data-id="${p._id}" data-name="${p.name}">Remind Team</button>
          <button class="btn" style="margin-left:8px" onclick="openAssignTaskModal('${p._id}', '${escape(p.name)}')">Assign Task</button>
        </div>
      </div>
    </div>
  `;
}

// ===== Assign Task Modal Handlers =====
let _currentAssignProject = null;
async function openAssignTaskModal(projectId, projectNameEscaped) {
    const projectName = unescape(projectNameEscaped);
    _currentAssignProject = projectId;
    document.getElementById('assignModalProjectName').textContent = projectName;
    document.getElementById('assignTaskTitle').value = '';
    document.getElementById('assignTaskDesc').value = '';
    document.getElementById('assignTaskDeadline').value = '';

    // populate employee list
    try {
        const team = await apiCall('/employees/team');
        const wrap = document.getElementById('assignEmployeesList');
        if (!wrap) return;
        wrap.innerHTML = team.length ? team.map(m => `
            <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer">
                <input type="checkbox" class="assign-emp-cb" value="${m._id}">
                <div style="flex:1"><strong>${m.name}</strong><div class="muted" style="font-size:12px">${m.email}</div></div>
            </label>
        `).join('') : '<p class="muted">No team members</p>';
    } catch (err) {
        console.error('Could not load team for assign:', err);
        document.getElementById('assignEmployeesList').innerHTML = '<p class="muted">Could not load team</p>';
    }

    document.getElementById('assignTaskModal').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
    const cancel = document.getElementById('assignCancel');
    const save = document.getElementById('assignSave');
    if (cancel) cancel.addEventListener('click', () => document.getElementById('assignTaskModal').style.display = 'none');
    if (save) save.addEventListener('click', submitAssignTask);
});

async function submitAssignTask() {
    const title = document.getElementById('assignTaskTitle').value.trim();
    const desc = document.getElementById('assignTaskDesc').value.trim();
    const deadline = document.getElementById('assignTaskDeadline').value;
    const assignees = Array.from(document.querySelectorAll('.assign-emp-cb:checked')).map(cb => cb.value);
    if (!title) return alert('Enter task title');
    if (!assignees.length) return alert('Select at least one employee');

    const payload = { title, description: desc, project: _currentAssignProject, assignees, deadline };
    try {
        const task = await apiCall('/tasks', 'POST', payload);
        if (!task || !task._id) return alert('Failed to create task');
        // send notification to assignees with timesheet link
        // task.assignments is populated with employee info (name, email) by backend
        const timesheetLink = `${location.origin}/timesheet.html?task=${task._id}`;
        for (const a of (task.assignments || [])) {
            try {
                const userEmail = a.employee?.email;
                const message = `You have been assigned a new task: ${title} (Project: ${task.project?.name || ''}). Please submit your timesheet at: ${timesheetLink}`;
                if (userEmail) await apiCall('/feedback', 'POST', { to: userEmail, subject: `New Task Assigned: ${title}`, message });
            } catch (err) { console.warn('notify error for assignment', a, err); }
        }
        alert('Task assigned and notifications sent');
        document.getElementById('assignTaskModal').style.display = 'none';
        await loadProjects();
    } catch (err) {
        console.error('submitAssignTask error', err);
        alert('Failed to assign task');
    }
}

let _currentProjectForReminder = null;

function openReminderModal(projectId, projectName) {
    _currentProjectForReminder = { projectId, projectName };
    document.getElementById('modalProjectName').textContent = projectName;
    document.getElementById('reminderMessage').value = `Hi team, please share your ideas or updates for ${projectName}.`;
    document.getElementById('reminderModal').style.display = 'block';
}

// modal handlers
if (typeof window !== 'undefined') {
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('reminderModal');
        if (!modal) return;
        if (e.target === modal) modal.style.display = 'none';
    });
    document.addEventListener('DOMContentLoaded', () => {
        const cancel = document.getElementById('modalCancel');
        const send = document.getElementById('modalSend');
        if (cancel) cancel.addEventListener('click', () => document.getElementById('reminderModal').style.display = 'none');
        if (send) send.addEventListener('click', sendReminderToTeam);
    });
}

async function loadTeam() {
    try {
        let team = await apiCall('/employees/team');
        console.log('Team loaded:', team);
        // handle case where API returned an error object (e.g., { message: 'Unauthorized' })
        if (!Array.isArray(team)) {
            const msgEl = document.getElementById('createProjectMsg');
            const text = (team && (team.message || team.error)) ? (team.message || team.error) : 'Unexpected response from server';
            if (msgEl) msgEl.innerHTML = `<div class="error">Could not load team: ${text}</div>`;
            console.warn('employees/team did not return an array:', team);
            team = [];
        }
        const wrap = document.getElementById('projectTeam');
        if (!wrap) return;
        wrap.innerHTML = team.length ? team.map(m => teamCardHtml(m)).join('') : '<p class="muted">No team members assigned</p>';
        document.getElementById('mgrTeamCount').textContent = `Team: ${team.length}`;
        // populate employees checkbox list for project creation
        const list = document.getElementById('projEmployeesList');
        const countEl = document.getElementById('projEmployeesCount');
        if (list) {
            list.innerHTML = '';
            console.log('Populating employee checkboxes, team count:', team.length);
            // populate debug view for easier troubleshooting
            const dbg = document.getElementById('projEmployeesDebug');
            if (dbg) {
                try {
                    if (team && team.length) {
                        dbg.style.display = 'none';
                        dbg.textContent = '';
                    } else {
                        dbg.style.display = 'block';
                        dbg.textContent = JSON.stringify(team, null, 2);
                    }
                } catch (e) {
                    dbg.style.display = 'block';
                    dbg.textContent = 'Failed to render debug data: ' + (e.message || e);
                }
            }
            team.forEach(m => {
                const id = m._id;
                const wrapper = document.createElement('label');
                wrapper.style.display = 'flex';
                wrapper.style.alignItems = 'center';
                wrapper.style.gap = '8px';
                wrapper.style.padding = '6px 4px';
                wrapper.style.cursor = 'pointer';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = id;
                cb.className = 'proj-emp-cb';
                const img = document.createElement('img');
                img.src = m.photo || 'assets/images/avatar-placeholder.svg';
                img.style.width = '36px';
                img.style.height = '36px';
                img.style.borderRadius = '6px';
                img.style.objectFit = 'cover';
                const txt = document.createElement('div');
                txt.innerHTML = `<div style="font-weight:700">${m.name}</div><div class="muted" style="font-size:12px">${m.designation || ''} · ${m.email}</div>`;
                wrapper.appendChild(cb);
                wrapper.appendChild(img);
                wrapper.appendChild(txt);
                list.appendChild(wrapper);
            });
            // selection counter
            function updateCount() { const n = document.querySelectorAll('.proj-emp-cb:checked').length; if (countEl) countEl.textContent = `${n} selected`; }
            list.addEventListener('change', updateCount);
            updateCount();
            console.log('Employee checkboxes populated');
            return team;
        }
    } catch (err) {
        console.error('loadTeam error:', err);
        const msgEl = document.getElementById('createProjectMsg');
        if (msgEl) msgEl.innerHTML = `<div class="error">Could not load team: ${err.message || err}</div>`;
        return [];
    }
}

function teamCardHtml(m) {
    return `
    <div class="stat-card employee-card">
      <div style="display:flex;gap:12px;align-items:center">
        <img src="${m.photo || 'assets/images/avatar-placeholder.svg'}" style="width:56px;height:56px;border-radius:8px;object-fit:cover" />
        <div style="flex:1">
          <div style="font-weight:700">${m.name}</div>
          <div class="muted" style="font-size:13px">${m.designation || ''} · ${m.department || ''}</div>
          <div class="muted" style="font-size:13px">${m.email}</div>
        </div>
        <div style="text-align:right">
          <button class="btn" onclick="openQuickMessage('${m.email}')">Message</button>
        </div>
      </div>
    </div>
  `;
}

async function sendReminderToTeam() {
    const msg = document.getElementById('reminderMessage').value.trim();
    if (!msg) return alert('Please enter a message');
    const modal = document.getElementById('reminderModal');
    modal.style.display = 'none';
    try {
        // get team members
        const team = await apiCall('/employees/team');
        if (!team || !team.length) return alert('No team to remind');
        const subject = `Reminder: ${_currentProjectForReminder?.projectName || 'Project'}`;
        for (const member of team) {
            await apiCall('/feedback', 'POST', { to: member.email, subject, message: msg });
        }
        alert('Reminders sent');
    } catch (err) {
        console.error('sendReminderToTeam', err);
        alert('Failed to send reminders');
    }
}

async function openQuickMessage(email) {
    const message = prompt('Message to ' + email + ':', 'Hi, quick update request.');
    if (!message) return;
    try {
        await apiCall('/feedback', 'POST', { to: email, subject: 'Message from manager', message });
        alert('Message sent');
    } catch (err) {
        console.error('openQuickMessage', err);
        alert('Failed to send message');
    }
}

function wireEmployeeSelection() {
    const list = document.getElementById('projEmployeesList');
    const countEl = document.getElementById('projEmployeesCount');
    if (!list || !countEl) {
        console.warn('wireEmployeeSelection: missing list or countEl');
        return;
    }

    function updateCount() {
        const n = document.querySelectorAll('.proj-emp-cb:checked').length;
        countEl.textContent = `${n} selected`;
        console.log('Selection updated:', n, 'selected');
    }

    // attach listeners to all checkboxes directly
    const checkboxes = document.querySelectorAll('.proj-emp-cb');
    console.log('Wiring', checkboxes.length, 'checkboxes');
    checkboxes.forEach((cb, idx) => {
        // remove any existing listeners by cloning and replacing
        const newCb = cb.cloneNode(true);
        cb.parentNode.replaceChild(newCb, cb);
        newCb.addEventListener('change', updateCount);
    });
    updateCount();
}

async function createProject() {
    const msgEl = document.getElementById('createProjectMsg');
    const name = document.getElementById('projName').value.trim();
    const description = document.getElementById('projDesc').value.trim();
    const startDate = document.getElementById('projStart').value || null;
    const endDate = document.getElementById('projEnd').value || null;
    const employees = Array.from(document.querySelectorAll('.proj-emp-cb:checked')).map(cb => cb.value);

    // clear previous message
    if (msgEl) msgEl.innerHTML = '';

    // validation
    if (!name) { if (msgEl) msgEl.innerHTML = '<div class="error">Project name is required.</div>'; return; }
    if (startDate && endDate) {
        const s = new Date(startDate);
        const e = new Date(endDate);
        if (s > e) { if (msgEl) msgEl.innerHTML = '<div class="error">Start date must be before or equal to end date.</div>'; return; }
    }

    // disable button
    const saveBtn = document.getElementById('createSave');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Creating...';
    }
    try {
        const payload = { name, description, startDate, endDate, employees };
        const res = await apiCall('/projects', 'POST', payload);
        // on success, close modal and reload list
        document.getElementById('createProjectModal').style.display = 'none';
        // clear form
        document.getElementById('projName').value = '';
        document.getElementById('projDesc').value = '';
        document.getElementById('projStart').value = '';
        document.getElementById('projEnd').value = '';
        // uncheck all
        document.querySelectorAll('.proj-emp-cb').forEach(cb => cb.checked = false);
        await loadProjects();
        if (msgEl) msgEl.innerHTML = '<div class="success">Project created successfully.</div>';
    } catch (err) {
        console.error('createProject', err);
        if (msgEl) msgEl.innerHTML = '<div class="error">Failed to create project. See console for details.</div>';
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Create';
        }
    }
}

// ===== Deadline warnings (runs in background on Projects page) =====
const _sentWarnings = new Set();
async function checkProjectDeadlines() {
    try {
        const projects = await apiCall('/projects');
        for (const proj of projects) {
            try {
                const tasks = await apiCall(`/tasks/project/${proj._id}`);
                if (!tasks || !tasks.length) continue;
                const now = new Date();
                for (const task of tasks) {
                    for (const a of (task.assignments || [])) {
                        if (!a.deadline) continue;
                        const deadline = new Date(a.deadline);
                        const key = `${task._id}:${a.employee}`;
                        if (deadline < now && (a.progress || 0) < 100 && !_sentWarnings.has(key)) {
                            // send warning
                            try {
                                const email = a.employee?.email || null;
                                const subject = `⚠️ TASK OVERDUE: ${task.title}`;
                                const message = `Task "${task.title}" (Project: ${proj.name}) assigned to you is overdue since ${deadline.toDateString()}. Please submit/update your timesheet.`;
                                if (email) await apiCall('/feedback', 'POST', { to: email, subject, message });
                                _sentWarnings.add(key);
                            } catch (err) { console.warn('warning send failed', err); }
                        }
                    }
                }
            } catch (err) { console.warn('checkProjectDeadlines task fetch error', err); }
        }
    } catch (err) { console.error('checkProjectDeadlines error', err); }
}

// run checks periodically (every 5 minutes)
setInterval(() => { checkProjectDeadlines(); }, 5 * 60 * 1000);
// also run once after loading
setTimeout(() => { checkProjectDeadlines(); }, 5000);