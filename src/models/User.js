const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'manager', 'employee'], default: 'employee' },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    department: { type: String },
    designation: { type: String },
    phone: { type: String },
    dob: { type: Date },
    address: { type: String },
    photo: { type: String },
    github: { type: String },
    linkedin: { type: String },
    bio: { type: String },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
