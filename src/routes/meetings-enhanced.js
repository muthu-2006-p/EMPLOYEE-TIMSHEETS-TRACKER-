const express = require('express');
const router = express.Router();
const Meeting = require('../models/Meeting');
const MeetingAttendance = require('../models/MeetingAttendance');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, permit } = require('../middleware/auth');

// ===== GET ALL MEETINGS (Admin View + Employee View) =====
router.get('/', auth, async(req, res) => {
    try {
        console.log('📞 User requesting meetings:', req.user.role);

        // Filter meetings based on role
        let query = {};
        if (req.user.role === 'employee') {
            // Employees only see meetings they're invited to
            query = {
                $or: [
                    { recipients: req.user._id },
                    { sender: req.user._id }
                ]
            };
        }

        const meetings = await Meeting.find(query)
            .populate('sender', 'name email role')
            .populate('recipients', 'name email role')
            .sort({ dateTime: -1 })
            .limit(50);

        // Also fetch attendance data for each meeting
        const meetingsWithAttendance = await Promise.all(meetings.map(async(meeting) => {
            const attendance = await MeetingAttendance.find({ meeting: meeting._id });
            const meetingObj = meeting.toObject();

            // Add computed status
            const now = new Date();
            const meetingDate = new Date(meetingObj.dateTime);
            const meetingEnd = new Date(meetingDate.getTime() + (meetingObj.duration || 60) * 60000);

            if (meetingObj.isExpired) {
                meetingObj.status = 'cancelled';
            } else if (now < meetingDate) {
                meetingObj.status = 'scheduled';
            } else if (now >= meetingDate && now <= meetingEnd) {
                meetingObj.status = 'ongoing';
            } else {
                meetingObj.status = 'completed';
            }

            return {
                ...meetingObj,
                attendance: attendance.map(a => ({
                    attendee: a.attendee,
                    joinedAt: a.joinedAt,
                    leftAt: a.leftAt,
                    status: a.status
                }))
            };
        }));

        console.log(`📞 Found ${meetingsWithAttendance.length} meetings`);
        meetingsWithAttendance.slice(0, 5).forEach(m =>
            console.log(`  - ${m.title} (${m.meetingType}) - ${m.recipients?.length || 0} participants`)
        );

        res.json({
            message: 'Meetings retrieved successfully',
            data: meetingsWithAttendance
        });

    } catch (err) {
        console.error('❌ Get all meetings error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== CREATE MEETING (Simplified) =====
router.post('/', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        console.log('📞 Received meeting creation request from:', req.user.name, req.user.role);
        console.log('📞 Request body:', JSON.stringify(req.body, null, 2));

        const {
            title,
            startTime,
            duration,
            meetingType,
            agenda,
            location,
            participants = []
        } = req.body;

        console.log('📞 Parsed data:', { title, startTime, duration, meetingType, participantCount: participants.length });

        // Validation - only title and startTime required
        if (!title) {
            console.log('❌ Validation failed: Title is required');
            return res.status(400).json({ message: 'Title is required' });
        }

        if (!startTime) {
            console.log('❌ Validation failed: startTime is required');
            return res.status(400).json({ message: 'startTime is required' });
        }

        // Role-based permission check for participants
        if (req.user.role === 'manager') {
            // Managers can only invite employees
            const participantUsers = await User.find({ _id: { $in: participants } });
            const invalidParticipants = participantUsers.filter(u => u.role !== 'employee');

            if (invalidParticipants.length > 0) {
                console.log('❌ Manager tried to invite non-employees:', invalidParticipants.map(u => u.name));
                return res.status(403).json({
                    message: 'Managers can only invite employees to meetings',
                    invalidParticipants: invalidParticipants.map(u => ({ name: u.name, role: u.role }))
                });
            }
        }

        const meeting = new Meeting({
            title,
            description: agenda || '',
            link: location || '',
            dateTime: new Date(startTime),
            duration: duration || 60,
            sender: req.user._id,
            senderRole: req.user.role,
            recipients: participants,
            recipientRole: 'all',
            isExpired: false
        });

        await meeting.save();

        console.log('✅ Meeting created:', meeting._id);

        // Notify participants
        if (participants.length > 0) {
            const notifications = participants.map(participantId => ({
                user: participantId,
                type: 'meeting_scheduled',
                title: '📅 Meeting Scheduled',
                body: `${req.user.name} scheduled a meeting: "${title}"`,
                meta: {
                    meetingId: meeting._id,
                    title,
                    dateTime: meeting.dateTime,
                    duration: meeting.duration,
                    location: meeting.link,
                    senderId: req.user._id,
                    senderName: req.user.name
                }
            }));

            await Notification.insertMany(notifications);
            console.log(`📞 Sent ${notifications.length} meeting notifications`);
        }

        const populatedMeeting = await Meeting.findById(meeting._id)
            .populate('sender', 'name email role')
            .populate('recipients', 'name email role');

        console.log('✅ Meeting created successfully:', populatedMeeting.title);

        res.status(201).json({
            message: 'Meeting created successfully',
            data: populatedMeeting
        });

    } catch (err) {
        console.error('❌ Create meeting error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== CREATE MEETING =====
router.post('/create', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const {
            title,
            description,
            link,
            dateTime,
            duration,
            recipients,
            recipientRole
        } = req.body;

        // Validation
        if (!title || !link || !dateTime) {
            return res.status(400).json({
                message: 'Title, link, and dateTime are required'
            });
        }

        // Validate meeting link
        const validLinkPatterns = [
            /zoom\.us/,
            /meet\.google\.com/,
            /teams\.microsoft\.com/,
            /webex\.com/,
            /gotomeeting\.com/
        ];

        const isValidLink = validLinkPatterns.some(pattern => pattern.test(link));
        if (!isValidLink) {
            return res.status(400).json({
                message: 'Invalid meeting link. Must be from Zoom, Google Meet, Teams, Webex, or GoToMeeting'
            });
        }

        // Resolve recipients
        let recipientIds = [];
        if (recipients && recipients.length > 0) {
            for (const recipient of recipients) {
                if (recipient.includes('@')) {
                    const user = await User.findOne({ email: recipient });
                    if (user) recipientIds.push(user._id);
                } else {
                    recipientIds.push(recipient);
                }
            }
        } else if (recipientRole) {
            // Get all users with specified role
            const users = await User.find({ role: recipientRole });
            recipientIds = users.map(u => u._id);
        } else if (recipientRole === 'all') {
            // Get all employees
            const users = await User.find({ role: { $in: ['employee', 'manager'] } });
            recipientIds = users.map(u => u._id);
        }

        // Remove sender from recipients
        recipientIds = recipientIds.filter(id => String(id) !== String(req.user._id));

        const meeting = new Meeting({
            title,
            description: description || '',
            link,
            dateTime: new Date(dateTime),
            duration: duration || 60,
            sender: req.user._id,
            senderRole: req.user.role,
            recipients: recipientIds,
            recipientRole: recipientRole || 'all',
            isExpired: false
        });

        await meeting.save();

        // Notify recipients
        const notifications = recipientIds.map(recipientId => ({
            user: recipientId,
            type: 'meeting_scheduled',
            title: '📅 Meeting Scheduled',
            body: `${req.user.name} scheduled a meeting: "${title}"`,
            meta: {
                meetingId: meeting._id,
                title,
                dateTime: meeting.dateTime,
                duration: meeting.duration,
                link: meeting.link,
                senderId: req.user._id,
                senderName: req.user.name
            }
        }));

        await Notification.insertMany(notifications);

        const populatedMeeting = await Meeting.findById(meeting._id)
            .populate('sender', 'name email role')
            .populate('recipients', 'name email role');

        res.status(201).json({
            message: 'Meeting created successfully',
            data: populatedMeeting
        });

    } catch (err) {
        console.error('Create meeting error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== JOIN MEETING (Track Attendance) =====
router.post('/:meetingId/join', auth, async(req, res) => {
    try {
        const { meetingId } = req.params;
        const { deviceInfo, connectionQuality } = req.body;

        const meeting = await Meeting.findById(meetingId);
        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found' });
        }

        // Check if meeting is expired
        if (meeting.isExpired) {
            return res.status(400).json({ message: 'Meeting has expired' });
        }

        // Check if already joined
        const existingAttendance = await MeetingAttendance.findOne({
            meeting: meetingId,
            attendee: req.user._id
        });

        if (existingAttendance) {
            return res.status(400).json({
                message: 'You have already joined this meeting',
                data: existingAttendance
            });
        }

        // Create attendance record
        const attendance = new MeetingAttendance({
            meeting: meetingId,
            attendee: req.user._id,
            attendeeRole: req.user.role,
            joinedAt: new Date(),
            status: 'joined',
            deviceInfo: deviceInfo || {},
            connectionQuality: connectionQuality || 'good'
        });

        await attendance.save();

        // Notify meeting organizer
        await Notification.create({
            user: meeting.sender,
            type: 'meeting_joined',
            title: '👤 Attendee Joined',
            body: `${req.user.name} joined the meeting "${meeting.title}"`,
            meta: {
                meetingId: meeting._id,
                attendeeId: req.user._id,
                attendeeName: req.user.name,
                joinedAt: attendance.joinedAt
            }
        });

        res.json({
            message: 'Joined meeting successfully',
            data: {
                meetingId: meeting._id,
                meetingLink: meeting.link,
                attendanceId: attendance._id,
                joinedAt: attendance.joinedAt
            }
        });

    } catch (err) {
        console.error('Join meeting error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== LEAVE MEETING =====
router.post('/:meetingId/leave', auth, async(req, res) => {
    try {
        const { meetingId } = req.params;
        const { notes } = req.body;

        const attendance = await MeetingAttendance.findOne({
            meeting: meetingId,
            attendee: req.user._id,
            status: 'joined'
        });

        if (!attendance) {
            return res.status(404).json({ message: 'Attendance record not found or already left' });
        }

        attendance.leftAt = new Date();
        attendance.status = 'left';
        attendance.notes = notes || '';

        await attendance.save();

        res.json({
            message: 'Left meeting successfully',
            data: {
                attendanceId: attendance._id,
                duration: attendance.duration,
                joinedAt: attendance.joinedAt,
                leftAt: attendance.leftAt
            }
        });

    } catch (err) {
        console.error('Leave meeting error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET UPCOMING MEETINGS =====
router.get('/upcoming', auth, async(req, res) => {
    try {
        const now = new Date();

        const meetings = await Meeting.find({
                $or: [
                    { recipients: req.user._id },
                    { sender: req.user._id }
                ],
                dateTime: { $gte: now },
                isExpired: false
            })
            .populate('sender', 'name email role')
            .populate('recipients', 'name email')
            .sort({ dateTime: 1 })
            .limit(50);

        res.json({
            message: 'Upcoming meetings retrieved successfully',
            data: meetings,
            count: meetings.length
        });

    } catch (err) {
        console.error('Get upcoming meetings error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET PAST MEETINGS =====
router.get('/past', auth, async(req, res) => {
    try {
        const now = new Date();

        const meetings = await Meeting.find({
                $or: [
                    { recipients: req.user._id },
                    { sender: req.user._id }
                ],
                $or: [
                    { dateTime: { $lt: now } },
                    { isExpired: true }
                ]
            })
            .populate('sender', 'name email role')
            .populate('recipients', 'name email')
            .sort({ dateTime: -1 })
            .limit(50);

        res.json({
            message: 'Past meetings retrieved successfully',
            data: meetings,
            count: meetings.length
        });

    } catch (err) {
        console.error('Get past meetings error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ALL MEETINGS =====
router.get('/list', auth, async(req, res) => {
    try {
        const { status, from, to } = req.query;

        console.log('📋 GET /list - User:', req.user.name, 'Role:', req.user.role, 'Status filter:', status);

        let query = {};

        // Admin can see all meetings, others only see meetings they're involved in
        if (req.user.role !== 'admin') {
            query.$or = [
                { recipients: req.user._id },
                { sender: req.user._id }
            ];
        }

        // If no status specified, show all meetings (don't filter by date)
        if (status === 'upcoming') {
            query.dateTime = { $gte: new Date() };
            query.isExpired = false;
        } else if (status === 'past') {
            if (!query.$or) {
                query.$or = [];
            }
            query.$or.push({ dateTime: { $lt: new Date() } }, { isExpired: true });
        }

        if (from && to) {
            query.dateTime = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        }

        console.log('📋 Query:', JSON.stringify(query));

        const meetings = await Meeting.find(query)
            .populate('sender', 'name email role')
            .populate('recipients', 'name email')
            .sort({ dateTime: -1 })
            .limit(100);

        console.log(`📋 Found ${meetings.length} meetings for user ${req.user.name}`);

        // Add computed status to each meeting
        const meetingsWithStatus = meetings.map(meeting => {
            const meetingObj = meeting.toObject();
            const now = new Date();
            const meetingDate = new Date(meetingObj.dateTime);
            const meetingEnd = new Date(meetingDate.getTime() + (meetingObj.duration || 60) * 60000);

            if (meetingObj.isExpired) {
                meetingObj.status = 'cancelled';
            } else if (now < meetingDate) {
                meetingObj.status = 'scheduled';
            } else if (now >= meetingDate && now <= meetingEnd) {
                meetingObj.status = 'ongoing';
            } else {
                meetingObj.status = 'completed';
            }

            return meetingObj;
        });

        console.log('📋 Returning meetings with status:', meetingsWithStatus.map(m => ({ title: m.title, dateTime: m.dateTime, status: m.status })));

        res.json({
            message: 'Meetings retrieved successfully',
            data: meetingsWithStatus,
            count: meetingsWithStatus.length
        });

    } catch (err) {
        console.error('Get meetings error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== UPDATE MEETING =====
router.put('/:meetingId', auth, async(req, res) => {
    try {
        const { meetingId } = req.params;
        const { title, description, link, dateTime, duration } = req.body;

        const meeting = await Meeting.findById(meetingId);
        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found' });
        }

        // Only sender or admin can update
        if (String(meeting.sender) !== String(req.user._id) && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Only meeting organizer can update' });
        }

        if (title) meeting.title = title;
        if (description !== undefined) meeting.description = description;
        if (link) meeting.link = link;
        if (dateTime) meeting.dateTime = new Date(dateTime);
        if (duration) meeting.duration = duration;

        await meeting.save();

        // Notify recipients about update
        const notifications = meeting.recipients.map(recipientId => ({
            user: recipientId,
            type: 'meeting_updated',
            title: '📝 Meeting Updated',
            body: `Meeting "${meeting.title}" has been updated`,
            meta: {
                meetingId: meeting._id,
                title: meeting.title,
                dateTime: meeting.dateTime,
                link: meeting.link
            }
        }));

        await Notification.insertMany(notifications);

        const populatedMeeting = await Meeting.findById(meeting._id)
            .populate('sender', 'name email role')
            .populate('recipients', 'name email role');

        res.json({
            message: 'Meeting updated successfully',
            data: populatedMeeting
        });

    } catch (err) {
        console.error('Update meeting error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== DELETE/CANCEL MEETING =====
router.delete('/:meetingId', auth, async(req, res) => {
    try {
        const { meetingId } = req.params;

        const meeting = await Meeting.findById(meetingId);
        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found' });
        }

        // Only sender or admin can delete
        if (String(meeting.sender) !== String(req.user._id) && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Only meeting organizer can cancel' });
        }

        // Notify recipients about cancellation
        const notifications = meeting.recipients.map(recipientId => ({
            user: recipientId,
            type: 'meeting_cancelled',
            title: '❌ Meeting Cancelled',
            body: `Meeting "${meeting.title}" has been cancelled`,
            meta: {
                meetingId: meeting._id,
                title: meeting.title,
                cancelledBy: req.user.name
            }
        }));

        await Notification.insertMany(notifications);

        await Meeting.findByIdAndDelete(meetingId);
        await MeetingAttendance.deleteMany({ meeting: meetingId });

        res.json({
            message: 'Meeting cancelled successfully',
            data: { meetingId }
        });

    } catch (err) {
        console.error('Delete meeting error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET MEETING ATTENDANCE =====
router.get('/:meetingId/attendance', auth, async(req, res) => {
    try {
        const { meetingId } = req.params;

        const meeting = await Meeting.findById(meetingId);
        if (!meeting) {
            return res.status(404).json({ message: 'Meeting not found' });
        }

        // Check permission
        if (String(meeting.sender) !== String(req.user._id) &&
            !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Only organizer or admin/manager can view attendance' });
        }

        const attendance = await MeetingAttendance.find({ meeting: meetingId })
            .populate('attendee', 'name email role')
            .sort({ joinedAt: 1 });

        const summary = {
            totalInvited: meeting.recipients.length,
            totalJoined: attendance.length,
            currentlyJoined: attendance.filter(a => a.status === 'joined').length,
            left: attendance.filter(a => a.status === 'left').length,
            noShow: meeting.recipients.length - attendance.length,
            averageDuration: attendance.length > 0 ?
                Math.round(attendance.reduce((sum, a) => sum + (a.duration || 0), 0) / attendance.length) : 0
        };

        res.json({
            message: 'Attendance retrieved successfully',
            data: attendance,
            summary,
            meeting: {
                id: meeting._id,
                title: meeting.title,
                dateTime: meeting.dateTime,
                duration: meeting.duration
            }
        });

    } catch (err) {
        console.error('Get attendance error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EXPIRE OLD MEETINGS (Scheduled Task) =====
router.post('/expire-old', auth, permit('admin'), async(req, res) => {
    try {
        const now = new Date();

        const result = await Meeting.updateMany({
            dateTime: { $lt: now },
            isExpired: false
        }, {
            $set: { isExpired: true }
        });

        res.json({
            message: 'Old meetings expired successfully',
            data: {
                expiredCount: result.modifiedCount
            }
        });

    } catch (err) {
        console.error('Expire meetings error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET MEETING ANALYTICS (Admin/Manager) =====
router.get('/analytics/summary', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { from, to } = req.query;

        const query = {};
        if (from && to) {
            query.dateTime = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        } else {
            // Default: last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            query.dateTime = { $gte: thirtyDaysAgo };
        }

        const meetings = await Meeting.find(query);
        const attendanceRecords = await MeetingAttendance.find({
            meeting: { $in: meetings.map(m => m._id) }
        });

        const analytics = {
            totalMeetings: meetings.length,
            upcomingMeetings: meetings.filter(m => m.dateTime > new Date() && !m.isExpired).length,
            pastMeetings: meetings.filter(m => m.dateTime < new Date() || m.isExpired).length,
            totalAttendees: attendanceRecords.length,
            averageAttendeesPerMeeting: meetings.length > 0 ?
                Math.round(attendanceRecords.length / meetings.length) : 0,
            totalDuration: attendanceRecords.reduce((sum, a) => sum + (a.duration || 0), 0),
            averageMeetingDuration: attendanceRecords.length > 0 ?
                Math.round(attendanceRecords.reduce((sum, a) => sum + (a.duration || 0), 0) / attendanceRecords.length) : 0
        };

        res.json({
            message: 'Meeting analytics retrieved successfully',
            data: analytics
        });

    } catch (err) {
        console.error('Get analytics error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
