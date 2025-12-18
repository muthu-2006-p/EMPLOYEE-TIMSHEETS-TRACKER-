const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');
const Timesheet = require('../models/Timesheet');
const router = express.Router();

router.get('/db', (req, res) => {
    const state = mongoose.connection.readyState; // 0 disconnected,1 connected,2 connecting,3 disconnecting
    res.json({ connectionState: state });
});

// Basic health check at /api/status
router.get('/', (req, res) => {
    const state = mongoose.connection.readyState;
    res.json({ ok: true, dbState: state });
});

// Summary for homepage info strip
router.get('/summary', async(req, res) => {
    try {
        const users = await User.countDocuments();
        const projects = await Project.countDocuments();
        const timesheets = await Timesheet.countDocuments();
        res.json({ users, projects, timesheets, server: 'ok' });
    } catch (err) {
        console.error('Error getting summary:', err);
        res.status(500).json({ error: 'Failed to get summary' });
    }
});

module.exports = router;
