// Admin Reports & Analytics
document.addEventListener('DOMContentLoaded', async() => {
    const user = getUser();
    // support both _id and id in stored user object
    if (!user || (!user._id && !user.id) || user.role !== 'admin') {
        return window.location.href = 'dashboard_admin.html';
    }

    try {
        await loadAdminReports();
    } catch (err) {
        console.error('Failed to load reports:', err);
    }
});

async function loadAdminReports() {
    try {
        // Fetch all timesheets
        const timesheets = await apiCall('/timesheets/me');
        const allUsers = await apiCall('/employees');

        if (!Array.isArray(timesheets) || !Array.isArray(allUsers)) {
            console.warn('Invalid response format for reports');
            return;
        }

        // Calculate metrics
        const totalUsers = allUsers.length;
        const employeeCount = allUsers.filter(u => u.role === 'employee').length;

        // Calculate efficiency
        let totalSubmitted = 0;
        let onTimeSubmissions = 0;

        timesheets.forEach(ts => {
            if (ts.status === 'approved') {
                totalSubmitted++;
                // Consider on-time if submitted/approved within a reasonable timeframe
                if (ts.status === 'approved') onTimeSubmissions++;
            }
        });

        const efficiency = totalUsers > 0 ? Math.round((employeeCount / totalUsers) * 100) : 0;
        const onTimeRate = totalSubmitted > 0 ? Math.round((onTimeSubmissions / totalSubmitted) * 100) : 0;

        // Calculate average hours per day from timesheets
        let totalHours = 0;
        timesheets.forEach(ts => {
            totalHours += ts.totalHours || 0;
        });
        const avgHoursPerDay = timesheets.length > 0 ? (totalHours / timesheets.length).toFixed(1) : 0;

        // Update UI
        const efficiencyEl = document.querySelector('[data-metric="efficiency"]');
        const avgHoursEl = document.querySelector('[data-metric="avgHours"]');
        const onTimeEl = document.querySelector('[data-metric="onTime"]');

        if (efficiencyEl) {
            efficiencyEl.textContent = `${efficiency}%`;
        }
        if (avgHoursEl) {
            avgHoursEl.textContent = `${avgHoursPerDay}h`;
        }
        if (onTimeEl) {
            onTimeEl.textContent = `${onTimeRate}%`;
        }

    } catch (err) {
        console.error('loadAdminReports error:', err);
    }
}