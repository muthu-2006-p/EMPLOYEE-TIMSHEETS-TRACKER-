require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || (process.env.MONGO_USER && process.env.MONGO_PASSWORD && process.env.MONGO_HOST && process.env.MONGO_DB ?
    `mongodb+srv://${encodeURIComponent(process.env.MONGO_USER)}:${encodeURIComponent(process.env.MONGO_PASSWORD)}@${process.env.MONGO_HOST}/${process.env.MONGO_DB}?retryWrites=true&w=majority&appName=timesheettracker` : null);

if (!uri) {
    console.error('No MONGODB_URI or MONGO_* components found in environment. Edit .env and try again.');
    process.exit(1);
}

(async() => {
    try {
        console.log('Attempting to connect to MongoDB...');
        await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('Connected to MongoDB successfully!');
        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error('Connection failed:', err.message);
        console.error(err);
        process.exit(1);
    }
})();
