const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, permit } = require('../middleware/auth');

// Configuration
const STANDARD_CHECK_IN_HOUR = 9; // 9:00 AM
const GRACE_MINUTES = 30; // 30 minutes grace period
const STANDARD_WORK_HOURS = 8;
const STANDARD_CHECK_OUT_HOUR = 17; // 5:00 PM

// ===== EMPLOYEE: CHECK-IN =====
router.post('/check-in', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        const { location, projectId, notes } = req.body;

        // Check if already checked in today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existingAttendance = await Attendance.findOne({
            employee: req.user._id,
            date: today
        });

        if (existingAttendance && existingAttendance.status === 'checked_in') {
            return res.status(400).json({
                message: 'You have already checked in today',
                data: {
                    checkInTime: existingAttendance.checkInTime,
                    attendanceId: existingAttendance._id
                }
            });
        }

        if (existingAttendance && existingAttendance.status === 'checked_out') {
            return res.status(400).json({
                message: 'You have already completed attendance for today',
                data: {
                    checkInTime: existingAttendance.checkInTime,
                    checkOutTime: existingAttendance.checkOutTime,
                    totalHours: existingAttendance.totalHours
                }
            });
        }

        const checkInTime = new Date();

        // Create attendance record
        const attendance = new Attendance({
            employee: req.user._id,
            date: today,
            checkInTime,
            location: location || 'office',
            project: projectId || null,
            notes: notes || '',
            status: 'checked_in'
        });

        // Check if late
        const isLate = attendance.checkIfLate(GRACE_MINUTES);

        await attendance.save();

        // Notify if late
        if (isLate) {
            const lateMinutes = Math.floor(
                (checkInTime.getHours() * 60 + checkInTime.getMinutes()) -
                (STANDARD_CHECK_IN_HOUR * 60 + GRACE_MINUTES)
            );

            await Notification.create({
                user: req.user._id,
                type: 'attendance_late',
                title: '⏰ Late Check-In',
                body: `You checked in ${lateMinutes} minutes late today`,
                meta: {
                    attendanceId: attendance._id,
                    checkInTime,
                    lateMinutes
                }
            });

            // Notify manager
            if (req.user.role === 'employee') {
                const managers = await User.find({ role: { $in: ['manager', 'admin'] } }).limit(5);
                const managerNotifications = managers.map(m => ({
                    user: m._id,
                    type: 'employee_late',
                    title: 'Employee Late Check-In',
                    body: `${req.user.name} checked in ${lateMinutes} minutes late`,
                    meta: {
                        employeeId: req.user._id,
                        employeeName: req.user.name,
                        checkInTime,
                        lateMinutes
                    }
                }));
                await Notification.insertMany(managerNotifications);
            }
        }

        res.json({
            message: isLate ? 'Checked in successfully (Late)' : 'Checked in successfully',
            data: {
                attendanceId: attendance._id,
                checkInTime: attendance.checkInTime,
                isLate: attendance.isLate,
                location: attendance.location
            }
        });

    } catch (err) {
        console.error('Check-in error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EMPLOYEE: CHECK-OUT =====
router.post('/check-out', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        const { notes } = req.body;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Find today's attendance
        const attendance = await Attendance.findOne({
            employee: req.user._id,
            date: today,
            status: 'checked_in'
        });

        if (!attendance) {
            return res.status(400).json({
                message: 'No active check-in found for today. Please check in first.'
            });
        }

        // Update check-out time
        attendance.checkOutTime = new Date();
        attendance.status = 'checked_out';
        if (notes) {
            attendance.notes = attendance.notes ? `${attendance.notes} | ${notes}` : notes;
        }

        // Calculate hours (pre-save hook will handle this)
        await attendance.save();

        // Check for overtime
        let overtimeNotification = null;
        if (attendance.overtimeHours > 0) {
            overtimeNotification = await Notification.create({
                user: req.user._id,
                type: 'attendance_overtime',
                title: '⏱️ Overtime Recorded',
                body: `You worked ${attendance.overtimeHours} hours of overtime today`,
                meta: {
                    attendanceId: attendance._id,
                    totalHours: attendance.totalHours,
                    overtimeHours: attendance.overtimeHours,
                    date: today
                }
            });
        }

        res.json({
            message: 'Checked out successfully',
            data: {
                attendanceId: attendance._id,
                checkInTime: attendance.checkInTime,
                checkOutTime: attendance.checkOutTime,
                totalHours: attendance.totalHours,
                overtimeHours: attendance.overtimeHours,
                isEarly: attendance.isEarly,
                isLate: attendance.isLate
            }
        });

    } catch (err) {
        console.error('Check-out error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET MY ATTENDANCE HISTORY =====
router.get('/my-attendance', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        const { from, to, status } = req.query;

        const query = { employee: req.user._id };

        if (from && to) {
            query.date = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        }

        if (status) {
            query.status = status;
        }

        const attendanceRecords = await Attendance.find(query)
            .sort({ date: -1 })
            .limit(100);

        // Calculate statistics
        const stats = {
            totalDays: attendanceRecords.length,
            lateDays: attendanceRecords.filter(a => a.isLate).length,
            earlyCheckouts: attendanceRecords.filter(a => a.isEarly).length,
            totalHours: attendanceRecords.reduce((sum, a) => sum + (a.totalHours || 0), 0),
            totalOvertime: attendanceRecords.reduce((sum, a) => sum + (a.overtimeHours || 0), 0),
            averageHours: 0
        };

        if (stats.totalDays > 0) {
            stats.averageHours = Math.round((stats.totalHours / stats.totalDays) * 100) / 100;
        }

        res.json({
            message: 'Attendance history retrieved successfully',
            data: attendanceRecords,
            stats
        });

    } catch (err) {
        console.error('Get attendance error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET SPECIFIC EMPLOYEE ATTENDANCE (Manager/Admin) =====
router.get('/:employeeId', auth, permit('manager', 'admin'), async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { from, to } = req.query;

        const query = { employee: employeeId };

        if (from && to) {
            query.date = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        } else {
            // Default: last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            query.date = { $gte: thirtyDaysAgo };
        }

        const attendanceRecords = await Attendance.find(query)
            .populate('employee', 'name email')
            .sort({ date: -1 });

        const stats = {
            totalDays: attendanceRecords.length,
            lateDays: attendanceRecords.filter(a => a.isLate).length,
            earlyCheckouts: attendanceRecords.filter(a => a.isEarly).length,
            totalHours: attendanceRecords.reduce((sum, a) => sum + (a.totalHours || 0), 0),
            totalOvertime: attendanceRecords.reduce((sum, a) => sum + (a.overtimeHours || 0), 0),
            averageHours: 0
        };

        if (stats.totalDays > 0) {
            stats.averageHours = Math.round((stats.totalHours / stats.totalDays) * 100) / 100;
        }

        res.json({
            message: 'Employee attendance retrieved successfully',
            data: attendanceRecords,
            stats
        });

    } catch (err) {
        console.error('Get employee attendance error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET TEAM ATTENDANCE (Manager/Admin) =====
router.get('/team/all', auth, permit('manager', 'admin'), async (req, res) => {
    try {
        const { date, projectId } = req.query;

        // Parse the date string and create a proper range for local timezone
        // The date comes as YYYY-MM-DD format
        let targetStart, targetEnd;

        if (date) {
            // Create date range for the entire day in local timezone
            // We expand the range to ensure we capture all records regardless of timezone
            const [year, month, day] = date.split('-').map(Number);

            // Start from beginning of the day (midnight local time, but we go back 12 hours to be safe)
            targetStart = new Date(year, month - 1, day, 0, 0, 0, 0);
            // End at end of the day
            targetEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
        } else {
            // Today
            const now = new Date();
            targetStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            targetEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        }

        console.log(`📅 Attendance query: ${targetStart.toISOString()} to ${targetEnd.toISOString()}`);

        // Use range query for better timezone handling
        const query = {
            date: {
                $gte: targetStart,
                $lte: targetEnd
            }
        };

        if (projectId) {
            query.project = projectId;
        }

        const attendanceRecords = await Attendance.find(query)
            .populate('employee', 'name email role')
            .populate('project', 'name')
            .sort({ checkInTime: 1 });

        // Get all employees who haven't checked in
        const checkedInEmployees = attendanceRecords.map(a => a.employee._id.toString());
        const allEmployees = await User.find({
            role: { $in: ['employee', 'manager'] },
            _id: { $nin: checkedInEmployees }
        }).select('name email role');

        const absentEmployees = allEmployees.map(emp => ({
            employee: emp,
            status: 'absent',
            date: targetStart
        }));

        const summary = {
            totalEmployees: attendanceRecords.length + absentEmployees.length,
            present: attendanceRecords.length,
            absent: absentEmployees.length,
            late: attendanceRecords.filter(a => a.isLate).length,
            onTime: attendanceRecords.filter(a => !a.isLate).length,
            checkedOut: attendanceRecords.filter(a => a.status === 'checked_out').length,
            stillWorking: attendanceRecords.filter(a => a.status === 'checked_in').length
        };

        res.json({
            message: 'Team attendance retrieved successfully',
            data: {
                present: attendanceRecords,
                absent: absentEmployees
            },
            summary
        });

    } catch (err) {
        console.error('Get team attendance error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== REQUEST ATTENDANCE CORRECTION =====
router.post('/correction/:attendanceId', auth, permit('employee', 'manager', 'admin'), async (req, res) => {
    try {
        const { attendanceId } = req.params;
        const { reason, requestedCheckIn, requestedCheckOut } = req.body;

        if (!reason || (!requestedCheckIn && !requestedCheckOut)) {
            return res.status(400).json({
                message: 'Reason and at least one correction time are required'
            });
        }

        const attendance = await Attendance.findById(attendanceId);
        if (!attendance) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }

        if (String(attendance.employee) !== String(req.user._id)) {
            return res.status(403).json({ message: 'You can only request correction for your own attendance' });
        }

        attendance.correctionRequest = {
            reason,
            requestedCheckIn: requestedCheckIn ? new Date(requestedCheckIn) : attendance.checkInTime,
            requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : attendance.checkOutTime,
            requestedBy: req.user._id,
            requestedAt: new Date(),
            status: 'pending'
        };
        attendance.status = 'correction_requested';

        await attendance.save();

        // Notify managers
        const managers = await User.find({ role: { $in: ['manager', 'admin'] } });
        const notifications = managers.map(m => ({
            user: m._id,
            type: 'attendance_correction_requested',
            title: 'Attendance Correction Requested',
            body: `${req.user.name} requested attendance correction`,
            meta: {
                attendanceId: attendance._id,
                employeeId: req.user._id,
                employeeName: req.user.name,
                reason,
                originalCheckIn: attendance.checkInTime,
                originalCheckOut: attendance.checkOutTime,
                requestedCheckIn: attendance.correctionRequest.requestedCheckIn,
                requestedCheckOut: attendance.correctionRequest.requestedCheckOut
            }
        }));
        await Notification.insertMany(notifications);

        res.json({
            message: 'Correction request submitted successfully',
            data: {
                attendanceId: attendance._id,
                correctionRequest: attendance.correctionRequest
            }
        });

    } catch (err) {
        console.error('Request correction error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== APPROVE/REJECT ATTENDANCE CORRECTION =====
router.put('/correction/:attendanceId', auth, permit('manager', 'admin'), async (req, res) => {
    try {
        const { attendanceId } = req.params;
        const { action } = req.body; // 'approve' or 'reject'

        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({
                message: 'Invalid action. Must be "approve" or "reject"'
            });
        }

        const attendance = await Attendance.findById(attendanceId).populate('employee', 'name email');
        if (!attendance) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }

        if (!attendance.correctionRequest || attendance.correctionRequest.status !== 'pending') {
            return res.status(400).json({
                message: 'No pending correction request found'
            });
        }

        if (action === 'approve') {
            // Apply corrections
            attendance.checkInTime = attendance.correctionRequest.requestedCheckIn;
            attendance.checkOutTime = attendance.correctionRequest.requestedCheckOut;
            attendance.correctionRequest.status = 'approved';
            attendance.correctionRequest.approvedBy = req.user._id;
            attendance.correctionRequest.approvedAt = new Date();
            attendance.status = 'correction_approved';

            // Recalculate hours
            await attendance.save();

            // Notify employee
            await Notification.create({
                user: attendance.employee._id,
                type: 'attendance_correction_approved',
                title: '✅ Attendance Correction Approved',
                body: `Your attendance correction request has been approved by ${req.user.name}`,
                meta: {
                    attendanceId: attendance._id,
                    approvedBy: req.user._id,
                    approverName: req.user.name,
                    newCheckIn: attendance.checkInTime,
                    newCheckOut: attendance.checkOutTime
                }
            });

            res.json({
                message: 'Correction approved successfully',
                data: {
                    attendanceId: attendance._id,
                    checkInTime: attendance.checkInTime,
                    checkOutTime: attendance.checkOutTime,
                    totalHours: attendance.totalHours
                }
            });
        } else {
            // Reject correction
            attendance.correctionRequest.status = 'rejected';
            attendance.status = 'checked_out';

            await attendance.save();

            // Notify employee
            await Notification.create({
                user: attendance.employee._id,
                type: 'attendance_correction_rejected',
                title: '❌ Attendance Correction Rejected',
                body: `Your attendance correction request was rejected by ${req.user.name}`,
                meta: {
                    attendanceId: attendance._id,
                    rejectedBy: req.user._id,
                    rejectorName: req.user.name
                }
            });

            res.json({
                message: 'Correction rejected',
                data: {
                    attendanceId: attendance._id,
                    status: 'rejected'
                }
            });
        }

    } catch (err) {
        console.error('Approve/reject correction error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ATTENDANCE ANALYTICS (Admin) =====
router.get('/analytics/summary', auth, permit('admin', 'manager'), async (req, res) => {
    try {
        const { from, to } = req.query;

        const query = {};
        if (from && to) {
            query.date = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        } else {
            // Default: last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            query.date = { $gte: thirtyDaysAgo };
        }

        const records = await Attendance.find(query).populate('employee', 'name');

        const analytics = {
            totalRecords: records.length,
            uniqueEmployees: [...new Set(records.map(r => r.employee._id.toString()))].length,
            totalHoursWorked: Math.round(records.reduce((sum, r) => sum + (r.totalHours || 0), 0) * 100) / 100,
            totalOvertimeHours: Math.round(records.reduce((sum, r) => sum + (r.overtimeHours || 0), 0) * 100) / 100,
            lateCheckIns: records.filter(r => r.isLate).length,
            earlyCheckOuts: records.filter(r => r.isEarly).length,
            averageHoursPerDay: 0,
            attendanceRate: 0
        };

        if (analytics.totalRecords > 0) {
            analytics.averageHoursPerDay = Math.round((analytics.totalHoursWorked / analytics.totalRecords) * 100) / 100;
        }

        res.json({
            message: 'Attendance analytics retrieved successfully',
            data: analytics
        });

    } catch (err) {
        console.error('Get analytics error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ATTENDANCE BY DATE =====
router.get('/date/:date', auth, async (req, res) => {
    try {
        const { date } = req.params;

        // Parse date (format: YYYY-MM-DD)
        const targetDate = new Date(date);
        targetDate.setHours(0, 0, 0, 0);

        const nextDay = new Date(targetDate);
        nextDay.setDate(nextDay.getDate() + 1);

        // If employee, only return their own attendance
        const query = {
            date: {
                $gte: targetDate,
                $lt: nextDay
            }
        };

        if (req.user.role === 'employee') {
            query.employee = req.user._id;
        }

        const records = await Attendance.find(query).populate('employee', 'name email department');

        res.json({
            message: 'Attendance records retrieved successfully',
            data: records
        });
    } catch (err) {
        console.error('Get attendance by date error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ALL ATTENDANCE WITH PAGINATION =====
router.get('/', auth, permit('admin', 'manager'), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const skip = parseInt(req.query.skip) || 0;

        const records = await Attendance.find()
            .populate('employee', 'name email department')
            .sort({ date: -1, checkInTime: -1 })
            .limit(limit)
            .skip(skip);

        const total = await Attendance.countDocuments();

        res.json({
            message: 'Attendance records retrieved successfully',
            data: records,
            total,
            limit,
            skip
        });
    } catch (err) {
        console.error('Get all attendance error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET PENDING CORRECTION REQUESTS =====
router.get('/corrections/pending', auth, permit('admin', 'manager'), async (req, res) => {
    try {
        const corrections = await Attendance.find({
            status: 'correction_requested',
            'correctionRequest.status': 'pending'
        })
            .populate('employee', 'name email department')
            .sort({ 'correctionRequest.requestedAt': -1 });

        res.json({
            message: 'Pending correction requests retrieved',
            data: corrections
        });
    } catch (err) {
        console.error('Get corrections error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== APPROVE CORRECTION REQUEST =====
router.post('/corrections/:id/approve', auth, permit('admin', 'manager'), async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);

        if (!attendance) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }

        if (!attendance.correctionRequest || attendance.correctionRequest.status !== 'pending') {
            return res.status(400).json({ message: 'No pending correction request found' });
        }

        // Apply the correction
        if (attendance.correctionRequest.requestedCheckIn) {
            attendance.checkInTime = attendance.correctionRequest.requestedCheckIn;
        }
        if (attendance.correctionRequest.requestedCheckOut) {
            attendance.checkOutTime = attendance.correctionRequest.requestedCheckOut;
        }

        attendance.correctionRequest.status = 'approved';
        attendance.correctionRequest.approvedBy = req.user._id;
        attendance.correctionRequest.approvedAt = new Date();
        attendance.status = 'correction_approved';

        await attendance.save();

        // Notify employee
        await Notification.create({
            user: attendance.employee,
            type: 'attendance_correction_approved',
            title: '✅ Attendance Correction Approved',
            body: `Your attendance correction for ${attendance.date.toDateString()} has been approved`,
            meta: {
                attendanceId: attendance._id,
                date: attendance.date
            }
        });

        res.json({
            message: 'Correction request approved',
            data: attendance
        });
    } catch (err) {
        console.error('Approve correction error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== REJECT CORRECTION REQUEST =====
router.post('/corrections/:id/reject', auth, permit('admin', 'manager'), async (req, res) => {
    try {
        const { reason } = req.body;
        const attendance = await Attendance.findById(req.params.id);

        if (!attendance) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }

        if (!attendance.correctionRequest || attendance.correctionRequest.status !== 'pending') {
            return res.status(400).json({ message: 'No pending correction request found' });
        }

        attendance.correctionRequest.status = 'rejected';
        attendance.correctionRequest.reason = (attendance.correctionRequest.reason || '') + ' [REJECTED: ' + (reason || 'No reason provided') + ']';
        attendance.status = 'checked_out'; // Revert to previous status

        await attendance.save();

        // Notify employee
        await Notification.create({
            user: attendance.employee,
            type: 'attendance_correction_rejected',
            title: '❌ Attendance Correction Rejected',
            body: `Your attendance correction for ${attendance.date.toDateString()} has been rejected: ${attendance.correctionRejectionReason}`,
            meta: {
                attendanceId: attendance._id,
                date: attendance.date,
                reason: attendance.correctionRejectionReason
            }
        });

        res.json({
            message: 'Correction request rejected',
            data: attendance
        });
    } catch (err) {
        console.error('Reject correction error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
