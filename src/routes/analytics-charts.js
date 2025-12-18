const express = require('express');
const { auth, permit } = require('../middleware/auth');
const Timesheet = require('../models/Timesheet');
const Task = require('../models/Task');
const Project = require('../models/Project');
const User = require('../models/User');
const ProofSubmission = require('../models/ProofSubmission');
const mongoose = require('mongoose');

const router = express.Router();

// Helper: Parse date range
const getDateRange = (range) => {
    const today = new Date();
    let from, to;

    switch (range) {
        case 'today':
            from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
            break;
        case 'week':
            from = new Date(today);
            from.setDate(today.getDate() - today.getDay());
            to = new Date(from);
            to.setDate(from.getDate() + 7);
            break;
        case 'month':
            from = new Date(today.getFullYear(), today.getMonth(), 1);
            to = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            break;
        default:
            from = new Date(today);
            from.setMonth(from.getMonth() - 1);
            to = today;
    }

    return { from, to };
};

// 1. EMPLOYEE PRODUCTIVITY BAR CHART
router.get('/chart/productivity', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const { range = 'month', projectId } = req.query;
        const managerId = req.user._id;
        const { from, to } = getDateRange(range);

        let query = { date: { $gte: from, $lte: to } };

        if (req.user.role === 'manager') {
            const projects = await Project.find({ manager: managerId }, '_id');
            const projectIds = projects.map(p => p._id);
            query.project = { $in: projectIds };
        }

        if (projectId) {
            query.project = new mongoose.Types.ObjectId(projectId);
        }

        const timesheets = await Timesheet.find(query)
            .populate('employee', 'name email')
            .lean();

        // Aggregate by employee
        const byEmployee = {};
        timesheets.forEach(ts => {
            const empId = ts.employee._id.toString();
            if (!byEmployee[empId]) {
                byEmployee[empId] = {
                    name: ts.employee.name,
                    totalHours: 0
                };
            }
            byEmployee[empId].totalHours += ts.totalHours || 0;
        });

        const data = Object.values(byEmployee).map(e => ({
            name: e.name,
            hours: Math.round(e.totalHours * 10) / 10
        }));

        res.json({
            type: 'bar',
            title: 'Employee Productivity',
            data,
            range
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to fetch productivity data' });
    }
});

// 2. DAILY HOURS TREND LINE CHART
router.get('/chart/daily-trend', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const { employeeId, days = 30 } = req.query;

        if (!employeeId) {
            return res.status(400).json({ message: 'Employee ID required' });
        }

        const from = new Date();
        from.setDate(from.getDate() - parseInt(days));

        const timesheets = await Timesheet.find({
                employee: new mongoose.Types.ObjectId(employeeId),
                date: { $gte: from }
            })
            .sort({ date: 1 })
            .lean();

        // Aggregate by date
        const byDate = {};
        timesheets.forEach(ts => {
            const dateStr = new Date(ts.date).toLocaleDateString();
            if (!byDate[dateStr]) byDate[dateStr] = 0;
            byDate[dateStr] += ts.totalHours || 0;
        });

        const data = Object.entries(byDate).map(([date, hours]) => ({
            date,
            hours: Math.round(hours * 10) / 10
        }));

        res.json({
            type: 'line',
            title: 'Daily Hours Trend',
            data,
            days
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to fetch trend data' });
    }
});

// 3. TASK STATUS PIE CHART
router.get('/chart/task-status', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const { projectId, employeeId } = req.query;
        const managerId = req.user._id;

        let query = {};

        if (req.user.role === 'manager') {
            const projects = await Project.find({ manager: managerId }, '_id');
            const projectIds = projects.map(p => p._id);
            query.project = { $in: projectIds };
        }

        if (projectId) {
            query.project = new mongoose.Types.ObjectId(projectId);
        }

        const tasks = await Task.find(query).lean();

        const statusCounts = {
            completed: 0,
            'in_progress': 0,
            pending: 0,
            rejected: 0
        };

        tasks.forEach(task => {
            task.assignments.forEach(assignment => {
                if (employeeId && String(assignment.employee) !== employeeId) return;

                const status = assignment.status || 'pending';
                if (statusCounts.hasOwnProperty(status)) {
                    statusCounts[status]++;
                }
            });
        });

        const data = Object.entries(statusCounts).map(([status, count]) => ({
            name: status.replace('_', ' ').toUpperCase(),
            value: count
        }));

        res.json({
            type: 'pie',
            title: 'Task Status Distribution',
            data
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to fetch task status data' });
    }
});

