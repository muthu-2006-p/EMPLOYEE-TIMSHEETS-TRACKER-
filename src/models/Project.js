const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    status: {
        type: String,
        enum: ['active', 'completed', 'pending_review', 'rework_required', 'approved', 'on-hold'],
        default: 'active'
    },
    startDate: { type: Date },
    endDate: { type: Date },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    employees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    budget: { type: Number },

    // Project Completion Proof
    completionProof: {
        githubLink: String,
        demoVideoLink: String,
        documentationLink: String,
        completionNotes: String,
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        submittedAt: Date
    },

    // Admin Review
    reviewCycle: {
        reviewStatus: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'rework_required'],
            default: 'pending'
        },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reviewedAt: Date,
        defectDescription: String,
        adminComments: String,
        defectCount: { type: Number, default: 0 },
        reworkRequired: { type: Boolean, default: false }
    }
}, { timestamps: true });

module.exports = mongoose.model('Project', ProjectSchema);
