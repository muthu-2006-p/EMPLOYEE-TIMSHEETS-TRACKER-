/**
 * Comprehensive Validation Utilities
 * Used across all routes for consistent validation
 */

const mongoose = require('mongoose');

// Date Validations
const dateValidation = {
    /**
     * Validate date format and parse
     */
    isValidDate(dateString) {
        const date = new Date(dateString);
        return !isNaN(date.getTime());
    },

    /**
     * Check if date is not in the future
     */
    isNotFuture(dateString) {
        const date = new Date(dateString);
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        return date <= today;
    },

    /**
     * Check if date is not in the past
     */
    isNotPast(dateString) {
        const date = new Date(dateString);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return date >= today;
    },

    /**
     * Validate date range (end >= start)
     */
    isValidRange(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        return end >= start;
    },

    /**
     * Check if dates are within valid range (e.g., not more than 1 year)
     */
    isWithinMaxDuration(startDate, endDate, maxDays = 365) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= maxDays;
    },

    /**
     * Get days difference
     */
    getDaysDifference(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end - start);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }
};

// Time Validations
const timeValidation = {
    /**
     * Validate time format HH:MM
     */
    isValidTimeFormat(timeString) {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        return timeRegex.test(timeString);
    },

    /**
     * Check if end time is after start time
     */
    isEndAfterStart(startTime, endTime, date = new Date().toISOString().split('T')[0]) {
        const start = new Date(`${date}T${startTime}:00`);
        const end = new Date(`${date}T${endTime}:00`);
        return end > start;
    },

    /**
     * Calculate hours between times
     */
    calculateHours(startTime, endTime, breakMinutes = 0, date = new Date().toISOString().split('T')[0]) {
        const start = new Date(`${date}T${startTime}:00`);
        const end = new Date(`${date}T${endTime}:00`);
        const diffMs = end - start;
        return Math.max(0, (diffMs / (1000 * 60 * 60)) - (breakMinutes / 60));
    },

    /**
     * Validate hours don't exceed 24
     */
    isUnder24Hours(hours) {
        return hours > 0 && hours <= 24;
    }
};

// String Validations
const stringValidation = {
    /**
     * Check minimum length
     */
    hasMinLength(str, minLength) {
        return str && str.trim().length >= minLength;
    },

    /**
     * Check maximum length
     */
    hasMaxLength(str, maxLength) {
        return str && str.trim().length <= maxLength;
    },

    /**
     * Check if string is within length range
     */
    isValidLength(str, minLength, maxLength) {
        return this.hasMinLength(str, minLength) && this.hasMaxLength(str, maxLength);
    },

    /**
     * Check if string matches pattern
     */
    matchesPattern(str, pattern) {
        return pattern.test(str);
    }
};

// MongoDB ID Validations
const idValidation = {
    /**
     * Check if valid MongoDB ObjectId
     */
    isValidObjectId(id) {
        return mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id);
    },

    /**
     * Check if document exists in collection
     */
    async documentExists(model, id) {
        if (!this.isValidObjectId(id)) return false;
        const doc = await model.findById(id);
        return !!doc;
    }
};

// Array Validations
const arrayValidation = {
    /**
     * Check if array has minimum items
     */
    hasMinItems(arr, minItems = 1) {
        return Array.isArray(arr) && arr.length >= minItems;
    },

    /**
     * Check if all items in array are valid ObjectIds
     */
    allValidObjectIds(arr) {
        if (!Array.isArray(arr)) return false;
        return arr.every(id => idValidation.isValidObjectId(id));
    }
};

// Enum Validations
const enumValidation = {
    /**
     * Check if value is in allowed list
     */
    isInEnum(value, allowedValues) {
        return allowedValues.includes(value);
    },

    /**
     * Case-insensitive enum check
     */
    isInEnumCaseInsensitive(value, allowedValues) {
        return allowedValues.map(v => v.toLowerCase()).includes(value.toLowerCase());
    }
};

