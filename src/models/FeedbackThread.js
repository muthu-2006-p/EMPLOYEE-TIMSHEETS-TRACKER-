const mongoose = require('mongoose');

const feedbackThreadSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true
    },
    tag: {
        type: String,
        enum: ['Bug', 'Issue', 'Performance', 'General', 'Request', 'Other'],
        default: 'General'
    },
    status: {
        type: String,
        enum: ['open', 'closed', 'resolved'],
        default: 'open'
    },
    lastMessageAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('FeedbackThread', feedbackThreadSchema);
