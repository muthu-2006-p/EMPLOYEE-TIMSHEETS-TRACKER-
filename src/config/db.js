const mongoose = require('mongoose');

/**
 * Connect to MongoDB using either a full MONGODB_URI or separate MONGO_USER/MONGO_PASSWORD/MONGO_HOST/MONGO_DB pieces.
 * Improves error messages for common auth/network issues to make troubleshooting easier.
 */
const connectDB = async() => {
    // prefer full uri if provided
    let uri = process.env.MONGODB_URI && process.env.MONGODB_URI.trim() !== '' ? process.env.MONGODB_URI : null;

    // allow building URI from components for easier local editing without embedding password in a long URI string
    if (!uri && process.env.MONGO_USER && process.env.MONGO_PASSWORD && process.env.MONGO_HOST && process.env.MONGO_DB) {
        const user = encodeURIComponent(process.env.MONGO_USER);
        const pass = encodeURIComponent(process.env.MONGO_PASSWORD);
        const host = process.env.MONGO_HOST;
        const db = process.env.MONGO_DB;
        uri = `mongodb+srv://${user}:${pass}@${host}/${db}?retryWrites=true&w=majority&appName=timesheettracker`;
    }

    if (!uri) {
        console.warn('⚠️ MongoDB connection information not found in environment. Falling back to local MongoDB at mongodb://127.0.0.1:27017/timesheettracker for development.');
        console.log('📝 To use Atlas or a remote DB, set MONGODB_URI or MONGO_USER/MONGO_PASSWORD/MONGO_HOST/MONGO_DB in your .env');
        console.log('📝 Example full URI: mongodb+srv://username:password@cluster0.mongodb.net/timesheettracker?retryWrites=true&w=majority');
        uri = 'mongodb://127.0.0.1:27017/timesheettracker';
    }

    try {
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ MongoDB Atlas Connected Successfully!');
    } catch (err) {
        // provide actionable hints for common causes
        console.error('❌ MongoDB connection error:', err.message);
        if (/auth/i.test(err.message) || /authentication/i.test(err.message) || /bad auth/i.test(err.message)) {
            console.log('🔍 Authentication failed: check the username/password in your connection string or Database Users in Atlas.');
            console.log('🔐 If you recently changed the password, update it in your .env.');
        }
        if (/IP|network/i.test(err.message) || /timed out/i.test(err.message)) {
            console.log('🔍 Network issue: ensure your IP is allowed in Atlas Network Access (or add 0.0.0.0/0 temporarily).');
        }
        console.log('🔍 Full error:');
        console.error(err);
        // Throw error to let caller handle it
        throw err;
    }
};

module.exports = connectDB;
