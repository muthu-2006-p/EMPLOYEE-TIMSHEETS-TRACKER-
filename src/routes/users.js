const express = require('express');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET users filtered by role - for role-based participant selection
router.get('/by-role', auth, async(req, res) => {
    try {
        const { roles } = req.query; // e.g., ?roles=employee,manager

        console.log('👥 Fetching users by role:', roles, 'for user:', req.user.name, req.user.role);

        if (!roles) {
            return res.status(400).json({ message: 'roles query parameter required (e.g., ?roles=employee,manager)' });
        }

        // Parse comma-separated roles
        const roleArray = roles.split(',').map(r => r.trim()).filter(r => r);

        if (roleArray.length === 0) {
            return res.status(400).json({ message: 'At least one role must be specified' });
        }

        // Validate roles
        const validRoles = ['employee', 'manager', 'admin'];
        const invalidRoles = roleArray.filter(r => !validRoles.includes(r));
        if (invalidRoles.length > 0) {
            return res.status(400).json({
                message: `Invalid roles: ${invalidRoles.join(', ')}. Valid roles: ${validRoles.join(', ')}`
            });
        }

        const users = await User.find({
                role: { $in: roleArray },
                isActive: true
            })
            .select('_id name email role department designation')
            .sort({ name: 1 });

        console.log(`👥 Found ${users.length} users with roles: ${roleArray.join(', ')}`);

        res.json({
            message: 'Users retrieved successfully',
            data: users,
            count: users.length
        });
    } catch (e) {
        console.error('❌ Failed to list users by role:', e);
        res.status(500).json({ message: 'Server error', error: e.message });
    }
});

// GET all users (employees and managers) - for dropdowns and listings
router.get('/', auth, async(req, res) => {
    try {
        const users = await User.find({ role: { $in: ['employee', 'manager'] } })
            .select('_id name email role department designation phone dob address isActive')
            .sort({ name: 1 });
        res.json(users);
    } catch (e) {
        console.error('Failed to list users', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET single user by ID
router.get('/:id', auth, async(req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (e) {
        console.error('Failed to get user', e);
        res.status(500).json({ message: 'Server error' });
    }
});

// DELETE user (admin only)
router.delete('/:id', auth, async(req, res) => {
    try {
        // Check if requester is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'User deleted successfully' });
    } catch (e) {
        console.error('Failed to delete user', e);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
