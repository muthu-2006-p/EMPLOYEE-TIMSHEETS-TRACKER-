const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Timesheet = require('../models/Timesheet');
const Task = require('../models/Task');
const Project = require('../models/Project');
const Attendance = require('../models/Attendance');
const Leave = require('../models/LeaveRequest');
const cacheManager = require('../utils/cache-manager');

// Groq API configuration
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ===== DATA RETRIEVAL TOOLS =====

// Get user's logged hours for a period
async function getLoggedHours(userId, period = 'week') {
    try {
        const now = new Date();
        let startDate;

        switch (period) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now.setDate(now.getDate() - 7));
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            default:
                startDate = new Date(now.setDate(now.getDate() - 7));
        }

        const timesheets = await Timesheet.find({
            employee: userId,
            date: { $gte: startDate }
        }).populate('project', 'name');

        const totalHours = timesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
        const overtimeHours = timesheets.reduce((sum, ts) => sum + (ts.overtimeHours || 0), 0);
        const pendingCount = timesheets.filter(ts => ts.status === 'pending').length;
        const approvedCount = timesheets.filter(ts => ts.status === 'approved').length;

        return {
            period,
            totalHours: totalHours.toFixed(2),
            overtimeHours: overtimeHours.toFixed(2),
            entryCount: timesheets.length,
            pendingCount,
            approvedCount,
            entries: timesheets.slice(-5).map(ts => ({
                date: new Date(ts.date).toLocaleDateString(),
                project: ts.project?.name || 'Unknown',
                hours: ts.totalHours,
                status: ts.status
            }))
        };
    } catch (error) {
        console.error('Error getting logged hours:', error);
        return { error: 'Failed to get logged hours' };
    }
}

// Get user's pending tasks
async function getPendingTasks(userId) {
    try {
        const tasks = await Task.find({
            'assignments.employee': userId,
            'assignments.status': { $in: ['assigned', 'in_progress'] }
        }).populate('project', 'name').limit(10);

        return {
            count: tasks.length,
            tasks: tasks.map(t => {
                const assignment = t.assignments.find(a =>
                    String(a.employee) === String(userId)
                );
                return {
                    title: t.title,
                    project: t.project?.name || 'Unknown',
                    status: assignment?.status || 'assigned',
                    dueDate: t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'No deadline',
                    priority: t.priority || 'normal'
                };
            })
        };
    } catch (error) {
        console.error('Error getting pending tasks:', error);
        return { error: 'Failed to get tasks' };
    }
}

// Get user's assigned projects
async function getAssignedProjects(userId) {
    try {
        // Find projects where user is a member or manager
        const projects = await Project.find({
            $or: [
                { members: userId },
                { manager: userId }
            ]
        }).populate('manager', 'name');

        return {
            count: projects.length,
            projects: projects.map(p => ({
                name: p.name,
                status: p.status || 'active',
                manager: p.manager?.name || 'Unknown',
                startDate: p.startDate ? new Date(p.startDate).toLocaleDateString() : '-',
                endDate: p.endDate ? new Date(p.endDate).toLocaleDateString() : '-'
            }))
        };
    } catch (error) {
        console.error('Error getting projects:', error);
        return { error: 'Failed to get projects' };
    }
}

// Check if user submitted timesheet today
async function checkTodayTimesheet(userId) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayEntry = await Timesheet.findOne({
            employee: userId,
            date: { $gte: today, $lt: tomorrow }
        });

        return {
            submitted: !!todayEntry,
            entry: todayEntry ? {
                hours: todayEntry.totalHours,
                status: todayEntry.status,
                project: todayEntry.project
            } : null,
            message: todayEntry
                ? `You submitted ${todayEntry.totalHours} hours today (${todayEntry.status})`
                : 'You have NOT submitted a timesheet for today yet!'
        };
    } catch (error) {
        return { error: 'Failed to check today\'s timesheet' };
    }
}

// Get attendance status
async function getAttendanceStatus(userId) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayAttendance = await Attendance.findOne({
            employee: userId,
            date: { $gte: today }
        });

        // Get this week's attendance
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());

        const weekAttendance = await Attendance.find({
            employee: userId,
            date: { $gte: weekStart }
        });

        return {
            today: todayAttendance ? {
                checkedIn: !!todayAttendance.checkInTime,
                checkedOut: !!todayAttendance.checkOutTime,
                checkInTime: todayAttendance.checkInTime ? new Date(todayAttendance.checkInTime).toLocaleTimeString() : null,
                checkOutTime: todayAttendance.checkOutTime ? new Date(todayAttendance.checkOutTime).toLocaleTimeString() : null,
                hoursWorked: todayAttendance.totalHours || 0
            } : { checkedIn: false, checkedOut: false },
            weekDaysPresent: weekAttendance.length,
            message: todayAttendance?.checkInTime
                ? `Checked in at ${new Date(todayAttendance.checkInTime).toLocaleTimeString()}`
                : 'Not checked in today'
        };
    } catch (error) {
        return { error: 'Failed to get attendance' };
    }
}

// Get leave balance
async function getLeaveBalance(userId) {
    try {
        const user = await User.findById(userId);
        const currentYear = new Date().getFullYear();

        // Get approved leaves this year
        const approvedLeaves = await Leave.find({
            employee: userId,
            status: 'approved',
            startDate: { $gte: new Date(currentYear, 0, 1) }
        });

        // Count used leaves by type
        const usedLeaves = { CL: 0, SL: 0, EL: 0, WFH: 0 };
        approvedLeaves.forEach(leave => {
            if (usedLeaves.hasOwnProperty(leave.leaveType)) {
                usedLeaves[leave.leaveType] += leave.totalDays || 1;
            }
        });

        // Standard leave allocations
        const allocations = { CL: 12, SL: 12, EL: 15, WFH: 52 };

        return {
            balance: {
                CL: { total: allocations.CL, used: usedLeaves.CL, remaining: allocations.CL - usedLeaves.CL },
                SL: { total: allocations.SL, used: usedLeaves.SL, remaining: allocations.SL - usedLeaves.SL },
                EL: { total: allocations.EL, used: usedLeaves.EL, remaining: allocations.EL - usedLeaves.EL },
                WFH: { total: allocations.WFH, used: usedLeaves.WFH, remaining: allocations.WFH - usedLeaves.WFH }
            },
            summary: `CL: ${allocations.CL - usedLeaves.CL}/${allocations.CL}, SL: ${allocations.SL - usedLeaves.SL}/${allocations.SL}, EL: ${allocations.EL - usedLeaves.EL}/${allocations.EL}`
        };
    } catch (error) {
        return { error: 'Failed to get leave balance' };
    }
}