// 4. OVERTIME ANALYSIS AREA CHART
router.get('/chart/overtime', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const { range = 'month', projectId } = req.query;
        const managerId = req.user._id;
        const { from, to } = getDateRange(range);

        let query = {
            date: { $gte: from, $lte: to },
            totalHours: { $gt: 8 } // Overtime threshold
        };

        if (req.user.role === 'manager') {
            const projects = await Project.find({ manager: managerId }, '_id');
            const projectIds = projects.map(p => p._id);
            query.project = { $in: projectIds };
        }

        if (projectId) {
            query.project = new mongoose.Types.ObjectId(projectId);
        }

        const overtime = await Timesheet.find(query)
            .populate('employee', 'name')
            .lean();

        // Aggregate by employee
        const byEmployee = {};
        overtime.forEach(ts => {
            const empId = ts.employee._id.toString();
            if (!byEmployee[empId]) {
                byEmployee[empId] = {
                    name: ts.employee.name,
                    overtimeHours: 0
                };
            }
            byEmployee[empId].overtimeHours += (ts.totalHours - 8);
        });

        const data = Object.values(byEmployee).map(e => ({
            name: e.name,
            overtime: Math.round(e.overtimeHours * 10) / 10
        }));

        res.json({
            type: 'area',
            title: 'Overtime Analysis',
            data,
            range
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to fetch overtime data' });
    }
});

// 5. TEAM PERFORMANCE COMPARISON CHART
router.get('/chart/team-performance', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const { range = 'month', projectId } = req.query;
        const managerId = req.user._id;
        const { from, to } = getDateRange(range);

        let projects = [];
        if (req.user.role === 'manager') {
            projects = await Project.find({ manager: managerId });
        } else {
            if (projectId) {
                projects = await Project.find({ _id: new mongoose.Types.ObjectId(projectId) });
            } else {
                projects = await Project.find({});
            }
        }

        const projectIds = projects.map(p => p._id);

        // Get timesheets
        const timesheets = await Timesheet.find({
            project: { $in: projectIds },
            date: { $gte: from, $lte: to }
        }).populate('employee', 'name').lean();

        // Get tasks
        const tasks = await Task.find({ project: { $in: projectIds } }).lean();

        // Aggregate
        const byEmployee = {};

        timesheets.forEach(ts => {
            const empId = ts.employee._id.toString();
            if (!byEmployee[empId]) {
                byEmployee[empId] = {
                    name: ts.employee.name,
                    totalHours: 0,
                    completedTasks: 0,
                    approvedProofs: 0
                };
            }
            byEmployee[empId].totalHours += ts.totalHours || 0;
        });

        tasks.forEach(task => {
            task.assignments.forEach(assignment => {
                const empId = assignment.employee.toString();
                if (!byEmployee[empId]) return;

                if (assignment.status === 'completed') {
                    byEmployee[empId].completedTasks++;
                }
            });
        });

        const data = Object.values(byEmployee).map(e => ({
            name: e.name,
            hours: Math.round(e.totalHours * 10) / 10,
            tasks: e.completedTasks,
            approvals: e.approvedProofs
        }));

        res.json({
            type: 'bar',
            title: 'Team Performance Comparison',
            data,
            range
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to fetch performance data' });
    }
});

// EXPORT: CSV
router.get('/export/csv', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { range = 'month', projectId, format = 'timesheets' } = req.query;
        const managerId = req.user._id;
        const { from, to } = getDateRange(range);

        let query = { date: { $gte: from, $lte: to } };

        if (req.user.role === 'manager') {
            const projects = await Project.find({ manager: managerId }, '_id');
            const projectIds = projects.map(p => p._id);
            query.project = { $in: projectIds };
        }

        if (projectId) {
            query.project = new mongoose.Types.ObjectId(projectId);
        }

        const timesheets = await Timesheet.find(query)
            .populate('employee', 'name email')
            .populate('project', 'name')
            .lean();

        // Generate CSV
        const headers = ['Date', 'Employee', 'Project', 'Hours', 'Status', 'Description'];
        const rows = timesheets.map(ts => [
            new Date(ts.date).toLocaleDateString(),
            ts.employee.name,
            ts.project.name,
            ts.totalHours,
            ts.status || 'draft',
            ts.description || ''
        ]);

        const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="timesheets_${Date.now()}.csv"`);
        res.send(csv);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to export CSV' });
    }
});

// EXPORT: XLSX
router.get('/export/xlsx', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const ExcelJS = require('exceljs');
        const { range = 'month', projectId } = req.query;
        const managerId = req.user._id;
        const { from, to } = getDateRange(range);

        let query = { date: { $gte: from, $lte: to } };

        if (req.user.role === 'manager') {
            const projects = await Project.find({ manager: managerId }, '_id');
            const projectIds = projects.map(p => p._id);
            query.project = { $in: projectIds };
        }

        if (projectId) {
            query.project = new mongoose.Types.ObjectId(projectId);
        }

        const timesheets = await Timesheet.find(query)
            .populate('employee', 'name email')
            .populate('project', 'name')
            .lean();

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Timesheets');

        worksheet.columns = [
            { header: 'Date', key: 'date', width: 12 },
            { header: 'Employee', key: 'employee', width: 20 },
            { header: 'Project', key: 'project', width: 20 },
            { header: 'Hours', key: 'hours', width: 10 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Description', key: 'description', width: 30 }
        ];

        timesheets.forEach(ts => {
            worksheet.addRow({
                date: new Date(ts.date).toLocaleDateString(),
                employee: ts.employee.name,
                project: ts.project.name,
                hours: ts.totalHours,
                status: ts.status || 'draft',
                description: ts.description || ''
            });
        });

        // Style headers
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="timesheets_${Date.now()}.xlsx"`);
        await workbook.xlsx.write(res);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to export XLSX' });
    }
});

module.exports = router;
