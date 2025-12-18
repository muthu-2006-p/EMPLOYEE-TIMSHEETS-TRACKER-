const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async(req, res, next) => {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ message: 'No token provided' });
    const token = authHeader.split(' ')[1];
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(payload.id).select('-password');
        if (!user) return res.status(401).json({ message: 'User not found' });
        req.user = user;
        next();
    } catch (err) {
        console.error(err);
        return res.status(401).json({ message: 'Token invalid' });
    }
};

const permit = (...allowed) => {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
        if (allowed.includes(req.user.role)) return next();
        return res.status(403).json({ message: 'Forbidden' });
    };
};

module.exports = { auth, permit };