// Get pending approvals (for managers)
async function getPendingApprovals(userId, role) {
    try {
        if (role !== 'manager' && role !== 'admin') {
            return { message: 'Only managers can view pending approvals' };
        }

        const pendingTimesheets = await Timesheet.find({
            status: 'pending'
        }).populate('employee', 'name').limit(10);

        const pendingLeaves = await Leave.find({
            status: 'pending'
        }).populate('employee', 'name').limit(10);

        return {
            timesheets: {
                count: pendingTimesheets.length,
                items: pendingTimesheets.map(ts => ({
                    employee: ts.employee?.name || 'Unknown',
                    date: new Date(ts.date).toLocaleDateString(),
                    hours: ts.totalHours
                }))
            },
            leaves: {
                count: pendingLeaves.length,
                items: pendingLeaves.map(l => ({
                    employee: l.employee?.name || 'Unknown',
                    type: l.leaveType,
                    days: l.totalDays || 1
                }))
            }
        };
    } catch (error) {
        return { error: 'Failed to get pending approvals' };
    }
}

// Get time spent on a project
async function getProjectTimeSpent(userId, projectName) {
    try {
        // Find project by name
        const project = await Project.findOne({
            name: { $regex: projectName, $options: 'i' }
        });

        if (!project) {
            return { error: `Project "${projectName}" not found` };
        }

        const timesheets = await Timesheet.find({
            employee: userId,
            project: project._id
        });

        const totalHours = timesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);

        // Group by month
        const monthlyBreakdown = {};
        timesheets.forEach(ts => {
            const month = new Date(ts.date).toLocaleString('default', { month: 'long', year: 'numeric' });
            monthlyBreakdown[month] = (monthlyBreakdown[month] || 0) + (ts.totalHours || 0);
        });

        return {
            projectName: project.name,
            totalHours: totalHours.toFixed(2),
            entryCount: timesheets.length,
            monthlyBreakdown
        };
    } catch (error) {
        return { error: 'Failed to get project time' };
    }
}

// ===== NEW INTELLIGENT TOOLS =====

// 1. Suggest task names based on user's history
async function suggestTaskNames(userId) {
    try {
        const timesheets = await Timesheet.find({
            employee: userId,
            description: { $exists: true, $ne: '' }
        }).populate('task', 'title').limit(50).sort({ date: -1 });

        // Count frequency of task descriptions
        const taskFrequency = {};
        timesheets.forEach(ts => {
            const desc = ts.description?.trim();
            if (desc && desc.length > 3) {
                taskFrequency[desc] = (taskFrequency[desc] || 0) + 1;
            }
        });

        // Get top 10 most frequent tasks
        const topTasks = Object.entries(taskFrequency)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([task, count]) => ({ task, timesUsed: count }));

        // Also get recent unique task names from Task model
        const recentTasks = await Task.find({
            'assignments.employee': userId
        }).populate('project', 'name').limit(10).sort({ createdAt: -1 });

        const taskNames = recentTasks.map(t => ({
            task: t.title,
            project: t.project?.name || 'Unknown'
        }));

        return {
            frequentTasks: topTasks,
            recentAssignedTasks: taskNames,
            message: topTasks.length > 0
                ? `Found ${topTasks.length} frequently used task descriptions in your history`
                : 'No historical task patterns found yet. Keep logging timesheets!'
        };
    } catch (error) {
        console.error('Error suggesting tasks:', error);
        return { error: 'Failed to suggest task names' };
    }
}

// 2. Get repeated entries for auto-fill
async function getRepeatedEntries(userId) {
    try {
        const timesheets = await Timesheet.find({
            employee: userId
        }).populate('project', 'name').populate('task', 'title').limit(50).sort({ date: -1 });

        // Find patterns: same project + task + hours
        const patterns = {};
        timesheets.forEach(ts => {
            if (ts.project && ts.task && ts.totalHours) {
                const key = `${ts.project._id}_${ts.task._id}_${ts.totalHours}`;
                if (!patterns[key]) {
                    patterns[key] = {
                        project: ts.project.name,
                        task: ts.task.title,
                        hours: ts.totalHours,
                        startTime: ts.startTime,
                        endTime: ts.endTime,
                        count: 0
                    };
                }
                patterns[key].count++;
            }
        });

        // Get patterns that repeat at least 3 times
        const repeatedPatterns = Object.values(patterns)
            .filter(p => p.count >= 3)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        return {
            patterns: repeatedPatterns,
            message: repeatedPatterns.length > 0
                ? `Found ${repeatedPatterns.length} repeated entry patterns you can reuse`
                : 'No repeated patterns found yet'
        };
    } catch (error) {
        return { error: 'Failed to get repeated entries' };
    }
}

