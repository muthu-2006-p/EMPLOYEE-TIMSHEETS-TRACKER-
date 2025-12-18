// Simple approval level configuration
// Order matters: first is the initial approver level
module.exports = [
    { key: 'manager', display: 'Manager', role: 'manager', status: 'pending_manager' },
    { key: 'hr', display: 'HR', role: 'hr', status: 'pending_hr' },
    { key: 'director', display: 'Director', role: 'director', status: 'pending_director' }
];

module.exports.defaultFinalStatus = 'approved_final';
