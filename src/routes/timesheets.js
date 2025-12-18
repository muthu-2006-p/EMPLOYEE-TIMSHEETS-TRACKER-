const express = require('express');
const Timesheet = require('../models/Timesheet');
const User = require('../models/User');
const { auth, permit } = require('../middleware/auth');
const cacheManager = require('../utils/cache-manager');

const router = express.Router();

// Get all timesheets (with optional filters)
router.get('/', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        console.log(`🔍 GET /timesheets | Role: ${req.user.role} | ID: ${req.user._id}`);

        // 1. Try to get from cache
        const cacheContext = { query: req.query, role: req.user.role };
        const cachedData = cacheManager.getCachedResponse(req.user._id, 'GET_TIMESHEETS', cacheContext);

        if (cachedData && cachedData.payload) {
            console.log('⚡ Serving timesheets from cache');
            return res.json(cachedData.payload);
        }

        const mongoose = require('mongoose');
        let query = {};

        // If employee, show only their timesheets
        if (req.user.role === 'employee') {
            query.employee = req.user._id;
        }

        // If manager, show timesheets for their team members
        if (req.user.role === 'manager') {
            const Project = mongoose.model('Project');
            const Task = mongoose.model('Task');

            // Get projects managed by this manager
            const managerProjects = await Project.find({ manager: req.user._id });
            const projectIds = managerProjects.map(p => p._id);

            // Get tasks from these projects to find assigned employees
            const tasks = await Task.find({ project: { $in: projectIds } })
                .select('assignments.employee');

            // Extract unique employee IDs
            const employeeIds = new Set();
            tasks.forEach(task => {
                if (task.assignments && Array.isArray(task.assignments)) {
                    task.assignments.forEach(assignment => {
                        if (assignment.employee) {
                            employeeIds.add(assignment.employee.toString());
                        }
                    });
                }
            });

            // Only apply filter if manager has projects or employees
            // If no projects/employees are assigned, show all timesheets (manager can see all)
            const hasProjects = projectIds.length > 0;
            const hasEmployees = employeeIds.size > 0;

            if (hasProjects || hasEmployees) {
                // Show timesheets from these employees OR timesheets with manager's projects
                query.$or = [
                    { employee: { $in: Array.from(employeeIds).map(id => new mongoose.Types.ObjectId(id)) } },
                    { project: { $in: projectIds } }
                ];
            }
            // If no projects/employees, don't add any filter - manager can see all timesheets
            console.log(`📋 Manager query: ${hasProjects ? projectIds.length : 0} projects, ${hasEmployees ? employeeIds.size : 0} employees`);
        }

        // Filter by date range
        if (req.query.from || req.query.to) {
            query.date = {};
            if (req.query.from) query.date.$gte = new Date(req.query.from);
            if (req.query.to) query.date.$lte = new Date(req.query.to);
        }

        // Filter by project
        if (req.query.projectId) {
            if (!query.$or) {
                query.project = new mongoose.Types.ObjectId(req.query.projectId);
            } else {
                // If $or exists, add project filter to it
                query.$or = query.$or.map(condition => ({
                    ...condition,
                    project: new mongoose.Types.ObjectId(req.query.projectId)
                }));
            }
        }

        // Filter by status
        if (req.query.status) {
            query.status = req.query.status;
        }

        const timesheets = await Timesheet.find(query)
            .populate('employee', 'name email')
            .populate('project', 'name')
            .populate('task', 'title')
            .sort({ date: -1 })
            .lean();

        console.log(`✅ Found ${timesheets.length} timesheets | Query:`, JSON.stringify(query));


        const responsePayload = { count: timesheets.length, data: timesheets };

        // 2. Save to cache (include userId for invalidation)
        cacheManager.setCachedResponse(req.user._id, 'GET_TIMESHEETS', {
            userId: req.user._id,
            payload: responsePayload
        }, cacheContext);

        res.json(responsePayload);
    } catch (err) {
        console.error('Get timesheets error:', err);
        res.status(500).json({ message: 'Failed to fetch timesheets', error: err.message });
    }
});

