// Manager Reports & Analytics
let analyticsData = null;
let currentChart = null;

document.addEventListener('DOMContentLoaded', async() => {
    const user = getUser();
    // support both _id and id in stored user object
    if (!user || (!user._id && !user.id)) return window.location.href = 'index.html';

    // populate profile
    const navImg = document.getElementById('navPhoto');
    if (navImg && user.photo) navImg.src = user.photo;

    const profilePhoto = document.getElementById('mgrProfilePhoto3');
    if (profilePhoto && user.photo) profilePhoto.src = user.photo;

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value || ''; };
    setText('mgrProfileName3', user.name);
    setText('mgrProfileEmail3', user.email);
    setText('mgrProfileRole3', `Role: ${user.role}`);

    // load all data
    await loadAnalytics();
    await loadMeetings();
    await loadFeedback();

    // wire event handlers - add null checks
    const chartTypeEl = document.getElementById('chartType');
    if (chartTypeEl) chartTypeEl.addEventListener('change', renderChart);

    const downloadReportBtn = document.getElementById('downloadReportBtn');
    if (downloadReportBtn) downloadReportBtn.addEventListener('click', downloadReportXLSX);

    const addMeetingBtn = document.getElementById('addMeetingBtn');
    if (addMeetingBtn) addMeetingBtn.addEventListener('click', () => {
        const m = document.getElementById('addMeetingModal');
        if (m) m.style.display = 'flex';
        wireAttendeeSelection();
    });

    const meetingCancel = document.getElementById('meetingCancel');
    if (meetingCancel) meetingCancel.addEventListener('click', () => {
        const m = document.getElementById('addMeetingModal');
        if (m) m.style.display = 'none';
    });

    const meetingSave = document.getElementById('meetingSave');
    if (meetingSave) meetingSave.addEventListener('click', saveMeeting);

    const feedbackCancel = document.getElementById('feedbackCancel');
    if (feedbackCancel) feedbackCancel.addEventListener('click', () => {
        const f = document.getElementById('feedbackReplyModal');
        if (f) f.style.display = 'none';
    });

    const feedbackReplySend = document.getElementById('feedbackReplySend');
    if (feedbackReplySend) feedbackReplySend.addEventListener('click', sendFeedbackReply);
});

async function loadAnalytics() {
    try {
        // fetch timesheets for this manager's team
        const timesheets = await apiCall('/timesheets/team/all');
        const team = await apiCall('/employees/team');
        const projects = await apiCall('/projects');

        // Validate API responses
        if (!Array.isArray(timesheets) || !Array.isArray(team) || !Array.isArray(projects)) {
            console.error('Invalid API response format', { timesheets, team, projects });
            document.getElementById('totalEmployees').textContent = `Team: Error loading data`;
            document.getElementById('totalProjects').textContent = `Projects: Error loading data`;
            return;
        }

        document.getElementById('totalEmployees').textContent = `Team: ${team.length}`;
        document.getElementById('totalProjects').textContent = `Projects: ${projects.length}`;

        // If the manager has no team assigned (data inconsistency), fallback to building a team from projects they manage
        const currentUser = getUser();
        if ((!team || team.length === 0) && Array.isArray(projects) && projects.length > 0) {
            const fallback = {};
            projects.forEach(proj => {
                const mgrId = proj.manager && (proj.manager._id ? String(proj.manager._id) : String(proj.manager));
                if (mgrId && (mgrId === String(currentUser._id || currentUser.id))) {
                    // include employees from this project
                    (proj.employees || []).forEach(e => {
                        const id = e && (e._id ? String(e._id) : String(e));
                        if (id && !fallback[id]) fallback[id] = { _id: id, name: e.name || 'Unknown', email: e.email || '' };
                    });
                }
            });
            const fallbackArr = Object.values(fallback);
            if (fallbackArr.length) {
                console.warn('Team empty; using project-assigned employees as fallback team');
                team = fallbackArr;
                document.getElementById('totalEmployees').textContent = `Team (from projects): ${team.length}`;
            }
        }

        // build analytics: map employee -> { planned, actual }
        const analytics = {};
        team.forEach(emp => {
            analytics[String(emp._id)] = { name: emp.name, email: emp.email, planned: 0, actual: 0 };
        });

        // calculate planned hours from projects assigned to employees
        projects.forEach(proj => {
            const start = proj.startDate ? new Date(proj.startDate) : null;
            const end = proj.endDate ? new Date(proj.endDate) : null;
            const hoursPerEmployee = start && end ?
                Math.ceil((end - start) / (1000 * 60 * 60 * 24)) * 8 : 0; // days * 8 hrs/day
            if (proj.employees && proj.employees.length) {
                proj.employees.forEach(empRef => {
                    // empRef might be an object or id; normalize to string id
                    const empId = empRef && (empRef._id ? String(empRef._id) : String(empRef));
                    if (analytics[empId]) analytics[empId].planned += hoursPerEmployee;
                });
            }
        });

        // calculate actual hours from timesheets
        timesheets.forEach(ts => {
            const empId = ts.employee && ts.employee._id ? String(ts.employee._id) : String(ts.employee);
            if (analytics[empId]) {
                analytics[empId].actual += ts.totalHours || 0;
            }
        });

        analyticsData = analytics;
        renderAnalyticsTable();
        renderChart();
    } catch (err) {
        console.error('loadAnalytics error:', err);
        alert('Failed to load analytics. Check console for details.');
        document.getElementById('totalEmployees').textContent = `Team: Error`;
        document.getElementById('totalProjects').textContent = `Projects: Error`;
    }
}

