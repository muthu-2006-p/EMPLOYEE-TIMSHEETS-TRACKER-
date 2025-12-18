const mongoose = require('mongoose');

const LeaveBalanceSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    year: {
        type: Number,
        required: true,
        default: () => new Date().getFullYear()
    },
    casualLeave: {
        total: { type: Number, default: 12 },
        used: { type: Number, default: 0 },
        balance: { type: Number, default: 12 }
    },
    sickLeave: {
        total: { type: Number, default: 12 },
        used: { type: Number, default: 0 },
        balance: { type: Number, default: 12 }
    },
    earnedLeave: {
        total: { type: Number, default: 18 },
        used: { type: Number, default: 0 },
        balance: { type: Number, default: 18 }
    },
    workFromHome: {
        total: { type: Number, default: 24 },
        used: { type: Number, default: 0 },
        balance: { type: Number, default: 24 }
    },
    permission: {
        total: { type: Number, default: 48 }, // In hours
        used: { type: Number, default: 0 },
        balance: { type: Number, default: 48 }
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Compound unique index for employee + year (allows same employee for different years)
LeaveBalanceSchema.index({ employee: 1, year: 1 }, { unique: true });

// Method to deduct leave balance
LeaveBalanceSchema.methods.deductLeave = function(leaveType, days, hours = 0) {
    const typeMap = {
        'CL': 'casualLeave',
        'SL': 'sickLeave',
        'EL': 'earnedLeave',
        'WFH': 'workFromHome',
        'PERMISSION': 'permission'
    };

    const field = typeMap[leaveType];
    if (!field) {
        throw new Error('Invalid leave type');
    }

    if (leaveType === 'PERMISSION') {
        // Permission is hour-based
        if (this[field].balance < hours) {
            throw new Error('Insufficient permission hours balance');
        }
        this[field].used += hours;
        this[field].balance -= hours;
    } else {
        // Day-based leaves
        if (this[field].balance < days) {
            throw new Error(`Insufficient ${leaveType} balance`);
        }
        this[field].used += days;
        this[field].balance -= days;
    }

    this.lastUpdated = Date.now();
    return this.save();
};

// Method to restore leave balance (when leave is cancelled)
LeaveBalanceSchema.methods.restoreLeave = function(leaveType, days, hours = 0) {
    const typeMap = {
        'CL': 'casualLeave',
        'SL': 'sickLeave',
        'EL': 'earnedLeave',
        'WFH': 'workFromHome',
        'PERMISSION': 'permission'
    };

    const field = typeMap[leaveType];
    if (!field) {
        throw new Error('Invalid leave type');
    }

    if (leaveType === 'PERMISSION') {
        this[field].used = Math.max(0, this[field].used - hours);
        this[field].balance = Math.min(this[field].total, this[field].balance + hours);
    } else {
        this[field].used = Math.max(0, this[field].used - days);
        this[field].balance = Math.min(this[field].total, this[field].balance + days);
    }

    this.lastUpdated = Date.now();
    return this.save();
};

// Static method to initialize leave balance for new employee
LeaveBalanceSchema.statics.initializeForEmployee = async function(employeeId) {
    try {
        const currentYear = new Date().getFullYear();

        // Check if balance exists for current year
        const existingBalance = await this.findOne({
            employee: employeeId,
            year: currentYear
        });

        if (existingBalance) {
            console.log('📊 Leave balance already exists for employee:', employeeId);
            return existingBalance;
        }

        console.log('📊 Creating new leave balance for employee:', employeeId, 'year:', currentYear);

        // Create new balance with default values
        const newBalance = await this.create({
            employee: employeeId,
            year: currentYear,
            casualLeave: { total: 12, used: 0, balance: 12 },
            sickLeave: { total: 12, used: 0, balance: 12 },
            earnedLeave: { total: 18, used: 0, balance: 18 },
            workFromHome: { total: 24, used: 0, balance: 24 },
            permission: { total: 48, used: 0, balance: 48 }
        });

        console.log('✅ Leave balance created successfully:', newBalance._id);
        return newBalance;

    } catch (err) {
        console.error('❌ Error initializing leave balance:', err);

        // If duplicate key error, return existing record
        if (err.code === 11000) {
            console.log('📊 Duplicate key error, fetching existing balance...');
            return this.findOne({
                employee: employeeId,
                year: new Date().getFullYear()
            });
        }

        throw err;
    }
};

module.exports = mongoose.model('LeaveBalance', LeaveBalanceSchema);
