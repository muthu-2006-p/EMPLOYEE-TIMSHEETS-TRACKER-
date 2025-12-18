const mongoose = require('mongoose');

const meetingAttendanceSchema = new mongoose.Schema({
    meeting: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Meeting',
        required: true
    },
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    joinedAt: {
        type: Date,
        default: null
    },
    duration: {
        type: Number, // in minutes
        default: 0
    },
    attended: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('MeetingAttendance', meetingAttendanceSchema);
