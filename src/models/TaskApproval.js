const mongoose = require('mongoose');

const TaskApprovalSchema = new mongoose.Schema({
    task: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task',
        required: true,
        index: true
    },
    assignment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Task.assignments._id'
    },
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    approver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        enum: ['approved', 'rejected', 'pending'],
        default: 'pending'
    },
    comments: {
        type: String,
        maxlength: 1000
    },
    approvalDate: {
        type: Date,
        index: true
    },
}, { timestamps: true });

// Index for quick lookups
TaskApprovalSchema.index({ task: 1, employee: 1, createdAt: -1 });
TaskApprovalSchema.index({ approver: 1, createdAt: -1 });

module.exports = mongoose.model('TaskApproval', TaskApprovalSchema);
