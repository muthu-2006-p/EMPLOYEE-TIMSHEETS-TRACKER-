const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String },
    title: { type: String },
    body: { type: String },
    read: { type: Boolean, default: false },
    meta: { type: Object },
}, { timestamps: true });

module.exports = mongoose.model('Notification', NotificationSchema);