function renderAnalyticsTable() {
    const tbody = document.getElementById('employeeTableBody');
    if (!tbody) return console.warn('employeeTableBody not found');
    if (!analyticsData) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">No data available</td></tr>';
        return;
    }

    const analyticsArray = Object.values(analyticsData);
    if (analyticsArray.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted">No employees in your team</td></tr>';
        return;
    }

    let html = '';
    let totalPlanned = 0,
        totalActual = 0;

    analyticsArray.forEach(emp => {
        const variance = emp.actual - emp.planned;
        const efficiency = emp.planned > 0 ? Math.round((emp.actual / emp.planned) * 100) : 0;
        html += `
      <tr>
        <td style="font-weight:700">${emp.name || 'Unknown'}</td>
        <td>${emp.planned}h</td>
        <td>${emp.actual}h</td>
        <td style="color:${variance < 0 ? '#6ee7b7' : '#f97316'}">${variance > 0 ? '+' : ''}${variance}h</td>
        <td>${efficiency}%</td>
      </tr>
    `;
        totalPlanned += emp.planned;
        totalActual += emp.actual;
    });

    // add total row
    const totalVariance = totalActual - totalPlanned;
    const totalEfficiency = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
    html += `
    <tr style="border-top:2px solid rgba(255,255,255,0.1);font-weight:700;background:rgba(59,130,246,0.05)">
      <td>TOTAL</td>
      <td>${totalPlanned}h</td>
      <td>${totalActual}h</td>
      <td style="color:${totalVariance < 0 ? '#6ee7b7' : '#f97316'}">${totalVariance > 0 ? '+' : ''}${totalVariance}h</td>
      <td>${totalEfficiency}%</td>
    </tr>
  `;

    tbody.innerHTML = html;
}

function renderChart() {
    const chartType = document.getElementById('chartType') ? .value || 'bar';
    const canvas = document.getElementById('analyticsChart');

    if (!canvas) {
        console.warn('analyticsChart canvas not found');
        return;
    }

    if (!analyticsData) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.fillStyle = 'rgba(230,238,248,0.9)';
        ctx.font = '16px system-ui, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No analytics data available', canvas.width / 2, canvas.height / 2);
        ctx.restore();
        return;
    }

    const analyticsArray = Object.values(analyticsData);
    if (analyticsArray.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.fillStyle = 'rgba(230,238,248,0.9)';
        ctx.font = '16px system-ui, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No employees in your team', canvas.width / 2, canvas.height / 2);
        ctx.restore();
        return;
    }

    const labels = analyticsArray.map(e => e.name || 'Unknown');
    const plannedData = analyticsArray.map(e => e.planned);
    const actualData = analyticsArray.map(e => e.actual);

    const ctx = canvas.getContext('2d');
    if (currentChart) currentChart.destroy();

    currentChart = new Chart(ctx, {
        type: chartType,
        data: {
            labels,
            datasets: [
                { label: 'Planned Hours', data: plannedData, backgroundColor: 'rgba(59,130,246,0.6)', borderColor: '#3B82F6', tension: 0.3 },
                { label: 'Actual Hours', data: actualData, backgroundColor: 'rgba(110,231,183,0.6)', borderColor: '#6EE7B7', tension: 0.3 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } } }
    });
}

