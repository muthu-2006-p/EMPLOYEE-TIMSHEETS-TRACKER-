const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, permit } = require('../middleware/auth');

// ===== EMPLOYEE: SUBMIT COMPLETION PROOF =====
router.post('/submit-completion-proof', auth, permit('employee'), async(req, res) => {
    try {
        const { taskId, githubLink, videoLink, attachments, completionNotes } = req.body;

        // Validation
        if (!taskId || !githubLink || !videoLink || !completionNotes) {
            return res.status(400).json({
                message: 'Missing required fields: taskId, githubLink, videoLink, completionNotes'
            });
        }

        // Validate completion notes length
        if (completionNotes.length < 20) {
            return res.status(400).json({
                message: 'Completion notes must be at least 20 characters long'
            });
        }

        // Validate URLs
        const githubRegex = /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)/;
        const videoRegex = /^https?:\/\/(youtube\.com|youtu\.be|vimeo\.com|loom\.com|drive\.google\.com)/;

        if (!githubRegex.test(githubLink)) {
            return res.status(400).json({
                message: 'Invalid GitHub link. Must be from github.com, gitlab.com, or bitbucket.org'
            });
        }

        if (!videoRegex.test(videoLink)) {
            return res.status(400).json({
                message: 'Invalid video link. Must be from YouTube, Vimeo, Loom, or Google Drive'
            });
        }

        // Find task and employee's assignment
        const task = await Task.findById(taskId).populate('project', 'name manager');
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Find employee's assignment in the task
        const assignmentIndex = task.assignments.findIndex(
            a => String(a.employee) === String(req.user._id)
        );

        if (assignmentIndex === -1) {
            return res.status(403).json({ message: 'Task not assigned to you' });
        }

        // Check if already submitted and pending review
        if (task.assignments[assignmentIndex].status === 'pending_review') {
            return res.status(400).json({
                message: 'Task is already submitted and awaiting review'
            });
        }

        // Check if in rework status
        const isRework = task.assignments[assignmentIndex].status === 'rework_required';

        // Update assignment with proof submission
        task.assignments[assignmentIndex].proofSubmission = {
            githubLink,
            demoVideoLink: videoLink,
            attachments: attachments || [],
            completionNotes,
            submittedAt: new Date()
        };
        task.assignments[assignmentIndex].status = 'pending_review';
        task.assignments[assignmentIndex].submittedAt = new Date();

        // Initialize review cycle if not exists or update for rework
        if (!task.assignments[assignmentIndex].reviewCycle || isRework) {
            task.assignments[assignmentIndex].reviewCycle = {
                reviewStatus: 'pending_review',
                defectCount: task.assignments[assignmentIndex].reviewCycle ?.defectCount || 0,
                reworkRequired: false
            };
        }

        await task.save();

        // Notify Manager and Admin
        const managers = await User.find({
            $or: [
                { _id: task.project.manager },
                { role: 'admin' }
            ]
        });

        const notifications = managers.map(manager => ({
            user: manager._id,
            type: 'task_proof_submitted',
            title: 'Task Proof Submitted for Review',
            body: `${req.user.name} has submitted proof for task "${task.title}"`,
            meta: {
                taskId: task._id,
                employeeId: req.user._id,
                employeeName: req.user.name,
                githubLink,
                videoLink,
                submittedAt: new Date()
            }
        }));

        await Notification.insertMany(notifications);

        res.json({
            message: 'Proof submitted successfully. Task is now under review.',
            data: {
                taskId: task._id,
                status: 'pending_review',
                submittedAt: new Date(),
                proofSubmission: task.assignments[assignmentIndex].proofSubmission
            }
        });

    } catch (err) {
        console.error('Submit completion proof error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EMPLOYEE: GET MY TASK STATUS =====
router.get('/my-status', auth, permit('employee'), async(req, res) => {
    try {
        const tasks = await Task.find({
                'assignments.employee': req.user._id
            })
            .populate('project', 'name')
            .populate('assignments.employee', 'name email')
            .populate('assignments.reviewCycle.reviewedBy', 'name role')
            .sort({ 'assignments.deadline': 1 });

        // Filter and format employee's assignments
        const myTasks = tasks.map(task => {
            const myAssignment = task.assignments.find(
                a => String(a.employee._id) === String(req.user._id)
            );

            return {
                taskId: task._id,
                title: task.title,
                description: task.description,
                project: task.project,
                priority: task.priority,
                deadline: myAssignment.deadline,
                status: myAssignment.status,
                progress: myAssignment.progress,
                proofSubmission: myAssignment.proofSubmission,
                reviewCycle: myAssignment.reviewCycle,
                submittedAt: myAssignment.submittedAt,
                createdAt: task.createdAt
            };
        });

        // Categorize tasks
        const categorized = {
            assigned: myTasks.filter(t => t.status === 'assigned'),
            inProgress: myTasks.filter(t => t.status === 'in_progress'),
            submitted: myTasks.filter(t => t.status === 'submitted'),
            pendingReview: myTasks.filter(t => t.status === 'pending_review'),
            defectFound: myTasks.filter(t => t.status === 'defect_found' || t.status === 'rework_required'),
            approved: myTasks.filter(t => t.status === 'approved' || t.status === 'completed'),
            all: myTasks
        };

        res.json({
            message: 'Task status retrieved successfully',
            data: categorized,
            summary: {
                total: myTasks.length,
                assigned: categorized.assigned.length,
                inProgress: categorized.inProgress.length,
                pendingReview: categorized.pendingReview.length,
                defectsFound: categorized.defectFound.length,
                approved: categorized.approved.length
            }
        });

    } catch (err) {
        console.error('Get task status error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== MANAGER/ADMIN: GET PENDING REVIEWS =====
router.get('/pending-reviews', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        // Query for tasks with any proof submissions (pending, approved, or rejected)
        let query = {
            'assignments': {
                $elemMatch: {
                    proofSubmission: { $exists: true },
                    status: { $in: ['pending_review', 'approved', 'rejected', 'rework_required', 'completed'] }
                }
            }
        };

        // If manager, filter by their projects
        if (req.user.role === 'manager') {
            const managerProjects = await mongoose.model('Project').find({ manager: req.user._id });
            query.project = { $in: managerProjects.map(p => p._id) };
        }

        const tasks = await Task.find(query)
            .populate('project', 'name')
            .populate('assignments.employee', 'name email')
            .sort({ 'assignments.submittedAt': -1 });

        const allReviews = [];

        tasks.forEach(task => {
            task.assignments.forEach(assignment => {
                if (assignment.proofSubmission) {
                    allReviews.push({
                        taskId: task._id,
                        title: task.title,
                        description: task.description,
                        project: task.project,
                        priority: task.priority,
                        employee: assignment.employee,
                        deadline: assignment.deadline,
                        submittedAt: assignment.submittedAt,
                        proofSubmission: assignment.proofSubmission,
                        reviewCycle: assignment.reviewCycle,
                        reviewStatus: assignment.status, // Include status for filtering
                        defectCount: assignment.reviewCycle ?.defectCount || 0
                    });
                }
            });
        });

        res.json({
            message: 'All task reviews retrieved successfully',
            data: allReviews,
            count: allReviews.length
        });

    } catch (err) {
        console.error('Get task reviews error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== MANAGER/ADMIN: REVIEW TASK (APPROVE/REJECT) =====
router.post('/review', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { taskId, employeeId, action, comments, defectDescription } = req.body;

        // Validation
        if (!taskId || !employeeId || !action) {
            return res.status(400).json({
                message: 'Missing required fields: taskId, employeeId, action'
            });
        }

        if (!['approve', 'reject', 'rework'].includes(action)) {
            return res.status(400).json({
                message: 'Invalid action. Must be "approve", "reject", or "rework"'
            });
        }

        if ((action === 'reject' || action === 'rework') && !defectDescription) {
            return res.status(400).json({
                message: 'Defect description is required when rejecting or requesting rework'
            });
        }

        // Find task
        const task = await Task.findById(taskId).populate('project', 'name manager');
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        // Check manager permission (manager can only review their own project tasks)
        if (req.user.role === 'manager' && String(task.project.manager) !== String(req.user._id)) {
            return res.status(403).json({ message: 'You can only review tasks from your projects' });
        }

        // Find employee's assignment
        const assignmentIndex = task.assignments.findIndex(
            a => String(a.employee) === String(employeeId)
        );

        if (assignmentIndex === -1) {
            return res.status(404).json({ message: 'Employee assignment not found' });
        }

        const assignment = task.assignments[assignmentIndex];

        // Check if task is in pending review or approved status (for rework)
        if (action === 'rework') {
            // Allow rework for approved tasks (defect found after approval)
            if (!['approved', 'pending_review', 'completed'].includes(assignment.status)) {
                return res.status(400).json({
                    message: 'Task must be approved or pending review to send for rework'
                });
            }
        } else if (assignment.status !== 'pending_review') {
            return res.status(400).json({
                message: 'Task is not in pending review status'
            });
        }

        // Process review based on action
        if (action === 'approve') {
            // APPROVE THE TASK
            assignment.status = 'approved';
            assignment.reviewCycle.reviewStatus = 'approved';
            assignment.reviewCycle.reviewedBy = req.user._id;
            assignment.reviewCycle.reviewedAt = new Date();
            assignment.reviewCycle.managerComments = comments || 'Approved';
            assignment.reviewCycle.reworkRequired = false;
            assignment.progress = 100;

            await task.save();

            // Notify employee
            await Notification.create({
                user: employeeId,
                type: 'task_approved',
                title: '✅ Task Approved!',
                body: `Your task "${task.title}" has been approved by ${req.user.name}`,
                meta: {
                    taskId: task._id,
                    reviewerId: req.user._id,
                    reviewerName: req.user.name,
                    comments,
                    approvedAt: new Date()
                }
            });

            // Auto-assign next pending task
            await autoAssignNextTask(employeeId);

            res.json({
                message: 'Task approved successfully',
                data: {
                    taskId: task._id,
                    status: 'approved',
                    reviewedBy: req.user._id,
                    reviewedAt: new Date(),
                    nextTaskAssigned: true
                }
            });

        } else {
            // REJECT/REWORK THE TASK (DEFECT FOUND)
            const defectCount = (assignment.reviewCycle.defectCount || 0) + 1;

            assignment.status = 'rework_required';
            assignment.reviewCycle.reviewStatus = 'defect_found';
            assignment.reviewCycle.reviewedBy = req.user._id;
            assignment.reviewCycle.reviewedAt = new Date();
            assignment.reviewCycle.defectDescription = defectDescription;
            assignment.reviewCycle.managerComments = comments || 'Defects found - rework required';
            assignment.reviewCycle.defectCount = defectCount;
            assignment.reviewCycle.reworkRequired = true;

            // Clear previous proof submission so employee can resubmit
            assignment.proofSubmission = null;

            await task.save();

            // Notify employee with appropriate message
            const notificationTitle = action === 'rework' ? '🔧 Defect Found - Rework Required' : '⚠️ Task Needs Rework';
            await Notification.create({
                user: employeeId,
                type: action === 'rework' ? 'task_rework_requested' : 'task_rejected',
                title: notificationTitle,
                body: `Your task "${task.title}" requires rework. Defect count: ${defectCount}. Reason: ${defectDescription}`,
                meta: {
                    taskId: task._id,
                    reviewerId: req.user._id,
                    reviewerName: req.user.name,
                    defectDescription,
                    comments,
                    defectCount,
                    reviewedAt: new Date()
                }
            });

            res.json({
                message: action === 'rework' ? 'Task sent for rework. Employee notified.' : 'Task rejected. Rework required.',
                data: {
                    taskId: task._id,
                    status: 'rework_required',
                    defectCount,
                    defectDescription,
                    reviewedBy: req.user._id,
                    reviewedAt: new Date()
                }
            });
        }

    } catch (err) {
        console.error('Review task error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== AUTO-ASSIGN NEXT TASK =====
async function autoAssignNextTask(employeeId) {
    try {
        // Find next pending task (not yet assigned to this employee)
        const nextTask = await Task.findOne({
                'assignments.employee': { $ne: employeeId },
                status: { $in: ['pending', 'open', 'assigned'] },
                'assignments.status': { $ne: 'completed' }
            })
            .sort({ priority: -1, createdAt: 1 })
            .limit(1);

        if (nextTask) {
            // Assign task to employee
            nextTask.assignments.push({
                employee: employeeId,
                status: 'assigned',
                deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
            });

            await nextTask.save();

            // Notify employee
            await Notification.create({
                user: employeeId,
                type: 'task_assigned',
                title: '🎯 New Task Assigned',
                body: `You have been assigned a new task: "${nextTask.title}"`,
                meta: {
                    taskId: nextTask._id,
                    taskTitle: nextTask.title,
                    priority: nextTask.priority,
                    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                }
            });

            return nextTask;
        }

        return null;
    } catch (err) {
        console.error('Auto-assign next task error:', err);
        return null;
    }
}

// ===== MANAGER/ADMIN: MANUALLY ASSIGN NEXT TASK =====
router.post('/assign-next', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { employeeId } = req.body;

        if (!employeeId) {
            return res.status(400).json({ message: 'Employee ID is required' });
        }

        // Check if employee has pending defects
        const defectTasks = await Task.findOne({
            'assignments.employee': employeeId,
            'assignments.status': 'rework_required'
        });

        if (defectTasks) {
            return res.status(400).json({
                message: 'Employee has pending defects that must be resolved first',
                data: { hasDefects: true }
            });
        }

        const nextTask = await autoAssignNextTask(employeeId);

        if (nextTask) {
            res.json({
                message: 'Next task assigned successfully',
                data: {
                    taskId: nextTask._id,
                    title: nextTask.title,
                    assignedTo: employeeId
                }
            });
        } else {
            res.json({
                message: 'No pending tasks available for assignment',
                data: { allTasksCompleted: true }
            });
        }

    } catch (err) {
        console.error('Assign next task error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== EMPLOYEE: UPDATE TASK PROGRESS =====
router.put('/:taskId/progress', auth, permit('employee'), async(req, res) => {
    try {
        const { taskId } = req.params;
        const { progress, status } = req.body;

        const task = await Task.findById(taskId);
        if (!task) {
            return res.status(404).json({ message: 'Task not found' });
        }

        const assignmentIndex = task.assignments.findIndex(
            a => String(a.employee) === String(req.user._id)
        );

        if (assignmentIndex === -1) {
            return res.status(403).json({ message: 'Task not assigned to you' });
        }

        if (progress !== undefined) {
            task.assignments[assignmentIndex].progress = Math.min(100, Math.max(0, progress));
        }

        if (status && ['assigned', 'in_progress'].includes(status)) {
            task.assignments[assignmentIndex].status = status;
        }

        await task.save();

        res.json({
            message: 'Task progress updated successfully',
            data: {
                taskId: task._id,
                progress: task.assignments[assignmentIndex].progress,
                status: task.assignments[assignmentIndex].status
            }
        });

    } catch (err) {
        console.error('Update progress error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
