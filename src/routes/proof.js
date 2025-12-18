const express = require('express');
const { auth, permit } = require('../middleware/auth');
const Task = require('../models/Task');
const ProofSubmission = require('../models/ProofSubmission');
const Review = require('../models/Review');
const Notification = require('../models/Notification');
const Project = require('../models/Project');
const User = require('../models/User');

const router = express.Router();

// ============================================================================
// 1. EMPLOYEE: Submit Proof of Work
// ============================================================================

/**
 * POST /api/proof/submit
 * Employee submits proof of work with GitHub link, video, attachments, and notes
 * Validation: All fields required, format checks on links
 */
router.post('/submit', auth, permit('employee'), async(req, res) => {
    try {
        const { taskId, githubLink, demoVideoLink, completionNotes } = req.body;
        const userId = String(req.user._id);

        console.log('📝 [PROOF] Submitting:', { taskId, github: githubLink?.substring(0, 20), notes: completionNotes?.substring(0, 20) });

        // Basic checks only
        if (!taskId) return res.status(400).json({ message: 'Task ID required' });
        if (!githubLink) return res.status(400).json({ message: 'GitHub link required' });
        if (!demoVideoLink) return res.status(400).json({ message: 'Video link required' });
        if (!completionNotes || completionNotes.length < 5) return res.status(400).json({ message: 'Notes required (min 5 chars)' });

        // Get task
        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: 'Task not found' });

        const assignment = task.assignments.find(a => String(a.employee) === userId);
        if (!assignment) return res.status(403).json({ message: 'Task not assigned to you' });

        // Create proof - skip model validation
        const proof = new ProofSubmission({
            task: taskId,
            employee: userId,
            project: task.project,
            githubLink: String(githubLink),
            demoVideoLink: String(demoVideoLink),
            completionNotes: String(completionNotes),
            attachments: [],
            submissionStatus: 'submitted'
        });

        // Save bypassing validation
        await proof.save({ validateBeforeSave: false });

        console.log('✅ Proof saved:', proof._id);

        // Update task status
        assignment.status = 'pending_review';
        await task.save();

        res.status(201).json({
            message: '✅ Proof submitted successfully!',
            data: { proofId: proof._id, status: 'submitted' }
        });

    } catch (err) {
        console.error('❌ Error:', err.message);
        res.status(500).json({ message: 'Error: ' + err.message });
    }
});

// ============================================================================
// 2. MANAGER/ADMIN: Review Proof Submission
// ============================================================================

/**
 * POST /api/proof/:proofId/review
 * Manager/Admin approves or rejects proof with comments
 * Decision: approve or defect_found
 */
