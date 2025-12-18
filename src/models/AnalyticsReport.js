const mongoose = require('mongoose');

const AnalyticsReportSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportType: {
        type: String,
        enum: ['team_performance', 'project_status', 'timesheet_summary', 'custom'],
        default: 'team_performance'
    },
    dateRange: {
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true }
    },
    filters: {
        projects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
        employees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        tasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }],
        status: [String]
    },
    data: {
        // Timesheet Analytics
        timesheets: {
            total: { type: Number, default: 0 },
            approved: { type: Number, default: 0 },
            pending: { type: Number, default: 0 },
            rejected: { type: Number, default: 0 },
            totalHours: { type: Number, default: 0 },
            byEmployee: [{
                employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                name: String,
                count: Number,
                hours: Number,
                avgHoursPerDay: Number
            }],
            byProject: [{
                project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
                name: String,
                hours: Number,
                percentage: Number
            }],
            byTask: [{
                task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
                name: String,
                hours: Number
            }]
        },

        // Task Analytics
        tasks: {
            total: { type: Number, default: 0 },
            completed: { type: Number, default: 0 },
            inProgress: { type: Number, default: 0 },
            pending: { type: Number, default: 0 },
            byEmployee: [{
                employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                name: String,
                completed: Number,
                inProgress: Number,
                pending: Number,
                completionRate: Number
            }]
        },

        // Attendance Analytics
        attendance: {
            totalDays: { type: Number, default: 0 },
            presentDays: { type: Number, default: 0 },
            absentDays: { type: Number, default: 0 },
            lateDays: { type: Number, default: 0 },
            byEmployee: [{
                employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                name: String,
                present: Number,
                absent: Number,
                late: Number,
                attendanceRate: Number
            }]
        },

        // Leave Analytics
        leaves: {
            total: { type: Number, default: 0 },
            approved: { type: Number, default: 0 },
            pending: { type: Number, default: 0 },
            rejected: { type: Number, default: 0 },
            byEmployee: [{
                employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                name: String,
                count: Number,
                days: Number
            }],
            byType: [{
                type: String,
                count: Number
            }]
        },

        // Performance Rankings
        rankings: {
            topPerformers: [{
                employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                name: String,
                score: Number,
                metrics: {
                    taskCompletionRate: Number,
                    attendanceRate: Number,
                    totalHours: Number,
                    avgHoursPerDay: Number
                }
            }],
            needsImprovement: [{
                employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                name: String,
                issues: [String]
            }]
        }
    },

    status: {
        type: String,
        enum: ['draft', 'sent', 'viewed', 'downloaded'],
        default: 'draft'
    },

    sentToAdmin: { type: Boolean, default: false },
    sentAt: { type: Date },
    viewedByAdmin: { type: Boolean, default: false },
    viewedAt: { type: Date },
    downloadedByAdmin: { type: Boolean, default: false },
    downloadedAt: { type: Date },

    adminNotes: { type: String },
    adminRating: { type: Number, min: 1, max: 5 }

}, { timestamps: true });

module.exports = mongoose.model('AnalyticsReport', AnalyticsReportSchema);
