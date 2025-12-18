// Task Workflow Management for Manager & Employee Dashboard
// Handles: create tasks, assign employees, track progress, submit timesheets, approve/reject

const TASK_API = '/tasks'; // NO /api prefix - will use apiCall or add it in fetch
const TS_API = '/timesheets';

// ===== MANAGER: Create & Assign Tasks =====

async function createAndAssignTask(projectId, taskTitle, taskDescription, assigneeIds, deadline) {
    try {
        const payload = {
            title: taskTitle,
            description: taskDescription,
            project: projectId,
            assignees: assigneeIds,
            deadline: deadline
        };
        console.log('🚀 Creating task with payload:', JSON.stringify(payload, null, 2));
        console.log('🔑 Token:', localStorage.getItem('token') ? .substring(0, 20) + '...');

        const res = await fetch(`/api${TASK_API}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(payload)
        });

        console.log('📊 Response status:', res.status, res.statusText);
        const result = await res.json();
        console.log('📦 Response body:', JSON.stringify(result, null, 2));

        if (!res.ok) {
            const msg = result.message || result.error || `Failed: ${res.status} ${res.statusText}`;
            console.error('❌ Backend error:', msg);
            throw new Error(msg);
        }

        console.log('✅ Task created:', result._id);
        return result;
    } catch (err) {
        console.error('💥 Error creating task:', err.message);
        alert('❌ Failed to assign task:\n\n' + (err.message || 'Unknown error'));
        return null;
    }
}

// ===== EMPLOYEE: Get My Assigned Tasks =====

async function getMyAssignedTasks() {
    try {
        const token = localStorage.getItem('token');
        console.log('getMyAssignedTasks - token present:', !!token);
        const url = `/api${TASK_API}/mine`;
        console.log('getMyAssignedTasks - fetching', url);
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('getMyAssignedTasks - response status:', res.status, res.statusText);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { data = text; }
        if (!res.ok) {
            console.error('getMyAssignedTasks - error body:', data);
            throw new Error(data ? .message || data ? .error || `Failed to fetch tasks: ${res.status}`);
        }
        console.log('getMyAssignedTasks - response body:', data);
        return data;
    } catch (err) {
        console.error('Error fetching my tasks:', err);
        return [];
    }
}

// ===== EMPLOYEE: Load & Display My Assigned Tasks =====

async function loadMyAssignedTasks() {
    try {
        console.log('🚀 Loading my assigned tasks...');
        const tasks = await getMyAssignedTasks();
        console.log('📋 Tasks loaded:', tasks);

        const tasksList = document.getElementById('myTasksList');
        if (!tasksList) {
            console.error('❌ myTasksList element not found');
            return;
        }

        if (!tasks || tasks.length === 0) {
            tasksList.innerHTML = '<p class="muted" style="grid-column: 1/-1;">No tasks assigned yet.</p>';
            return;
        }

        tasksList.innerHTML = tasks.map(task => {
                    const deadline = new Date(task.deadline || task.assignments ? .[0] ? .deadline);
                    const now = new Date();
                    const isOverdue = deadline < now;
                    const daysOverdue = Math.ceil((now - deadline) / (1000 * 60 * 60 * 24));
                    const progress = task.assignments ? .[0] ? .progress || 0;
                    const status = task.assignments ? .[0] ? .status || 'not_started';
                    const statusDisplay = status === 'completed' ? '✅ COMPLETED' : (status === 'in_progress' ? '🔄 IN PROGRESS' : '⏳ NOT STARTED');
                    const statusColor = status === 'completed' ? '#10b981' : (status === 'in_progress' ? '#3b82f6' : '#6b7280');

                    return `
                <div class="card" style="padding: 16px; border-left: 4px solid ${isOverdue ? '#ef4444' : statusColor};">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                        <div style="flex: 1;">
                            <h3 style="margin: 0 0 4px 0;">${task.title || 'Untitled Task'}</h3>
                            <p class="muted" style="margin: 0; font-size: 13px;">${task.project?.name || 'No Project'}</p>
                            ${task.description ? `<p class="muted" style="margin: 8px 0 0 0; font-size: 13px;">${task.description}</p>` : ''}
                        </div>
                        <span class="badge" style="background: ${statusColor}; padding: 4px 12px; border-radius: 12px; white-space: nowrap;">${statusDisplay}</span>
                    </div>
                    
                    <div style="margin: 12px 0;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <label style="font-size: 12px; font-weight: 600; color: #9ca3af;">Progress</label>
                            <span style="font-size: 12px; font-weight: 600; color: #9ca3af;">${progress}%</span>
                        </div>
                        <div style="background: rgba(255,255,255,0.05); border-radius: 4px; height: 8px; overflow: hidden;">
                            <div style="background: linear-gradient(90deg, #3b82f6, #8b5cf6); height: 100%; width: ${progress}%; transition: width 0.3s ease;"></div>
                        </div>
                    </div>
                    
                    <div style="margin: 12px 0; padding: 8px; background: rgba(255,255,255,0.02); border-radius: 6px;">
                        <p class="muted" style="margin: 0; font-size: 12px;">
                            <strong>Deadline:</strong> ${deadline.toDateString()}
                            ${isOverdue ? `<span style="color: #ef4444; font-weight: 600;"> 🔴 ${daysOverdue} day(s) overdue</span>` : ''}
                        </p>
                    </div>
                    
                    <button class="btn primary" onclick="openSubmitTaskModal('${task._id}', '${task.title?.replace(/'/g, "\\'")}', ${progress})" style="width: 100%; margin-top: 12px;">
                        📝 Submit Timesheet for Task
                    </button>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('💥 Error loading my tasks:', err);
        const tasksList = document.getElementById('myTasksList');
        if (tasksList) {
            tasksList.innerHTML = '<p class="muted" style="grid-column: 1/-1; color: #ef4444;">Error loading tasks. Please refresh.</p>';
        }
    }
}

