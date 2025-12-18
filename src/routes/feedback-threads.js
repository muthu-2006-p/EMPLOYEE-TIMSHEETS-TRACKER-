const express = require('express');
const router = express.Router();
const FeedbackThread = require('../models/FeedbackThread');
const FeedbackMessage = require('../models/FeedbackMessage');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, permit } = require('../middleware/auth');

// ===== GET AVAILABLE RECIPIENTS (Role-Based) =====
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

// ===== CREATE NEW FEEDBACK THREAD =====
router.post('/thread/new', auth, async(req, res) => {
    try {
        const { subject, message, recipients, category, priority, relatedTask, relatedProject } = req.body;

        if (!subject || !message || !recipients || recipients.length === 0) {
            return res.status(400).json({
                message: 'Subject, message, and at least one recipient are required'
            });
        }

        // Resolve recipients (can be email or ID)
        const participantIds = [];
        for (const recipient of recipients) {
            if (recipient.includes('@')) {
                const user = await User.findOne({ email: recipient });
                if (user) participantIds.push(user._id);
            } else {
                participantIds.push(recipient);
            }
        }

        if (participantIds.length === 0) {
            return res.status(400).json({ message: 'No valid recipients found' });
        }

        // Get recipient roles
        const recipientUsers = await User.find({ _id: { $in: participantIds } });

        // ===== ROLE-BASED PERMISSION VALIDATION =====
        console.log('👤 Feedback permission check - Sender:', req.user.role);

        for (const recipient of recipientUsers) {
            console.log('   → Recipient:', recipient.role);

            if (req.user.role === 'employee') {
                // Employee can ONLY send to managers
                if (recipient.role !== 'manager') {
                    return res.status(403).json({
                        message: 'Employees can only send feedback to managers',
                        rejectedRecipient: { name: recipient.name, role: recipient.role }
                    });
                }
            } else if (req.user.role === 'manager') {
                // Manager can send to admins and employees ONLY
                if (!['admin', 'employee'].includes(recipient.role)) {
                    return res.status(403).json({
                        message: 'Managers can only send feedback to admins and employees',
                        rejectedRecipient: { name: recipient.name, role: recipient.role }
                    });
                }
            } else if (req.user.role === 'admin') {
                // Admin can send to managers and employees ONLY
                if (!['manager', 'employee'].includes(recipient.role)) {
                    return res.status(403).json({
                        message: 'Admins can only send feedback to managers and employees',
                        rejectedRecipient: { name: recipient.name, role: recipient.role }
                    });
                }
            }
        }

        console.log('✅ Feedback permission validated');

        // Create separate thread for each recipient (model supports single receiver)
        const createdThreads = [];

        for (const recipientUser of recipientUsers) {
            const thread = new FeedbackThread({
                title: subject,
                sender: req.user._id,
                receiver: recipientUser._id,
                tag: category || 'General',
                status: 'open',
                lastMessageAt: new Date()
            });

            await thread.save();
            createdThreads.push(thread);

            // Create first message
            const firstMessage = new FeedbackMessage({
                thread: thread._id,
                sender: req.user._id,
                senderRole: req.user.role,
                message
            });

            await firstMessage.save();

            // Notify recipient
            await Notification.create({
                user: recipientUser._id,
                type: 'feedback_new_thread',
                title: '💬 New Message Thread',
                body: `${req.user.name} started a new conversation: "${subject}"`,
                meta: {
                    threadId: thread._id,
                    senderId: req.user._id,
                    senderName: req.user.name,
                    subject,
                    category
                }
            });
        }

        console.log(`✅ Created ${createdThreads.length} thread(s)`);

        res.status(201).json({
            message: `Thread${createdThreads.length > 1 ? 's' : ''} created successfully`,
            data: createdThreads,
            count: createdThreads.length
        });

    } catch (err) {
        console.error('Create thread error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== REPLY TO THREAD =====
router.post('/thread/:threadId/reply', auth, async(req, res) => {
    try {
        const { threadId } = req.params;
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ message: 'Message is required' });
        }

        const thread = await FeedbackThread.findById(threadId).populate('sender receiver', 'name email');
        if (!thread) {
            return res.status(404).json({ message: 'Thread not found' });
        }

        // Check if user is sender or receiver
        const isParticipant = String(thread.sender._id || thread.sender) === String(req.user._id) ||
            String(thread.receiver._id || thread.receiver) === String(req.user._id);

        if (!isParticipant) {
            return res.status(403).json({ message: 'You are not a participant in this thread' });
        }

        // Create reply message
        const reply = new FeedbackMessage({
            thread: threadId,
            sender: req.user._id,
            senderRole: req.user.role,
            message
        });

        await reply.save();

        // Update thread
        thread.lastMessageAt = new Date();
        await thread.save();

        // Notify the other participant (sender or receiver)
        const otherParticipantId = String(thread.sender._id || thread.sender) === String(req.user._id) ?
            (thread.receiver._id || thread.receiver) :
            (thread.sender._id || thread.sender);

        await Notification.create({
            user: otherParticipantId,
            type: 'feedback_new_reply',
            title: '💬 New Reply',
            body: `${req.user.name} replied in "${thread.title}"`,
            meta: {
                threadId: thread._id,
                messageId: reply._id,
                senderId: req.user._id,
                senderName: req.user.name,
                subject: thread.title
            }
        });

        const populatedReply = await FeedbackMessage.findById(reply._id)
            .populate('sender', 'name email role');

        res.status(201).json({
            message: 'Reply sent successfully',
            data: populatedReply
        });

    } catch (err) {
        console.error('Reply error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET MY THREADS =====
router.get('/threads/my', auth, async(req, res) => {
    try {
        const { status, category } = req.query;

        const query = {
            $or: [
                { sender: req.user._id },
                { receiver: req.user._id }
            ]
        };

        if (status) {
            query.status = status;
        }

        if (category) {
            query.tag = category;
        }

        const threads = await FeedbackThread.find(query)
            .populate('sender', 'name email role')
            .populate('receiver', 'name email role')
            .sort({ lastMessageAt: -1 })
            .limit(100);

        res.json({
            message: 'Threads retrieved successfully',
            data: threads,
            count: threads.length
        });

    } catch (err) {
        console.error('Get threads error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET THREAD MESSAGES =====
router.get('/thread/:threadId/messages', auth, async(req, res) => {
    try {
        const { threadId } = req.params;

        const thread = await FeedbackThread.findById(threadId);
        if (!thread) {
            return res.status(404).json({ message: 'Thread not found' });
        }

        // Check if user is sender or receiver
        const isParticipant = String(thread.sender) === String(req.user._id) ||
            String(thread.receiver) === String(req.user._id);

        if (!isParticipant && !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ message: 'You do not have access to this thread' });
        }

        const messages = await FeedbackMessage.find({ thread: threadId })
            .populate('sender', 'name email role')
            .sort({ createdAt: 1 });

        res.json({
            message: 'Messages retrieved successfully',
            data: messages,
            count: messages.length
        });

    } catch (err) {
        console.error('Get messages error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== MARK THREAD AS READ =====
router.put('/thread/:threadId/read', auth, async(req, res) => {
    try {
        const { threadId } = req.params;

        const thread = await FeedbackThread.findById(threadId);
        if (!thread) {
            return res.status(404).json({ message: 'Thread not found' });
        }

        res.json({
            message: 'Thread marked as read',
            data: { threadId, unreadCount: 0 }
        });

    } catch (err) {
        console.error('Mark read error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET UNREAD COUNT =====
router.get('/unread-count', auth, async(req, res) => {
    try {
        const threads = await FeedbackThread.find({
            'participants.user': req.user._id,
            status: 'active'
        });

        let totalUnread = 0;
        threads.forEach(thread => {
            const unread = thread.unreadCount.get(req.user._id.toString()) || 0;
            totalUnread += unread;
        });

        res.json({
            message: 'Unread count retrieved successfully',
            data: {
                totalUnread,
                threadCount: threads.length
            }
        });

    } catch (err) {
        console.error('Get unread count error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== CLOSE THREAD =====
router.put('/thread/:threadId/close', auth, async(req, res) => {
    try {
        const { threadId } = req.params;

        const thread = await FeedbackThread.findById(threadId);
        if (!thread) {
            return res.status(404).json({ message: 'Thread not found' });
        }

        // Only initiator or admin/manager can close
        if (String(thread.initiatedBy) !== String(req.user._id) &&
            !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Only thread initiator or admin/manager can close thread' });
        }

        thread.status = 'closed';
        await thread.save();

        res.json({
            message: 'Thread closed successfully',
            data: { threadId, status: 'closed' }
        });

    } catch (err) {
        console.error('Close thread error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ALL THREADS (Manager/Admin) =====
router.get('/threads/all', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        console.log('📋 GET /threads/all - User:', req.user.name, 'Role:', req.user.role);

        const { status, category, priority } = req.query;

        const query = {};

        if (status) {
            query.status = status;
        }

        if (category) {
            query.category = category;
        }

        if (priority) {
            query.priority = priority;
        }

        console.log('📋 Query:', JSON.stringify(query));

        const threads = await FeedbackThread.find(query)
            .populate('sender', 'name email role')
            .populate('receiver', 'name email role')
            .sort({ lastMessageAt: -1 })
            .limit(200);

        console.log(`📋 Found ${threads.length} threads`);

        res.json({
            message: 'All threads retrieved successfully',
            data: threads,
            count: threads.length
        });

    } catch (err) {
        console.error('Get all threads error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== ADD REACTION TO MESSAGE =====
router.post('/message/:messageId/react', auth, async(req, res) => {
    try {
        const { messageId } = req.params;
        const { emoji } = req.body;

        if (!emoji) {
            return res.status(400).json({ message: 'Emoji is required' });
        }

        const message = await FeedbackMessage.findById(messageId);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        // Check if user already reacted with this emoji
        const existingReaction = message.reactions.find(
            r => String(r.user) === String(req.user._id) && r.emoji === emoji
        );

        if (existingReaction) {
            // Remove reaction
            message.reactions = message.reactions.filter(
                r => !(String(r.user) === String(req.user._id) && r.emoji === emoji)
            );
        } else {
            // Add reaction
            message.reactions.push({
                user: req.user._id,
                emoji
            });
        }

        await message.save();

        res.json({
            message: 'Reaction updated successfully',
            data: { reactions: message.reactions }
        });

    } catch (err) {
        console.error('React error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
