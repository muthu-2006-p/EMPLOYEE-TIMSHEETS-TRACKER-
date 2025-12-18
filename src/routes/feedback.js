const express = require('express');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, permit } = require('../middleware/auth');
const mongoose = require('mongoose');

const router = express.Router();

// ===== GET AVAILABLE RECIPIENTS (Based on Role) =====
router.get('/recipients', auth, async(req, res) => {
    try {
        console.log('👥 Getting feedback recipients for:', req.user.name, 'Role:', req.user.role);

        let recipients = [];

        if (req.user.role === 'employee') {
            // Employee can only send to managers
            recipients = await User.find({ role: 'manager', isActive: true })
                .select('_id name email role department designation');
        } else if (req.user.role === 'manager') {
            // Manager can send to both admin and employees
            recipients = await User.find({
                    role: { $in: ['admin', 'employee'] },
                    isActive: true
                })
                .select('_id name email role department designation');
        } else if (req.user.role === 'admin') {
            // Admin can send to both managers and employees
            recipients = await User.find({
                    role: { $in: ['manager', 'employee'] },
                    isActive: true
                })
                .select('_id name email role department designation');
        }

        console.log(`👥 Found ${recipients.length} available recipients`);
        res.json({
            message: 'Recipients retrieved successfully',
            data: recipients,
            count: recipients.length
        });

    } catch (err) {
        console.error('❌ Error getting recipients:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Create new feedback with role-based validation
router.post('/', auth, async(req, res) => {
    try {
        const { to, subject, message, priority, category } = req.body;

        if (!to || !subject || !message) {
            return res.status(400).json({ message: 'To, subject, and message are required' });
        }

        // Resolve receiver email to ID if needed
        let receiverId = to;
        if (to.includes('@')) {
            const receiver = await User.findOne({ email: to });
            if (!receiver) return res.status(400).json({ message: 'Receiver not found' });
            receiverId = receiver._id;
        }

        // Validate recipient exists and get role
        const recipientUser = await User.findById(receiverId);
        if (!recipientUser) {
            return res.status(404).json({ message: 'Recipient not found' });
        }

        // Role-based permission check
        if (req.user.role === 'employee' && recipientUser.role !== 'manager') {
            return res.status(403).json({
                message: 'Employees can only send feedback to managers',
                recipientRole: recipientUser.role
            });
        }

        if (req.user.role === 'manager' && !['admin', 'employee'].includes(recipientUser.role)) {
            return res.status(403).json({
                message: 'Managers can only send feedback to admins and employees',
                recipientRole: recipientUser.role
            });
        }

        if (req.user.role === 'admin' && !['manager', 'employee'].includes(recipientUser.role)) {
            return res.status(403).json({
                message: 'Admins can only send feedback to managers and employees',
                recipientRole: recipientUser.role
            });
        }

        const feedback = await Feedback.create({
            from: req.user._id,
            to: receiverId,
            subject,
            message,
            priority: priority || 'medium',
            category: category || 'general',
            status: 'pending'
        });

        const populated = await Feedback.findById(feedback._id)
            .populate('from', 'name email role')
            .populate('to', 'name email role');

        // Send notification to recipient
        await Notification.create({
            user: receiverId,
            type: 'feedback_received',
            title: '📩 New Feedback',
            body: `${req.user.name} sent you feedback: "${subject}"`,
            meta: {
                feedbackId: feedback._id,
                senderId: req.user._id,
                senderName: req.user.name,
                subject: subject
            }
        });

        console.log('✅ Feedback sent:', feedback._id, 'from', req.user.name, 'to', recipientUser.name);
        res.status(201).json({ message: 'Feedback sent', data: populated });
    } catch (err) {
        console.error('Feedback error:', err);
        res.status(500).json({ message: 'Failed to send feedback', error: err.message });
    }
});

// ===== REPLY TO FEEDBACK =====
router.post('/reply/:feedbackId', auth, async(req, res) => {
    try {
        const { feedbackId } = req.params;
        const { message } = req.body;

        console.log('💬 Replying to feedback:', feedbackId);

        if (!message) {
            return res.status(400).json({ message: 'Reply message is required' });
        }

        // Find original feedback
        const originalFeedback = await Feedback.findById(feedbackId)
            .populate('from', 'name email role')
            .populate('to', 'name email role');

        if (!originalFeedback) {
            return res.status(404).json({ message: 'Feedback not found' });
        }

        // Check if user is either sender or recipient of original feedback
        const isSender = String(originalFeedback.from._id) === String(req.user._id);
        const isRecipient = String(originalFeedback.to._id) === String(req.user._id);

        if (!isSender && !isRecipient) {
            return res.status(403).json({ message: 'You can only reply to feedback you sent or received' });
        }

        // Determine who receives the reply
        const replyRecipient = isSender ? originalFeedback.to._id : originalFeedback.from._id;

        // Create reply feedback
        const reply = await Feedback.create({
            from: req.user._id,
            to: replyRecipient,
            subject: `Re: ${originalFeedback.subject}`,
            message,
            priority: originalFeedback.priority,
            category: originalFeedback.category,
            parentFeedback: feedbackId,
            status: 'pending'
        });

        // Update original feedback
        originalFeedback.replies.push(reply._id);
        originalFeedback.status = 'replied';
        await originalFeedback.save();

        // Populate reply
        const populatedReply = await Feedback.findById(reply._id)
            .populate('from', 'name email role')
            .populate('to', 'name email role');

        // Send notification
        await Notification.create({
            user: replyRecipient,
            type: 'feedback_reply',
            title: '💬 Feedback Reply',
            body: `${req.user.name} replied to: "${originalFeedback.subject}"`,
            meta: {
                feedbackId: reply._id,
                originalFeedbackId: feedbackId,
                senderId: req.user._id,
                senderName: req.user.name
            }
        });

        console.log('✅ Reply sent successfully:', reply._id);
        res.status(201).json({
            message: 'Reply sent successfully',
            data: populatedReply
        });

    } catch (err) {
        console.error('❌ Error replying to feedback:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Get my threads (sent or received)
router.get('/my-threads', auth, async(req, res) => {
    try {
        const feedbacks = await Feedback.find({
                $or: [
                    { from: req.user._id },
                    { to: req.user._id }
                ]
            })
            .populate('from', 'name email role')
            .populate('to', 'name email role')
            .sort({ createdAt: -1 });

        res.json({ count: feedbacks.length, data: feedbacks });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to fetch feedback' });
    }
});

// Get unread count
router.get('/unread-count', auth, async(req, res) => {
    try {
        const count = await Feedback.countDocuments({
            to: req.user._id,
            isRead: false
        });

        res.json({ count });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to get unread count' });
    }
});

// Mark as read
router.put('/:id/read', auth, async(req, res) => {
    try {
        const feedback = await Feedback.findById(req.params.id);

        if (!feedback) {
            return res.status(404).json({ message: 'Feedback not found' });
        }

        if (String(feedback.to) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        feedback.isRead = true;
        await feedback.save();

        res.json({ message: 'Marked as read' });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to mark as read' });
    }
});

// Get all threads (admin/manager)
router.get('/threads', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        let query = {};

        // Managers see feedback involving their team
        if (req.user.role === 'manager') {
            // Find employees under this manager
            const employees = await User.find({ manager: req.user._id }, '_id');
            const employeeIds = employees.map(e => e._id);

            query = {
                $or: [
                    { from: { $in: employeeIds } },
                    { to: { $in: employeeIds } },
                    { from: req.user._id },
                    { to: req.user._id }
                ]
            };
        }

        const feedbacks = await Feedback.find(query)
            .populate('from', 'name email role')
            .populate('to', 'name email role')
            .sort({ createdAt: -1 });

        res.json({ count: feedbacks.length, data: feedbacks });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ message: 'Failed to fetch threads' });
    }
});

module.exports = router;
