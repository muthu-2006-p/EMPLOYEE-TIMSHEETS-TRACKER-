require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const timesheetRoutes = require('./routes/timesheets');
const projectRoutes = require('./routes/projects');
const statusRoutes = require('./routes/status');
const tasksRoutes = require('./routes/tasks');
const reportsRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const proofRoutes = require('./routes/proof');
const chartsRoutes = require('./routes/analytics-charts');
const feedbackRoutes = require('./routes/feedback');
const meetingsRoutes = require('./routes/meetings');
const taskCompletionRoutes = require('./routes/task-completion');
const attendanceRoutes = require('./routes/attendance');
const leaveRoutes = require('./routes/leave');
const feedbackThreadsRoutes = require('./routes/feedback-threads');
const meetingsEnhancedRoutes = require('./routes/meetings-enhanced');
const exportsRoutes = require('./routes/exports');
const usersRoutes = require('./routes/users');
const notifyRoutes = require('./routes/notify');
const projectCompletionRoutes = require('./routes/project-completion');
const analyticsReportRoutes = require('./routes/analytics-report');
const chatbotRoutes = require('./routes/chatbot');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

// Connect to MongoDB
connectDB().catch(err => console.error('DB Error:', err.message));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/analysis', reportsRoutes);
app.use('/api/charts', chartsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/proof', proofRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/meetings', meetingsRoutes);

// ===== NEW ENTERPRISE ROUTES =====
app.use('/api/task-completion', taskCompletionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/feedback-threads', feedbackThreadsRoutes);
app.use('/api/meetings-v2', meetingsEnhancedRoutes);
app.use('/api/export', exportsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/notify', notifyRoutes);
app.use('/api/project-completion', projectCompletionRoutes);
app.use('/api/analytics-report', analyticsReportRoutes);
app.use('/api/chatbot', chatbotRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Frontend
app.use(express.static(path.join(__dirname, '..', 'frontend'), { index: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'home.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'home.html')));

// Redirect old dashboard names to new ones
app.get('/dashboard_manager.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'manager.html')));
app.get('/dashboard_employee.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'employee.html')));
app.get('/dashboard_admin.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'admin.html')));

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ message: 'Server error' });
});

const server = app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} in browser`);
});

server.on('error', (err) => {
    console.error('❌ Server error:', err);
    process.exit(1);
});;