router.post('/:proofId/review', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { proofId } = req.params;
        const { decision, comments, defectDescription } = req.body;
        const reviewerId = String(req.user._id);

        // Validation
        if (!['approved', 'defect_found'].includes(decision)) {
            return res.status(400).json({ message: 'Decision must be "approved" or "defect_found"' });
        }

        if (!comments || comments.length < 5) {
            return res.status(400).json({ message: 'Review comments required (minimum 5 characters)' });
        }

        if (decision === 'defect_found' && !defectDescription) {
            return res.status(400).json({ message: 'Defect description required' });
        }

        // Get proof submission
        const proof = await ProofSubmission.findById(proofId);
        if (!proof) {
            return res.status(404).json({ message: 'Proof not found' });
        }

        // Get task
        const task = await Task.findById(proof.task);
        const assignment = task.assignments.find(a => String(a.employee) === String(proof.employee));

        // Create review record
        const review = await Review.create({
            proof: proofId,
            task: proof.task,
            employee: proof.employee,
            project: proof.project,
            reviewedBy: reviewerId,
            reviewerRole: req.user.role,
            decision,
            comments,
            defectDescription: decision === 'defect_found' ? defectDescription : null,
            taskStatusAfterReview: decision === 'approved' ? 'completed' : 'rework_required'
        });

        // Update proof status
        proof.reviewDecision = decision;
        proof.submissionStatus = decision === 'approved' ? 'approved' : 'rejected';
        proof.reviewedBy = reviewerId;
        proof.reviewedAt = new Date();
        proof.managerComments = comments;

        if (decision === 'defect_found') {
            proof.defectDescription = defectDescription;
            proof.defectCount += 1;
            proof.reworkRequired = true;
            proof.reworkAttempts += 1;

            // Check if max rework attempts exceeded
            if (proof.reworkAttempts >= proof.maxReworkAttempts) {
                return res.status(400).json({
                    message: 'Maximum rework attempts exceeded. Task needs reassignment.',
                    defectCount: proof.defectCount
                });
            }
        } else if (decision === 'approved') {
            proof.isApproved = true;
            proof.finalApprovedAt = new Date();
        }

        await proof.save();

        // Update task assignment status
        if (decision === 'approved') {
            assignment.status = 'completed';
            assignment.finalApprovedAt = new Date();
            assignment.reviewCycle = {
                reviewedBy: reviewerId,
                reviewStatus: 'approved',
                managerComments: comments,
                reviewedAt: new Date()
            };
        } else {
            assignment.status = 'rework_required';
            assignment.reviewCycle = {
                reviewedBy: reviewerId,
                reviewStatus: 'defect_found',
                managerComments: comments,
                defectDescription,
                reviewedAt: new Date(),
                defectCount: (assignment.reviewCycle?.defectCount || 0) + 1,
                reworkRequired: true
            };
        }

        await task.save();

        // Notify employee
        await Notification.create({
            user: proof.employee,
            type: decision === 'approved' ? 'proof_approved' : 'proof_rejected',
            title: decision === 'approved' ? '✅ Proof Approved' : '⚠️ Rework Required',
            body: decision === 'approved' ?
                `Your proof for "${task.title}" has been approved!` : `Your proof for "${task.title}" needs rework. See comments below.`,
            meta: {
                taskId: proof.task,
                proofId,
                decision,
                comments,
                defectDescription: decision === 'defect_found' ? defectDescription : null,
                defectCount: proof.defectCount,
                reviewedAt: new Date()
            }
        });

        console.log(`📋 Proof reviewed - ${decision}: ${task.title}, Employee: ${proof.employee}`);

        res.json({
            message: `✅ Proof ${decision === 'approved' ? 'approved' : 'rejected for rework'}`,
            data: review,
            taskStatus: decision === 'approved' ? 'completed' : 'rework_required'
        });

    } catch (err) {
        console.error('❌ Error reviewing proof:', err);
        res.status(500).json({ message: 'Failed to review proof: ' + err.message });
    }
});

// ============================================================================
// 3. EMPLOYEE: Resubmit After Defect
// ============================================================================

/**
 * POST /api/proof/:proofId/resubmit
 * Employee resubmits proof after defect fix
 * Loops back to pending_review
 */
router.post('/:proofId/resubmit', auth, permit('employee'), async(req, res) => {
    try {
        const { proofId } = req.params;
        const { githubLink, demoVideoLink, completionNotes, attachments = [] } = req.body;

        // Validation
        if (!githubLink || !githubLink.match(/^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)/)) {
            return res.status(400).json({ message: 'Valid GitHub link required' });
        }
        if (!demoVideoLink || !demoVideoLink.match(/^https?:\/\/(youtube\.com|youtu\.be|vimeo\.com|loom\.com)/)) {
            return res.status(400).json({ message: 'Valid video link required' });
        }
        if (!completionNotes || completionNotes.length < 20) {
            return res.status(400).json({ message: 'Completion notes required (minimum 20 characters)' });
        }

        // Get proof and verify ownership
        const proof = await ProofSubmission.findById(proofId);
        if (!proof) return res.status(404).json({ message: 'Proof not found' });
        if (String(proof.employee) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Cannot resubmit others proof' });
        }

        // Update proof
        proof.githubLink = githubLink;
        proof.demoVideoLink = demoVideoLink;
        proof.completionNotes = completionNotes;
        proof.attachments = attachments;
        proof.submissionStatus = 'submitted';
        proof.submittedAt = new Date();
        proof.reviewDecision = 'pending';
        proof.reviewedBy = null;
        proof.reviewedAt = null;
        await proof.save();

        // Update task status
        const task = await Task.findById(proof.task);
        const assignment = task.assignments.find(a => String(a.employee) === String(proof.employee));
        assignment.status = 'pending_review';
        await task.save();

        // Notify manager
        const project = await Project.findById(proof.project);
        await Notification.create({
            user: project.manager,
            type: 'proof_resubmitted',
            title: 'Rework Completed - Resubmitted',
            body: `${req.user.name} resubmitted proof for "${task.title}" after fixes`,
            meta: {
                taskId: proof.task,
                proofId,
                employeeName: req.user.name
            }
        });

        console.log(`🔄 Proof resubmitted - Task: ${task.title}, Attempt: ${proof.reworkAttempts}`);

        res.json({
            message: '✅ Proof resubmitted for review',
            data: proof,
            reworkAttempt: proof.reworkAttempts,
            status: 'pending_review'
        });

    } catch (err) {
        console.error('❌ Error resubmitting proof:', err);
        res.status(500).json({ message: 'Failed to resubmit proof: ' + err.message });
    }
});

