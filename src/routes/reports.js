const express = require('express');
const { auth, permit } = require('../middleware/auth');
const Timesheet = require('../models/Timesheet');
const Task = require('../models/Task');
const Project = require('../models/Project');
const User = require('../models/User');

const router = express.Router();

// ===== SUMMARY REPORT: Date range, employee, project filter =====
router.get('/summary', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const { startDate, endDate, employeeId, projectId } = req.query;

        const query = {};
        if (startDate && endDate) {
            query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }
        if (employeeId) query.employee = employeeId;
        if (projectId) query.project = projectId;

        const timesheets = await Timesheet.find(query)
            .populate('employee', 'name email department')
            .populate('project', 'name')
            .populate('task', 'title')
            .sort({ date: -1 });

        const summary = {
            totalTimesheets: timesheets.length,
            totalHours: timesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0),
            totalOvertimeHours: timesheets.reduce((sum, ts) => sum + (ts.overtimeHours || 0), 0),
            approved: timesheets.filter(ts => ts.status === 'approved').length,
            pending: timesheets.filter(ts => ts.status === 'pending').length,
            rejected: timesheets.filter(ts => ts.status === 'rejected').length,
            timesheets: timesheets
        };

        res.json(summary);
    } catch (e) {
        console.error('Failed to get report summary', e);
        res.status(500).json({ message: 'Server error', error: e.message });
    }
});