// 3. Check for missing hours in a period
async function checkMissingHours(userId, period = 'week') {
    try {
        const now = new Date();
        let startDate, endDate = now;

        switch (period) {
            case 'week':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 7);
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            default:
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 7);
        }

        const timesheets = await Timesheet.find({
            employee: userId,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 });

        // Find days with no entries or low hours
        const daysMap = {};
        timesheets.forEach(ts => {
            const dateKey = new Date(ts.date).toDateString();
            daysMap[dateKey] = (daysMap[dateKey] || 0) + (ts.totalHours || 0);
        });

        const missingDays = [];
        const lowHourDays = [];
        const expectedHours = 8;

        // Check each weekday in the period
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dayOfWeek = d.getDay();
            // Skip weekends (0 = Sunday, 6 = Saturday)
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                const dateKey = d.toDateString();
                const hours = daysMap[dateKey] || 0;

                if (hours === 0) {
                    missingDays.push({ date: new Date(d).toLocaleDateString(), hours: 0 });
                } else if (hours < expectedHours) {
                    lowHourDays.push({ date: new Date(d).toLocaleDateString(), hours });
                }
            }
        }

        return {
            period,
            missingDays,
            lowHourDays,
            totalMissingDays: missingDays.length,
            totalLowHourDays: lowHourDays.length,
            message: missingDays.length > 0 || lowHourDays.length > 0
                ? `⚠️ Found ${missingDays.length} days with no entries and ${lowHourDays.length} days with low hours`
                : '✅ All days have adequate timesheet entries!'
        };
    } catch (error) {
        return { error: 'Failed to check missing hours' };
    }
}

// 4. Get upcoming deadlines
async function getUpcomingDeadlines(userId) {
    try {
        const now = new Date();
        const futureDate = new Date(now);
        futureDate.setDate(futureDate.getDate() + 14); // Next 2 weeks

        const tasks = await Task.find({
            'assignments.employee': userId,
            'assignments.deadline': { $gte: now, $lte: futureDate },
            'assignments.status': { $in: ['assigned', 'in_progress'] }
        }).populate('project', 'name').sort({ 'assignments.deadline': 1 });

        const deadlines = [];
        tasks.forEach(task => {
            const assignment = task.assignments.find(a =>
                String(a.employee) === String(userId) &&
                a.deadline >= now &&
                a.deadline <= futureDate
            );
            if (assignment) {
                const daysUntil = Math.ceil((assignment.deadline - now) / (1000 * 60 * 60 * 24));
                deadlines.push({
                    task: task.title,
                    project: task.project?.name || 'Unknown',
                    deadline: new Date(assignment.deadline).toLocaleDateString(),
                    daysUntil,
                    status: assignment.status,
                    urgent: daysUntil <= 3
                });
            }
        });

        const urgentCount = deadlines.filter(d => d.urgent).length;

        return {
            deadlines,
            count: deadlines.length,
            urgentCount,
            message: deadlines.length > 0
                ? urgentCount > 0
                    ? `⚠️ You have ${urgentCount} urgent deadlines (≤3 days) and ${deadlines.length} total upcoming deadlines`
                    : `You have ${deadlines.length} upcoming deadlines in the next 2 weeks`
                : 'No upcoming deadlines in the next 2 weeks'
        };
    } catch (error) {
        return { error: 'Failed to get upcoming deadlines' };
    }
}

// 5. Detect incomplete timesheet entries
async function detectIncompleteEntries(userId, period = 'week') {
    try {
        const now = new Date();
        let startDate;

        switch (period) {
            case 'week':
                startDate = new Date(now.setDate(now.getDate() - 7));
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            default:
                startDate = new Date(now.setDate(now.getDate() - 7));
        }

        const timesheets = await Timesheet.find({
            employee: userId,
            date: { $gte: startDate }
        }).populate('project', 'name').populate('task', 'title');

        const incompleteEntries = timesheets.filter(ts => {
            return !ts.project || !ts.task || !ts.description || ts.totalHours <= 0;
        }).map(ts => ({
            date: new Date(ts.date).toLocaleDateString(),
            missing: [
                !ts.project ? 'project' : null,
                !ts.task ? 'task' : null,
                !ts.description ? 'description' : null,
                ts.totalHours <= 0 ? 'valid hours' : null
            ].filter(Boolean),
            hours: ts.totalHours || 0
        }));

        return {
            incompleteEntries,
            count: incompleteEntries.length,
            message: incompleteEntries.length > 0
                ? `⚠️ Found ${incompleteEntries.length} incomplete timesheet entries with missing information`
                : '✅ All your timesheet entries are complete!'
        };
    } catch (error) {
        return { error: 'Failed to detect incomplete entries' };
    }
}

// 6. Detect overlapping hours
async function detectOverlappingHours(userId, period = 'week') {
    try {
        const now = new Date();
        let startDate;

        switch (period) {
            case 'week':
                startDate = new Date(now.setDate(now.getDate() - 7));
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            default:
                startDate = new Date(now.setDate(now.getDate() - 7));
        }

        const timesheets = await Timesheet.find({
            employee: userId,
            date: { $gte: startDate }
        }).populate('project', 'name').sort({ date: 1, startTime: 1 });

        // Group by date
        const dateGroups = {};
        timesheets.forEach(ts => {
            const dateKey = new Date(ts.date).toDateString();
            if (!dateGroups[dateKey]) {
                dateGroups[dateKey] = [];
            }
            dateGroups[dateKey].push({
                project: ts.project?.name || 'Unknown',
                startTime: ts.startTime,
                endTime: ts.endTime,
                hours: ts.totalHours
            });
        });

        const overlaps = [];

        // Check for overlaps within each day
        Object.entries(dateGroups).forEach(([date, entries]) => {
            for (let i = 0; i < entries.length; i++) {
                for (let j = i + 1; j < entries.length; j++) {
                    const e1 = entries[i];
                    const e2 = entries[j];

                    // Simple time overlap check (assumes HH:MM format)
                    if (e1.startTime && e2.startTime && e1.endTime && e2.endTime) {
                        const [h1s, m1s] = e1.startTime.split(':').map(Number);
                        const [h1e, m1e] = e1.endTime.split(':').map(Number);
                        const [h2s, m2s] = e2.startTime.split(':').map(Number);
                        const [h2e, m2e] = e2.endTime.split(':').map(Number);

                        const t1s = h1s * 60 + m1s;
                        const t1e = h1e * 60 + m1e;
                        const t2s = h2s * 60 + m2s;
                        const t2e = h2e * 60 + m2e;

                        // Check if times overlap
                        if ((t1s < t2e && t1e > t2s) || (t2s < t1e && t2e > t1s)) {
                            overlaps.push({
                                date: new Date(date).toLocaleDateString(),
                                entry1: `${e1.project} (${e1.startTime}-${e1.endTime})`,
                                entry2: `${e2.project} (${e2.startTime}-${e2.endTime})`
                            });
                        }
                    }
                }
            }
        });

        return {
            overlaps,
            count: overlaps.length,
            message: overlaps.length > 0
                ? `🔴 Found ${overlaps.length} overlapping time entries that need correction`
                : '✅ No overlapping hours detected!'
        };
    } catch (error) {
        return { error: 'Failed to detect overlapping hours' };
    }
}

