const express = require('express');
const Project = require('../models/Project');
const Timesheet = require('../models/Timesheet');
const { auth, permit } = require('../middleware/auth');

const router = express.Router();

// create project (manager/admin)
router.post('/', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const payload = Object.assign({}, req.body);
        // ensure manager is the requester unless admin explicitly sets another manager
        if (!payload.manager) payload.manager = req.user._id;
        // normalize employees list (accept emails or ids)
        if (payload.employees && payload.employees.length) {
            // assume frontend sends ids; otherwise leave as-is
        }
        const project = await Project.create(payload);
        res.status(201).json(project);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to create project' });
    }
});

// get single project
router.get('/:id', auth, permit('manager', 'admin', 'employee'), async(req, res) => {
    try {
        const p = await Project.findById(req.params.id).populate('manager', 'name email').populate('employees', 'name email designation photo');
        if (!p) return res.status(404).json({ message: 'Project not found' });
        res.json(p);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// update project (manager/admin)
router.put('/:id', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const updates = req.body;
        const p = await Project.findById(req.params.id);
        if (!p) return res.status(404).json({ message: 'Project not found' });
        // only manager or admin may update
        if (req.user.role !== 'admin' && String(p.manager) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not allowed' });
        }
        Object.assign(p, updates);
        await p.save();
        const populated = await Project.findById(p._id).populate('manager', 'name email').populate('employees', 'name email designation photo');
        res.json(populated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Update failed' });
    }
});

// delete project (manager or admin)
router.delete('/:id', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const p = await Project.findById(req.params.id);
        if (!p) return res.status(404).json({ message: 'Project not found' });
        if (req.user.role !== 'admin' && String(p.manager) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not allowed' });
        }

        // remove project reference from timesheets (set to null)
        await Timesheet.updateMany({ project: p._id }, { $set: { project: null } });

        await Project.deleteOne({ _id: p._id });
        res.json({ message: 'Project deleted' });
    } catch (err) {
        console.error('Error deleting project', err);
        res.status(500).json({ message: 'Failed to delete project' });
    }
});

// remove employee from project (manager or admin)
router.delete('/:id/employees/:empId', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const p = await Project.findById(req.params.id);
        if (!p) return res.status(404).json({ message: 'Project not found' });
        if (req.user.role !== 'admin' && String(p.manager) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not allowed' });
        }

        const empId = req.params.empId;
        await Project.updateOne({ _id: p._id }, { $pull: { employees: empId } });
        const updated = await Project.findById(p._id).populate('manager', 'name email').populate('employees', 'name email');
        res.json(updated);
    } catch (err) {
        console.error('Error removing employee from project', err);
        res.status(500).json({ message: 'Failed to remove employee' });
    }
});

// employee leaves a project (self-remove)
router.post('/:id/leave', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const p = await Project.findById(req.params.id);
        if (!p) return res.status(404).json({ message: 'Project not found' });
        const userId = String(req.user._id);
        // only allow if user is in employees
        const isMember = p.employees.some(e => String(e) === userId);
        if (!isMember) return res.status(400).json({ message: 'You are not a member of this project' });

        await Project.updateOne({ _id: p._id }, { $pull: { employees: req.user._id } });
        const updated = await Project.findById(p._id).populate('manager', 'name email').populate('employees', 'name email');
        res.json({ message: 'Left project', project: updated });
    } catch (err) {
        console.error('Error leaving project', err);
        res.status(500).json({ message: 'Failed to leave project' });
    }
});

// list
router.get('/', auth, permit('manager', 'admin', 'employee'), async(req, res) => {
    const list = await Project.find().populate('manager', 'name email').populate('employees', '_id name email');
    res.json(list);
});

module.exports = router;