// Specific Validations
const specificValidation = {
    /**
     * Validate email format
     */
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },

    /**
     * Validate phone number
     */
    isValidPhone(phone) {
        const phoneRegex = /^[0-9]{10,15}$/;
        return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
    },

    /**
     * Validate URL
     */
    isValidURL(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Validate file upload
     */
    isValidFile(file, allowedTypes = [], maxSizeMB = 10) {
        if (!file) return false;

        // Check file size
        const maxSize = maxSizeMB * 1024 * 1024;
        if (file.size > maxSize) return false;

        // Check file type if specified
        if (allowedTypes.length > 0) {
            const fileExt = file.originalname.split('.').pop().toLowerCase();
            return allowedTypes.includes(fileExt);
        }

        return true;
    }
};

// Filter Validations
const filterValidation = {
    /**
     * Validate month format (1-12)
     */
    isValidMonth(month) {
        const m = parseInt(month);
        return !isNaN(m) && m >= 1 && m <= 12;
    },

    /**
     * Validate year format
     */
    isValidYear(year) {
        const y = parseInt(year);
        return !isNaN(y) && y >= 2000 && y <= 2100;
    },

    /**
     * Validate employee name for search
     */
    isValidEmployeeName(name) {
        return stringValidation.hasMinLength(name, 2) && stringValidation.hasMaxLength(name, 100);
    },

    /**
     * Validate project name for search
     */
    isValidProjectName(name) {
        return stringValidation.hasMinLength(name, 2) && stringValidation.hasMaxLength(name, 100);
    }
};