// submit timesheet
router.post('/', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        const { date, startTime, endTime, breakMinutes = 0, description, project, task, isDraft = false } = req.body;
        if (!date || !startTime || !endTime) return res.status(400).json({ message: 'date/startTime/endTime required' });

        // Parse time strings properly
        const s = new Date(`${date}T${startTime}:00`);
        const e = new Date(`${date}T${endTime}:00`);

        // Validate dates
        if (isNaN(s.getTime()) || isNaN(e.getTime())) {
            return res.status(400).json({ message: 'Invalid date or time format' });
        }

        const diffMs = Math.max(0, e - s);
        const bm = Number(breakMinutes) || 0;
        const totalHours = Math.max(0, Math.round((diffMs / (1000 * 60 * 60) - (bm / 60)) * 100) / 100);

        // Validate: Single timesheet cannot exceed 24 hours
        if (totalHours > 24) {
            return res.status(400).json({ message: 'A single timesheet cannot exceed 24 hours. Please check start time, end time, and break duration.' });
        }

        // Validate: Total hours for the day cannot exceed 24
        const dayStart = new Date(date);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(date);
        dayEnd.setHours(23, 59, 59, 999);

        const existingTimesheets = await Timesheet.find({
            employee: req.user._id,
            date: { $gte: dayStart, $lte: dayEnd },
            status: { $ne: 'rejected' } // Don't count rejected timesheets
        });

        const existingDayTotal = existingTimesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
        const newDayTotal = existingDayTotal + totalHours;

        if (newDayTotal > 24) {
            return res.status(400).json({
                message: `Total hours for ${new Date(date).toLocaleDateString()} would be ${newDayTotal.toFixed(1)}h, exceeding 24 hours. Existing: ${existingDayTotal.toFixed(1)}h, New: ${totalHours.toFixed(1)}h.`
            });
        }

        const status = isDraft ? 'draft' : 'pending';
        const overtimeHours = Math.max(0, totalHours - 8);

        const ts = await Timesheet.create({
            employee: req.user._id,
            date: new Date(date),
            startTime,
            endTime,
            breakMinutes: bm,
            totalHours,
            description,
            project,
            task,
            status,
            overtimeHours
        });

        // Invalidate cache on new submission
        cacheManager.invalidateUserCache(req.user._id);

        res.status(201).json(ts);
    } catch (err) {
        console.error('Timesheet POST error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// UPDATE timesheet (save as draft or edit pending)
router.put('/:id', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        const { date, startTime, endTime, breakMinutes = 0, description, project, isDraft = false } = req.body;
        const ts = await Timesheet.findById(req.params.id);

        if (!ts) return res.status(404).json({ message: 'Timesheet not found' });
        if (String(ts.employee) !== String(req.user._id) && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Not allowed' });
        }

        // Only allow editing if pending or draft (unless admin)
        if (req.user.role !== 'admin' && !['pending', 'draft', 'rework_required'].includes(ts.status)) {
            return res.status(400).json({ message: 'Cannot edit timesheet after it has been approved or rejected' });
        }

        if (date && startTime && endTime) {
            const s = new Date(`${date}T${startTime}`);
            let e = new Date(`${date}T${endTime}`);
            if (e < s) e = new Date(e.getTime() + 24 * 60 * 60 * 1000);

            let diffMs = e - s;
            if (diffMs < 0) diffMs = 0;

            const bm = Number(breakMinutes) || 0;
            const hours = diffMs / (1000 * 60 * 60) - (bm / 60);
            const totalHours = Math.max(0, Math.round(hours * 100) / 100);

            // Validate: Single timesheet cannot exceed 24 hours
            if (totalHours > 24) {
                return res.status(400).json({ message: 'A single timesheet cannot exceed 24 hours. Please check start time, end time, and break duration.' });
            }

            // Validate: Total hours for the day cannot exceed 24
            const dayStart = new Date(date);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(date);
            dayEnd.setHours(23, 59, 59, 999);

            const existingTimesheets = await Timesheet.find({
                employee: ts.employee,
                date: { $gte: dayStart, $lte: dayEnd },
                status: { $ne: 'rejected' },
                _id: { $ne: ts._id } // Exclude current timesheet
            });

            const existingDayTotal = existingTimesheets.reduce((sum, t) => sum + (t.totalHours || 0), 0);
            const newDayTotal = existingDayTotal + totalHours;

            if (newDayTotal > 24) {
                return res.status(400).json({
                    message: `Total hours for ${new Date(date).toLocaleDateString()} would be ${newDayTotal.toFixed(1)}h, exceeding 24 hours. Other timesheets: ${existingDayTotal.toFixed(1)}h, This entry: ${totalHours.toFixed(1)}h.`
                });
            }

            ts.date = date;
            ts.startTime = startTime;
            ts.endTime = endTime;
            ts.breakMinutes = bm;
            ts.totalHours = totalHours;
            ts.overtimeHours = Math.max(0, Math.round(Math.max(0, totalHours - 8) * 100) / 100);
        }

        if (description) ts.description = description;
        if (project) ts.project = project;

        // If editing, and it was draft, keep it draft unless submitted. 
        // If it was pending, keep it pending.
        // If isDraft is strictly passed, update status.
        if (isDraft !== undefined) {
            ts.status = isDraft ? 'draft' : (ts.status === 'rework_required' ? 'pending' : ts.status);
        } else if (ts.status === 'rework_required') {
            // Use case: fixing rework, automatically set back to pending on save? 
            // Or keep as rework_required until explicit submit? 
            // Let's keep status unless isDraft flag changes it.
        }

        await ts.save();

        // Invalidate cache
        cacheManager.invalidateUserCache(req.user._id);

        res.json(ts);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// DELETE timesheet (cancel)
router.delete('/:id', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        const ts = await Timesheet.findById(req.params.id);
        if (!ts) return res.status(404).json({ message: 'Timesheet not found' });

        if (String(ts.employee) !== String(req.user._id) && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Not allowed' });
        }

        // Only allow deleting if pending or draft (unless admin)
        if (req.user.role !== 'admin' && !['pending', 'draft', 'rework_required'].includes(ts.status)) {
            return res.status(400).json({ message: 'Cannot delete timesheet after it has been approved or rejected' });
        }

        await Timesheet.deleteOne({ _id: req.params.id });

        // Invalidate cache
        cacheManager.invalidateUserCache(req.user._id);

        res.json({ message: 'Timesheet deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// SUBMIT draft timesheet (change status from draft to pending)
router.post('/:id/submit', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        const ts = await Timesheet.findById(req.params.id);
        if (!ts) return res.status(404).json({ message: 'Timesheet not found' });

        if (String(ts.employee) !== String(req.user._id) && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Not allowed' });
        }

        if (ts.status !== 'draft') {
            return res.status(400).json({ message: 'Only draft timesheets can be submitted' });
        }

        ts.status = 'pending';
        await ts.save();

        // Invalidate cache on submit
        cacheManager.invalidateUserCache(req.user._id);

        res.json(ts);
    } catch (err) {
        console.error('Submit error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});
// get my timesheets
router.get('/me', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        const list = await Timesheet.find({ employee: req.user._id }).sort({ date: -1 });
        res.json(list);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// get team timesheets (manager/admin)
router.get('/team/all', auth, permit('manager', 'admin'), async (req, res) => {
    try {
        const Project = require('../models/Project');
        // get all employees under this manager
        let team = await User.find({ manager: req.user._id });
        let teamIds = team.map(t => t._id);

        // fallback: if no direct manager relationship, get employees from projects
        if (!teamIds || teamIds.length === 0) {
            const projects = await Project.find({ manager: req.user._id }).populate('employees', '_id');
            const empMap = {};
            projects.forEach(p => {
                if (p.employees && Array.isArray(p.employees)) {
                    p.employees.forEach(e => {
                        if (e && e._id) empMap[String(e._id)] = e._id;
                    });
                }
            });
            teamIds = Object.values(empMap);
        }

        // get all their timesheets
        const list = await Timesheet.find({ employee: { $in: teamIds } }).populate('employee', 'name email').sort({ date: -1 });
        res.json(list);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// pending (manager/admin)
router.get('/pending', auth, permit('manager', 'admin'), async (req, res) => {
    try {
        let query = { status: 'pending' };

        // If manager, show timesheets for employees in their projects
        if (req.user.role === 'manager') {
            const mongoose = require('mongoose');
            const Project = mongoose.model('Project');
            const Task = mongoose.model('Task');

            // Get projects managed by this manager
            const managerProjects = await Project.find({ manager: req.user._id });
            const projectIds = managerProjects.map(p => p._id);

            // Get tasks from these projects to find assigned employees
            const tasks = await Task.find({ project: { $in: projectIds } })
                .select('assignments.employee');

            // Extract unique employee IDs
            const employeeIds = new Set();
            tasks.forEach(task => {
                if (task.assignments && Array.isArray(task.assignments)) {
                    task.assignments.forEach(assignment => {
                        if (assignment.employee) {
                            employeeIds.add(assignment.employee.toString());
                        }
                    });
                }
            });

            // Only apply filter if manager has projects or employees
            const hasProjects = projectIds.length > 0;
            const hasEmployees = employeeIds.size > 0;

            if (hasProjects || hasEmployees) {
                // Show timesheets from these employees OR timesheets with manager's projects
                query.$or = [
                    { employee: { $in: Array.from(employeeIds).map(id => new mongoose.Types.ObjectId(id)) } },
                    { project: { $in: projectIds } }
                ];
            }
            // If no projects/employees, don't add restriction - manager sees all pending
            console.log(`📋 Pending query: ${hasProjects ? projectIds.length : 0} projects, ${hasEmployees ? employeeIds.size : 0} employees`);
        }

        const list = await Timesheet.find(query)
            .populate('employee', 'name email')
            .populate('project', 'name')
            .populate('task', 'title')
            .sort({ date: -1 });
        res.json(list);
    } catch (err) {
        console.error('Get pending timesheets error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// approve/reject with multi-level workflow
router.put('/:id/approve', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { approve, remarks } = req.body;
        const ts = await Timesheet.findById(id);
        if (!ts) return res.status(404).json({ message: 'Timesheet not found' });

        // Simple approval: just change status
        ts.status = approve ? 'approved' : 'rejected';
        if (remarks) ts.managerRemarks = remarks;
        await ts.save();
        res.json(ts);
    } catch (err) {
        console.error('Approve error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
