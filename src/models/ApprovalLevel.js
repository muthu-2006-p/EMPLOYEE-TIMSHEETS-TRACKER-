const mongoose = require('mongoose');

const ApprovalLevelSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    display: { type: String, required: true },
    role: { type: String, required: true },
    status: { type: String, required: true },
    order: { type: Number, default: 0 }
});

module.exports = mongoose.model('ApprovalLevel', ApprovalLevelSchema);
