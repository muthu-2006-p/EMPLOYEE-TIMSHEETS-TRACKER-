const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ['pending', 'read', 'replied'],
        default: 'pending'
    },
    parentFeedback: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Feedback',
        default: null
    },
    replies: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Feedback'
    }],
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },
    category: {
        type: String,
        enum: ['general', 'task', 'attendance', 'leave', 'performance', 'other'],
        default: 'general'
    }
}, { timestamps: true });

// Index for faster queries
FeedbackSchema.index({ from: 1, to: 1, createdAt: -1 });
FeedbackSchema.index({ status: 1 });

module.exports = mongoose.model('Feedback', FeedbackSchema);
