const mongoose = require('mongoose');

const ProofSubmissionSchema = new mongoose.Schema({
    githubLink: { type: String, required: true, match: /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)/ },
    demoVideoLink: { type: String, required: true, match: /^https?:\/\/(youtube\.com|youtu\.be|vimeo\.com|loom\.com|drive\.google\.com)/ },
    attachments: [{
        fileName: String,
        fileUrl: String,
        fileType: String, // image, pdf, document, etc
        uploadedAt: { type: Date, default: Date.now }
    }],
    completionNotes: { type: String, minlength: 20, maxlength: 2000, required: true },
    submittedAt: { type: Date, default: Date.now }
}, { _id: false });

const ReviewCycleSchema = new mongoose.Schema({
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewStatus: {
        type: String,
        enum: ['pending_review', 'approved', 'defect_found'],
        default: 'pending_review'
    },
    managerComments: { type: String },
    defectDescription: { type: String },
    reviewedAt: { type: Date },
    defectCount: { type: Number, default: 0 },
    reworkRequired: { type: Boolean, default: false }
}, { _id: false });

const AssignmentSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
        type: String,
        enum: ['assigned', 'in_progress', 'submitted', 'pending_review', 'approved', 'defect_found', 'rework_required', 'completed'],
        default: 'assigned'
    },
    progress: { type: Number, default: 0 }, // percent 0-100
    submittedTimesheet: { type: Boolean, default: false },
    deadline: { type: Date },

    // Proof Submission Fields
    proofSubmission: ProofSubmissionSchema,

    // Review Cycle Fields
    reviewCycle: ReviewCycleSchema,

    // Legacy fields (keeping for backward compatibility)
    submittedAt: { type: Date },
    submittedData: {
        workLogs: { type: String },
        remarks: { type: String },
        attachments: [{ type: String }]
    },

    // Rework Tracking
    reworkAttempts: { type: Number, default: 0 },
    maxReworkAttempts: { type: Number, default: 3 },
    finalApprovedAt: { type: Date }
}, { _id: false });

const TaskSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // manager
    assignments: [AssignmentSchema],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Task', TaskSchema);
