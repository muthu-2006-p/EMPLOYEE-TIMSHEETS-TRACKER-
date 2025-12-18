const express = require('express');
const router = express.Router();
const LeaveRequest = require('../models/LeaveRequest');
const LeaveBalance = require('../models/LeaveBalance');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, permit } = require('../middleware/auth');

// ===== EMPLOYEE: REQUEST LEAVE =====
router.post('/request', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const {
            leaveType,
            fromDate,
            toDate,
            permissionHours,
            reason,
            attachments,
            isEmergency
        } = req.body;

        // Validation
        if (!leaveType || !fromDate || !reason) {
            return res.status(400).json({
                message: 'Missing required fields: leaveType, fromDate, reason'
            });
        }

        const validLeaveTypes = ['CL', 'SL', 'EL', 'WFH', 'PERMISSION'];
        if (!validLeaveTypes.includes(leaveType)) {
            return res.status(400).json({
                message: 'Invalid leave type. Must be one of: CL, SL, EL, WFH, PERMISSION'
            });
        }

        if (leaveType === 'PERMISSION') {
            if (!permissionHours || permissionHours < 1 || permissionHours > 4) {
                return res.status(400).json({
                    message: 'Permission hours must be between 1 and 4'
                });
            }
        } else {
            if (!toDate) {
                return res.status(400).json({
                    message: 'toDate is required for day-based leave types'
                });
            }
        }

        if (reason.length < 10) {
            return res.status(400).json({
                message: 'Reason must be at least 10 characters long'
            });
        }

        // Check leave balance
        let leaveBalance = await LeaveBalance.findOne({
            employee: req.user._id,
            year: new Date().getFullYear()
        });

        if (!leaveBalance) {
            leaveBalance = await LeaveBalance.initializeForEmployee(req.user._id);
        }

        // Calculate days
        let totalDays = 0;
        if (leaveType !== 'PERMISSION') {
            const from = new Date(fromDate);
            const to = new Date(toDate);
            const diffTime = Math.abs(to - from);
            totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        }

        // Check if sufficient balance
        const typeMap = {
            'CL': 'casualLeave',
            'SL': 'sickLeave',
            'EL': 'earnedLeave',
            'WFH': 'workFromHome',
            'PERMISSION': 'permission'
        };

        const balanceField = typeMap[leaveType];
        const requiredBalance = leaveType === 'PERMISSION' ? permissionHours : totalDays;
        const availableBalance = leaveBalance[balanceField].balance;

        if (availableBalance < requiredBalance) {
            return res.status(400).json({
                message: `Insufficient ${leaveType} balance. Available: ${availableBalance}, Required: ${requiredBalance}`,
                data: {
                    available: availableBalance,
                    required: requiredBalance
                }
            });
        }

        // Create leave request
        const leaveRequest = new LeaveRequest({
            employee: req.user._id,
            leaveType,
            fromDate: new Date(fromDate),
            toDate: leaveType === 'PERMISSION' ? new Date(fromDate) : new Date(toDate),
            permissionHours: leaveType === 'PERMISSION' ? permissionHours : null,
            totalDays,
            reason,
            attachments: attachments || [],
            isEmergency: isEmergency || false,
            status: 'pending'
        });

        await leaveRequest.save();

        // Notify managers
        const managers = await User.find({ role: { $in: ['manager', 'admin'] } });
        const notifications = managers.map(m => ({
            user: m._id,
            type: 'leave_request_submitted',
            title: '📅 New Leave Request',
            body: `${req.user.name} requested ${leaveType} leave`,
            meta: {
                leaveRequestId: leaveRequest._id,
                employeeId: req.user._id,
                employeeName: req.user.name,
                leaveType,
                fromDate: leaveRequest.fromDate,
                toDate: leaveRequest.toDate,
                totalDays,
                permissionHours,
                reason,
                isEmergency
            }
        }));
        await Notification.insertMany(notifications);

        res.json({
            message: 'Leave request submitted successfully',
            data: {
                leaveRequestId: leaveRequest._id,
                leaveType,
                fromDate: leaveRequest.fromDate,
                toDate: leaveRequest.toDate,
                totalDays,
                permissionHours,
                status: 'pending',
                availableBalance: availableBalance - requiredBalance
            }
        });

    } catch (err) {
        console.error('Request leave error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ALL LEAVE REQUESTS (for analytics) =====
router.get('/', auth, permit('admin'), async(req, res) => {
    try {
        const leaveRequests = await LeaveRequest.find()
            .populate('employee', 'name email role')
            .sort({ appliedAt: -1 })
            .limit(500);

        res.json({
            message: 'Leave requests retrieved successfully',
            data: leaveRequests
        });

    } catch (err) {
        console.error('Get leave requests error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET MY LEAVE REQUESTS =====
router.get('/my-requests', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const { status, year } = req.query;

        const query = { employee: req.user._id };

        if (status) {
            query.status = status;
        }

        if (year) {
            const startOfYear = new Date(`${year}-01-01`);
            const endOfYear = new Date(`${year}-12-31`);
            query.fromDate = { $gte: startOfYear, $lte: endOfYear };
        }

        const leaveRequests = await LeaveRequest.find(query)
            .populate('approvedBy', 'name role')
            .populate('rejectedBy', 'name role')
            .sort({ appliedAt: -1 });

        const summary = {
            total: leaveRequests.length,
            pending: leaveRequests.filter(l => l.status === 'pending').length,
            approved: leaveRequests.filter(l => l.status === 'approved').length,
            rejected: leaveRequests.filter(l => l.status === 'rejected').length,
            cancelled: leaveRequests.filter(l => l.status === 'cancelled').length
        };

        res.json({
            message: 'Leave requests retrieved successfully',
            data: leaveRequests,
            summary
        });

    } catch (err) {
        console.error('Get my requests error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET PENDING LEAVE REQUESTS (Manager/Admin) =====
router.get('/pending', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const leaveRequests = await LeaveRequest.find({ status: 'pending' })
            .populate('employee', 'name email role')
            .sort({ appliedAt: 1 });

        res.json({
            message: 'Pending leave requests retrieved successfully',
            data: leaveRequests,
            count: leaveRequests.length
        });

    } catch (err) {
        console.error('Get pending requests error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ALL LEAVE REQUESTS (Manager/Admin) =====
router.get('/all', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { status, employeeId, leaveType, from, to } = req.query;

        const query = {};

        if (status) {
            query.status = status;
        }

        if (employeeId) {
            query.employee = employeeId;
        }

        if (leaveType) {
            query.leaveType = leaveType;
        }

        if (from && to) {
            query.fromDate = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        }

        const leaveRequests = await LeaveRequest.find(query)
            .populate('employee', 'name email role')
            .populate('approvedBy', 'name role')
            .populate('rejectedBy', 'name role')
            .sort({ appliedAt: -1 })
            .limit(200);

        const summary = {
            total: leaveRequests.length,
            pending: leaveRequests.filter(l => l.status === 'pending').length,
            approved: leaveRequests.filter(l => l.status === 'approved').length,
            rejected: leaveRequests.filter(l => l.status === 'rejected').length
        };

        res.json({
            message: 'Leave requests retrieved successfully',
            data: leaveRequests,
            summary
        });

    } catch (err) {
        console.error('Get all requests error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== APPROVE LEAVE REQUEST (Manager/Admin) =====
router.put('/approve/:id', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { id } = req.params;
        const { comments } = req.body;

        const leaveRequest = await LeaveRequest.findById(id).populate('employee', 'name email');
        if (!leaveRequest) {
            return res.status(404).json({ message: 'Leave request not found' });
        }

        if (leaveRequest.status !== 'pending') {
            return res.status(400).json({
                message: `Leave request is already ${leaveRequest.status}`
            });
        }

        // Get employee's leave balance
        const leaveBalance = await LeaveBalance.findOne({
            employee: leaveRequest.employee._id,
            year: new Date().getFullYear()
        });

        if (!leaveBalance) {
            return res.status(400).json({
                message: 'Leave balance not found for employee'
            });
        }

        // Deduct leave balance
        try {
            if (leaveRequest.leaveType === 'PERMISSION') {
                await leaveBalance.deductLeave(
                    leaveRequest.leaveType,
                    0,
                    leaveRequest.permissionHours
                );
            } else {
                await leaveBalance.deductLeave(
                    leaveRequest.leaveType,
                    leaveRequest.totalDays,
                    0
                );
            }
        } catch (balanceErr) {
            return res.status(400).json({
                message: balanceErr.message
            });
        }

        // Update leave request
        leaveRequest.status = 'approved';
        leaveRequest.approvedBy = req.user._id;
        leaveRequest.approvedAt = new Date();
        leaveRequest.managerComments = comments || 'Approved';

        await leaveRequest.save();

        // Notify employee
        await Notification.create({
            user: leaveRequest.employee._id,
            type: 'leave_approved',
            title: '✅ Leave Request Approved',
            body: `Your ${leaveRequest.leaveType} leave request has been approved by ${req.user.name}`,
            meta: {
                leaveRequestId: leaveRequest._id,
                leaveType: leaveRequest.leaveType,
                fromDate: leaveRequest.fromDate,
                toDate: leaveRequest.toDate,
                approvedBy: req.user._id,
                approverName: req.user.name,
                comments
            }
        });

        res.json({
            message: 'Leave request approved successfully',
            data: {
                leaveRequestId: leaveRequest._id,
                status: 'approved',
                approvedBy: req.user._id,
                approvedAt: leaveRequest.approvedAt,
                remainingBalance: leaveBalance[{
                    'CL': 'casualLeave',
                    'SL': 'sickLeave',
                    'EL': 'earnedLeave',
                    'WFH': 'workFromHome',
                    'PERMISSION': 'permission'
                }[leaveRequest.leaveType]].balance
            }
        });

    } catch (err) {
        console.error('Approve leave error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== REJECT LEAVE REQUEST (Manager/Admin) =====
router.put('/reject/:id', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { id } = req.params;
        const { rejectionReason } = req.body;

        if (!rejectionReason) {
            return res.status(400).json({
                message: 'Rejection reason is required'
            });
        }

        const leaveRequest = await LeaveRequest.findById(id).populate('employee', 'name email');
        if (!leaveRequest) {
            return res.status(404).json({ message: 'Leave request not found' });
        }

        if (leaveRequest.status !== 'pending') {
            return res.status(400).json({
                message: `Leave request is already ${leaveRequest.status}`
            });
        }

        leaveRequest.status = 'rejected';
        leaveRequest.rejectedBy = req.user._id;
        leaveRequest.rejectedAt = new Date();
        leaveRequest.rejectionReason = rejectionReason;

        await leaveRequest.save();

        // Notify employee
        await Notification.create({
            user: leaveRequest.employee._id,
            type: 'leave_rejected',
            title: '❌ Leave Request Rejected',
            body: `Your ${leaveRequest.leaveType} leave request has been rejected`,
            meta: {
                leaveRequestId: leaveRequest._id,
                leaveType: leaveRequest.leaveType,
                fromDate: leaveRequest.fromDate,
                toDate: leaveRequest.toDate,
                rejectedBy: req.user._id,
                rejectorName: req.user.name,
                rejectionReason
            }
        });

        res.json({
            message: 'Leave request rejected',
            data: {
                leaveRequestId: leaveRequest._id,
                status: 'rejected',
                rejectedBy: req.user._id,
                rejectedAt: leaveRequest.rejectedAt,
                rejectionReason
            }
        });

    } catch (err) {
        console.error('Reject leave error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== CANCEL LEAVE REQUEST (Employee) =====
router.put('/cancel/:id', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const { id } = req.params;

        const leaveRequest = await LeaveRequest.findById(id);
        if (!leaveRequest) {
            return res.status(404).json({ message: 'Leave request not found' });
        }

        // Only owner can cancel their own leave
        if (String(leaveRequest.employee) !== String(req.user._id) && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'You can only cancel your own leave requests' });
        }

        if (leaveRequest.status === 'cancelled') {
            return res.status(400).json({ message: 'Leave request is already cancelled' });
        }

        // If leave was approved, restore balance
        if (leaveRequest.status === 'approved') {
            const leaveBalance = await LeaveBalance.findOne({
                employee: leaveRequest.employee,
                year: new Date().getFullYear()
            });

            if (leaveBalance) {
                if (leaveRequest.leaveType === 'PERMISSION') {
                    await leaveBalance.restoreLeave(leaveRequest.leaveType, 0, leaveRequest.permissionHours);
                } else {
                    await leaveBalance.restoreLeave(leaveRequest.leaveType, leaveRequest.totalDays, 0);
                }
            }
        }

        leaveRequest.status = 'cancelled';
        await leaveRequest.save();

        res.json({
            message: 'Leave request cancelled successfully',
            data: {
                leaveRequestId: leaveRequest._id,
                status: 'cancelled'
            }
        });

    } catch (err) {
        console.error('Cancel leave error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET LEAVE BALANCE =====
router.get('/balance/:employeeId?', auth, permit('employee', 'manager', 'admin'), async(req, res) => {
    try {
        const employeeId = req.params.employeeId || req.user._id;
        console.log('📊 Leave balance requested for employee:', employeeId);

        // Check permission
        if (String(employeeId) !== String(req.user._id) && !['manager', 'admin'].includes(req.user.role)) {
            return res.status(403).json({ message: 'You can only view your own leave balance' });
        }

        let leaveBalance = await LeaveBalance.findOne({
            employee: employeeId,
            year: new Date().getFullYear()
        }).populate('employee', 'name email');

        console.log('📊 Existing leave balance found:', !!leaveBalance);

        if (!leaveBalance) {
            console.log('📊 Creating new leave balance for employee:', employeeId);
            leaveBalance = await LeaveBalance.initializeForEmployee(employeeId);
            leaveBalance = await leaveBalance.populate('employee', 'name email');
            console.log('📊 New leave balance created:', leaveBalance);
        }

        console.log('📊 Leave balance details:', {
            CL: leaveBalance.casualLeave,
            SL: leaveBalance.sickLeave,
            EL: leaveBalance.earnedLeave,
            WFH: leaveBalance.workFromHome,
            PERM: leaveBalance.permission
        });

        res.json({
            message: 'Leave balance retrieved successfully',
            data: leaveBalance
        });

    } catch (err) {
        console.error('❌ Get balance error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== UPDATE LEAVE BALANCE (Admin only) =====
router.put('/balance/:employeeId', auth, permit('admin'), async(req, res) => {
    try {
        const { employeeId } = req.params;
        const { casualLeave, sickLeave, earnedLeave, workFromHome, permission } = req.body;

        let leaveBalance = await LeaveBalance.findOne({
            employee: employeeId,
            year: new Date().getFullYear()
        });

        if (!leaveBalance) {
            leaveBalance = await LeaveBalance.initializeForEmployee(employeeId);
        }

        // Update balances if provided
        if (casualLeave !== undefined) {
            leaveBalance.casualLeave.total = casualLeave.total || leaveBalance.casualLeave.total;
            leaveBalance.casualLeave.used = casualLeave.used || leaveBalance.casualLeave.used;
            leaveBalance.casualLeave.balance = leaveBalance.casualLeave.total - leaveBalance.casualLeave.used;
        }

        if (sickLeave !== undefined) {
            leaveBalance.sickLeave.total = sickLeave.total || leaveBalance.sickLeave.total;
            leaveBalance.sickLeave.used = sickLeave.used || leaveBalance.sickLeave.used;
            leaveBalance.sickLeave.balance = leaveBalance.sickLeave.total - leaveBalance.sickLeave.used;
        }

        if (earnedLeave !== undefined) {
            leaveBalance.earnedLeave.total = earnedLeave.total || leaveBalance.earnedLeave.total;
            leaveBalance.earnedLeave.used = earnedLeave.used || leaveBalance.earnedLeave.used;
            leaveBalance.earnedLeave.balance = leaveBalance.earnedLeave.total - leaveBalance.earnedLeave.used;
        }

        if (workFromHome !== undefined) {
            leaveBalance.workFromHome.total = workFromHome.total || leaveBalance.workFromHome.total;
            leaveBalance.workFromHome.used = workFromHome.used || leaveBalance.workFromHome.used;
            leaveBalance.workFromHome.balance = leaveBalance.workFromHome.total - leaveBalance.workFromHome.used;
        }

        if (permission !== undefined) {
            leaveBalance.permission.total = permission.total || leaveBalance.permission.total;
            leaveBalance.permission.used = permission.used || leaveBalance.permission.used;
            leaveBalance.permission.balance = leaveBalance.permission.total - leaveBalance.permission.used;
        }

        await leaveBalance.save();

        res.json({
            message: 'Leave balance updated successfully',
            data: leaveBalance
        });

    } catch (err) {
        console.error('Update balance error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ALL LEAVE BALANCES (Admin) =====
router.get('/balances', auth, permit('admin'), async(req, res) => {
    try {
        const currentYear = new Date().getFullYear();

        const balances = await LeaveBalance.find({
            year: currentYear
        }).populate('employee', 'name email role');

        // Calculate used leave from approved leave requests
        const balancesWithUsage = await Promise.all(balances.map(async(balance) => {
            const approvedLeaves = await LeaveRequest.find({
                employee: balance.employee._id,
                status: { $in: ['approved', 'approved_final'] },
                fromDate: {
                    $gte: new Date(currentYear, 0, 1),
                    $lte: new Date(currentYear, 11, 31)
                }
            });

            const usedLeave = approvedLeaves.reduce((total, leave) => total + (leave.totalDays || 0), 0);
            const remainingLeave = balance.totalAnnualLeave - usedLeave;

            return {
                employee: balance.employee,
                totalAnnualLeave: balance.totalAnnualLeave,
                usedLeave: usedLeave,
                remainingLeave: Math.max(0, remainingLeave),
                carryForward: balance.carryForward || 0
            };
        }));

        res.json({
            message: 'Leave balances retrieved successfully',
            data: balancesWithUsage
        });

    } catch (err) {
        console.error('Get leave balances error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET LEAVE ANALYTICS (Manager/Admin) =====
router.get('/analytics/summary', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { from, to } = req.query;

        const query = {};
        if (from && to) {
            query.fromDate = {
                $gte: new Date(from),
                $lte: new Date(to)
            };
        } else {
            // Default: current year
            const startOfYear = new Date(new Date().getFullYear(), 0, 1);
            const endOfYear = new Date(new Date().getFullYear(), 11, 31);
            query.fromDate = { $gte: startOfYear, $lte: endOfYear };
        }

        const leaveRequests = await LeaveRequest.find(query);

        const analytics = {
            totalRequests: leaveRequests.length,
            approved: leaveRequests.filter(l => l.status === 'approved').length,
            rejected: leaveRequests.filter(l => l.status === 'rejected').length,
            pending: leaveRequests.filter(l => l.status === 'pending').length,
            byType: {
                CL: leaveRequests.filter(l => l.leaveType === 'CL').length,
                SL: leaveRequests.filter(l => l.leaveType === 'SL').length,
                EL: leaveRequests.filter(l => l.leaveType === 'EL').length,
                WFH: leaveRequests.filter(l => l.leaveType === 'WFH').length,
                PERMISSION: leaveRequests.filter(l => l.leaveType === 'PERMISSION').length
            },
            totalDaysRequested: leaveRequests.reduce((sum, l) => sum + (l.totalDays || 0), 0),
            totalDaysApproved: leaveRequests.filter(l => l.status === 'approved').reduce((sum, l) => sum + (l.totalDays || 0), 0)
        };

        res.json({
            message: 'Leave analytics retrieved successfully',
            data: analytics
        });

    } catch (err) {
        console.error('Get analytics error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
