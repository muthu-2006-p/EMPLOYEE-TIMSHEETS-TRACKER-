const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    link: {
        type: String,
        required: true
    },
    dateTime: {
        type: Date,
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    senderRole: {
        type: String,
        enum: ['manager', 'admin', 'employee'],
        required: true
    },
    recipients: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    recipientRole: {
        type: String,
        enum: ['employee', 'manager', 'admin', 'all'],
        default: 'all'
    },
    isExpired: {
        type: Boolean,
        default: false
    },
    duration: {
        type: Number, // in minutes
        default: 60
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Meeting', meetingSchema);