// 7. Check overtime limits
async function checkOvertimeLimits(userId, period = 'month') {
    try {
        const now = new Date();
        let startDate;

        switch (period) {
            case 'week':
                startDate = new Date(now.setDate(now.getDate() - 7));
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        const timesheets = await Timesheet.find({
            employee: userId,
            date: { $gte: startDate }
        }).sort({ date: 1 });

        const dailyHours = {};
        let totalOvertime = 0;

        timesheets.forEach(ts => {
            const dateKey = new Date(ts.date).toDateString();
            dailyHours[dateKey] = (dailyHours[dateKey] || 0) + (ts.totalHours || 0);
            totalOvertime += (ts.overtimeHours || 0);
        });

        // Find days exceeding 8 hours
        const overtimeDays = Object.entries(dailyHours)
            .filter(([date, hours]) => hours > 8)
            .map(([date, hours]) => ({
                date: new Date(date).toLocaleDateString(),
                hours: hours.toFixed(2),
                overtime: (hours - 8).toFixed(2)
            }));

        // Company limit: 20 hours overtime per month
        const monthlyOvertimeLimit = 20;
        const exceedsLimit = totalOvertime > monthlyOvertimeLimit;

        return {
            totalOvertime: totalOvertime.toFixed(2),
            monthlyLimit: monthlyOvertimeLimit,
            exceedsLimit,
            overtimeDays,
            message: exceedsLimit
                ? `🔴 WARNING: Your overtime (${totalOvertime.toFixed(2)} hrs) exceeds the monthly limit of ${monthlyOvertimeLimit} hours!`
                : totalOvertime > 0
                    ? `You have logged ${totalOvertime.toFixed(2)} hours of overtime this ${period} (within ${monthlyOvertimeLimit} hr limit)`
                    : `No overtime logged this ${period}`
        };
    } catch (error) {
        return { error: 'Failed to check overtime limits' };
    }
}

// 8. Suggest corrections for detected errors
async function suggestCorrections(userId) {
    try {
        // Run all error detection tools
        const [incomplete, overlaps, overtime, missing] = await Promise.all([
            detectIncompleteEntries(userId, 'week'),
            detectOverlappingHours(userId, 'week'),
            checkOvertimeLimits(userId, 'month'),
            checkMissingHours(userId, 'week')
        ]);

        const suggestions = [];

        if (incomplete.count > 0) {
            suggestions.push({
                issue: 'Incomplete Entries',
                count: incomplete.count,
                suggestion: 'Add missing project, task, or description to these timesheets'
            });
        }

        if (overlaps.count > 0) {
            suggestions.push({
                issue: 'Overlapping Hours',
                count: overlaps.count,
                suggestion: 'Adjust start/end times to remove overlaps between tasks'
            });
        }

        if (overtime.exceedsLimit) {
            suggestions.push({
                issue: 'Excessive Overtime',
                hours: overtime.totalOvertime,
                suggestion: 'Contact your manager to discuss overtime approval or redistribute hours'
            });
        }

        if (missing.totalMissingDays > 0) {
            suggestions.push({
                issue: 'Missing Days',
                count: missing.totalMissingDays,
                suggestion: `Submit timesheets for ${missing.totalMissingDays} missing working days`
            });
        }

        return {
            suggestions,
            issueCount: suggestions.length,
            message: suggestions.length > 0
                ? `Found ${suggestions.length} issues that need your attention`
                : '✅ No issues found! Your timesheets look great.'
        };
    } catch (error) {
        return { error: 'Failed to suggest corrections' };
    }
}

// 9. Get today's tasks
async function getTodayTasks(userId) {
    try {
        const tasks = await Task.find({
            'assignments.employee': userId,
            'assignments.status': { $in: ['assigned', 'in_progress'] }
        }).populate('project', 'name');

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayTasks = [];
        const urgentTasks = [];

        tasks.forEach(task => {
            const assignment = task.assignments.find(a =>
                String(a.employee) === String(userId)
            );

            if (assignment) {
                const taskInfo = {
                    title: task.title,
                    project: task.project?.name || 'Unknown',
                    status: assignment.status,
                    progress: assignment.progress || 0,
                    deadline: assignment.deadline ? new Date(assignment.deadline).toLocaleDateString() : 'No deadline'
                };

                // Check if deadline is today or urgent
                if (assignment.deadline) {
                    const deadlineDate = new Date(assignment.deadline);
                    if (deadlineDate >= today && deadlineDate < tomorrow) {
                        todayTasks.push({ ...taskInfo, urgency: 'Due Today!' });
                    } else if (deadlineDate < today) {
                        urgentTasks.push({ ...taskInfo, urgency: 'OVERDUE!' });
                    }
                }
            }
        });

        return {
            todayTasks,
            urgentTasks,
            todayCount: todayTasks.length,
            urgentCount: urgentTasks.length,
            message: urgentTasks.length > 0
                ? `🔴 You have ${urgentTasks.length} overdue tasks!`
                : todayTasks.length > 0
                    ? `You have ${todayTasks.length} tasks due today`
                    : 'No tasks due today'
        };
    } catch (error) {
        return { error: 'Failed to get today\'s tasks' };
    }
}

// 10. Get employees with missing timesheets (manager only)
async function getManagerMissingTimesheets(userId, userRole, period = 'week') {
    try {
        if (userRole !== 'manager' && userRole !== 'admin') {
            return { message: 'Only managers can view team timesheet status' };
        }

        const now = new Date();
        let startDate;

        switch (period) {
            case 'today':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'week':
                startDate = new Date(now.setDate(now.getDate() - 7));
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            default:
                startDate = new Date(now.setDate(now.getDate() - 7));
        }

        // Get all employees under this manager
        const employees = await User.find({
            manager: userId,
            role: 'employee',
            isActive: true
        });

        const missingList = [];

        for (const emp of employees) {
            const timesheets = await Timesheet.find({
                employee: emp._id,
                date: { $gte: startDate }
            });

            // Count expected working days
            let expectedDays = 0;
            for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
                const dayOfWeek = d.getDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6) expectedDays++;
            }

            const submittedDays = timesheets.length;
            const missingDays = expectedDays - submittedDays;

            if (missingDays > 0) {
                missingList.push({
                    employee: emp.name,
                    email: emp.email,
                    submittedDays,
                    missingDays,
                    completionRate: ((submittedDays / expectedDays) * 100).toFixed(0) + '%'
                });
            }
        }

        missingList.sort((a, b) => b.missingDays - a.missingDays);

        return {
            period,
            employeesWithMissing: missingList,
            count: missingList.length,
            totalEmployees: employees.length,
            message: missingList.length > 0
                ? `${missingList.length} out of ${employees.length} employees have missing timesheets`
                : `All ${employees.length} employees have submitted complete timesheets!`
        };
    } catch (error) {
        return { error: 'Failed to get missing timesheets' };
    }
}

