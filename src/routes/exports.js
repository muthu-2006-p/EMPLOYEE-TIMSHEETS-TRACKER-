const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const Timesheet = require('../models/Timesheet');
const Task = require('../models/Task');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const User = require('../models/User');
const { auth, permit } = require('../middleware/auth');

// Helper function to build query from filters
function buildQuery(filters) {
    const query = {};

    if (filters.employeeId) {
        query.employee = filters.employeeId;
    }

    if (filters.projectId) {
        query.project = filters.projectId;
    }

    if (filters.status) {
        query.status = filters.status;
    }

    if (filters.from && filters.to) {
        query.createdAt = {
            $gte: new Date(filters.from),
            $lte: new Date(filters.to)
        };
    }

    return query;
}

// ===== EXPORT TIMESHEETS AS CSV =====
router.get('/timesheets/csv', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const query = buildQuery(req.query);

        const timesheets = await Timesheet.find(query)
            .populate('employee', 'name email')
            .populate('project', 'name')
            .sort({ createdAt: -1 })
            .limit(5000);

        // Build CSV
        let csv = 'ID,Employee,Email,Project,Week Start,Week End,Total Hours,Status,Submitted At\n';

        timesheets.forEach(ts => {
            csv += `"${ts._id}","${ts.employee?.name || 'N/A'}","${ts.employee?.email || 'N/A'}","${ts.project?.name || 'N/A'}","${ts.weekStart}","${ts.weekEnd}","${ts.totalHours || 0}","${ts.status}","${ts.submittedAt || 'N/A'}"\n`;
        });

        const filename = `timesheets_${Date.now()}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);

    } catch (err) {
        console.error('Export timesheets CSV error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EXPORT TIMESHEETS AS XLSX =====
router.get('/timesheets/xlsx', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const query = buildQuery(req.query);

        const timesheets = await Timesheet.find(query)
            .populate('employee', 'name email role')
            .populate('project', 'name')
            .sort({ createdAt: -1 })
            .limit(5000);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Timesheets');

        // Add headers
        worksheet.columns = [
            { header: 'ID', key: 'id', width: 25 },
            { header: 'Employee', key: 'employee', width: 25 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Role', key: 'role', width: 15 },
            { header: 'Project', key: 'project', width: 25 },
            { header: 'Week Start', key: 'weekStart', width: 15 },
            { header: 'Week End', key: 'weekEnd', width: 15 },
            { header: 'Total Hours', key: 'totalHours', width: 15 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Submitted At', key: 'submittedAt', width: 20 }
        ];

        // Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4A90E2' }
        };

        // Add data
        timesheets.forEach(ts => {
            worksheet.addRow({
                id: ts._id.toString(),
                employee: ts.employee ?.name || 'N/A',
                email: ts.employee ?.email || 'N/A',
                role: ts.employee ?.role || 'N/A',
                project: ts.project ?.name || 'N/A',
                weekStart: ts.weekStart ? new Date(ts.weekStart).toLocaleDateString() : 'N/A',
                weekEnd: ts.weekEnd ? new Date(ts.weekEnd).toLocaleDateString() : 'N/A',
                totalHours: ts.totalHours || 0,
                status: ts.status,
                submittedAt: ts.submittedAt ? new Date(ts.submittedAt).toLocaleString() : 'N/A'
            });
        });

        const filename = `timesheets_${Date.now()}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Export timesheets XLSX error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EXPORT PERFORMANCE DATA AS CSV =====
router.get('/performance/csv', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { employeeId, from, to } = req.query;

        const query = {};
        if (employeeId) {
            query['assignments.employee'] = employeeId;
        }

        if (from && to) {
            query.createdAt = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        }

        const tasks = await Task.find(query)
            .populate('assignments.employee', 'name email')
            .populate('project', 'name')
            .sort({ createdAt: -1 })
            .limit(5000);

        // Build CSV
        let csv = 'Task ID,Task Title,Project,Employee,Status,Progress,Deadline,Submitted At,Reviewed At,Defect Count\n';

        tasks.forEach(task => {
            task.assignments.forEach(assignment => {
                if (!employeeId || String(assignment.employee._id) === String(employeeId)) {
                    csv += `"${task._id}","${task.title}","${task.project?.name || 'N/A'}","${assignment.employee?.name || 'N/A'}","${assignment.status}","${assignment.progress || 0}%","${assignment.deadline || 'N/A'}","${assignment.submittedAt || 'N/A'}","${assignment.reviewCycle?.reviewedAt || 'N/A'}","${assignment.reviewCycle?.defectCount || 0}"\n`;
                }
            });
        });

        const filename = `performance_${Date.now()}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);

    } catch (err) {
        console.error('Export performance CSV error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EXPORT PERFORMANCE DATA AS XLSX =====
router.get('/performance/xlsx', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { employeeId, from, to } = req.query;

        const query = {};
        if (employeeId) {
            query['assignments.employee'] = employeeId;
        }

        if (from && to) {
            query.createdAt = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        }

        const tasks = await Task.find(query)
            .populate('assignments.employee', 'name email')
            .populate('assignments.reviewCycle.reviewedBy', 'name')
            .populate('project', 'name')
            .sort({ createdAt: -1 })
            .limit(5000);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Performance');

        worksheet.columns = [
            { header: 'Task ID', key: 'taskId', width: 25 },
            { header: 'Task Title', key: 'title', width: 30 },
            { header: 'Project', key: 'project', width: 25 },
            { header: 'Employee', key: 'employee', width: 25 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Status', key: 'status', width: 20 },
            { header: 'Progress', key: 'progress', width: 12 },
            { header: 'Priority', key: 'priority', width: 12 },
            { header: 'Deadline', key: 'deadline', width: 15 },
            { header: 'Submitted At', key: 'submittedAt', width: 20 },
            { header: 'Reviewed By', key: 'reviewedBy', width: 25 },
            { header: 'Reviewed At', key: 'reviewedAt', width: 20 },
            { header: 'Defect Count', key: 'defectCount', width: 15 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4A90E2' }
        };

        tasks.forEach(task => {
            task.assignments.forEach(assignment => {
                if (!employeeId || String(assignment.employee ?._id) === String(employeeId)) {
                    worksheet.addRow({
                        taskId: task._id.toString(),
                        title: task.title,
                        project: task.project ?.name || 'N/A',
                        employee: assignment.employee ?.name || 'N/A',
                        email: assignment.employee ?.email || 'N/A',
                        status: assignment.status,
                        progress: `${assignment.progress || 0}%`,
                        priority: task.priority || 'medium',
                        deadline: assignment.deadline ? new Date(assignment.deadline).toLocaleDateString() : 'N/A',
                        submittedAt: assignment.submittedAt ? new Date(assignment.submittedAt).toLocaleString() : 'N/A',
                        reviewedBy: assignment.reviewCycle ?.reviewedBy ?.name || 'N/A',
                        reviewedAt: assignment.reviewCycle ?.reviewedAt ? new Date(assignment.reviewCycle.reviewedAt).toLocaleString() : 'N/A',
                        defectCount: assignment.reviewCycle ?.defectCount || 0
                    });
                }
            });
        });

        const filename = `performance_${Date.now()}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Export performance XLSX error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EXPORT ATTENDANCE AS CSV =====
router.get('/attendance/csv', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { employeeId, from, to } = req.query;

        const query = {};
        if (employeeId) {
            query.employee = employeeId;
        }

        if (from && to) {
            query.date = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        }

        const records = await Attendance.find(query)
            .populate('employee', 'name email')
            .populate('project', 'name')
            .sort({ date: -1 })
            .limit(5000);

        let csv = 'Date,Employee,Email,Check In,Check Out,Total Hours,Overtime Hours,Late,Early,Location,Status\n';

        records.forEach(r => {
            csv += `"${new Date(r.date).toLocaleDateString()}","${r.employee?.name || 'N/A'}","${r.employee?.email || 'N/A'}","${r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString() : 'N/A'}","${r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString() : 'N/A'}","${r.totalHours || 0}","${r.overtimeHours || 0}","${r.isLate ? 'Yes' : 'No'}","${r.isEarly ? 'Yes' : 'No'}","${r.location || 'N/A'}","${r.status}"\n`;
        });

        const filename = `attendance_${Date.now()}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);

    } catch (err) {
        console.error('Export attendance CSV error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EXPORT ATTENDANCE AS XLSX =====
router.get('/attendance/xlsx', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { employeeId, from, to } = req.query;

        const query = {};
        if (employeeId) {
            query.employee = employeeId;
        }

        if (from && to) {
            query.date = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        }

        const records = await Attendance.find(query)
            .populate('employee', 'name email')
            .populate('project', 'name')
            .sort({ date: -1 })
            .limit(5000);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Attendance');

        worksheet.columns = [
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Employee', key: 'employee', width: 25 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Project', key: 'project', width: 25 },
            { header: 'Check In', key: 'checkIn', width: 20 },
            { header: 'Check Out', key: 'checkOut', width: 20 },
            { header: 'Total Hours', key: 'totalHours', width: 15 },
            { header: 'Overtime Hours', key: 'overtimeHours', width: 15 },
            { header: 'Late', key: 'isLate', width: 10 },
            { header: 'Early', key: 'isEarly', width: 10 },
            { header: 'Location', key: 'location', width: 15 },
            { header: 'Status', key: 'status', width: 20 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4A90E2' }
        };

        records.forEach(r => {
            worksheet.addRow({
                date: new Date(r.date).toLocaleDateString(),
                employee: r.employee ?.name || 'N/A',
                email: r.employee ?.email || 'N/A',
                project: r.project ?.name || 'N/A',
                checkIn: r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString() : 'N/A',
                checkOut: r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString() : 'N/A',
                totalHours: r.totalHours || 0,
                overtimeHours: r.overtimeHours || 0,
                isLate: r.isLate ? 'Yes' : 'No',
                isEarly: r.isEarly ? 'Yes' : 'No',
                location: r.location || 'N/A',
                status: r.status
            });
        });

        const filename = `attendance_${Date.now()}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Export attendance XLSX error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EXPORT LEAVE REQUESTS AS CSV =====
router.get('/leaves/csv', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { employeeId, status, from, to } = req.query;

        const query = {};
        if (employeeId) {
            query.employee = employeeId;
        }

        if (status) {
            query.status = status;
        }

        if (from && to) {
            query.fromDate = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        }

        const leaves = await LeaveRequest.find(query)
            .populate('employee', 'name email')
            .populate('approvedBy', 'name')
            .populate('rejectedBy', 'name')
            .sort({ appliedAt: -1 })
            .limit(5000);

        let csv = 'Employee,Email,Leave Type,From Date,To Date,Total Days,Permission Hours,Reason,Status,Applied At,Approved/Rejected By\n';

        leaves.forEach(l => {
            csv += `"${l.employee?.name || 'N/A'}","${l.employee?.email || 'N/A'}","${l.leaveType}","${new Date(l.fromDate).toLocaleDateString()}","${new Date(l.toDate).toLocaleDateString()}","${l.totalDays || 0}","${l.permissionHours || 'N/A'}","${l.reason}","${l.status}","${new Date(l.appliedAt).toLocaleString()}","${l.approvedBy?.name || l.rejectedBy?.name || 'N/A'}"\n`;
        });

        const filename = `leave_requests_${Date.now()}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);

    } catch (err) {
        console.error('Export leaves CSV error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EXPORT LEAVE REQUESTS AS XLSX =====
router.get('/leaves/xlsx', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { employeeId, status, from, to } = req.query;

        const query = {};
        if (employeeId) {
            query.employee = employeeId;
        }

        if (status) {
            query.status = status;
        }

        if (from && to) {
            query.fromDate = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        }

        const leaves = await LeaveRequest.find(query)
            .populate('employee', 'name email')
            .populate('approvedBy', 'name')
            .populate('rejectedBy', 'name')
            .sort({ appliedAt: -1 })
            .limit(5000);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Leave Requests');

        worksheet.columns = [
            { header: 'Employee', key: 'employee', width: 25 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Leave Type', key: 'leaveType', width: 15 },
            { header: 'From Date', key: 'fromDate', width: 15 },
            { header: 'To Date', key: 'toDate', width: 15 },
            { header: 'Total Days', key: 'totalDays', width: 12 },
            { header: 'Permission Hours', key: 'permissionHours', width: 18 },
            { header: 'Reason', key: 'reason', width: 40 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Applied At', key: 'appliedAt', width: 20 },
            { header: 'Approved/Rejected By', key: 'processedBy', width: 25 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4A90E2' }
        };

        leaves.forEach(l => {
            worksheet.addRow({
                employee: l.employee ?.name || 'N/A',
                email: l.employee ?.email || 'N/A',
                leaveType: l.leaveType,
                fromDate: new Date(l.fromDate).toLocaleDateString(),
                toDate: new Date(l.toDate).toLocaleDateString(),
                totalDays: l.totalDays || 0,
                permissionHours: l.permissionHours || 'N/A',
                reason: l.reason,
                status: l.status,
                appliedAt: new Date(l.appliedAt).toLocaleString(),
                processedBy: l.approvedBy ?.name || l.rejectedBy ?.name || 'Pending'
            });
        });

        const filename = `leave_requests_${Date.now()}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Export leaves XLSX error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
