const express = require('express');
const router = express.Router();
const AnalyticsReport = require('../models/AnalyticsReport');
const Timesheet = require('../models/Timesheet');
const Task = require('../models/Task');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const User = require('../models/User');
const Project = require('../models/Project');
const { auth, permit } = require('../middleware/auth');

// ===== CREATE NEW ANALYTICS REPORT (Manager or Employee) =====
router.post('/create', auth, permit('manager', 'employee'), async (req, res) => {
    try {
        const { title, description, reportType, dateRange, filters, data } = req.body;

        console.log('📊 Creating analytics report by:', req.user.role, req.user._id);
        console.log('📊 Report data received:', data ? 'Yes' : 'No');
        console.log('📊 Data keys:', data ? Object.keys(data) : 'None');

        // Validate date range
        const startDate = new Date(dateRange.startDate);
        const endDate = new Date(dateRange.endDate);

        if (startDate > endDate) {
            return res.status(400).json({ message: 'Start date must be before end date' });
        }

        // Create report with draft status and data if provided
        const report = new AnalyticsReport({
            title,
            description,
            manager: req.user._id, // Can be employee or manager
            reportType: reportType || 'team_performance',
            dateRange: { startDate, endDate },
            filters: filters || {},
            data: data || {},
            status: 'draft'
        });

        await report.save();

        console.log('✅ Report created with ID:', report._id);
        console.log('✅ Report has data:', !!report.data);

        res.json({
            message: 'Analytics report created successfully',
            reportId: report._id,
            report: report
        });

    } catch (err) {
        console.error('❌ Create analytics report error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GENERATE REPORT DATA (Manager) =====
router.post('/generate/:id', auth, permit('manager'), async (req, res) => {
    try {
        const report = await AnalyticsReport.findById(req.params.id);

        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }

        // Verify manager owns this report
        if (String(report.manager) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not authorized to generate this report' });
        }

        console.log('📊 Generating data for report:', report._id);

        const { startDate, endDate } = report.dateRange;

        // Build query filters
        const dateFilter = {
            createdAt: { $gte: startDate, $lte: endDate }
        };

        // Get employees under this manager
        const managedEmployees = await User.find({
            manager: req.user._id,
            role: 'employee'
        }).select('_id name');

        const employeeIds = managedEmployees.map(e => e._id);

        // ===== TIMESHEET ANALYTICS =====
        const timesheets = await Timesheet.find({
            employee: { $in: employeeIds },
            date: { $gte: startDate, $lte: endDate }
        }).populate('employee', 'name').populate('project', 'name').populate('task', 'name');

        const timesheetData = {
            total: timesheets.length,
            approved: timesheets.filter(t => t.status === 'approved' || t.status === 'approved_final').length,
            pending: timesheets.filter(t => t.status.includes('pending')).length,
            rejected: timesheets.filter(t => t.status === 'rejected').length,
            totalHours: timesheets.reduce((sum, t) => sum + (t.totalHours || 0), 0),
            byEmployee: [],
            byProject: [],
            byTask: []
        };

        // Group by employee
        const empMap = {};
        timesheets.forEach(ts => {
            const empId = String(ts.employee._id);
            if (!empMap[empId]) {
                empMap[empId] = {
                    employee: ts.employee._id,
                    name: ts.employee.name,
                    count: 0,
                    hours: 0
                };
            }
            empMap[empId].count++;
            empMap[empId].hours += (ts.totalHours || 0);
        });

        timesheetData.byEmployee = Object.values(empMap).map(e => ({
            ...e,
            avgHoursPerDay: e.count > 0 ? (e.hours / e.count).toFixed(2) : 0
        })).sort((a, b) => b.hours - a.hours);

        // Group by project
        const projMap = {};
        timesheets.forEach(ts => {
            if (ts.project) {
                const projId = String(ts.project._id);
                if (!projMap[projId]) {
                    projMap[projId] = {
                        project: ts.project._id,
                        name: ts.project.name,
                        hours: 0
                    };
                }
                projMap[projId].hours += (ts.totalHours || 0);
            }
        });

        const totalProjectHours = Object.values(projMap).reduce((sum, p) => sum + p.hours, 0);
        timesheetData.byProject = Object.values(projMap).map(p => ({
            ...p,
            percentage: totalProjectHours > 0 ? ((p.hours / totalProjectHours) * 100).toFixed(1) : 0
        })).sort((a, b) => b.hours - a.hours);

        // Group by task
        const taskMap = {};
        timesheets.forEach(ts => {
            if (ts.task) {
                const taskId = String(ts.task._id);
                if (!taskMap[taskId]) {
                    taskMap[taskId] = {
                        task: ts.task._id,
                        name: ts.task.name,
                        hours: 0
                    };
                }
                taskMap[taskId].hours += (ts.totalHours || 0);
            }
        });

        timesheetData.byTask = Object.values(taskMap).sort((a, b) => b.hours - a.hours).slice(0, 10);

        // ===== TASK ANALYTICS =====
        const tasks = await Task.find({
            'assignments.employee': { $in: employeeIds },
            createdAt: { $gte: startDate, $lte: endDate }
        }).populate('assignments.employee', 'name');

        const taskData = {
            total: 0,
            completed: 0,
            inProgress: 0,
            pending: 0,
            byEmployee: []
        };

        const taskEmpMap = {};

        tasks.forEach(task => {
            task.assignments.forEach(assign => {
                if (employeeIds.some(id => String(id) === String(assign.employee._id))) {
                    taskData.total++;

                    const empId = String(assign.employee._id);
                    if (!taskEmpMap[empId]) {
                        taskEmpMap[empId] = {
                            employee: assign.employee._id,
                            name: assign.employee.name,
                            completed: 0,
                            inProgress: 0,
                            pending: 0
                        };
                    }

                    if (assign.status === 'completed') {
                        taskData.completed++;
                        taskEmpMap[empId].completed++;
                    } else if (assign.status === 'in_progress') {
                        taskData.inProgress++;
                        taskEmpMap[empId].inProgress++;
                    } else {
                        taskData.pending++;
                        taskEmpMap[empId].pending++;
                    }
                }
            });
        });

        taskData.byEmployee = Object.values(taskEmpMap).map(e => {
            const total = e.completed + e.inProgress + e.pending;
            return {
                ...e,
                completionRate: total > 0 ? ((e.completed / total) * 100).toFixed(1) : 0
            };
        }).sort((a, b) => b.completed - a.completed);

        // ===== ATTENDANCE ANALYTICS =====
        const attendance = await Attendance.find({
            employee: { $in: employeeIds },
            date: { $gte: startDate, $lte: endDate }
        }).populate('employee', 'name');

        const attendanceData = {
            totalDays: attendance.length,
            presentDays: attendance.filter(a => a.status === 'present' || a.status === 'late').length,
            absentDays: attendance.filter(a => a.status === 'absent').length,
            lateDays: attendance.filter(a => a.status === 'late').length,
            byEmployee: []
        };

        const attEmpMap = {};
        attendance.forEach(att => {
            const empId = String(att.employee._id);
            if (!attEmpMap[empId]) {
                attEmpMap[empId] = {
                    employee: att.employee._id,
                    name: att.employee.name,
                    present: 0,
                    absent: 0,
                    late: 0
                };
            }

            if (att.status === 'present') attEmpMap[empId].present++;
            else if (att.status === 'absent') attEmpMap[empId].absent++;
            else if (att.status === 'late') attEmpMap[empId].late++;
        });

        attendanceData.byEmployee = Object.values(attEmpMap).map(e => {
            const total = e.present + e.absent + e.late;
            return {
                ...e,
                attendanceRate: total > 0 ? (((e.present + e.late) / total) * 100).toFixed(1) : 0
            };
        }).sort((a, b) => b.attendanceRate - a.attendanceRate);

        // ===== LEAVE ANALYTICS =====
        const leaves = await LeaveRequest.find({
            employee: { $in: employeeIds },
            startDate: { $gte: startDate, $lte: endDate }
        }).populate('employee', 'name');

        const leaveData = {
            total: leaves.length,
            approved: leaves.filter(l => l.status === 'approved').length,
            pending: leaves.filter(l => l.status === 'pending').length,
            rejected: leaves.filter(l => l.status === 'rejected').length,
            byEmployee: [],
            byType: []
        };

        const leaveEmpMap = {};
        const leaveTypeMap = {};

        leaves.forEach(leave => {
            const empId = String(leave.employee._id);
            if (!leaveEmpMap[empId]) {
                leaveEmpMap[empId] = {
                    employee: leave.employee._id,
                    name: leave.employee.name,
                    count: 0,
                    days: 0
                };
            }
            leaveEmpMap[empId].count++;

            const days = Math.ceil((new Date(leave.endDate) - new Date(leave.startDate)) / (1000 * 60 * 60 * 24)) + 1;
            leaveEmpMap[empId].days += days;

            if (!leaveTypeMap[leave.leaveType]) {
                leaveTypeMap[leave.leaveType] = 0;
            }
            leaveTypeMap[leave.leaveType]++;
        });

        leaveData.byEmployee = Object.values(leaveEmpMap).sort((a, b) => b.days - a.days);
        leaveData.byType = Object.entries(leaveTypeMap).map(([type, count]) => ({ type, count }));

        // ===== PERFORMANCE RANKINGS =====
        const rankings = {
            topPerformers: [],
            needsImprovement: []
        };

        // Calculate performance scores
        const performanceScores = managedEmployees.map(emp => {
            const empId = String(emp._id);

            const tsData = timesheetData.byEmployee.find(e => String(e.employee) === empId);
            const taskDataEmp = taskData.byEmployee.find(e => String(e.employee) === empId);
            const attData = attendanceData.byEmployee.find(e => String(e.employee) === empId);

            const taskCompletionRate = taskDataEmp ? parseFloat(taskDataEmp.completionRate) : 0;
            const attendanceRate = attData ? parseFloat(attData.attendanceRate) : 0;
            const totalHours = tsData ? tsData.hours : 0;
            const avgHoursPerDay = tsData ? parseFloat(tsData.avgHoursPerDay) : 0;

            // Calculate weighted score (0-100)
            const score = (
                (taskCompletionRate * 0.4) +
                (attendanceRate * 0.3) +
                (Math.min(avgHoursPerDay / 8 * 100, 100) * 0.3)
            ).toFixed(1);

            return {
                employee: emp._id,
                name: emp.name,
                score: parseFloat(score),
                metrics: {
                    taskCompletionRate,
                    attendanceRate,
                    totalHours,
                    avgHoursPerDay
                }
            };
        });

        // Top performers (score >= 70)
        rankings.topPerformers = performanceScores
            .filter(p => p.score >= 70)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

        // Needs improvement (score < 50)
        rankings.needsImprovement = performanceScores
            .filter(p => p.score < 50)
            .map(p => {
                const issues = [];
                if (p.metrics.taskCompletionRate < 50) issues.push('Low task completion rate');
                if (p.metrics.attendanceRate < 80) issues.push('Poor attendance');
                if (p.metrics.avgHoursPerDay < 6) issues.push('Low work hours');
                return {
                    employee: p.employee,
                    name: p.name,
                    issues
                };
            })
            .sort((a, b) => b.issues.length - a.issues.length);

        // Update report with generated data
        report.data = {
            timesheets: timesheetData,
            tasks: taskData,
            attendance: attendanceData,
            leaves: leaveData,
            rankings
        };

        await report.save();

        console.log('✅ Report data generated successfully');

        res.json({
            message: 'Report data generated successfully',
            data: report.data
        });

    } catch (err) {
        console.error('❌ Generate report error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== SEND REPORT TO ADMIN (Manager) =====
router.post('/send/:id', auth, permit('manager', 'employee'), async (req, res) => {
    try {
        const report = await AnalyticsReport.findById(req.params.id);

        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }

        // Verify user owns this report
        if (String(report.manager) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not authorized to send this report' });
        }

        console.log('📤 Report being sent:', {
            id: report._id,
            title: report.title,
            type: report.reportType,
            hasData: !!report.data,
            dataKeys: report.data ? Object.keys(report.data) : []
        });

        // Update status
        report.status = 'sent';
        report.sentToAdmin = true;
        report.sentAt = new Date();

        await report.save();

        console.log('📤 Report sent to admin:', report._id);

        res.json({
            message: 'Report sent to admin successfully',
            report
        });

    } catch (err) {
        console.error('❌ Send report error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ALL MANAGER'S REPORTS (Manager) =====
router.get('/my-reports', auth, permit('manager'), async (req, res) => {
    try {
        const reports = await AnalyticsReport.find({ manager: req.user._id })
            .populate('manager', 'name email')
            .sort({ createdAt: -1 });

        res.json(reports);

    } catch (err) {
        console.error('❌ Get manager reports error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ALL REPORTS SENT TO ADMIN (Admin) =====
router.get('/admin/all', auth, permit('admin'), async (req, res) => {
    try {
        const reports = await AnalyticsReport.find({ sentToAdmin: true })
            .populate('manager', 'name email department')
            .sort({ sentAt: -1 });

        console.log(`📊 Found ${reports.length} reports sent to admin`);

        res.json(reports);

    } catch (err) {
        console.error('❌ Get admin reports error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== VIEW REPORT DETAILS (Admin & Manager) =====
router.get('/view/:id', auth, permit('admin', 'manager'), async (req, res) => {
    try {
        console.log('👀 Viewing report:', req.params.id, 'by user:', req.user.role);

        const report = await AnalyticsReport.findById(req.params.id)
            .populate('manager', 'name email department role');

        if (!report) {
            console.log('❌ Report not found:', req.params.id);
            return res.status(404).json({ message: 'Report not found' });
        }

        // Access Control
        if (req.user.role === 'manager' && String(report.manager._id) !== String(req.user._id)) {
            console.log('❌ IDs dont match:', report.manager._id, req.user._id);
            return res.status(403).json({ message: 'Not authorized to view this report' });
        }

        console.log('📊 Report found:', {
            id: report._id,
            title: report.title,
            type: report.reportType,
            manager: report.manager?.name,
            hasData: !!report.data,
            dataKeys: report.data ? Object.keys(report.data) : [],
            status: report.status
        });

        if (report.data) {
            console.log('📊 Report data structure:', JSON.stringify(report.data, null, 2).substring(0, 500));
        }

        // Mark as viewed ONLY if Admin
        if (req.user.role === 'admin' && !report.viewedByAdmin) {
            report.viewedByAdmin = true;
            report.viewedAt = new Date();
            if (report.status === 'sent') {
                report.status = 'viewed';
            }
            await report.save();
        }

        console.log('✅ Sending report data');

        res.json({ data: report });

    } catch (err) {
        console.error('❌ View report error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== MARK REPORT AS DOWNLOADED (Admin) =====
router.post('/admin/download/:id', auth, permit('admin'), async (req, res) => {
    try {
        const report = await AnalyticsReport.findById(req.params.id);

        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }

        report.downloadedByAdmin = true;
        report.downloadedAt = new Date();
        if (report.status !== 'downloaded') {
            report.status = 'downloaded';
        }

        await report.save();

        console.log('💾 Admin downloaded report:', report._id);

        res.json({ message: 'Report marked as downloaded' });

    } catch (err) {
        console.error('❌ Download report error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== ADD ADMIN NOTES/RATING (Admin) =====
router.put('/admin/feedback/:id', auth, permit('admin'), async (req, res) => {
    try {
        const { adminNotes, adminRating } = req.body;

        const report = await AnalyticsReport.findById(req.params.id);

        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }

        if (adminNotes) report.adminNotes = adminNotes;
        if (adminRating) report.adminRating = adminRating;

        await report.save();

        console.log('📝 Admin added feedback to report:', report._id);

        res.json({
            message: 'Feedback added successfully',
            report
        });

    } catch (err) {
        console.error('❌ Add feedback error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== DELETE REPORT (Manager) =====
router.delete('/:id', auth, permit('manager'), async (req, res) => {
    try {
        const report = await AnalyticsReport.findById(req.params.id);

        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }

        // Verify manager owns this report
        if (String(report.manager) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not authorized to delete this report' });
        }

        await report.deleteOne();

        console.log('🗑️ Report deleted:', req.params.id);

        res.json({ message: 'Report deleted successfully' });

    } catch (err) {
        console.error('❌ Delete report error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
