const express = require('express');
const Task = require('../models/Task');
const Project = require('../models/Project');
const User = require('../models/User');
const { auth, permit } = require('../middleware/auth');

const router = express.Router();

// Get all tasks (with optional filters)
router.get('/', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const mongoose = require('mongoose');
        let query = {};

        // If employee, show only their assigned tasks
        if (req.user.role === 'employee') {
            query = { 'assignments.employee': req.user._id };
        }

        // Filter by project if provided
        if (req.query.projectId) {
            query.project = new mongoose.Types.ObjectId(req.query.projectId);
        }

        const tasks = await Task.find(query)
            .populate('project', 'name')
            .populate('assignments.employee', 'name email')
            .sort({ createdAt: -1 })
            .lean();

        res.json({ count: tasks.length, data: tasks });
    } catch (err) {
        console.error('Get tasks error:', err);
        res.status(500).json({ message: 'Failed to fetch tasks', error: err.message });
    }
});

// Manager creates a task for a project and assigns employees
router.post('/', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        console.log('\n📝 === TASK POST REQUEST START ===');
        console.log('📝 User:', req.user._id, req.user.name);
        console.log('📝 Body:', JSON.stringify(req.body, null, 2));

        const { title, description, project, assignees = [], deadline } = req.body;

        // Validate inputs exist
        if (!title || !project) {
            console.log('❌ Missing title or project');
            return res.status(400).json({ message: 'title and project required' });
        }

        // Convert project to ObjectId if it's a string
        const mongoose = require('mongoose');
        let projectId = project;
        if (typeof project === 'string') {
            projectId = new mongoose.Types.ObjectId(project);
        }

        // Verify project exists
        const proj = await Project.findById(projectId);
        console.log('🔍 Project lookup:', { projectId, found: !!proj, projectName: proj?.name });

        if (!proj) {
            console.log('❌ Project not found');
            return res.status(404).json({ message: 'Project not found' });
        }

        // Convert assignees to ObjectIds
        console.log('👥 Processing assignees:', assignees);
        let assigneeIds = assignees;
        if (Array.isArray(assignees) && assignees.length > 0) {
            assigneeIds = assignees.map(a => {
                try {
                    return typeof a === 'string' ? new mongoose.Types.ObjectId(a) : a;
                } catch (e) {
                    console.error('❌ Failed to convert assignee:', a, e.message);
                    throw e;
                }
            });
            console.log('👥 Converted assignee IDs:', assigneeIds);
        }

        // Create task
        const assignments = (assigneeIds || []).map(a => ({ employee: a, deadline }));
        console.log('📦 Creating task with:', { title, projectId, assignments: assignments.length, createdBy: req.user._id });

        const t = await Task.create({
            title,
            description,
            project: projectId,
            createdBy: req.user._id,
            assignments
        });
        console.log('✅ Task created:', t._id);
        console.log('✅ Task assignments stored:');
        assignments.forEach((a, i) => {
            console.log(`   Assignment ${i + 1}: employee=${a.employee} (type: ${typeof a.employee}), deadline=${a.deadline}`);
        });

        const populated = await Task.findById(t._id)
            .populate('assignments.employee', 'name email')
            .populate('project', 'name');

        console.log('✅ Task populated:', populated);
        res.status(201).json(populated);

    } catch (err) {
        console.error('❌ Task creation error:', err.message);
        console.error('❌ Stack:', err.stack);
        res.status(500).json({ message: 'Failed to create task: ' + err.message });
    }
});

