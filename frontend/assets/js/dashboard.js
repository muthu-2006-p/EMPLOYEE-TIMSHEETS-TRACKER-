// Dashboard page routing and content
async function navigate(section) {
    const user = getUser();
    const contentDiv = document.getElementById('content');

    // Update active nav-link
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    const activeLink = Array.from(document.querySelectorAll('.nav-link')).find(link =>
        link.textContent.toLowerCase().includes(section.toLowerCase())
    );
    if (activeLink) activeLink.classList.add('active');

    if (section === 'dashboard') {
        if (user.role === 'admin') {
            contentDiv.innerHTML = `
        <div class="card">
          <h2>Welcome, Admin</h2>
          <div class="grid">
            <div class="stat-card">
              <div class="label">Total Employees</div>
              <div class="value" id="employeeCount">0</div>
            </div>
            <div class="stat-card">
              <div class="label">Active Projects</div>
              <div class="value" id="projectCount">0</div>
            </div>
            <div class="stat-card">
              <div class="label">Pending Timesheets</div>
              <div class="value" id="pendingCount">0</div>
            </div>
          </div>
        </div>
      `;
            loadAdminDashboard();
        } else if (user.role === 'manager') {
            contentDiv.innerHTML = `
        <div class="card">
          <h2>Welcome, ${user.name}</h2>
          <p>Team Overview & Pending Approvals</p>
          <div id="managerData"></div>
        </div>
      `;
            loadManagerDashboard();
        } else {
            contentDiv.innerHTML = `
        <div class="card">
          <h2>Welcome, ${user.name}</h2>
          <p>Your recent timesheets</p>
          <div id="employeeData"></div>
        </div>
      `;
            loadEmployeeDashboard();
        }
    } else if (section === 'timesheet') {
        contentDiv.innerHTML = `<p><a href="timesheet.html">Go to Timesheet Entry</a></p>`;
    } else if (section === 'history') {
        contentDiv.innerHTML = `<div class="card"><h2>My Timesheets</h2><div id="timesheetHistory"></div></div>`;
        loadTimesheetHistory();
    } else if (section === 'pending') {
        contentDiv.innerHTML = `<div class="card"><h2>Pending Approvals</h2><div id="pendingData"></div></div>`;
        loadPendingTimesheets();
    } else if (section === 'reports') {
        if (user.role === 'admin') {
            contentDiv.innerHTML = `
                <div class="card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <div>
                            <h2 style="margin: 0;">📈 Analytics Reports from Managers</h2>
                            <p class="muted" style="margin: 8px 0 0 0;">View and analyze performance reports submitted by managers.</p>
                        </div>
                        <button class="btn primary" onclick="loadAnalyticsReports()" style="display: flex; align-items: center; gap: 8px;">
                            <span>🔄</span> Refresh
                        </button>
                    </div>
                    <div id="analyticsReportsContainer" style="margin-top: 20px;">
                        <p class="muted">Loading reports...</p>
                    </div>
                </div>
            `;
            loadAnalyticsReports();
        } else {
            contentDiv.innerHTML = `<div class="card"><p class="muted">Access denied</p></div>`;
        }
    }
}

async function loadAdminDashboard() {
    const user = await apiCall('/auth/me');
    console.log('Admin dashboard loaded:', user);
}

