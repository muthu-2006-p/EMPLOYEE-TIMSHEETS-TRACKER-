const express = require('express');
const Notification = require('../models/Notification');
const { auth, permit } = require('../middleware/auth');

const router = express.Router();

// Enqueue a notification (internal use)
router.post('/', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { userId, type, title, body, meta } = req.body;
        if (!userId || !title) return res.status(400).json({ message: 'userId and title required' });
        const n = await Notification.create({ user: userId, type, title, body, meta });
        return res.status(201).json(n);
    } catch (err) {
        console.error('Notify error', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get notifications for current user
router.get('/me', auth, async(req, res) => {
    try {
        const list = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.json({ data: list });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Mark as read
router.put('/:id/read', auth, async(req, res) => {
    try {
        const n = await Notification.findById(req.params.id);
        if (!n) return res.status(404).json({ message: 'Not found' });
        if (String(n.user) !== String(req.user._id)) return res.status(403).json({ message: 'Not allowed' });
        n.read = true;
        await n.save();
        res.json(n);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
