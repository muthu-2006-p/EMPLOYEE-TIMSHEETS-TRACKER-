const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
    proof: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ProofSubmission',
        required: true,
        index: true
    },
    task: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task',
        required: true,
        index: true
    },
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },

    // Reviewer Information
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    reviewerRole: {
        type: String,
        enum: ['manager', 'admin'],
        required: true
    },

    // Review Decision
    decision: {
        type: String,
        enum: ['approved', 'defect_found'],
        required: true
    },

    // Review Details
    comments: {
        type: String,
        required: true,
        minlength: [5, 'Review comments required']
    },

    // If Defect
    defectDescription: String,
    defectSeverity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },

    // Rework Tracking
    requiresRework: { type: Boolean, default: false },
    reworkDeadline: Date,

    // Timestamps
    reviewedAt: { type: Date, default: Date.now },

    // Status After Review
    taskStatusAfterReview: {
        type: String,
        enum: ['completed', 'rework_required', 'pending_resubmission'],
        required: true
    },

    // Next Task Assignment
    nextTaskAssignedAt: Date,
    nextTaskId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task'
    }
}, { timestamps: true });

// Indexes for performance
ReviewSchema.index({ task: 1, employee: 1, createdAt: -1 });
ReviewSchema.index({ reviewedBy: 1, createdAt: -1 });
ReviewSchema.index({ project: 1, decision: 1 });

module.exports = mongoose.model('Review', ReviewSchema);
