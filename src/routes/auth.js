const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// register
router.post('/register', async(req, res) => {
    try {
        const { name, email, password, role, managerEmail, department, designation, photo, github, linkedin, phone, dob, address, bio } = req.body;
        if (!name || !email || !password) return res.status(400).json({ message: 'name/email/password required' });
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ message: 'Email already in use' });
        const hashed = await bcrypt.hash(password, 10);
        const payload = { name, email, password: hashed, role: role || 'employee', department, designation };
        if (photo) payload.photo = photo;
        if (github) payload.github = github;
        if (linkedin) payload.linkedin = linkedin;
        if (phone) payload.phone = phone;
        if (dob) payload.dob = dob;
        if (address) payload.address = address;
        if (bio) payload.bio = bio;
        // resolve manager by email if provided
        if (managerEmail) {
            const mgr = await User.findOne({ email: managerEmail });
            if (mgr) payload.manager = mgr._id;
        }
        const user = await User.create(payload);
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.status(201).json({
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                role: user.role,
                department: user.department,
                designation: user.designation,
                phone: user.phone,
                dob: user.dob,
                address: user.address,
                photo: user.photo,
                github: user.github,
                linkedin: user.linkedin,
                bio: user.bio
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// login
router.post('/login', async(req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'email/password required' });
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: 'Invalid credentials' });
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                department: user.department,
                designation: user.designation,
                phone: user.phone,
                dob: user.dob,
                address: user.address,
                photo: user.photo,
                github: user.github,
                linkedin: user.linkedin,
                bio: user.bio
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get current user info (auth/me)
router.get('/me', auth, async(req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({
            user: {
                id: user._id,
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                department: user.department,
                designation: user.designation,
                phone: user.phone,
                dob: user.dob,
                address: user.address,
                photo: user.photo,
                github: user.github,
                linkedin: user.linkedin,
                bio: user.bio
            }
        });
    } catch (err) {
        console.error('Get me error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