// Manager can update task (e.g., change assignments or deadline)
router.put('/:id', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const t = await Task.findById(req.params.id);
        if (!t) return res.status(404).json({ message: 'Task not found' });

        // Admins can update any task
        if (req.user.role !== 'admin') {
            const proj = await Project.findById(t.project);
            if (!proj) return res.status(404).json({ message: 'Project not found' });
            if (String(proj.manager) !== String(req.user._id)) {
                return res.status(403).json({ message: 'Not allowed' });
            }
        }

        // allow partial updates: title, description, assignments, deadline
        const updates = req.body;
        if (updates.assignments) t.assignments = updates.assignments;
        if (updates.title) t.title = updates.title;
        if (updates.description) t.description = updates.description;
        await t.save();
        const populated = await Task.findById(t._id).populate('assignments.employee', 'name email');
        res.json(populated);
    } catch (err) {
        console.error('Task update error:', err);
        res.status(500).json({ message: 'Failed to update task', error: err.message });
    }
});

// Employee: get my assigned tasks
router.get('/mine', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const mongoose = require('mongoose');
        const userId = req.user && req.user._id ? String(req.user._id) : String(req.user);
        const userObjectId = new mongoose.Types.ObjectId(userId);

        console.log(`\n📋 [TASKS /mine] Request from user:`, userId);
        console.log(`📋 [TASKS /mine] Query: { 'assignments.employee': ${userObjectId} }`);

        // Query: find all tasks that have this user in assignments.employee
        const list = await Task.find({ 'assignments.employee': userObjectId })
            .populate('project', 'name')
            .populate('assignments.employee', 'name email')
            .lean();

        console.log(`📋 [TASKS /mine] Found ${list.length} task(s) for user ${userId}`);

        // Log each task for debugging
        list.forEach((task, idx) => {
            const assignmentForUser = task.assignments.find(a => String(a.employee) === userId);
            console.log(`  Task ${idx + 1}: ${task.title}`);
            console.log(`    - Assignments: ${task.assignments.map(a => String(a.employee)).join(', ')}`);
            if (assignmentForUser) {
                console.log(`    - ✅ User assigned with status: ${assignmentForUser.status}, progress: ${assignmentForUser.progress}%`);
            }
        });

        res.json(list);
    } catch (err) {
        console.error('❌ [TASKS /mine] Error:', err.message, err.stack);
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
});