// Composite Validations (commonly used combinations)
const compositeValidation = {
    /**
     * Validate timesheet data
     */
    validateTimesheet(data) {
        const errors = [];

        if (!data.date) errors.push('Date is required');
        else if (!dateValidation.isValidDate(data.date)) errors.push('Invalid date format');
        else if (!dateValidation.isNotFuture(data.date)) errors.push('Cannot create timesheet for future dates');

        if (!data.startTime) errors.push('Start time is required');
        else if (!timeValidation.isValidTimeFormat(data.startTime)) errors.push('Invalid start time format (use HH:MM)');

        if (!data.endTime) errors.push('End time is required');
        else if (!timeValidation.isValidTimeFormat(data.endTime)) errors.push('Invalid end time format (use HH:MM)');

        if (data.startTime && data.endTime && data.date) {
            if (!timeValidation.isEndAfterStart(data.startTime, data.endTime)) {
                errors.push('End time must be after start time');
            }
            const hours = timeValidation.calculateHours(data.startTime, data.endTime, data.breakMinutes || 0, data.date);
            if (!timeValidation.isUnder24Hours(hours)) {
                errors.push(`Total hours (${hours.toFixed(2)}h) cannot exceed 24 hours`);
            }
        }

        return { isValid: errors.length === 0, errors };
    },

    /**
     * Validate attendance data
     */
    validateAttendance(data) {
        const errors = [];

        if (!data.date) errors.push('Date is required');
        else if (!dateValidation.isValidDate(data.date)) errors.push('Invalid date format');
        else if (!dateValidation.isNotFuture(data.date)) errors.push('Cannot mark attendance for future dates');

        if (!data.checkIn) errors.push('Check-in time is required');
        else if (!timeValidation.isValidTimeFormat(data.checkIn)) errors.push('Invalid check-in time format');

        if (data.checkOut) {
            if (!timeValidation.isValidTimeFormat(data.checkOut)) errors.push('Invalid check-out time format');
            if (data.checkIn && !timeValidation.isEndAfterStart(data.checkIn, data.checkOut, data.date)) {
                errors.push('Check-out must be after check-in');
            }
        }

        return { isValid: errors.length === 0, errors };
    },

    /**
     * Validate leave request data
     */
    validateLeave(data) {
        const errors = [];

        if (!data.startDate) errors.push('Start date is required');
        else if (!dateValidation.isValidDate(data.startDate)) errors.push('Invalid start date format');
        else if (!dateValidation.isNotPast(data.startDate)) errors.push('Cannot request leave for past dates');

        if (!data.endDate) errors.push('End date is required');
        else if (!dateValidation.isValidDate(data.endDate)) errors.push('Invalid end date format');

        if (data.startDate && data.endDate) {
            if (!dateValidation.isValidRange(data.startDate, data.endDate)) {
                errors.push('End date cannot be before start date');
            }
            if (!dateValidation.isWithinMaxDuration(data.startDate, data.endDate, 30)) {
                errors.push('Leave duration cannot exceed 30 days');
            }
        }

        if (!data.leaveType) errors.push('Leave type is required');
        else if (!enumValidation.isInEnumCaseInsensitive(data.leaveType, ['sick', 'casual', 'vacation', 'emergency', 'unpaid', 'other'])) {
            errors.push('Invalid leave type');
        }

        if (!data.reason) errors.push('Reason is required');
        else if (!stringValidation.hasMinLength(data.reason, 10)) errors.push('Reason must be at least 10 characters');

        return { isValid: errors.length === 0, errors };
    },

    /**
     * Validate meeting data
     */
    validateMeeting(data) {
        const errors = [];

        if (!data.title) errors.push('Meeting title is required');
        else if (!stringValidation.isValidLength(data.title, 3, 200)) errors.push('Title must be 3-200 characters');

        if (!data.date) errors.push('Date is required');
        else if (!dateValidation.isValidDate(data.date)) errors.push('Invalid date format');

        if (!data.startTime) errors.push('Start time is required');
        else if (!timeValidation.isValidTimeFormat(data.startTime)) errors.push('Invalid start time format');

        if (!data.endTime) errors.push('End time is required');
        else if (!timeValidation.isValidTimeFormat(data.endTime)) errors.push('Invalid end time format');

        if (data.startTime && data.endTime && data.date) {
            if (!timeValidation.isEndAfterStart(data.startTime, data.endTime)) {
                errors.push('End time must be after start time');
            }
            const duration = timeValidation.calculateHours(data.startTime, data.endTime, 0, data.date);
            if (duration > 8) {
                errors.push('Meeting duration cannot exceed 8 hours');
            }
        }

        if (!arrayValidation.hasMinItems(data.attendees, 1)) {
            errors.push('At least one attendee is required');
        }

        return { isValid: errors.length === 0, errors };
    },

    /**
     * Validate project data
     */
    validateProject(data) {
        const errors = [];

        if (!data.name) errors.push('Project name is required');
        else if (!stringValidation.isValidLength(data.name, 3, 100)) errors.push('Project name must be 3-100 characters');

        if (!data.description) errors.push('Description is required');
        else if (!stringValidation.hasMinLength(data.description, 10)) errors.push('Description must be at least 10 characters');

        if (data.startDate && data.endDate) {
            if (!dateValidation.isValidDate(data.startDate)) errors.push('Invalid start date format');
            if (!dateValidation.isValidDate(data.endDate)) errors.push('Invalid end date format');
            if (!dateValidation.isValidRange(data.startDate, data.endDate)) {
                errors.push('End date cannot be before start date');
            }
        }

        return { isValid: errors.length === 0, errors };
    },

    /**
     * Validate task data
     */
    validateTask(data) {
        const errors = [];

        if (!data.title) errors.push('Task title is required');
        else if (!stringValidation.isValidLength(data.title, 3, 200)) errors.push('Title must be 3-200 characters');

        if (!data.project) errors.push('Project is required');
        else if (!idValidation.isValidObjectId(data.project)) errors.push('Invalid project ID');

        if (data.description && !stringValidation.hasMinLength(data.description, 10)) {
            errors.push('Description must be at least 10 characters if provided');
        }

        if (data.priority && !enumValidation.isInEnumCaseInsensitive(data.priority, ['low', 'medium', 'high', 'urgent'])) {
            errors.push('Invalid priority value');
        }

        if (data.deadline && !dateValidation.isValidDate(data.deadline)) {
            errors.push('Invalid deadline date format');
        }

        return { isValid: errors.length === 0, errors };
    }
};

module.exports = {
    dateValidation,
    timeValidation,
    stringValidation,
    idValidation,
    arrayValidation,
    enumValidation,
    specificValidation,
    filterValidation,
    compositeValidation
};