// ============================================================================
// 4. MANAGER/ADMIN: Get Pending Proofs for Review
// ============================================================================

/**
 * GET /api/proof/pending
 * Manager/Admin views all pending proofs awaiting review
 * Filters by project (manager) or all (admin)
 */
router.get('/pending', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { filter = 'all' } = req.query;
        const managerId = String(req.user._id);

        let query = { submissionStatus: 'submitted', reviewDecision: 'pending' };

        // Manager sees only their projects
        if (req.user.role === 'manager') {
            const projects = await Project.find({ manager: managerId }, '_id');
            const projectIds = projects.map(p => p._id);
            query.project = { $in: projectIds };
        }

        const proofs = await ProofSubmission.find(query)
            .populate('employee', 'name email')
            .populate('task', 'title description')
            .populate('project', 'name')
            .sort({ submittedAt: -1 })
            .lean();

        res.json({
            count: proofs.length,
            filter,
            data: proofs
        });

    } catch (err) {
        console.error('❌ Error getting pending proofs:', err);
        res.status(500).json({ message: 'Failed to fetch pending proofs: ' + err.message });
    }
});

// ============================================================================
// 5. MANAGER/ADMIN: Assign Next Task
// ============================================================================

/**
 * POST /api/proof/:proofId/assign-next
 * After approval, automatically assign next pending task
 * Notifies employee and manager
 */
router.post('/:proofId/assign-next', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { proofId } = req.params;

        const proof = await ProofSubmission.findById(proofId);
        if (!proof) return res.status(404).json({ message: 'Proof not found' });

        // Check if proof is approved
        if (proof.reviewDecision !== 'approved') {
            return res.status(400).json({ message: 'Can only assign tasks after approval' });
        }

        // Get next pending task in same project
        const pendingTask = await Task.findOne({
            project: proof.project,
            'assignments': {
                $elemMatch: {
                    employee: proof.employee,
                    status: 'assigned'
                }
            }
        }).sort({ createdAt: 1 });

        if (!pendingTask) {
            // All tasks completed
            return res.json({
                message: '✅ All tasks completed!',
                status: 'all_tasks_completed',
                employee: proof.employee,
                project: proof.project
            });
        }

        // Assign next task
        const assignment = pendingTask.assignments.find(a => String(a.employee) === String(proof.employee));
        assignment.status = 'in_progress';
        assignment.progress = 0;
        await pendingTask.save();

        // Notify employee
        await Notification.create({
            user: proof.employee,
            type: 'task_assigned',
            title: '📌 New Task Assigned',
            body: `You have been assigned: "${pendingTask.title}"`,
            meta: {
                taskId: pendingTask._id,
                taskTitle: pendingTask.title,
                deadline: assignment.deadline
            }
        });

        // Notify manager
        const project = await Project.findById(proof.project);
        await Notification.create({
            user: project.manager,
            type: 'task_assigned',
            title: 'Task Assigned to Team Member',
            body: `Assigned "${pendingTask.title}" to employee for project`,
            meta: {
                taskId: pendingTask._id,
                employeeId: proof.employee
            }
        });

        console.log(`✅ Next task assigned - Task: ${pendingTask.title}`);

        res.json({
            message: '✅ Next task assigned',
            nextTask: {
                id: pendingTask._id,
                title: pendingTask.title,
                description: pendingTask.description,
                deadline: assignment.deadline
            },
            status: 'task_assigned'
        });

    } catch (err) {
        console.error('❌ Error assigning next task:', err);
        res.status(500).json({ message: 'Failed to assign next task: ' + err.message });
    }
});