async function loadManagerDashboard() {
    // load projects
    try {
        const projects = await apiCall('/projects');
        const projectList = document.getElementById('projectList');
        if (projectList) {
            projectList.innerHTML = projects.map(p => `
        <div class="stat-card project-card">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="project-icon">${p.icon || (p.name ? p.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase() : 'P')}</div>
            <div style="flex:1">
              <div class="label">${p.name}</div>
              <div class="muted" style="font-size:13px">${p.description ? (p.description.substring(0,80) + '...') : ''}</div>
            </div>
            <div style="text-align:right">
              <button class="btn" onclick="remindProject('${p._id}', '${escape(p.name)}')">Remind Team</button>
            </div>
          </div>
        </div>
      `).join('') || '<p>No projects yet</p>';
        }

        // load pending timesheets for team overview
        const pending = await apiCall('/timesheets/pending');
        const pendingSection = document.getElementById('pendingSection');
        if (pendingSection) {
            pendingSection.innerHTML = (pending.length ? pending.map(ts => `
        <div class="card">
          <p><strong>${ts.employee?.name}</strong> | ${ts.date} | ${ts.totalHours} hrs</p>
          <div>
            <button class="btn" onclick="approveTimesheet('${ts._id}', true)">Approve</button>
            <button class="btn" onclick="approveTimesheet('${ts._id}', false)">Reject</button>
            <button class="btn" onclick="openMessageTo('${ts.employee?.email}')">Message</button>
          </div>
        </div>
      `).join('') : '<p>No pending timesheets</p>');
        }

        // load team members for this manager
        try {
            const team = await apiCall('/employees/team');
            const teamList = document.getElementById('teamList');
            if (teamList) {
                teamList.innerHTML = team.length ? team.map(m => `
          <div class="stat-card employee-card">
            <div style="display:flex;gap:12px;align-items:center">
              <img src="${m.photo || 'assets/images/avatar-placeholder.png'}" style="width:56px;height:56px;border-radius:8px;object-fit:cover" />
              <div style="flex:1">
                <div style="font-weight:700">${m.name}</div>
                <div class="muted" style="font-size:13px">${m.designation || ''} · ${m.department || ''}</div>
                <div class="muted" style="font-size:13px">${m.email}</div>
              </div>
              <div style="text-align:right">
                <button class="btn" onclick="openMessageTo('${m.email}')">Message</button>
                <button class="btn" onclick="window.location.href='profile.html'">View</button>
              </div>
            </div>
          </div>
        `).join('') : '<p class="muted">No team members assigned</p>';
            }
        } catch (err) {
            console.warn('Could not load team:', err);
        }

        // create a simple report: total hours per employee (from pending + recent timesheets)
        const recent = await apiCall('/timesheets/me'); // this returns current user timesheets; for manager we'll use pending employees
        // Aggregate using pending array (as demo)
        const map = {};
        pending.forEach(t => {
            const name = t.employee ? .name || 'Unknown';
            map[name] = (map[name] || 0) + (t.totalHours || 0);
        });
        const labels = Object.keys(map);
        const data = Object.values(map);

        // render chart
        const ctx = document.getElementById('reportChart');
        if (ctx && labels.length) {
            if (window.managerChart) window.managerChart.destroy();
            window.managerChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{ label: 'Pending Hours by Employee', data, backgroundColor: '#3B82F6' }]
                },
                options: { responsive: true, plugins: { legend: { display: false } } }
            });
        }

        // expose export function
        window.exportManagerReport = async function() {
            // build worksheet from pending
            const rows = pending.map(t => ({ Employee: t.employee ? .name || '', Date: t.date, Hours: t.totalHours, Status: t.status }));
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Pending');
            XLSX.writeFile(wb, 'manager_report.xlsx');
        };
    } catch (err) {
        console.error('Manager dashboard error', err);
    }
}

async function loadEmployeeDashboard() {
    const timesheets = await apiCall('/timesheets/me');
    const html = timesheets.slice(0, 5).map(ts => `
    <div class="card">
      <p><strong>${ts.date}</strong> | ${ts.totalHours} hours | <span class="badge ${ts.status}">${ts.status}</span></p>
    </div>
  `).join('');
    document.getElementById('employeeData').innerHTML = html || '<p>No timesheets yet</p>';
}

async function loadTimesheetHistory() {
    const timesheets = await apiCall('/timesheets/me');
    const html = `
    <table>
      <tr><th>Date</th><th>Start</th><th>End</th><th>Hours</th><th>Status</th></tr>
      ${timesheets.map(ts => `<tr><td>${ts.date}</td><td>${ts.startTime}</td><td>${ts.endTime}</td><td>${ts.totalHours}</td><td><span class="badge ${ts.status}">${ts.status}</span></td></tr>`).join('')}
    </table>
  `;
  document.getElementById('timesheetHistory').innerHTML = html || '<p>No timesheets</p>';
}

