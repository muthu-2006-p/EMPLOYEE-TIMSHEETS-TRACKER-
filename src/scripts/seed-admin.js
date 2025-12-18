require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('MONGODB_URI not set in .env. Create .env with your Atlas URI');
    process.exit(1);
}

async function run() {
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
    const password = process.env.SEED_ADMIN_PASSWORD || 'Password123!';
    const existing = await User.findOne({ email });
    if (existing) {
        console.log('Admin already exists:', email);
        process.exit(0);
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name: 'Admin', email, password: hashed, role: 'admin' });
    console.log('Created admin user:', user.email, 'password:', password);
    process.exit(0);
}

run().catch(err => { console.error(err);
    process.exit(1); });
