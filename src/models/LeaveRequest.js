const mongoose = require('mongoose');

const LeaveRequestSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    leaveType: {
        type: String,
        enum: ['CL', 'SL', 'EL', 'WFH', 'PERMISSION'],
        required: true
    },
    fromDate: {
        type: Date,
        required: true
    },
    toDate: {
        type: Date,
        required: true
    },
    // For permission (hour-based leave)
    permissionHours: {
        type: Number,
        min: 1,
        max: 4,
        default: null
    },
    totalDays: {
        type: Number,
        required: true,
        default: 1
    },
    reason: {
        type: String,
        required: true,
        minlength: 10,
        maxlength: 500
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'cancelled'],
        default: 'pending'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: {
        type: Date
    },
    rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    rejectedAt: {
        type: Date
    },
    rejectionReason: {
        type: String,
        maxlength: 500
    },
    attachments: [{
        fileName: String,
        fileUrl: String,
        fileType: String
    }],
    managerComments: {
        type: String,
        maxlength: 500
    },
    isEmergency: {
        type: Boolean,
        default: false
    },
    appliedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for faster queries
LeaveRequestSchema.index({ employee: 1, status: 1 });
LeaveRequestSchema.index({ status: 1, appliedAt: -1 });
LeaveRequestSchema.index({ fromDate: 1, toDate: 1 });

// Calculate total days before saving
LeaveRequestSchema.pre('save', function(next) {
    if (this.leaveType === 'PERMISSION') {
        // Permission is hour-based, not day-based
        this.totalDays = 0;
    } else if (this.fromDate && this.toDate) {
        const diffTime = Math.abs(this.toDate - this.fromDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        this.totalDays = diffDays;
    }
    next();
});

module.exports = mongoose.model('LeaveRequest', LeaveRequestSchema);
