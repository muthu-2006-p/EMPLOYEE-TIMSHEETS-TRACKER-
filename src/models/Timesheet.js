const mongoose = require('mongoose');

const TimesheetSchema = new mongoose.Schema({
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    date: { type: Date, required: true },
    endDate: { type: Date },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    breakMinutes: { type: Number, default: 0 },
    totalHours: { type: Number },
    description: { type: String },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    // support multi-level statuses
    status: { type: String, enum: ['draft', 'pending', 'pending_manager', 'pending_hr', 'pending_director', 'approved_final', 'approved', 'rejected', 'locked'], default: 'pending' },
    managerRemarks: { type: String },
    approvals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Approval' }],
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    overtimeHours: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Timesheet', TimesheetSchema);