// 11. Get top loggers (manager only)
async function getTopLoggers(userId, userRole, period = 'month') {
    try {
        if (userRole !== 'manager' && userRole !== 'admin') {
            return { message: 'Only managers can view team logging statistics' };
        }

        const now = new Date();
        let startDate;

        switch (period) {
            case 'week':
                startDate = new Date(now.setDate(now.getDate() - 7));
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        // Get all employees under this manager
        const employees = await User.find({
            manager: userId,
            role: 'employee',
            isActive: true
        });

        const loggerStats = [];

        for (const emp of employees) {
            const timesheets = await Timesheet.find({
                employee: emp._id,
                date: { $gte: startDate }
            });

            const totalHours = timesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
            const overtimeHours = timesheets.reduce((sum, ts) => sum + (ts.overtimeHours || 0), 0);

            if (totalHours > 0) {
                loggerStats.push({
                    employee: emp.name,
                    totalHours: totalHours.toFixed(2),
                    overtimeHours: overtimeHours.toFixed(2),
                    entryCount: timesheets.length,
                    avgHoursPerDay: (totalHours / timesheets.length).toFixed(2)
                });
            }
        }

        loggerStats.sort((a, b) => parseFloat(b.totalHours) - parseFloat(a.totalHours));
        const topLoggers = loggerStats.slice(0, 10);

        return {
            period,
            topLoggers,
            count: topLoggers.length,
            message: topLoggers.length > 0
                ? `Top ${topLoggers.length} employees by logged hours this ${period}`
                : 'No timesheet data available for this period'
        };
    } catch (error) {
        return { error: 'Failed to get top loggers' };
    }
}

// 12. Get onboarding help
async function getOnboardingHelp(topic) {
    const guides = {
        'submit_timesheet': {
            title: 'How to Submit a Timesheet',
            steps: [
                '1. Go to the Timesheets page from the navigation menu',
                '2. Click the "Add New Timesheet" button',
                '3. Select the date for your timesheet',
                '4. Choose the project you worked on from the dropdown',
                '5. Select the specific task (if applicable)',
                '6. Enter start time and end time (e.g., 09:00 AM - 06:00 PM)',
                '7. Add break time in minutes (default is 60 minutes)',
                '8. Write a detailed description of work done',
                '9. Click "Submit" to send for approval',
                '10. Your manager will review and approve/reject it'
            ],
            tips: [
                '💡 Submit timesheets daily for better accuracy',
                '💡 Be specific in descriptions to help your manager understand your work',
                '💡 Check for errors before submitting using the chatbot'
            ]
        },
        'apply_leave': {
            title: 'How to Apply for Leave',
            steps: [
                '1. Navigate to the Leave Management section',
                '2. Click "Apply for Leave" button',
                '3. Select leave type: CL (Casual), SL (Sick), EL (Earned), or WFH',
                '4. Choose start date and end date',
                '5. Enter reason for leave',
                '6. Click "Submit Application"',
                '7. Wait for manager approval',
                '8. You\'ll receive a notification when approved/rejected'
            ],
            tips: [
                '💡 Check your leave balance before applying',
                '💡 Apply for leave at least 2 days in advance',
                '💡 CL: 12 days/year, SL: 12 days/year, EL: 15 days/year, WFH: 52 days/year'
            ]
        },
        'check_in': {
            title: 'How to Check In/Out',
            steps: [
                '1. Go to the Attendance section',
                '2. Click "Check In" button when you start work',
                '3. System records your check-in time automatically',
                '4. Click "Check Out" when leaving for the day',
                '5. Total hours worked will be calculated automatically'
            ],
            tips: [
                '💡 Standard work hours: 9 AM - 6 PM',
                '💡 Remember to check in daily',
                '💡 Check in/out times affect your attendance record'
            ]
        },
        'complete_task': {
            title: 'How to Complete a Task',
            steps: [
                '1. Go to Tasks section',
                '2. Find your assigned task',
                '3. Click on the task to view details',
                '4. Update progress percentage as you work',
                '5. When done, click "Mark as Complete"',
                '6. Submit proof of work (GitHub link, demo video)',
                '7. Add completion notes explaining your work',
                '8. Manager will review and approve'
            ],
            tips: [
                '💡 Update task progress regularly',
                '💡 Provide clear proof of completion',
                '💡 Tasks may require rework if defects are found'
            ]
        },
        'view_reports': {
            title: 'How to View Reports',
            steps: [
                '1. Navigate to Reports section',
                '2. Select report type (Timesheet, Attendance, Leave)',
                '3. Choose date range (week, month, custom)',
                '4. Click "Generate Report"',
                '5. View charts and statistics',
                '6. Download as PDF or Excel if needed'
            ],
            tips: [
                '💡 Use reports to track your productivity',
                '💡 Managers can see team-wide reports',
                '💡 Export reports for record keeping'
            ]
        }
    };

    const topicKey = topic?.toLowerCase().replace(/\s+/g, '_') || 'general';
    const guide = guides[topicKey];

    if (guide) {
        return {
            guide,
            topic: topicKey,
            message: `Here's how to ${topic || 'get started'}:`
        };
    }

    return {
        availableTopics: Object.keys(guides).map(k => k.replace(/_/g, ' ')),
        message: 'Available help topics: submit timesheet, apply leave, check in, complete task, view reports'
    };
}

// Execute tool based on name (WITH CACHING)

async function executeTool(toolName, userId, userRole, params = {}) {
    // Check cache first
    const cachedResult = cacheManager.getCachedToolResult(toolName, userId, params);
    if (cachedResult) {
        return cachedResult;
    }

    // Execute tool
    let result;
    switch (toolName) {
        case 'getLoggedHours':
            result = await getLoggedHours(userId, params.period);
            break;
        case 'getPendingTasks':
            result = await getPendingTasks(userId);
            break;
        case 'getAssignedProjects':
            result = await getAssignedProjects(userId);
            break;
        case 'checkTodayTimesheet':
            result = await checkTodayTimesheet(userId);
            break;
        case 'getAttendanceStatus':
            result = await getAttendanceStatus(userId);
            break;
        case 'getLeaveBalance':
            result = await getLeaveBalance(userId);
            break;
        case 'getPendingApprovals':
            result = await getPendingApprovals(userId, userRole);
            break;
        case 'getProjectTimeSpent':
            result = await getProjectTimeSpent(userId, params.projectName);
            break;
        // NEW INTELLIGENT TOOLS
        case 'suggestTaskNames':
            result = await suggestTaskNames(userId);
            break;
        case 'getRepeatedEntries':
            result = await getRepeatedEntries(userId);
            break;
        case 'checkMissingHours':
            result = await checkMissingHours(userId, params.period);
            break;
        case 'getUpcomingDeadlines':
            result = await getUpcomingDeadlines(userId);
            break;
        case 'detectIncompleteEntries':
            result = await detectIncompleteEntries(userId, params.period);
            break;
        case 'detectOverlappingHours':
            result = await detectOverlappingHours(userId, params.period);
            break;
        case 'checkOvertimeLimits':
            result = await checkOvertimeLimits(userId, params.period);
            break;
        case 'suggestCorrections':
            result = await suggestCorrections(userId);
            break;
        case 'getTodayTasks':
            result = await getTodayTasks(userId);
            break;
        case 'getManagerMissingTimesheets':
            result = await getManagerMissingTimesheets(userId, userRole, params.period);
            break;
        case 'getTopLoggers':
            result = await getTopLoggers(userId, userRole, params.period);
            break;
        case 'getOnboardingHelp':
            result = await getOnboardingHelp(params.topic);
            break;
        default:
            result = { error: 'Unknown tool' };
    }

    // Cache the result before returning
    if (result && !result.error) {
        cacheManager.setCachedToolResult(toolName, userId, result, params);
    }

    return result;
}


// Enhanced System prompt with tool definitions
const SYSTEM_PROMPT = `You are an intelligent AI assistant for the Employee Timesheet Tracker.

## YOUR CAPABILITIES
You are a proactive, helpful AI assistant with access to 20 TOOLS that can query and analyze real user data. You can:
- Help employees fill timesheets correctly with smart suggestions
- Automatically detect errors and suggest corrections
- Provide instant answers to timesheet, task, and attendance questions
- Reduce HR/Admin workload by handling common queries
- Offer project and task insights for employees and managers
- Send smart reminders about deadlines and missing entries
- Provide step-by-step training and onboarding help

## AVAILABLE TOOLS (use JSON format to call)
To use a tool, respond with: TOOL_CALL: {"tool": "toolName", "params": {...}}

### 📊 DATA QUERY TOOLS (Basic Information)

1. **getLoggedHours** - Get user's logged hours summary
   TOOL_CALL: {"tool": "getLoggedHours", "params": {"period": "week"}}
   periods: "today", "week", "month"

2. **getPendingTasks** - Get user's assigned/in-progress tasks
   TOOL_CALL: {"tool": "getPendingTasks", "params": {}}

3. **getAssignedProjects** - Get projects user is assigned to
   TOOL_CALL: {"tool": "getAssignedProjects", "params": {}}

4. **checkTodayTimesheet** - Check if user submitted timesheet today
   TOOL_CALL: {"tool": "checkTodayTimesheet", "params": {}}

5. **getAttendanceStatus** - Get attendance check-in/out status
   TOOL_CALL: {"tool": "getAttendanceStatus", "params": {}}

6. **getLeaveBalance** - Get remaining leave balance
   TOOL_CALL: {"tool": "getLeaveBalance", "params": {}}

7. **getPendingApprovals** - Get pending approvals (managers only)
   TOOL_CALL: {"tool": "getPendingApprovals", "params": {}}

8. **getProjectTimeSpent** - Get time logged on specific project
   TOOL_CALL: {"tool": "getProjectTimeSpent", "params": {"projectName": "Project Name"}}

### 🎯 TIMESHEET ASSISTANCE TOOLS (Help Fill Correctly)

9. **suggestTaskNames** - Suggest frequently used task descriptions from history
   TOOL_CALL: {"tool": "suggestTaskNames", "params": {}}

10. **getRepeatedEntries** - Find repeated timesheet patterns for auto-fill
    TOOL_CALL: {"tool": "getRepeatedEntries", "params": {}}

11. **checkMissingHours** - Identify days with no or incomplete hours
    TOOL_CALL: {"tool": "checkMissingHours", "params": {"period": "week"}}
    periods: "week", "month"

12. **getUpcomingDeadlines** - Show task deadlines in next 2 weeks
    TOOL_CALL: {"tool": "getUpcomingDeadlines", "params": {}}

### 🔍 ERROR DETECTION TOOLS (Find & Fix Mistakes)

13. **detectIncompleteEntries** - Find timesheets with missing fields
    TOOL_CALL: {"tool": "detectIncompleteEntries", "params": {"period": "week"}}

14. **detectOverlappingHours** - Identify overlapping time entries
    TOOL_CALL: {"tool": "detectOverlappingHours", "params": {"period": "week"}}

15. **checkOvertimeLimits** - Check if overtime exceeds company limits
    TOOL_CALL: {"tool": "checkOvertimeLimits", "params": {"period": "month"}}

16. **suggestCorrections** - Run all error checks and suggest fixes
    TOOL_CALL: {"tool": "suggestCorrections", "params": {}}

### 📈 ADVANCED INSIGHTS TOOLS

17. **getTodayTasks** - Get tasks due today or overdue
    TOOL_CALL: {"tool": "getTodayTasks", "params": {}}

18. **getManagerMissingTimesheets** - Employees with missing timesheets (managers)
    TOOL_CALL: {"tool": "getManagerMissingTimesheets", "params": {"period": "week"}}

19. **getTopLoggers** - Top employees by logged hours (managers)
    TOOL_CALL: {"tool": "getTopLoggers", "params": {"period": "month"}}

### 🎓 ONBOARDING & TRAINING TOOL

20. **getOnboardingHelp** - Step-by-step guides for common tasks
    TOOL_CALL: {"tool": "getOnboardingHelp", "params": {"topic": "submit timesheet"}}
    topics: "submit timesheet", "apply leave", "check in", "complete task", "view reports"

## WHEN TO USE TOOLS (Smart Selection Guide)

### User asks about DATA → Use query tools
- "How many hours did I log?" → getLoggedHours
- "What tasks do I have?" → getPendingTasks / getTodayTasks
- "What projects am I on?" → getAssignedProjects
- "Did I submit today's timesheet?" → checkTodayTimesheet
- "Am I checked in?" → getAttendanceStatus
- "What's my leave balance?" → getLeaveBalance

### User asks for HELP/SUGGESTIONS → Use assistance tools
- "Can you suggest task names?" → suggestTaskNames
- "Do I have repeated entries?" → getRepeatedEntries
- "Am I missing any hours?" → checkMissingHours
- "What are my upcoming deadlines?" → getUpcomingDeadlines

### User wants ERROR CHECK → Use detection tools
- "Check my timesheets for errors" → suggestCorrections
- "Do I have any incomplete entries?" → detectIncompleteEntries
- "Are my hours overlapping?" → detectOverlappingHours
- "How much overtime have I logged?" → checkOvertimeLimits

### Manager asks about TEAM → Use manager tools
- "Who hasn't submitted timesheets?" → getManagerMissingTimesheets
- "Who logged the most hours?" → getTopLoggers
- "Any pending approvals?" → getPendingApprovals

### User asks HOW TO → Use onboarding tool
- "How do I submit a timesheet?" → getOnboardingHelp
- "How do I apply for leave?" → getOnboardingHelp

## COMPANY POLICIES (Answer directly WITHOUT tools)
- **Leave Types**: CL (12/year), SL (12/year), EL (15/year), WFH (52/year)
- **Work Hours**: 9 AM - 6 PM, 1 hour lunch break (8 hours/day)
- **Timesheet**: Daily submission required, manager approval needed
- **Overtime**: Beyond 8 hrs/day, max 20 hours/month, needs manager approval

## HOW TO RESPOND

1. **Be Proactive & Intelligent**: Don't just answer - help users discover issues
   - If they ask about hours, also mention if they have missing days
   - If they ask about tasks, check for urgent deadlines
   - Suggest corrections when you detect errors

2. **Use Tools Wisely**: 
   - Use ONE tool for simple queries
   - Use suggestCorrections for comprehensive error checking
   - Combine related data in your summary

3. **Format Responses Clearly**:
   - Use emojis for better engagement (✅ ⚠️ 🔴 💡 📊 🎯)
   - Use bullet points for lists
   - Highlight warnings and errors prominently
   - Provide actionable suggestions

4. **Personality**:
   - Be friendly, helpful, and encouraging
   - Use "you" and "your" to personalize
   - Celebrate successes ("Great job!")
   - Guide gently when errors are found ("Let's fix this together")

5. **After Tool Results**:
   - Summarize data in plain English
   - Highlight important items (urgent, overdue, errors)
   - Always end with a helpful suggestion or next step

## EXAMPLE INTERACTIONS

User: "How am I doing this week?"
You: Use suggestCorrections + getLoggedHours, then summarize both with encouragement

User: "Help me fill a timesheet"
You: Use suggestTaskNames + getRepeatedEntries, show suggestions clearly

User: "Check for errors"
You: Use suggestCorrections, list all issues with clear fix suggestions

## USER ACTION CAPABILITIES (NEW!)

You can help users navigate and interact with the website by issuing action commands!

When a user asks you to:
- Navigate ("open my dashboard", "go to tasks page")
- Click something ("click submit", "open timesheet form")
- Show something ("show my timesheets", "scroll to attendance")

Respond with an ACTION_COMMAND followed by your explanation:

ACTION_COMMAND: {"action": "navigate", "target": "employee-dashboard"}
Then say: "Opening your employee dashboard now! 📊"

ACTION_COMMAND: {"action": "click", "element": "#addTimesheetBtn"}
Then say: "Opening the timesheet form for you ✍️"

ACTION_COMMAND: {"action": "scroll", "target": "timesheets-section"}
Then say: "Scrolling to your timesheets section 📋"

ACTION_COMMAND: {"action": "open_modal", "modal": "add-timesheet"}
Then say: "Let me open that form for you! ✨"

Available Nav Targets:
- employee-dashboard, manager-dashboard, admin-dashboard
- timesheets-page, tasks-page, attendance-page, profile-page

Available Click Elements:  
- #addTimesheetBtn, #checkInBtn, #checkOutBtn, #submitTimesheetBtn

Available Modals:
- add-timesheet, edit-timesheet, add-task, view-details

IMPORTANT: Only use ACTION_COMMAND when user EXPLICITLY asks to navigate/click/open something. Don't use it for data queries!

REMEMBER: You're not just a data bot - you're an intelligent assistant that helps users be more productive and accurate!`;


// Chat endpoint WITH AUTH AND CACHING
router.post('/chat', auth, async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        const userId = req.user._id;
        const userRole = req.user.role;
        const userName = req.user.name;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Check cache for identical recent query
        const cachedResponse = cacheManager.getCachedResponse(userId, message, { role: userRole });
        if (cachedResponse) {
            return res.json({
                response: cachedResponse.response,
                model: cachedResponse.model,
                cached: true
            });
        }

        // Deduplicate concurrent identical requests
        const requestKey = cacheManager.generateCacheKey(userId, message, { role: userRole });
        const processRequest = async () => {

            // Add user context to system prompt
            const contextPrompt = SYSTEM_PROMPT + `\n\n## CURRENT USER CONTEXT\nName: ${userName} \nRole: ${userRole} \nUser ID: ${userId} `;

            // Build messages array
            const messages = [
                { role: 'system', content: contextPrompt },
                ...history.slice(-10),
                { role: 'user', content: message }
            ];

            // Call Groq API
            const response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY} `,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant',
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 1024
                })
            });

            if (!response.ok) {
                throw new Error('Failed to get response from AI');
            }

            let data = await response.json();
            let aiResponse = data.choices[0]?.message?.content || '';

            // Check if AI wants to use a tool
            if (aiResponse.includes('TOOL_CALL:')) {
                const toolMatch = aiResponse.match(/TOOL_CALL:\s*(\{[^}]+\})/);
                if (toolMatch) {
                    try {
                        const toolCall = JSON.parse(toolMatch[1]);
                        const toolResult = await executeTool(toolCall.tool, userId, userRole, toolCall.params || {});

                        // Send tool result back to AI for summarization
                        const followUpMessages = [
                            { role: 'system', content: contextPrompt },
                            ...history.slice(-6),
                            { role: 'user', content: message },
                            { role: 'assistant', content: `TOOL_CALL: ${JSON.stringify(toolCall)} ` },
                            { role: 'user', content: `TOOL_RESULT: ${JSON.stringify(toolResult)} \n\nPlease summarize this data for the user in a friendly, helpful way.Use bullet points and emojis.` }
                        ];

                        const followUpResponse = await fetch(GROQ_API_URL, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${GROQ_API_KEY} `,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                model: 'llama-3.1-8b-instant',
                                messages: followUpMessages,
                                temperature: 0.7,
                                max_tokens: 1024
                            })
                        });

                        if (followUpResponse.ok) {
                            const followUpData = await followUpResponse.json();
                            aiResponse = followUpData.choices[0]?.message?.content || 'I retrieved the data but couldn\'t summarize it.';
                        }
                    } catch (toolError) {
                        console.error('Tool execution error:', toolError);
                        aiResponse = 'I tried to look up your data but encountered an error. Please try again.';
                    }
                }
            }

            // Parse action commands from AI response
            let actionCommand = null;
            if (aiResponse.includes('ACTION_COMMAND:')) {
                const actionMatch = aiResponse.match(/ACTION_COMMAND:\s*(\{[^}]+\})/);
                if (actionMatch) {
                    try {
                        actionCommand = JSON.parse(actionMatch[1]);
                        // Remove the ACTION_COMMAND line from the response
                        aiResponse = aiResponse.replace(/ACTION_COMMAND:\s*\{[^}]+\}\s*/g, '').trim();
                    } catch (err) {
                        console.error('Failed to parse action command:', err);
                    }
                }
            }

            // Cache successful response
            const responseData = {
                response: aiResponse,
                model: data.model || 'llama-3.1-8b-instant',
                userId: userId,
                action: actionCommand // Include action if present
            };
            cacheManager.setCachedResponse(userId, message, responseData, { role: userRole });

            return responseData;
        };

        // Use deduplication to prevent concurrent identical requests
        const result = await cacheManager.deduplicateRequest(requestKey, processRequest);

        res.json({
            response: result.response,
            model: result.model,
            cached: false,
            action: result.action || null
        });

    } catch (error) {
        console.error('Chatbot error:', error);
        res.status(500).json({
            error: 'Failed to process your request',
            message: error.message
        });
    }
});


// Cache statistics endpoint (for monitoring/debugging)
router.get('/cache/stats', auth, (req, res) => {
    const stats = cacheManager.getCacheStats();
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        cacheStats: stats
    });
});

// Cache invalidation endpoint (for admins)
router.post('/cache/clear', auth, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    cacheManager.clearAllCaches();
    res.json({ message: 'All caches cleared successfully' });
});

// Health check for chatbot
router.get('/health', (req, res) => {
    res.json({ status: 'ok', name: 'Llama 3.2 Intelligent Assistant', features: ['data-aware', 'personalized', 'cached'] });
});

module.exports = router;