function downloadReportXLSX() {
    if (!analyticsData) return alert('No analytics data to download');

    const analyticsArray = Object.values(analyticsData);
    if (analyticsArray.length === 0) return alert('No employee data available to download');

    if (typeof XLSX === 'undefined') {
        return alert('XLSX library not loaded. Please refresh the page.');
    }

    const rows = [];
    analyticsArray.forEach(emp => {
        const variance = emp.actual - emp.planned;
        const efficiency = emp.planned > 0 ? Math.round((emp.actual / emp.planned) * 100) : 0;
        rows.push({
            Employee: emp.name,
            Email: emp.email,
            'Planned Hours': emp.planned,
            'Actual Hours': emp.actual,
            'Variance (h)': variance,
            'Efficiency %': efficiency
        });
    });

    // add totals
    const totalPlanned = analyticsArray.reduce((sum, e) => sum + e.planned, 0);
    const totalActual = analyticsArray.reduce((sum, e) => sum + e.actual, 0);
    rows.push({
        Employee: 'TOTAL',
        Email: '',
        'Planned Hours': totalPlanned,
        'Actual Hours': totalActual,
        'Variance (h)': totalActual - totalPlanned,
        'Efficiency %': totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analytics');
    XLSX.writeFile(wb, `manager_analytics_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// Meetings Management
async function loadMeetings() {
    try {
        const meetingsList = document.getElementById('meetingsList');
        if (!meetingsList) {
            console.warn('meetingsList element not found');
            return;
        }
        // fetch meetings for this manager (stored as feedback with special type or separate endpoint)
        // for now, display empty and ready to add
        meetingsList.innerHTML = '<p class="muted">No meetings scheduled. Click "Add Meeting" to create one.</p>';
    } catch (err) {
        console.error('loadMeetings error:', err);
        const meetingsList = document.getElementById('meetingsList');
        if (meetingsList) {
            meetingsList.innerHTML = '<p class="muted" style="color:#f97316;">Failed to load meetings</p>';
        }
    }
}

async function wireAttendeeSelection() {
    const list = document.getElementById('meetingAttendeesList');
    if (!list) return;

    try {
        const team = await apiCall('/employees/team');
        list.innerHTML = '';
        if (!Array.isArray(team) || team.length === 0) {
            list.innerHTML = '<div class="muted">No team members available</div>';
            return;
        }

        team.forEach(emp => {
            const wrapper = document.createElement('label');
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '8px';
            wrapper.style.padding = '6px 4px';
            wrapper.style.cursor = 'pointer';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            // support both _id and id properties
            cb.value = emp._id || emp.id || (emp._id && emp._id.toString());
            cb.className = 'meeting-attendee-cb';
            const txt = document.createElement('div');
            txt.textContent = emp.name || emp.email || 'Unknown';
            wrapper.appendChild(cb);
            wrapper.appendChild(txt);
            list.appendChild(wrapper);
        });
    } catch (err) {
        console.error('wireAttendeeSelection error:', err);
    }
}

async function saveMeeting() {
    const title = document.getElementById('meetingTitle').value.trim();
    const link = document.getElementById('meetingLink').value.trim();
    let attendees = Array.from(document.querySelectorAll('.meeting-attendee-cb:checked')).map(cb => cb.value);

    if (!title || !link) return alert('Meeting title and link are required');

    try {
        // if no attendees explicitly selected, fallback to whole team
        if (!attendees || attendees.length === 0) {
            const team = await apiCall('/employees/team');
            if (Array.isArray(team) && team.length) {
                attendees = team.map(e => e._id || e.id);
            }
        }

        if (!attendees || attendees.length === 0) return alert('No attendees selected or available');

        // ensure link is a full URL
        const normalizedLink = link.startsWith('http://') || link.startsWith('https://') ? link : `https://${link}`;

        // send meeting link to attendees via feedback
        for (const attendeeId of attendees) {
            try {
                const attendee = await apiCall(`/employees/${attendeeId}`);
                const email = attendee && (attendee.email || attendee.emailAddress || attendee.emailId);
                if (email) {
                    await apiCall('/feedback', 'POST', {
                        to: email,
                        subject: `📅 Meeting Invite: ${title}`,
                        message: `You are invited to a team meeting.\n\nTitle: ${title}\nLink: ${normalizedLink}`
                    });
                }
            } catch (e) {
                console.warn('Failed to fetch/send to attendee', attendeeId, e);
            }
        }

        document.getElementById('addMeetingModal').style.display = 'none';
        document.getElementById('meetingTitle').value = '';
        document.getElementById('meetingLink').value = '';
        document.querySelectorAll('.meeting-attendee-cb').forEach(cb => cb.checked = false);

        // reload and show in meetings list
        await loadMeetings();
        alert('Meeting invitation sent to attendees');
    } catch (err) {
        console.error('saveMeeting error:', err);
        alert('Failed to send meeting invite');
    }
}

// Feedback Management
async function loadFeedback() {
    try {
        const feedback = await apiCall('/feedback/me');
        const feedbackList = document.getElementById('feedbackList');

        if (!feedbackList) {
            console.warn('feedbackList element not found');
            return;
        }

        if (!Array.isArray(feedback) || feedback.length === 0) {
            feedbackList.innerHTML = '<p class="muted">No feedback received yet.</p>';
            return;
        }

        let html = '';
        feedback.forEach(fb => {
            const fromName = fb.from ? .name || fb.from ? .email || 'Unknown';
            const fromEmail = fb.from ? .email || '';
            const subject = fb.subject || 'No subject';
            const message = fb.message || 'No message';

            html += `
        <div class="card" style="margin-bottom:12px;padding:12px">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <div style="flex:1">
              <div style="font-weight:700">${fromName}</div>
              <div class="muted" style="font-size:13px">${fromEmail}</div>
              <div style="margin-top:6px;font-weight:600">${subject}</div>
              <div style="margin-top:4px;color:#ccc;font-size:14px">${message}</div>
            </div>
            <button class="btn" onclick="openFeedbackReplyModal('${fb._id}', '${fromName}', '${subject}', '${message}')">Reply</button>
          </div>
        </div>
      `;
        });

        feedbackList.innerHTML = html;
    } catch (err) {
        console.error('loadFeedback error:', err);
        const feedbackList = document.getElementById('feedbackList');
        if (feedbackList) {
            feedbackList.innerHTML = '<p class="muted" style="color:#f97316;">Failed to load feedback. Please try again.</p>';
        }
    }
}

function openFeedbackReplyModal(feedbackId, fromName, subject, message) {
    document.getElementById('feedbackFrom').textContent = `From: ${fromName}`;
    document.getElementById('feedbackSubject').textContent = subject;
    document.getElementById('feedbackMessage').textContent = message;
    document.getElementById('replyMessage').value = '';
    document.getElementById('replyMessage').dataset.feedbackId = feedbackId;
    document.getElementById('feedbackReplyModal').style.display = 'block';
}

async function sendFeedbackReply() {
    const feedbackId = document.getElementById('replyMessage').dataset.feedbackId;
    const replyMsg = document.getElementById('replyMessage').value.trim();

    if (!replyMsg) return alert('Please enter a reply message');

    try {
        // send reply back (create feedback response)
        await apiCall('/feedback', 'POST', {
            to: 'feedback-reply', // placeholder
            subject: `Re: ${document.getElementById('feedbackSubject').textContent}`,
            message: replyMsg
        });

        document.getElementById('feedbackReplyModal').style.display = 'none';
        document.getElementById('replyMessage').value = '';
        await loadFeedback();
        alert('Reply sent');
    } catch (err) {
        console.error('sendFeedbackReply error:', err);
        alert('Failed to send reply');
    }
}