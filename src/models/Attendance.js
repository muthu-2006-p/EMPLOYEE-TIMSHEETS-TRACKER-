const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        required: true,
        default: () => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return today;
        }
    },
    checkInTime: {
        type: Date,
        required: true
    },
    checkOutTime: {
        type: Date
    },
    totalHours: {
        type: Number,
        default: 0
    },
    overtimeHours: {
        type: Number,
        default: 0
    },
    isLate: {
        type: Boolean,
        default: false
    },
    isEarly: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['checked_in', 'checked_out', 'correction_requested', 'correction_approved'],
        default: 'checked_in'
    },
    notes: {
        type: String,
        maxlength: 500
    },
    correctionRequest: {
        reason: String,
        requestedCheckIn: Date,
        requestedCheckOut: Date,
        requestedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        requestedAt: Date,
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        approvedAt: Date,
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending'
        }
    },
    project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    },
    location: {
        type: String,
        enum: ['office', 'remote', 'client_site'],
        default: 'office'
    }
}, {
    timestamps: true
});

// Index for faster queries
AttendanceSchema.index({ employee: 1, date: 1 });
AttendanceSchema.index({ date: 1 });
AttendanceSchema.index({ status: 1 });

// Calculate total hours and overtime before saving
AttendanceSchema.pre('save', function(next) {
    if (this.checkOutTime && this.checkInTime) {
        const diffMs = this.checkOutTime - this.checkInTime;
        const diffHours = diffMs / (1000 * 60 * 60);
        this.totalHours = Math.round(diffHours * 100) / 100; // Round to 2 decimals

        // Standard work day is 8 hours
        const standardHours = 8;
        if (this.totalHours > standardHours) {
            this.overtimeHours = Math.round((this.totalHours - standardHours) * 100) / 100;
        }

        // Check if checked out early (before 5:00 PM)
        const checkOutHour = this.checkOutTime.getHours();
        if (checkOutHour < 17) {
            this.isEarly = true;
        }
    }

    next();
});

// Static method to check if late (after 9:30 AM grace period)
AttendanceSchema.methods.checkIfLate = function(graceMinutes = 30) {
    const checkInHour = this.checkInTime.getHours();
    const checkInMinutes = this.checkInTime.getMinutes();

    // Standard time: 9:00 AM + grace period
    const standardHour = 9;
    const lateThreshold = standardHour * 60 + graceMinutes; // in minutes
    const checkInTotalMinutes = checkInHour * 60 + checkInMinutes;

    if (checkInTotalMinutes > lateThreshold) {
        this.isLate = true;
        return true;
    }
    return false;
};

module.exports = mongoose.model('Attendance', AttendanceSchema);
