const mongoose = require('mongoose');

const feedbackMessageSchema = new mongoose.Schema({
    thread: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FeedbackThread',
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    senderRole: {
        type: String,
        enum: ['employee', 'manager', 'admin'],
        required: true
    },
    message: {
        type: String,
        required: true
    },
    attachment: {
        type: String,
        default: null
    },
    readStatus: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('FeedbackMessage', feedbackMessageSchema);
