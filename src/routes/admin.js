const express = require('express');
const Holiday = require('../models/Holiday');
const User = require('../models/User');
const Project = require('../models/Project');
const Task = require('../models/Task');
const { auth, permit } = require('../middleware/auth');

const router = express.Router();

// ===== EMPLOYEE MANAGEMENT =====

// GET all employees
router.get('/employees', auth, permit('admin', 'manager'), async(req, res) => {
    try {
        const employees = await User.find({ role: { $in: ['employee', 'manager'] } })
            .select('_id name email role department designation isActive')
            .sort({ name: 1 });
        res.json(employees);
    } catch (e) {
        console.error('Failed to list employees', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET single employee
router.get('/employees/:id', auth, permit('admin'), async(req, res) => {
    try {
        const emp = await User.findById(req.params.id)
            .select('_id name email role department designation isActive photo');
        if (!emp) return res.status(404).json({ message: 'Employee not found' });
        res.json(emp);
    } catch (e) {
        console.error('Failed to get employee', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// CREATE employee
router.post('/employees', auth, permit('admin'), async(req, res) => {
    try {
        const { name, email, password, role, department, designation } = req.body;
        if (!name || !email || !password) return res.status(400).json({ message: 'name/email/password required' });

        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ message: 'Email already in use' });

        const bcrypt = require('bcrypt');
        const hashed = await bcrypt.hash(password, 10);

        // Auto-assign employee to default manager
        let manager = null;
        if (role === 'employee' || !role) {
            // Find default manager (mgr@ex.com) or any manager
            const defaultManager = await User.findOne({ role: 'manager' });
            if (defaultManager) {
                manager = defaultManager._id;
            }
        }

        const emp = await User.create({
            name,
            email,
            password: hashed,
            role: role || 'employee',
            department: department || '',
            designation: designation || '',
            manager: manager,
            isActive: true
        });

        res.status(201).json({ id: emp._id, name: emp.name, email: emp.email, role: emp.role, manager: emp.manager });
    } catch (e) {
        console.error('Failed to create employee', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// UPDATE employee (role, department, designation, isActive)
router.put('/employees/:id', auth, permit('admin'), async(req, res) => {
    try {
        const { role, department, designation, isActive } = req.body;
        const emp = await User.findByIdAndUpdate(
            req.params.id, { role, department, designation, isActive }, { new: true }
        ).select('_id name email role department designation isActive');

        if (!emp) return res.status(404).json({ message: 'Employee not found' });
        res.json(emp);
    } catch (e) {
        console.error('Failed to update employee', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// DELETE employee
router.delete('/employees/:id', auth, permit('admin'), async(req, res) => {
    try {
        const emp = await User.findByIdAndDelete(req.params.id);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });
        res.json({ message: 'Employee deleted' });
    } catch (e) {
        console.error('Failed to delete employee', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// ASSIGN employee to project
router.post('/employees/:empId/assign-project/:projectId', auth, permit('admin'), async(req, res) => {
    try {
        const { empId, projectId } = req.params;
        const project = await Project.findById(projectId);
        if (!project) return res.status(404).json({ message: 'Project not found' });

        const emp = await User.findById(empId);
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        if (!project.employees.includes(empId)) {
            project.employees.push(empId);
            await project.save();
        }

        res.json({ message: 'Employee assigned to project', project });
    } catch (e) {
        console.error('Failed to assign employee', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// ===== PROJECT MANAGEMENT =====

// GET all projects (admin view)
router.get('/projects', auth, permit('admin'), async(req, res) => {
    try {
        const projects = await Project.find()
            .populate('manager', 'name email')
            .populate('employees', 'name email designation')
            .sort({ createdAt: -1 });
        res.json(projects);
    } catch (e) {
        console.error('Failed to list projects', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET single project
router.get('/projects/:id', auth, permit('admin'), async(req, res) => {
    try {
        const project = await Project.findById(req.params.id)
            .populate('manager', 'name email')
            .populate('employees', 'name email');
        if (!project) return res.status(404).json({ message: 'Project not found' });
        res.json(project);
    } catch (e) {
        console.error('Failed to get project', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// CREATE project (admin override)
router.post('/projects', auth, permit('admin'), async(req, res) => {
    try {
        const { name, description, manager, employees } = req.body;
        if (!name) return res.status(400).json({ message: 'name required' });

        const project = await Project.create({
            name,
            description: description || '',
            manager: manager || req.user._id,
            employees: employees || []
        });

        await project.populate('manager', 'name email');
        res.status(201).json(project);
    } catch (e) {
        console.error('Failed to create project', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// UPDATE project
router.put('/projects/:id', auth, permit('admin'), async(req, res) => {
    try {
        const { name, description, manager, employees } = req.body;
        const project = await Project.findByIdAndUpdate(
            req.params.id, { name, description, manager, employees }, { new: true }
        ).populate('manager', 'name email').populate('employees', 'name email');

        if (!project) return res.status(404).json({ message: 'Project not found' });
        res.json(project);
    } catch (e) {
        console.error('Failed to update project', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// DELETE project
router.delete('/projects/:id', auth, permit('admin'), async(req, res) => {
    try {
        const project = await Project.findByIdAndDelete(req.params.id);
        if (!project) return res.status(404).json({ message: 'Project not found' });

        // clean up tasks
        await Task.deleteMany({ project: req.params.id });
        res.json({ message: 'Project deleted' });
    } catch (e) {
        console.error('Failed to delete project', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// ASSIGN employee to project
router.post('/projects/:id/assign-employee', auth, permit('admin'), async(req, res) => {
    try {
        const { employee } = req.body;
        const project = await Project.findById(req.params.id);
        if (!project) return res.status(404).json({ message: 'Project not found' });

        // Find employee by email
        const emp = await User.findOne({ email: employee });
        if (!emp) return res.status(404).json({ message: 'Employee not found' });

        if (!project.employees.includes(emp._id)) {
            project.employees.push(emp._id);
            await project.save();
        }

        res.json({ message: 'Employee assigned to project' });
    } catch (e) {
        console.error('Failed to assign employee', e);
        res.status(500).json({ message: 'Server error', error: e.message });
    }
});

// ===== TASK MANAGEMENT =====

// GET all tasks (admin view)
router.get('/tasks', auth, permit('admin'), async(req, res) => {
    try {
        const tasks = await Task.find()
            .populate('project', 'name')
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });
        res.json(tasks);
    } catch (e) {
        console.error('Failed to list tasks', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET tasks by project
router.get('/tasks/project/:projectId', auth, permit('admin'), async(req, res) => {
    try {
        const tasks = await Task.find({ project: req.params.projectId })
            .populate('project', 'name')
            .sort({ createdAt: -1 });
        res.json(tasks);
    } catch (e) {
        console.error('Failed to list project tasks', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// CREATE task (admin)
router.post('/tasks', auth, permit('admin'), async(req, res) => {
    try {
        const { title, description, project, assignees, deadline } = req.body;
        if (!title || !project) return res.status(400).json({ message: 'title/project required' });

        const task = await Task.create({
            title,
            description: description || '',
            project,
            createdBy: req.user._id,
            assignments: (assignees || []).map(empId => ({ employee: empId, status: 'assigned' })),
            deadline
        });

        res.status(201).json(task);
    } catch (e) {
        console.error('Failed to create task', e);
        res.status(500).json({ message: 'Server error', error: e.message });
    }
});

// UPDATE task
router.put('/tasks/:id', auth, permit('admin'), async(req, res) => {
    try {
        const { title, description, project, assignees, deadline } = req.body;
        const updates = { title, description, project, deadline };

        if (assignees) {
            updates.assignments = assignees.map(empId => ({ employee: empId, status: 'pending' }));
        }

        const task = await Task.findByIdAndUpdate(req.params.id, updates, { new: true })
            .populate('project', 'name').populate('createdBy', 'name email');

        if (!task) return res.status(404).json({ message: 'Task not found' });
        res.json(task);
    } catch (e) {
        console.error('Failed to update task', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// DELETE task
router.delete('/tasks/:id', auth, permit('admin'), async(req, res) => {
    try {
        const task = await Task.findByIdAndDelete(req.params.id);
        if (!task) return res.status(404).json({ message: 'Task not found' });
        res.json({ message: 'Task deleted' });
    } catch (e) {
        console.error('Failed to delete task', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// ===== HOLIDAYS =====

// List holidays
router.get('/holidays', auth, permit('admin', 'manager'), async(req, res) => {
    try {
        const list = await Holiday.find().sort({ date: 1 });
        res.json(list);
    } catch (e) {
        console.error('Failed to list holidays', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// Create holiday
router.post('/holidays', auth, permit('admin'), async(req, res) => {
    try {
        const { date, description } = req.body;
        if (!date) return res.status(400).json({ message: 'date required' });
        const h = new Holiday({ date: new Date(date), description });
        await h.save();
        res.status(201).json(h);
    } catch (e) {
        console.error('Failed to create holiday', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete holiday
router.delete('/holidays/:id', auth, permit('admin'), async(req, res) => {
    try {
        await Holiday.findByIdAndDelete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (e) {
        console.error('Failed to delete holiday', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// ===== PUBLIC ENDPOINTS FOR EMPLOYEES =====

// GET all projects (public for employees)
router.get('/projects-list', auth, async(req, res) => {
    try {
        const projects = await Project.find()
            .populate('manager', 'name email')
            .sort({ createdAt: -1 });
        res.json(projects);
    } catch (e) {
        console.error('Failed to list projects', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET all tasks (public for employees)
router.get('/tasks-list', auth, async(req, res) => {
    try {
        const tasks = await Task.find()
            .populate('project', 'name')
            .sort({ createdAt: -1 });
        res.json(tasks);
    } catch (e) {
        console.error('Failed to list tasks', e);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