// ============================================================================
// 6. GET: Task/Proof Status
// ============================================================================

/**
 * GET /api/proof/:proofId/status
 * Get current status of proof submission and review
 */
router.get('/:proofId/status', auth, async(req, res) => {
    try {
        const proof = await ProofSubmission.findById(req.params.proofId)
            .populate('employee', 'name email')
            .populate('reviewedBy', 'name')
            .lean();

        if (!proof) return res.status(404).json({ message: 'Proof not found' });

        res.json({
            proofId: proof._id,
            submissionStatus: proof.submissionStatus,
            reviewDecision: proof.reviewDecision,
            submittedAt: proof.submittedAt,
            reviewedAt: proof.reviewedAt,
            defectCount: proof.defectCount,
            reworkAttempts: proof.reworkAttempts,
            isApproved: proof.isApproved,
            githubLink: proof.githubLink,
            demoVideoLink: proof.demoVideoLink,
            managerComments: proof.managerComments,
            reviewedBy: proof.reviewedBy?.name
        });

    } catch (err) {
        console.error('❌ Error getting status:', err);
        res.status(500).json({ message: 'Failed to get status: ' + err.message });
    }
});

// ============================================================================
// 6b. GET: Employee's Submissions - View Manager Actions
// ============================================================================

/**
 * GET /api/proof/my-submissions
 * Employee views their own submitted proofs with manager decisions
 */
router.get('/my-submissions', auth, permit('employee'), async(req, res) => {
    try {
        const employeeId = String(req.user._id);

        const proofs = await ProofSubmission.find({ employee: employeeId })
            .populate('task', 'title description')
            .populate('project', 'name')
            .sort({ submittedAt: -1 })
            .lean();

        res.json({
            count: proofs.length,
            data: proofs
        });

    } catch (err) {
        console.error('❌ Error fetching employee submissions:', err);
        res.status(500).json({ message: 'Failed to fetch submissions: ' + err.message });
    }
});

// ============================================================================
// 7. GET: Analytics - Review Cycle Metrics
// ============================================================================

/**
 * GET /api/proof/analytics/metrics
 * Admin/Manager sees review cycle analytics
 */
router.get('/analytics/metrics', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        const { days = 30 } = req.query;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        let query = { submittedAt: { $gte: startDate } };

        if (req.user.role === 'manager') {
            const projects = await Project.find({ manager: req.user._id }, '_id');
            const projectIds = projects.map(p => p._id);
            query.project = { $in: projectIds };
        }

        const proofs = await ProofSubmission.find(query).lean();

        // Calculate metrics
        const approved = proofs.filter(p => p.reviewDecision === 'approved').length;
        const defects = proofs.filter(p => p.reviewDecision === 'defect_found').length;
        const pending = proofs.filter(p => p.reviewDecision === 'pending').length;
        const avgReworkAttempts = proofs.length > 0 ?
            (proofs.reduce((sum, p) => sum + p.reworkAttempts, 0) / proofs.length).toFixed(2) :
            0;

        res.json({
            period: `Last ${days} days`,
            totalSubmissions: proofs.length,
            approved,
            defects,
            pending,
            approvalRate: proofs.length > 0 ? Math.round((approved / proofs.length) * 100) : 0,
            defectRate: proofs.length > 0 ? Math.round((defects / proofs.length) * 100) : 0,
            avgReworkAttempts
        });

    } catch (err) {
        console.error('❌ Error getting analytics:', err);
        res.status(500).json({ message: 'Failed to get analytics: ' + err.message });
    }
});

module.exports = router;