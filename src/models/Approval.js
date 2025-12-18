const mongoose = require('mongoose');

const ApprovalSchema = new mongoose.Schema({
    timesheet: { type: mongoose.Schema.Types.ObjectId, ref: 'Timesheet', required: true, index: true },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    level: { type: String, required: true },
    action: { type: String, enum: ['approve', 'reject'], required: true },
    comments: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Approval', ApprovalSchema);
const mongoose = require('mongoose');

const ApprovalSchema = new mongoose.Schema({
    timesheet: { type: mongoose.Schema.Types.ObjectId, ref: 'Timesheet', required: true },
    approver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: ['approved', 'rejected'], required: true },
    comments: { type: String },
    level: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Approval', ApprovalSchema);