// Get tasks for a project
router.get('/project/:projectId', auth, permit('manager', 'admin', 'employee'), async(req, res) => {
    try {
        const list = await Task.find({ project: req.params.projectId }).populate('assignments.employee', 'name email');
        res.json(list);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Employee updates their assignment progress
router.put('/:id/assignment/:empId', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const { id, empId } = req.params;
        const { progress, status } = req.body; // progress number 0-100, status in enum
        const t = await Task.findById(id);
        if (!t) return res.status(404).json({ message: 'Task not found' });
        const assignment = t.assignments.find(a => String(a.employee) === String(empId));
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
        // if requester is employee, ensure they update only their assignment
        if (req.user.role === 'employee' && String(req.user._id) !== String(empId)) return res.status(403).json({ message: 'Not allowed' });
        if (typeof progress === 'number') assignment.progress = Math.max(0, Math.min(100, progress));
        if (status) assignment.status = status;
        await t.save();
        const populated = await Task.findById(t._id).populate('assignments.employee', 'name email');
        res.json(populated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to update assignment' });
    }
});

// Employee submits task completion
router.post('/:id/complete', auth, permit('employee'), async(req, res) => {
    try {
        const { id } = req.params;
        const { workLogs, remarks } = req.body;
        const userId = String(req.user._id);

        const t = await Task.findById(id);
        if (!t) return res.status(404).json({ message: 'Task not found' });

        const assignment = t.assignments.find(a => String(a.employee) === userId);
        if (!assignment) return res.status(404).json({ message: 'Task not assigned to you' });

        // Update assignment status to submitted
        assignment.status = 'submitted';
        assignment.submittedAt = new Date();
        assignment.submittedData = {
            workLogs: workLogs || '',
            remarks: remarks || '',
            attachments: []
        };

        await t.save();

        // Create notification for manager
        const Notification = require('../models/Notification');
        const proj = await Project.findById(t.project);

        await Notification.create({
            user: proj.manager,
            type: 'task_completed',
            title: 'Task Completion Submitted',
            body: `${req.user.name} submitted completion for "${t.title}"`,
            meta: {
                taskId: t._id,
                taskTitle: t.title,
                employeeId: req.user._id,
                employeeName: req.user.name,
                submittedAt: assignment.submittedAt,
                remarks: remarks
            }
        });

        const populated = await Task.findById(t._id)
            .populate('assignments.employee', 'name email')
            .populate('project', 'name');

        res.status(201).json({ message: 'Task completion submitted', data: populated });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to submit task completion: ' + err.message });
    }
});

// Manager approves or rejects task completion
router.put('/:id/assignment/:empId/approve', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { id, empId } = req.params;
        const { action, comments } = req.body;

        if (!['approved', 'rejected'].includes(action)) {
            return res.status(400).json({ message: 'Action must be approved or rejected' });
        }

        const t = await Task.findById(id);
        if (!t) return res.status(404).json({ message: 'Task not found' });

        const proj = await Project.findById(t.project);
        if (req.user.role !== 'admin' && String(proj.manager) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not authorized to approve this task' });
        }

        const assignment = t.assignments.find(a => String(a.employee) === String(empId));
        if (!assignment) return res.status(404).json({ message: 'Assignment not found' });

        if (assignment.status !== 'submitted') {
            return res.status(400).json({ message: 'Task is not in submitted state' });
        }

        // Create approval record
        const TaskApproval = require('../models/TaskApproval');
        await TaskApproval.create({
            task: t._id,
            employee: empId,
            approver: req.user._id,
            action: action,
            comments: comments || '',
            approvalDate: new Date()
        });

        // Update task status
        assignment.status = action === 'approved' ? 'completed' : 'in_progress';
        await t.save();

        // Create notification for employee
        const Notification = require('../models/Notification');
        const employee = await User.findById(empId);

        await Notification.create({
            user: empId,
            type: action === 'approved' ? 'task_approved' : 'task_rejected',
            title: action === 'approved' ? 'Task Approved' : 'Task Rejected',
            body: action === 'approved' ?
                `Your task "${t.title}" has been approved` : `Your task "${t.title}" was rejected. Please review and resubmit.`,
            meta: {
                taskId: t._id,
                taskTitle: t.title,
                approverId: req.user._id,
                approverName: req.user.name,
                action: action,
                comments: comments,
                approvalDate: new Date()
            }
        });

        const populated = await Task.findById(t._id)
            .populate('assignments.employee', 'name email')
            .populate('project', 'name');

        res.json({
            message: `Task ${action}`,
            data: populated
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to approve task: ' + err.message });
    }
});

// Manager gets pending task completions for review
router.get('/completed/pending-review', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { filter = 'all' } = req.query;
        const managerId = String(req.user._id);

        // Get projects managed by this user (or all if admin)
        const projectQuery = req.user.role === 'admin' ? {} : { manager: managerId };
        const projects = await Project.find(projectQuery, '_id');
        const projectIds = projects.map(p => p._id);

        // Build date filter
        let dateFilter = {};
        const now = new Date();

        switch (filter) {
            case 'today':
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                dateFilter = { 'assignments.submittedAt': { $gte: startOfToday } };
                break;
            case 'week':
                const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                dateFilter = { 'assignments.submittedAt': { $gte: weekAgo } };
                break;
            case 'all':
            default:
                break;
        }

        // Find tasks with submitted assignments
        const tasks = await Task.find({
                project: { $in: projectIds },
                'assignments.status': 'submitted',
                ...dateFilter
            })
            .populate('assignments.employee', 'name email')
            .populate('project', 'name manager')
            .lean();

        // Filter to only include submitted assignments
        const result = tasks.map(task => ({
            ...task,
            assignments: task.assignments.filter(a => a.status === 'submitted')
        })).filter(task => task.assignments.length > 0);

        res.json({
            count: result.length,
            filter,
            data: result
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to fetch pending reviews: ' + err.message });
    }
});

module.exports = router;