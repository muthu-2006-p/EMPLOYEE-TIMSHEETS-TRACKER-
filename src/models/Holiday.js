const mongoose = require('mongoose');

const HolidaySchema = new mongoose.Schema({
    date: { type: Date, required: true },
    description: { type: String }
});

module.exports = mongoose.model('Holiday', HolidaySchema);
