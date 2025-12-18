const mongoose = require('mongoose');
require('dotenv').config();

// Load all models in the right order
require('./src/models/User');
require('./src/models/Attendance');

const Attendance = mongoose.model('Attendance');

async function checkAttendance() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get recent attendance records
    const records = await Attendance.find()
        .sort({ date: -1 })
        .limit(10)
        .populate('employee', 'name');

    console.log('\nRecent attendance records:');
    records.forEach(r => {
        console.log(`  - ${r.employee?.name || 'Unknown'} | Date: ${r.date} | Status: ${r.status} | CheckIn: ${r.checkInTime}`);
    });

    // Check today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    console.log('\nToday range:', today, 'to', tomorrow);

    const todayRecords = await Attendance.find({
        date: { $gte: today, $lt: tomorrow }
    }).populate('employee', 'name');

    console.log('\nToday\'s attendance (using range query):');
    todayRecords.forEach(r => {
        console.log(`  - ${r.employee?.name || 'Unknown'} | Date: ${r.date} | Status: ${r.status}`);
    });

    await mongoose.disconnect();
}

checkAttendance().catch(console.error);
