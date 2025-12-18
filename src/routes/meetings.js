const express = require('express');
const Meeting = require('../models/Meeting');
const MeetingAttendance = require('../models/MeetingAttendance');
const User = require('../models/User');
const { auth, permit } = require('../middleware/auth');
const mongoose = require('mongoose');

const router = express.Router();

// Create new meeting (Manager/Admin only)
router.post('/', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { title, description, link, dateTime, recipients, recipientRole, duration } = req.body;

        if (!title || !link || !dateTime) {
            return res.status(400).json({ message: 'Title, link, and dateTime are required' });
        }

        // Parse recipients
        let recipientIds = [];
        if (recipients && Array.isArray(recipients)) {
            for (let recip of recipients) {
                if (mongoose.Types.ObjectId.isValid(recip)) {
                    recipientIds.push(recip);
                } else if (recip.includes('@')) {
                    const user = await User.findOne({ email: recip });
                    if (user) recipientIds.push(user._id);
                }
            }
        }

        // If recipientRole specified, get all users with that role
        if (recipientRole && recipientRole !== 'all') {
            const users = await User.find({ role: recipientRole }).select('_id');
            recipientIds = [...recipientIds, ...users.map(u => u._id)];
        }

        // Remove duplicates
        recipientIds = [...new Set(recipientIds.map(id => id.toString()))];

        const meeting = await Meeting.create({
            title,
            description: description || '',
            link,
            dateTime: new Date(dateTime),
            sender: req.user._id,
            senderRole: req.user.role,
            recipients: recipientIds,
            recipientRole: recipientRole || 'all',
            duration: duration || 60
        });

        // Create attendance records for all recipients
        const attendancePromises = recipientIds.map(recipId =>
            MeetingAttendance.create({
                meeting: meeting._id,
                employee: recipId
            })
        );
        await Promise.all(attendancePromises);

        const populatedMeeting = await Meeting.findById(meeting._id)
            .populate('sender', 'name email role')
            .populate('recipients', 'name email role');

        console.log('Meeting created:', {
            meetingId: meeting._id,
            by: req.user.email,
            recipients: recipientIds.length
        });

        res.status(201).json(populatedMeeting);
    } catch (err) {
        console.error('Error creating meeting:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all meetings for current user
router.get('/', auth, async(req, res) => {
    try {
        const { status = 'all' } = req.query;

        let query = {
            $or: [
                { sender: req.user._id },
                { recipients: req.user._id }
            ]
        };

        // Filter by expired status
        if (status === 'upcoming') {
            query.dateTime = { $gte: new Date() };
            query.isExpired = false;
        } else if (status === 'past') {
            query.dateTime = { $lt: new Date() };
        }

        const meetings = await Meeting.find(query)
            .populate('sender', 'name email role')
            .populate('recipients', 'name email role')
            .sort({ dateTime: -1 });

        res.json({ count: meetings.length, data: meetings });
    } catch (err) {
        console.error('Error fetching meetings:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get specific meeting
router.get('/:meetingId', auth, async(req, res) => {
    try {
        const { meetingId } = req.params;

        const meeting = await Meeting.findById(meetingId)
            .populate('sender', 'name email role')
            .populate('recipients', 'name email role');

        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found' });
        }

        // Check if user has access
        const userId = req.user._id.toString();
        const hasAccess = meeting.sender._id.toString() === userId ||
            meeting.recipients.some(r => r._id.toString() === userId);

        if (!hasAccess) {
            return res.status(403).json({ message: 'Access denied' });
        }

        res.json(meeting);
    } catch (err) {
        console.error('Error fetching meeting:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update meeting (only sender can update)
router.put('/:meetingId', auth, async(req, res) => {
    try {
        const { meetingId } = req.params;
        const { title, description, link, dateTime, duration } = req.body;

        const meeting = await Meeting.findById(meetingId);
        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found' });
        }

        // Only sender can update
        if (meeting.sender.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Only meeting creator can update' });
        }

        if (title) meeting.title = title;
        if (description) meeting.description = description;
        if (link) meeting.link = link;
        if (dateTime) meeting.dateTime = new Date(dateTime);
        if (duration) meeting.duration = duration;

        await meeting.save();

        const updatedMeeting = await Meeting.findById(meetingId)
            .populate('sender', 'name email role')
            .populate('recipients', 'name email role');

        res.json({ message: 'Meeting updated', meeting: updatedMeeting });
    } catch (err) {
        console.error('Error updating meeting:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete meeting (only sender can delete)
router.delete('/:meetingId', auth, async(req, res) => {
    try {
        const { meetingId } = req.params;

        const meeting = await Meeting.findById(meetingId);
        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found' });
        }

        // Only sender or admin can delete
        if (meeting.sender.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        await Meeting.findByIdAndDelete(meetingId);
        await MeetingAttendance.deleteMany({ meeting: meetingId });

        res.json({ message: 'Meeting deleted successfully' });
    } catch (err) {
        console.error('Error deleting meeting:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Join meeting (mark attendance)
router.post('/:meetingId/join', auth, async(req, res) => {
    try {
        const { meetingId } = req.params;

        const meeting = await Meeting.findById(meetingId);
        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found' });
        }

        // Check if user is recipient
        const userId = req.user._id.toString();
        const isRecipient = meeting.recipients.some(r => r.toString() === userId) ||
            meeting.sender.toString() === userId;

        if (!isRecipient) {
            return res.status(403).json({ message: 'You are not invited to this meeting' });
        }

        // Find or create attendance record
        let attendance = await MeetingAttendance.findOne({
            meeting: meetingId,
            employee: req.user._id
        });

        if (!attendance) {
            attendance = await MeetingAttendance.create({
                meeting: meetingId,
                employee: req.user._id
            });
        }

        // Mark as joined
        if (!attendance.joinedAt) {
            attendance.joinedAt = new Date();
            attendance.attended = true;
        }

        await attendance.save();

        res.json({ message: 'Meeting joined successfully', attendance });
    } catch (err) {
        console.error('Error joining meeting:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get attendance for a meeting (Manager/Admin only)
router.get('/:meetingId/attendance', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { meetingId } = req.params;

        const meeting = await Meeting.findById(meetingId);
        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found' });
        }

        // Only sender can view attendance
        if (meeting.sender.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const attendance = await MeetingAttendance.find({ meeting: meetingId })
            .populate('employee', 'name email role');

        res.json({
            count: attendance.length,
            attended: attendance.filter(a => a.attended).length,
            data: attendance
        });
    } catch (err) {
        console.error('Error fetching attendance:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Mark meeting as expired (auto-run or manual)
router.put('/:meetingId/expire', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { meetingId } = req.params;

        const meeting = await Meeting.findById(meetingId);
        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found' });
        }

        meeting.isExpired = true;
        await meeting.save();

        res.json({ message: 'Meeting marked as expired', meeting });
    } catch (err) {
        console.error('Error expiring meeting:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