// ===== EMPLOYEE: Update Task Assignment Progress =====

async function updateTaskProgress(taskId, employeeId, progress, status) {
    try {
        const payload = { progress, status };
        const res = await fetch(`/api${TASK_API}/${taskId}/assignment/${employeeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`Failed to update progress: ${res.status}`);
        const updated = await res.json();
        console.log('Task progress updated:', updated);
        return updated;
    } catch (err) {
        console.error('Error updating progress:', err);
        alert('Failed to update progress: ' + err.message);
        return null;
    }
}

// ===== EMPLOYEE: Submit Timesheet for Task =====

async function submitTimesheetForTask(taskId, date, startTime, endTime, breakMinutes, description, progress) {
    try {
        const payload = {
            task: taskId,
            date,
            startTime,
            endTime,
            breakMinutes: breakMinutes || 0,
            description,
            progress: progress || 0
        };
        const token = localStorage.getItem('token');
        const url = `/api${TS_API}`;
        console.log('submitTimesheetForTask - token present:', !!token);
        console.log('submitTimesheetForTask - POST', url, 'payload:', payload);

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        console.log('submitTimesheetForTask - response status:', res.status, res.statusText);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { data = text; }
        if (!res.ok) {
            console.error('submitTimesheetForTask - error body:', data);
            const msg = data?.message || data?.error || `Failed to submit timesheet: ${res.status}`;
            throw new Error(msg);
        }
        console.log('Timesheet submitted:', data);
        return data;
    } catch (err) {
        console.error('Error submitting timesheet:', err);
        alert('Failed to submit timesheet: ' + (err.message || err));
        return null;
    }
}

// ===== MANAGER: Get Pending Approvals (Timesheets) =====

async function getPendingTimesheetApprovals() {
    try {
        const res = await fetch(`/api${TS_API}/team/all`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (!res.ok) throw new Error(`Failed to fetch timesheets: ${res.status}`);
        const timesheets = await res.json();
        // Filter for pending only
        return timesheets.filter(ts => ts.status === 'pending');
    } catch (err) {
        console.error('Error fetching pending timesheets:', err);
        return [];
    }
}

// ===== MANAGER: Approve or Reject Timesheet =====

async function approveOrRejectTimesheet(timesheetId, approve, remarks = '') {
    try {
        const payload = { approve, remarks };
        const res = await fetch(`/api${TS_API}/${timesheetId}/approve`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`Failed to approve/reject: ${res.status}`);
        const updated = await res.json();
        console.log('Timesheet approved/rejected:', updated);
        return updated;
    } catch (err) {
        console.error('Error approving/rejecting:', err);
        alert('Failed to process approval: ' + err.message);
        return null;
    }
}

// ===== MANAGER: Get Tasks for Project =====

async function getProjectTasks(projectId) {
    try {
        const res = await fetch(`/api${TASK_API}/project/${projectId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
        const tasks = await res.json();
        return tasks;
    } catch (err) {
        console.error('Error fetching project tasks:', err);
        return [];
    }
}

// ===== MANAGER: Check for Overdue Tasks and Send Warnings =====

async function checkAndSendDeadlineWarnings() {
    try {
        const now = new Date();
        // Get all my projects
        const res = await fetch('/api/projects', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (!res.ok) return;
        const projects = await res.json();
        const myProjects = projects.filter(p => String(p.manager._id) === String(getUser()._id));

        for (const proj of myProjects) {
            const tasks = await getProjectTasks(proj._id);
            for (const task of tasks) {
                for (const assignment of task.assignments) {
                    if (assignment.deadline) {
                        const deadline = new Date(assignment.deadline);
                        // If deadline passed and task not completed and no timesheet submitted, send warning
                        if (deadline < now && assignment.progress < 100 && !assignment.submittedTimesheet) {
                            const warningMsg = `Task "${task.title}" (Project: ${proj.name}) is overdue. Deadline was ${deadline.toDateString()}. Please submit your timesheet or update progress.`;
                            // Store warning in feedback/notification system
                            console.log('WARNING:', warningMsg);
                            // You can send a message via feedback API if desired
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error checking deadlines:', err);
    }
}

// ===== Helper: Format Task Display =====

function formatTaskForDisplay(task) {
    return {
        id: task._id,
        title: task.title,
        description: task.description,
        projectName: task.project ? .name || 'Unknown Project',
        assignments: (task.assignments || []).map(a => ({
            employeeId: a.employee._id,
            employeeName: a.employee.name,
            progress: a.progress,
            status: a.status,
            deadline: a.deadline ? new Date(a.deadline).toLocaleString() : 'No deadline',
            submittedTimesheet: a.submittedTimesheet
        }))
    };
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createAndAssignTask,
        getMyAssignedTasks,
        updateTaskProgress,
        submitTimesheetForTask,
        getPendingTimesheetApprovals,
        approveOrRejectTimesheet,
        getProjectTasks,
        checkAndSendDeadlineWarnings,
        formatTaskForDisplay
    };
}

// ===== EMPLOYEE: Modal Controls for Task Timesheet =====

let _currentTaskId = null;

function openSubmitTaskModal(taskId, taskTitle, currentProgress) {
    _currentTaskId = taskId;
    document.getElementById('taskInfoDisplay').textContent = `${taskTitle} (${currentProgress}% complete)`;
    document.getElementById('tsTaskDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('tsTaskStartTime').value = '';
    document.getElementById('tsTaskEndTime').value = '';
    document.getElementById('tsTaskBreak').value = '0';
    document.getElementById('tsTaskProgress').value = currentProgress || 50;
    document.getElementById('progressValue').textContent = (currentProgress || 50) + '%';
    document.getElementById('tsTaskDesc').value = '';
    document.getElementById('submitTaskTimesheetModal').style.display = 'flex';
    document.getElementById('submitTaskTimesheetModal').style.flexDirection = 'column';
}

function closeSubmitTaskModal() {
    _currentTaskId = null;
    document.getElementById('submitTaskTimesheetModal').style.display = 'none';
}

// Calculate and display hours in real-time
function calculateTaskHours() {
    const startTime = document.getElementById('tsTaskStartTime').value;
    const endTime = document.getElementById('tsTaskEndTime').value;
    const breakMinutes = parseInt(document.getElementById('tsTaskBreak').value) || 0;
    
    const display = document.getElementById('calculatedHoursDisplay');
    const hoursText = document.getElementById('hoursCalculationText');
    const breakdown = document.getElementById('hoursBreakdown');
    
    if (!startTime || !endTime) {
        display.style.display = 'none';
        return;
    }
    
    const date = document.getElementById('tsTaskDate').value || new Date().toISOString().split('T')[0];
    const startDate = new Date(`${date}T${startTime}:00`);
    const endDate = new Date(`${date}T${endTime}:00`);
    const diffMs = endDate - startDate;
    const totalHours = Math.max(0, (diffMs / (1000 * 60 * 60)) - (breakMinutes / 60));
    
    display.style.display = 'block';
    
    if (totalHours > 24) {
        display.style.background = 'rgba(239, 68, 68, 0.1)';
        display.style.borderLeftColor = '#EF4444';
        hoursText.style.color = '#EF4444';
        hoursText.textContent = `${totalHours.toFixed(2)}h ⚠️ EXCEEDS 24 HOURS!`;
        breakdown.textContent = `A single day cannot have more than 24 hours. Please adjust times.`;
    } else if (totalHours <= 0) {
        display.style.background = 'rgba(251, 191, 36, 0.1)';
        display.style.borderLeftColor = '#FBBF24';
        hoursText.style.color = '#FBBF24';
        hoursText.textContent = `${totalHours.toFixed(2)}h ⚠️ Invalid`;
        breakdown.textContent = `Hours must be positive. Check your times and break duration.`;
    } else {
        display.style.background = 'rgba(59, 130, 246, 0.1)';
        display.style.borderLeftColor = '#3B82F6';
        hoursText.style.color = '#3B82F6';
        hoursText.textContent = `${totalHours.toFixed(2)}h`;
        breakdown.textContent = `Formula: (${endTime} - ${startTime}) - ${breakMinutes} min break`;
        
        if (totalHours > 8) {
            breakdown.textContent += ` | Overtime: ${(totalHours - 8).toFixed(2)}h`;
        }
    }
}

async function submitTaskTimesheet() {
    if (!_currentTaskId) {
        alert('❌ No task selected');
        return;
    }
    
    const date = document.getElementById('tsTaskDate').value;
    const startTime = document.getElementById('tsTaskStartTime').value;
    const endTime = document.getElementById('tsTaskEndTime').value;
    const breakMinutes = parseInt(document.getElementById('tsTaskBreak').value) || 0;
    const progress = parseInt(document.getElementById('tsTaskProgress').value) || 50;
    const description = document.getElementById('tsTaskDesc').value;
    
    if (!date || !startTime || !endTime) {
        alert('❌ Please fill in Date, Start Time, and End Time');
        return;
    }
    
    if (startTime >= endTime) {
        alert('❌ End Time must be after Start Time');
        return;
    }
    
    // Calculate hours to validate 24-hour limit
    const startDate = new Date(`${date}T${startTime}:00`);
    const endDate = new Date(`${date}T${endTime}:00`);
    const diffMs = endDate - startDate;
    const totalHours = (diffMs / (1000 * 60 * 60)) - (breakMinutes / 60);
    
    if (totalHours > 24) {
        alert(`❌ Total hours cannot exceed 24 hours.\n\nCalculated: ${totalHours.toFixed(1)} hours\n(Start: ${startTime}, End: ${endTime}, Break: ${breakMinutes} min)\n\nPlease adjust your times.`);
        return;
    }
    
    if (totalHours <= 0) {
        alert('❌ Total hours must be greater than 0. Please check your times and break duration.');
        return;
    }
    
    try {
        console.log('📝 Submitting timesheet for task:', _currentTaskId);
        const result = await submitTimesheetForTask(_currentTaskId, date, startTime, endTime, breakMinutes, description, progress);
        
        if (result) {
            alert('✅ Timesheet submitted successfully!');
            closeSubmitTaskModal();
            await loadMyAssignedTasks();
        } else {
            alert('❌ Failed to submit timesheet');
        }
    } catch (err) {
        console.error('❌ Error submitting timesheet:', err);
        alert('❌ Error: ' + err.message);
    }
}