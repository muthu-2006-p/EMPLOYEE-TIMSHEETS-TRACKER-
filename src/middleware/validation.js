/**
 * Validation Middleware
 * Express middleware for request validation
 */

const { compositeValidation } = require('../utils/validation');

/**
 * Validate timesheet creation/update
 */
const validateTimesheet = (req, res, next) => {
    const { isValid, errors } = compositeValidation.validateTimesheet(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: 'Validation failed',
            errors
        });
    }

    next();
};

/**
 * Validate attendance
 */
const validateAttendance = (req, res, next) => {
    const { isValid, errors } = compositeValidation.validateAttendance(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: 'Validation failed',
            errors
        });
    }

    next();
};

/**
 * Validate leave request
 */
const validateLeave = (req, res, next) => {
    const { isValid, errors } = compositeValidation.validateLeave(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: 'Validation failed',
            errors
        });
    }

    next();
};

/**
 * Validate meeting
 */
const validateMeeting = (req, res, next) => {
    const { isValid, errors } = compositeValidation.validateMeeting(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: 'Validation failed',
            errors
        });
    }

    next();
};

/**
 * Validate project
 */
const validateProject = (req, res, next) => {
    const { isValid, errors } = compositeValidation.validateProject(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: 'Validation failed',
            errors
        });
    }

    next();
};

/**
 * Validate task
 */
const validateTask = (req, res, next) => {
    const { isValid, errors } = compositeValidation.validateTask(req.body);

    if (!isValid) {
        return res.status(400).json({
            message: 'Validation failed',
            errors
        });
    }

    next();
};

module.exports = {
    validateTimesheet,
    validateAttendance,
    validateLeave,
    validateMeeting,
    validateProject,
    validateTask
};