// ===== CHART 1: Timesheets by Project =====
router.get('/chart/by-project', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const result = await Timesheet.aggregate([
            { $match: {} },
            { $group: { _id: '$project', count: { $sum: 1 }, totalHours: { $sum: '$totalHours' } } },
            { $lookup: { from: 'projects', localField: '_id', foreignField: '_id', as: 'project' } },
            { $unwind: { path: '$project', preserveNullAndEmptyArrays: true } },
            { $project: { name: { $ifNull: ['$project.name', 'Unassigned'] }, count: 1, totalHours: 1 } }
        ]);

        res.json({ chart: 'by-project', data: result });
    } catch (e) {
        console.error('Failed to get project chart', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// ===== CHART 2: Timesheets by Task =====
router.get('/chart/by-task', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const result = await Timesheet.aggregate([
            { $match: { task: { $ne: null } } },
            { $group: { _id: '$task', count: { $sum: 1 }, totalHours: { $sum: '$totalHours' } } },
            { $lookup: { from: 'tasks', localField: '_id', foreignField: '_id', as: 'task' } },
            { $unwind: '$task' },
            { $project: { name: '$task.title', count: 1, totalHours: 1 } }
        ]);

        res.json({ chart: 'by-task', data: result });
    } catch (e) {
        console.error('Failed to get task chart', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// ===== CHART 3: Timesheets by Status =====
router.get('/chart/by-status', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const result = await Timesheet.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $project: { status: '$_id', count: 1, _id: 0 } }
        ]);

        res.json({ chart: 'by-status', data: result });
    } catch (e) {
        console.error('Failed to get status chart', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// ===== CHART 4: Hours per Day =====
router.get('/chart/hours-per-day', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const days = 30; // last 30 days
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const result = await Timesheet.aggregate([
            { $match: { date: { $gte: startDate } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, totalHours: { $sum: '$totalHours' }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        res.json({ chart: 'hours-per-day', period: `Last ${days} days`, data: result });
    } catch (e) {
        console.error('Failed to get hours per day chart', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// ===== CHART 5: Employee Utilization =====
router.get('/chart/employee-utilization', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const result = await Timesheet.aggregate([
            { $group: { _id: '$employee', totalHours: { $sum: '$totalHours' }, count: { $sum: 1 } } },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'employee' } },
            { $unwind: '$employee' },
            { $project: { name: '$employee.name', totalHours: 1, count: 1, utilization: { $round: [{ $divide: ['$totalHours', { $multiply: ['$count', 8] }] }, 2] } } },
            { $sort: { totalHours: -1 } }
        ]);

        res.json({ chart: 'employee-utilization', data: result });
    } catch (e) {
        console.error('Failed to get employee utilization chart', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// ===== GET: Timesheets grouped by Project =====
router.get('/by-project', auth, async(req, res) => {
    try {
        // Get all timesheets with task and employee info
        const timesheets = await Timesheet.find()
            .populate('task', 'title project')
            .populate('employee', 'name email department')
            .lean();

        // Group by project
        const byProject = {};
        timesheets.forEach(ts => {
            if (!ts.task || !ts.task.project) return;

            const projectId = ts.task.project.toString();
            if (!byProject[projectId]) {
                byProject[projectId] = {
                    projectId,
                    timesheets: []
                };
            }

            byProject[projectId].timesheets.push({
                _id: ts._id,
                date: ts.date,
                startTime: ts.startTime,
                endTime: ts.endTime,
                breakMinutes: ts.breakMinutes,
                totalHours: ts.totalHours,
                status: ts.status,
                description: ts.description,
                employee: ts.employee,
                taskTitle: ts.task.title,
                taskId: ts.task._id
            });
        });

        // Fetch project names and calculate stats
        const result = [];
        for (const [projectId, data] of Object.entries(byProject)) {
            const project = await Task.findOne({ project: projectId }).populate('project', 'name').lean();
            const projectName = project?.project?.name || 'Unknown Project';

            const totalHours = data.timesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
            const pending = data.timesheets.filter(ts => ts.status === 'pending').length;
            const approved = data.timesheets.filter(ts => ts.status === 'approved').length;
            const rejected = data.timesheets.filter(ts => ts.status === 'rejected').length;

            result.push({
                projectId,
                projectName,
                stats: {
                    totalTimesheets: data.timesheets.length,
                    totalHours,
                    pending,
                    approved,
                    rejected
                },
                timesheets: data.timesheets
            });
        }

        res.json(result);
    } catch (err) {
        console.error('Error fetching reports by project:', err);
        res.status(500).json({ message: 'Failed to fetch reports' });
    }
});

// ===== GET: Timesheets grouped by Task =====
router.get('/by-task', auth, async(req, res) => {
    try {
        // Get all timesheets with task and employee info
        const timesheets = await Timesheet.find()
            .populate('task', 'title description project')
            .populate('employee', 'name email department')
            .lean();

        // Group by task
        const byTask = {};
        timesheets.forEach(ts => {
            if (!ts.task) return;

            const taskId = ts.task._id.toString();
            if (!byTask[taskId]) {
                byTask[taskId] = {
                    taskId,
                    taskTitle: ts.task.title,
                    taskDescription: ts.task.description,
                    projectId: ts.task.project,
                    timesheets: []
                };
            }

            byTask[taskId].timesheets.push({
                _id: ts._id,
                date: ts.date,
                startTime: ts.startTime,
                endTime: ts.endTime,
                breakMinutes: ts.breakMinutes,
                totalHours: ts.totalHours,
                status: ts.status,
                description: ts.description,
                employee: ts.employee
            });
        });

        // Calculate stats for each task and fetch project names
        const result = [];
        for (const [taskId, data] of Object.entries(byTask)) {
            const project = await Task.findById(data.projectId).populate('project', 'name').lean();
            const projectName = project?.project?.name || 'Unknown Project';

            const totalHours = data.timesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
            const pending = data.timesheets.filter(ts => ts.status === 'pending').length;
            const approved = data.timesheets.filter(ts => ts.status === 'approved').length;
            const rejected = data.timesheets.filter(ts => ts.status === 'rejected').length;

            result.push({
                taskId,
                taskTitle: data.taskTitle,
                taskDescription: data.taskDescription,
                projectName,
                stats: {
                    totalTimesheets: data.timesheets.length,
                    totalHours,
                    pending,
                    approved,
                    rejected
                },
                timesheets: data.timesheets
            });
        }

        res.json(result);
    } catch (err) {
        console.error('Error fetching reports by task:', err);
        res.status(500).json({ message: 'Failed to fetch reports' });
    }
});

// ===== ADMIN ANALYTICS: Task Completion Metrics =====
router.get('/task-completions', auth, permit('admin', 'manager'), async(req, res) => {
    try {
        const { days = 30, projectId } = req.query;

        // Calculate date range
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        // Get all tasks with their assignments
        const taskQuery = {
            'assignments.submittedAt': { $gte: startDate }
        };

        if (projectId) {
            taskQuery.project = projectId;
        }

        // Manager can only see their own projects
        let projectIds = [];
        if (req.user.role === 'manager') {
            const projects = await Project.find({ manager: req.user._id }, '_id');
            projectIds = projects.map(p => p._id);
            taskQuery.project = { $in: projectIds };
        }

        const tasks = await Task.find(taskQuery)
            .populate('assignments.employee', 'name email department')
            .populate('project', 'name')
            .populate('createdBy', 'name')
            .lean();

        // Process and aggregate completion data
        const completedAssignments = [];
        const employeeMetrics = {};
        const projectMetrics = {};

        tasks.forEach(task => {
            const completedAssignmentsInTask = task.assignments.filter(a => a.status === 'completed' || a.status === 'submitted');

            completedAssignmentsInTask.forEach(assignment => {
                const empId = String(assignment.employee._id);
                const projId = String(task.project._id);

                // Track completed assignment
                completedAssignments.push({
                    taskId: task._id,
                    taskTitle: task.title,
                    employee: assignment.employee,
                    submittedAt: assignment.submittedAt,
                    remarks: assignment.submittedData?.remarks || '',
                    status: assignment.status,
                    project: task.project
                });

                // Employee metrics
                if (!employeeMetrics[empId]) {
                    employeeMetrics[empId] = {
                        employeeId: empId,
                        employeeName: assignment.employee.name,
                        email: assignment.employee.email,
                        department: assignment.employee.department,
                        totalTasks: 0,
                        completedTasks: 0,
                        submittedTasks: 0,
                        completionRate: 0
                    };
                }
                employeeMetrics[empId].totalTasks++;
                if (assignment.status === 'completed') {
                    employeeMetrics[empId].completedTasks++;
                } else if (assignment.status === 'submitted') {
                    employeeMetrics[empId].submittedTasks++;
                }

                // Project metrics
                if (!projectMetrics[projId]) {
                    projectMetrics[projId] = {
                        projectId: projId,
                        projectName: task.project.name,
                        totalTasks: 0,
                        completedTasks: 0,
                        submittedTasks: 0,
                        completionRate: 0,
                        employees: 0
                    };
                }
                projectMetrics[projId].totalTasks++;
                if (assignment.status === 'completed') {
                    projectMetrics[projId].completedTasks++;
                } else if (assignment.status === 'submitted') {
                    projectMetrics[projId].submittedTasks++;
                }
            });
        });

        // Calculate completion rates
        Object.values(employeeMetrics).forEach(emp => {
            emp.completionRate = emp.totalTasks > 0 ?
                Math.round((emp.completedTasks / emp.totalTasks) * 100) :
                0;
        });

        Object.values(projectMetrics).forEach(proj => {
            proj.completionRate = proj.totalTasks > 0 ?
                Math.round((proj.completedTasks / proj.totalTasks) * 100) :
                0;
        });

        // Summary statistics
        const totalTasksSubmitted = completedAssignments.length;
        const totalCompleted = completedAssignments.filter(a => a.status === 'completed').length;
        const totalPending = completedAssignments.filter(a => a.status === 'submitted').length;
        const overallCompletionRate = totalTasksSubmitted > 0 ?
            Math.round((totalCompleted / totalTasksSubmitted) * 100) :
            0;

        res.json({
            summary: {
                period: `Last ${days} days`,
                totalTasksSubmitted,
                totalCompleted,
                totalPending,
                overallCompletionRate: `${overallCompletionRate}%`,
                uniqueEmployees: Object.keys(employeeMetrics).length,
                uniqueProjects: Object.keys(projectMetrics).length
            },
            byEmployee: Object.values(employeeMetrics).sort((a, b) => b.completionRate - a.completionRate),
            byProject: Object.values(projectMetrics).sort((a, b) => b.completionRate - a.completionRate),
            recentCompletions: completedAssignments
                .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
                .slice(0, 20)
        });
    } catch (err) {
        console.error('Error fetching task completion analytics:', err);
        res.status(500).json({ message: 'Failed to fetch analytics: ' + err.message });
    }
});

module.exports = router;