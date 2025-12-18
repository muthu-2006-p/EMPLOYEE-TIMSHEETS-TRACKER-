const express = require('express');
const Project = require('../models/Project');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { auth, permit } = require('../middleware/auth');

const router = express.Router();

// ===== MANAGER: SUBMIT PROJECT COMPLETION PROOF =====
router.post('/submit/:projectId', auth, permit('manager'), async(req, res) => {
    try {
        const { projectId } = req.params;
        const { githubLink, demoVideoLink, documentationLink, completionNotes } = req.body;

        if (!githubLink && !demoVideoLink && !documentationLink) {
            return res.status(400).json({
                message: 'At least one proof link (GitHub, Demo Video, or Documentation) is required'
            });
        }

        const project = await Project.findById(projectId);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Check if user is the project manager
        if (String(project.manager) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Only the project manager can submit completion proof' });
        }

        // Update project with completion proof
        project.completionProof = {
            githubLink,
            demoVideoLink,
            documentationLink,
            completionNotes,
            submittedBy: req.user._id,
            submittedAt: new Date()
        };
        project.status = 'pending_review';
        project.reviewCycle = {
            reviewStatus: 'pending',
            defectCount: project.reviewCycle ?.defectCount || 0
        };

        await project.save();

        // Notify all admins
        const admins = await User.find({ role: 'admin' });
        const notifications = admins.map(admin => ({
            user: admin._id,
            type: 'project_completion_submitted',
            title: '📦 Project Completion Proof Submitted',
            body: `${req.user.name} has submitted completion proof for project "${project.name}"`,
            meta: {
                projectId: project._id,
                projectName: project.name,
                managerId: req.user._id,
                managerName: req.user.name,
                githubLink,
                demoVideoLink,
                documentationLink,
                submittedAt: new Date()
            }
        }));

        await Notification.insertMany(notifications);

        res.json({
            message: 'Project completion proof submitted successfully. Awaiting admin review.',
            data: {
                projectId: project._id,
                status: 'pending_review',
                submittedAt: new Date(),
                completionProof: project.completionProof
            }
        });

    } catch (err) {
        console.error('Submit project completion proof error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== MANAGER: GET MY PROJECTS STATUS =====
router.get('/my-projects', auth, permit('manager'), async(req, res) => {
    try {
        const projects = await Project.find({ manager: req.user._id })
            .populate('manager', 'name email')
            .populate('reviewCycle.reviewedBy', 'name role')
            .sort({ updatedAt: -1 });

        const projectsWithStatus = projects.map(project => ({
            projectId: project._id,
            name: project.name,
            description: project.description,
            status: project.status,
            startDate: project.startDate,
            endDate: project.endDate,
            completionProof: project.completionProof,
            reviewCycle: project.reviewCycle,
            canSubmitProof: project.status === 'active' || project.status === 'rework_required',
            needsRework: project.status === 'rework_required',
            defectCount: project.reviewCycle ?.defectCount || 0
        }));

        res.json({
            message: 'Projects retrieved successfully',
            data: projectsWithStatus
        });

    } catch (err) {
        console.error('Get my projects error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== ADMIN: GET PENDING PROJECT REVIEWS =====
router.get('/pending-reviews', auth, permit('admin'), async(req, res) => {
    try {
        console.log('📦 Admin requesting pending project reviews');
        const projects = await Project.find({
                status: { $in: ['pending_review', 'rework_required'] },
                'completionProof.submittedAt': { $exists: true }
            })
            .populate('manager', 'name email')
            .populate('completionProof.submittedBy', 'name email')
            .populate('reviewCycle.reviewedBy', 'name role')
            .sort({ 'completionProof.submittedAt': -1 });

        console.log(`📦 Found ${projects.length} pending project reviews`);
        projects.forEach(p => console.log(`  - ${p.name} (${p.status})`));

        const reviewList = projects.map(project => ({
            projectId: project._id,
            name: project.name,
            description: project.description,
            manager: project.manager,
            status: project.status,
            completionProof: project.completionProof,
            reviewCycle: project.reviewCycle,
            submittedAt: project.completionProof ?.submittedAt,
            defectCount: project.reviewCycle ?.defectCount || 0
        }));

        res.json({
            message: 'Pending project reviews retrieved',
            data: reviewList
        });

    } catch (err) {
        console.error('Get pending project reviews error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== ADMIN: REVIEW PROJECT (APPROVE/REWORK/REJECT) =====
router.post('/review/:projectId', auth, permit('admin'), async(req, res) => {
    try {
        console.log('📦 Admin reviewing project:', req.params.projectId, req.body.action);
        const { projectId } = req.params;
        const { action, comments, defectDescription } = req.body;

        // Validation
        if (!action) {
            return res.status(400).json({ message: 'Action is required' });
        }

        if (!['approve', 'rework', 'reject'].includes(action)) {
            return res.status(400).json({
                message: 'Invalid action. Must be "approve", "rework", or "reject"'
            });
        }

        if ((action === 'rework' || action === 'reject') && !defectDescription) {
            return res.status(400).json({
                message: 'Defect description is required when requesting rework or rejecting'
            });
        }

        const project = await Project.findById(projectId).populate('manager', 'name email');
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        if (!project.completionProof || !project.completionProof.submittedAt) {
            return res.status(400).json({ message: 'No completion proof submitted for this project' });
        }

        // Process review based on action
        if (action === 'approve') {
            // APPROVE THE PROJECT
            project.status = 'approved';
            project.reviewCycle.reviewStatus = 'approved';
            project.reviewCycle.reviewedBy = req.user._id;
            project.reviewCycle.reviewedAt = new Date();
            project.reviewCycle.adminComments = comments || 'Approved';
            project.reviewCycle.reworkRequired = false;

            await project.save();

            // Notify manager
            await Notification.create({
                user: project.manager._id,
                type: 'project_approved',
                title: '✅ Project Approved!',
                body: `Your project "${project.name}" has been approved by admin ${req.user.name}`,
                meta: {
                    projectId: project._id,
                    projectName: project.name,
                    reviewerId: req.user._id,
                    reviewerName: req.user.name,
                    comments,
                    approvedAt: new Date()
                }
            });

            res.json({
                message: 'Project approved successfully',
                data: {
                    projectId: project._id,
                    status: 'approved',
                    reviewedBy: req.user._id,
                    reviewedAt: new Date()
                }
            });

        } else {
            // REWORK/REJECT THE PROJECT (DEFECT FOUND)
            const defectCount = (project.reviewCycle.defectCount || 0) + 1;

            project.status = action === 'reject' ? 'rejected' : 'rework_required';
            project.reviewCycle.reviewStatus = 'rework_required';
            project.reviewCycle.reviewedBy = req.user._id;
            project.reviewCycle.reviewedAt = new Date();
            project.reviewCycle.defectDescription = defectDescription;
            project.reviewCycle.adminComments = comments || 'Defects found - rework required';
            project.reviewCycle.defectCount = defectCount;
            project.reviewCycle.reworkRequired = true;

            // Clear previous proof submission for rework
            if (action === 'rework') {
                project.completionProof = null;
            }

            await project.save();

            // Notify manager
            const notificationTitle = action === 'reject' ? '❌ Project Rejected' : '🔧 Project Needs Rework';
            await Notification.create({
                user: project.manager._id,
                type: action === 'reject' ? 'project_rejected' : 'project_rework_requested',
                title: notificationTitle,
                body: `Your project "${project.name}" ${action === 'reject' ? 'has been rejected' : 'requires rework'}. Defect count: ${defectCount}. Reason: ${defectDescription}`,
                meta: {
                    projectId: project._id,
                    projectName: project.name,
                    reviewerId: req.user._id,
                    reviewerName: req.user.name,
                    defectDescription,
                    comments,
                    defectCount,
                    reviewedAt: new Date()
                }
            });

            res.json({
                message: action === 'reject' ? 'Project rejected' : 'Project sent for rework. Manager notified.',
                data: {
                    projectId: project._id,
                    status: project.status,
                    defectCount,
                    defectDescription,
                    reviewedBy: req.user._id,
                    reviewedAt: new Date()
                }
            });
        }

    } catch (err) {
        console.error('Review project error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== ADMIN: GET ALL PROJECTS WITH STATUS =====
router.get('/all', auth, permit('admin'), async(req, res) => {
    try {
        const projects = await Project.find()
            .populate('manager', 'name email')
            .populate('completionProof.submittedBy', 'name email')
            .populate('reviewCycle.reviewedBy', 'name role')
            .sort({ updatedAt: -1 });

        res.json({
            message: 'All projects retrieved',
            data: projects
        });

    } catch (err) {
        console.error('Get all projects error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// ===== GET ALL COMPLETION PROOFS (For Analytics) =====
router.get('/proofs', auth, permit('manager', 'admin'), async(req, res) => {
    try {
        console.log('📦 Fetching all project completion proofs for analytics');

        // Find all projects that have completion proof submitted
        const projects = await Project.find({
                'completionProof.submittedAt': { $exists: true }
            })
            .populate('manager', 'name email')
            .populate('completionProof.submittedBy', 'name email')
            .populate('reviewCycle.reviewedBy', 'name role')
            .select('name description status completionProof reviewCycle manager')
            .sort({ 'completionProof.submittedAt': -1 });

        console.log(`📦 Found ${projects.length} projects with completion proofs`);

        // Transform to simpler structure for charts
        const proofs = projects.map(proj => ({
            _id: proj._id,
            projectName: proj.name,
            project: {
                _id: proj._id,
                name: proj.name
            },
            submittedBy: proj.completionProof.submittedBy || proj.manager,
            employee: proj.manager,
            status: proj.status,
            submittedAt: proj.completionProof.submittedAt,
            githubLink: proj.completionProof.githubLink,
            demoVideoLink: proj.completionProof.demoVideoLink,
            documentationLink: proj.completionProof.documentationLink,
            reviewStatus: proj.reviewCycle ?.reviewStatus || 'pending',
            defectCount: proj.reviewCycle ?.defectCount || 0
        }));

        res.json(proofs);

    } catch (err) {
        console.error('❌ Get completion proofs error:', err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