async function loadPendingTimesheets() {
  const timesheets = await apiCall('/timesheets/pending');
  const html = timesheets.map(ts => `
    <div class="card" style="margin-bottom: 12px; border-left: 4px solid #f59e0b;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
        <div>
          <p style="font-weight: 600; margin-bottom: 4px;">📄 ${ts.employee?.name || 'Unknown'}</p>
          <p class="muted" style="font-size: 13px;">${ts.date} | ${ts.totalHours || 0} hours</p>
          ${ts.task ? `<p class="muted" style="font-size: 12px; margin-top: 4px;">Task: <strong>${ts.task.title || 'Linked Task'}</strong></p>` : ''}
        </div>
        <span class="badge" style="background: #f59e0b; padding: 4px 12px; border-radius: 12px;">PENDING</span>
      </div>
      <p class="muted" style="font-size: 12px; margin-bottom: 12px;">${ts.description || 'No description'}</p>
      <div style="display: flex; gap: 8px;">
        <button class="btn" style="background: #10b981; flex: 1;" onclick="approveTimesheet('${ts._id}', true)">✅ Approve</button>
        <button class="btn" style="background: #ef4444; flex: 1;" onclick="approveTimesheet('${ts._id}', false)">❌ Reject</button>
        <button class="btn" onclick="showTimesheetDetails('${ts._id}')">📋 View</button>
      </div>
    </div>
  `).join('');
  document.getElementById('pendingData').innerHTML = html || '<p>No pending timesheets</p>';
}

async function approveTimesheet(id, approve) {
  const remarks = prompt('Add remarks (optional):');
  const result = await apiCall(`/timesheets/${id}/approve`, 'PUT', { approve, remarks });
  alert(approve ? '✅ Approved!' : '❌ Rejected!');
  loadPendingTimesheets();
}

function showTimesheetDetails(tsId) {
  alert('Opening timesheet details for: ' + tsId + '\n\n(Feature: Show full timesheet details in modal)');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  const user = getUser();
  if (!user.id) window.location.href = 'index.html';
  navigate('dashboard');
});

// send reminder to all team members for a project
async function remindProject(projectId, projectNameEscaped) {
  const projectName = unescape(projectNameEscaped);
  const defaultMsg = `Hi team, please share your project ideas or updates for ${projectName}.`;
  const message = prompt('Message to team:', defaultMsg);
  if (!message) return;
  try {
    const team = await apiCall('/employees/team');
    if (!team || !team.length) return alert('No team members to remind.');
    for (const member of team) {
      await apiCall('/feedback', 'POST', { to: member.email, subject: `Reminder: ${projectName}`, message });
    }
    alert('Reminders sent to team members');
  } catch (err) {
    console.error('Remind error', err);
    alert('Failed to send reminders');
  }
}

// open quick message composer to a single user by email
async function openMessageTo(email) {
  const message = prompt('Message to ' + email + ':', 'Hi, just a quick note regarding the project.');
  if (!message) return;
  try {
    await apiCall('/feedback', 'POST', { to: email, subject: 'Message from manager', message });
    alert('Message sent');
  } catch (err) {
    console.error('Send message error', err);
    alert('Failed to send message');
  }
}

// Send warning to employee
async function sendWarningToEmployee(email) {
  const message = prompt('Warning message to ' + email + ':', 'Please note: Your recent timesheet submission was late.');
  if (!message) return;
  try {
    await apiCall('/feedback', 'POST', { to: email, subject: '⚠️ WARNING: ' + (prompt('Warning type:', 'Late Submission')), message });
    alert('Warning sent');
  } catch (err) {
    console.error('Send warning error', err);
    alert('Failed to send warning');
  }
}

