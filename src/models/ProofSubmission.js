const mongoose = require('mongoose');

const ProofSubmissionSchema = new mongoose.Schema({
    task: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task',
        required: true,
        index: true
    },
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },

    // Proof Links (Required)
    githubLink: {
        type: String,
        required: true
    },
    demoVideoLink: {
        type: String,
        required: true
    },

    // Attachments
    attachments: [{
        fileName: { type: String, required: true },
        fileUrl: { type: String, required: true },
        fileType: {
            type: String,
            enum: ['image', 'pdf', 'document', 'code', 'other'],
            required: true
        },
        uploadedAt: { type: Date, default: Date.now }
    }],

    // Completion Notes
    completionNotes: {
        type: String,
        required: true,
        minlength: [20, 'Notes must be at least 20 characters'],
        maxlength: [2000, 'Notes cannot exceed 2000 characters']
    },

    // Submission Status
    submissionStatus: {
        type: String,
        enum: ['submitted', 'pending_review', 'approved', 'rejected'],
        default: 'submitted'
    },
    submittedAt: { type: Date, default: Date.now },

    // Review Information
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewedAt: Date,

    // Review Decision
    reviewDecision: {
        type: String,
        enum: ['approved', 'defect_found', 'pending'],
        default: 'pending'
    },
    managerComments: String,

    // Defect Tracking
    defectDescription: String,
    defectCount: { type: Number, default: 0 },
    reworkRequired: { type: Boolean, default: false },
    reworkAttempts: { type: Number, default: 0 },
    maxReworkAttempts: { type: Number, default: 3 },

    // Final Approval
    finalApprovedAt: Date,
    isApproved: { type: Boolean, default: false },

    // Notification Tracking
    notificationsSent: {
        toManager: { type: Boolean, default: false },
        toAdmin: { type: Boolean, default: false },
        toEmployee: { type: Boolean, default: false }
    }
}, { timestamps: true });

// Indexes for performance
ProofSubmissionSchema.index({ task: 1, employee: 1 });
ProofSubmissionSchema.index({ project: 1, submittedAt: -1 });
ProofSubmissionSchema.index({ reviewedBy: 1, reviewedAt: -1 });
ProofSubmissionSchema.index({ submissionStatus: 1, createdAt: -1 });

module.exports = mongoose.model('ProofSubmission', ProofSubmissionSchema);