// Send meeting link to employee
async function sendMeetingLinkToEmployee(email) {
  const title = prompt('Meeting title:', 'Team Standup');
  if (!title) return;
  const link = prompt('Meeting link:', 'https://meet.google.com/');
  if (!link) return;
  const message = `You are invited to a meeting.\n\nTitle: ${title}\nLink: ${link}\n\nPlease join on time.`;
  try {
    await apiCall('/feedback', 'POST', { to: email, subject: '📅 Meeting Invite: ' + title, message });
    alert('Meeting invitation sent');
  } catch (err) {
    console.error('Send meeting error', err);
    alert('Failed to send meeting invitation');
  }
}

// Send feedback to employee
async function sendFeedbackToEmployee(email) {
  const subject = prompt('Feedback subject:', 'Performance feedback');
  if (!subject) return;
  const message = prompt('Feedback message:', 'Great work on the recent project!');
  if (!message) return;
  try {
    await apiCall('/feedback', 'POST', { to: email, subject: '💬 ' + subject, message });
    alert('Feedback sent');
  } catch (err) {
    console.error('Send feedback error', err);
    alert('Failed to send feedback');
  }
}

// ===== ANALYTICS REPORTS FROM MANAGERS =====
async function loadAnalyticsReports() {
    try {
        console.log('📊 Loading analytics reports from managers...');
        const reports = await apiCall('/analytics-report/admin/all');
        console.log('📊 Reports received:', reports);
        
        const container = document.getElementById('analyticsReportsContainer');
        
        if (!container) {
            console.error('❌ analyticsReportsContainer element not found');
            return;
        }
        
        if (!reports || reports.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; color: white;">
                    <div style="font-size: 64px; margin-bottom: 20px;">📊</div>
                    <h3 style="margin-bottom: 15px;">No Reports Available Yet</h3>
                    <p style="opacity: 0.9; max-width: 500px; margin: 0 auto;">
                        Managers haven't sent any analytics reports yet. 
                        Reports will appear here once managers generate and send them from their dashboard.
                    </p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = `
            <div style="display: grid; gap: 20px;">
                ${reports.map(report => `
                    <div class="stat-card" style="padding: 20px; border-left: 4px solid ${report.status === 'downloaded' ? '#10b981' : report.status === 'viewed' ? '#3b82f6' : '#f59e0b'};">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                            <div style="flex: 1;">
                                <h3 style="margin: 0 0 8px 0; color: #1f2937;">${report.title}</h3>
                                <p class="muted" style="font-size: 14px; margin: 0;">${report.description || 'No description'}</p>
                            </div>
                            <div style="text-align: right;">
                                <span class="badge" style="background: ${report.status === 'downloaded' ? '#10b981' : report.status === 'viewed' ? '#3b82f6' : '#f59e0b'}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">
                                    ${report.status === 'downloaded' ? '💾 Downloaded' : report.status === 'viewed' ? '👀 Viewed' : '📤 New'}
                                </span>
                            </div>
                        </div>
                        
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 15px 0; padding: 15px; background: rgba(0,0,0,0.02); border-radius: 8px;">
                            <div>
                                <div class="label" style="font-size: 12px; color: #6b7280;">Manager</div>
                                <div style="font-weight: 600;">${report.manager?.name || 'Unknown'}</div>
                                <div class="muted" style="font-size: 11px;">${report.manager?.department || ''}</div>
                            </div>
                            <div>
                                <div class="label" style="font-size: 12px; color: #6b7280;">Date Range</div>
                                <div style="font-weight: 600;">${new Date(report.dateRange.startDate).toLocaleDateString()}</div>
                                <div class="muted" style="font-size: 11px;">to ${new Date(report.dateRange.endDate).toLocaleDateString()}</div>
                            </div>
                            <div>
                                <div class="label" style="font-size: 12px; color: #6b7280;">Sent At</div>
                                <div style="font-weight: 600;">${new Date(report.sentAt).toLocaleDateString()}</div>
                                <div class="muted" style="font-size: 11px;">${new Date(report.sentAt).toLocaleTimeString()}</div>
                            </div>
                        </div>
                        
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <button class="btn primary" onclick="viewAdminReport('${report._id}')" style="flex: 1;">
                                📊 View Full Report
                            </button>
                            <button class="btn" onclick="downloadAdminReport('${report._id}')" style="flex: 1;">
                                💾 Download
                            </button>
                            <button class="btn" onclick="openFeedbackModal('${report._id}')" style="background: #f59e0b; color: white;">
                                💬 Add Feedback
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
    } catch (err) {
        console.error('❌ Load analytics reports error:', err);
        console.error('Error details:', err.message, err.stack);
        const container = document.getElementById('analyticsReportsContainer');
        if (container) {
            container.innerHTML = 
                `<p style="color: #ef4444; text-align: center; padding: 40px;">
                    Failed to load reports<br>
                    <small style="color: #6b7280;">${err.message || 'Unknown error'}</small>
                </p>`;
        }
    }
}

async function viewAdminReport(reportId) {
    try {
        const report = await apiCall(`/analytics-report/admin/view/${reportId}`);
        
        // Create modal for viewing report
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content card" style="width: 95%; max-width: 1200px; max-height: 90vh; overflow-y: auto;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #e5e7eb;">
                    <h2 style="margin: 0;">📊 ${report.title}</h2>
                    <button class="btn" onclick="this.closest('.modal').remove()" style="width: 40px; height: 40px; padding: 0;">✕</button>
                </div>
                
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
                        <div>
                            <div style="font-size: 13px; opacity: 0.9;">Manager</div>
                            <div style="font-size: 18px; font-weight: 700;">${report.manager.name}</div>
                            <div style="font-size: 12px; opacity: 0.8;">${report.manager.email}</div>
                        </div>
                        <div>
                            <div style="font-size: 13px; opacity: 0.9;">Date Range</div>
                            <div style="font-size: 18px; font-weight: 700;">${new Date(report.dateRange.startDate).toLocaleDateString()} - ${new Date(report.dateRange.endDate).toLocaleDateString()}</div>
                        </div>
                    </div>
                </div>
                
                <h3 style="margin-top: 30px; margin-bottom: 15px;">📈 Key Metrics</h3>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                        <div style="font-size: 32px; font-weight: bold;">${report.data.timesheets.total}</div>
                        <div style="font-size: 14px; opacity: 0.9;">Total Timesheets</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                        <div style="font-size: 32px; font-weight: bold;">${report.data.timesheets.totalHours.toFixed(1)}</div>
                        <div style="font-size: 14px; opacity: 0.9;">Total Hours</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                        <div style="font-size: 32px; font-weight: bold;">${report.data.tasks.completed}</div>
                        <div style="font-size: 14px; opacity: 0.9;">Tasks Completed</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                        <div style="font-size: 32px; font-weight: bold;">${report.data.attendance.presentDays}</div>
                        <div style="font-size: 14px; opacity: 0.9;">Present Days</div>
                    </div>
                </div>
                
                <h3 style="margin-bottom: 15px;">🏆 Top Performers</h3>
                <table class="data-table" style="width: 100%; margin-bottom: 30px;">
                    <thead>
                        <tr>
                            <th style="text-align: center; width: 60px;">Rank</th>
                            <th>Employee</th>
                            <th style="text-align: center;">Performance Score</th>
                            <th style="text-align: center;">Task Completion</th>
                            <th style="text-align: center;">Attendance Rate</th>
                            <th style="text-align: center;">Avg Hours/Day</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${report.data.rankings.topPerformers.slice(0, 10).map((p, idx) => `
                            <tr style="background: ${idx < 3 ? 'rgba(16, 185, 129, 0.1)' : 'transparent'};">
                                <td style="text-align: center; font-weight: bold; font-size: 18px;">
                                    ${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : (idx + 1)}
                                </td>
                                <td><strong>${p.name}</strong></td>
                                <td style="text-align: center;">
                                    <span style="background: #10b981; color: white; padding: 6px 12px; border-radius: 8px; font-weight: bold; font-size: 16px;">
                                        ${p.score}%
                                    </span>
                                </td>
                                <td style="text-align: center;">${p.metrics.taskCompletionRate}%</td>
                                <td style="text-align: center;">${p.metrics.attendanceRate}%</td>
                                <td style="text-align: center;">${p.metrics.avgHoursPerDay} hrs</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                ${report.data.rankings.needsImprovement.length > 0 ? `
                    <h3 style="margin-bottom: 15px; color: #ef4444;">⚠️ Needs Improvement</h3>
                    <table class="data-table" style="width: 100%; margin-bottom: 30px;">
                        <thead>
                            <tr>
                                <th>Employee</th>
                                <th>Issues Identified</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${report.data.rankings.needsImprovement.map(emp => `
                                <tr>
                                    <td><strong>${emp.name}</strong></td>
                                    <td>
                                        ${emp.issues.map(issue => 
                                            `<span style="background: #fef3c7; color: #92400e; padding: 4px 8px; border-radius: 6px; font-size: 12px; margin-right: 5px; display: inline-block; margin-bottom: 5px;">${issue}</span>`
                                        ).join('')}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : ''}
                
                <div style="display: flex; gap: 15px; margin-top: 30px; padding-top: 20px; border-top: 2px solid #e5e7eb;">
                    <button class="btn primary" onclick="downloadAdminReport('${report._id}')" style="flex: 1;">
                        💾 Download Report
                    </button>
                    <button class="btn" onclick="this.closest('.modal').remove()" style="flex: 1;">
                        Close
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
    } catch (err) {
        console.error('View report error:', err);
        alert('Failed to load report details');
    }
}

async function downloadAdminReport(reportId) {
    try {
        // Mark as downloaded
        await apiCall(`/analytics-report/admin/download/${reportId}`, 'POST');
        
        // Get report data
        const report = await apiCall(`/analytics-report/admin/view/${reportId}`);
        
        // Generate CSV content
        let csv = `Analytics Report: ${report.title}\n`;
        csv += `Manager: ${report.manager.name}\n`;
        csv += `Date Range: ${new Date(report.dateRange.startDate).toLocaleDateString()} - ${new Date(report.dateRange.endDate).toLocaleDateString()}\n\n`;
        
        csv += `TOP PERFORMERS\n`;
        csv += `Rank,Employee,Score,Task Completion,Attendance,Avg Hours/Day\n`;
        report.data.rankings.topPerformers.forEach((p, idx) => {
            csv += `${idx + 1},${p.name},${p.score}%,${p.metrics.taskCompletionRate}%,${p.metrics.attendanceRate}%,${p.metrics.avgHoursPerDay}\n`;
        });
        
        if (report.data.rankings.needsImprovement.length > 0) {
            csv += `\nNEEDS IMPROVEMENT\n`;
            csv += `Employee,Issues\n`;
            report.data.rankings.needsImprovement.forEach(emp => {
                csv += `${emp.name},"${emp.issues.join(', ')}"\n`;
            });
        }
        
        // Download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${report.title.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        
        alert('✅ Report downloaded successfully!');
        loadAnalyticsReports(); // Refresh the list
        
    } catch (err) {
        console.error('Download report error:', err);
        alert('Failed to download report');
    }
}

async function openFeedbackModal(reportId) {
    const notes = prompt('Enter your feedback/notes for this report:');
    const rating = prompt('Rate this report (1-5):', '5');
    
    if (!notes && !rating) return;
    
    try {
        await apiCall(`/analytics-report/admin/feedback/${reportId}`, 'PUT', {
            adminNotes: notes,
            adminRating: parseInt(rating)
        });
        
        alert('✅ Feedback added successfully!');
        loadAnalyticsReports();
        
    } catch (err) {
        console.error('Add feedback error:', err);
        alert('Failed to add feedback');
    }
}