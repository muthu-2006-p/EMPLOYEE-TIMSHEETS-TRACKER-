# Employee Timesheet Tracker - AI Coding Guidelines

## Architecture Overview

**Tech Stack:** Node.js + Express + MongoDB + Vanilla JS Frontend  
**Core Pattern:** RESTful API with role-based access control (Admin/Manager/Employee)

### Key Components

- **Database Layer:** Mongoose models in `src/models/` (User, Task, Timesheet, Notification, Project, Approval)
- **API Layer:** Express routes in `src/routes/` with middleware-based auth & role permissions
- **Frontend:** Static HTML pages in `frontend/` with vanilla JS, fetch-based API calls, modal-driven UX
- **Authentication:** JWT token (Bearer scheme) with role-based permit middleware

### Three-Tier Role Hierarchy
- **Admin:** Full system access, reports, employee performance metrics
- **Manager:** Project management, task assignment, timesheet approval, team analytics
- **Employee:** Task submission, progress tracking, timesheet entry

## Critical Patterns

### 1. Task-Assignment Model (NOT Task-alone)
Tasks have embedded `assignments[]` subdocument:
```javascript
// Task.js - each task has multiple employee assignments with per-assignment status
assignments: [{ employee: ObjectId, status: enum, progress: 0-100, deadline: Date }]
```
**When working with tasks:** Always reference `task.assignments.find(a => String(a.employee) === userId)` to get single employee's status.

### 2. Multi-Level Approval Workflow
Timesheets use enumerated status: `['draft','pending','pending_manager','pending_hr','pending_director','approved_final','approved','rejected','locked']`
Store approval records in `Approval` model (separate from Timesheet).
**Key:** Approver field links to User ID, timestamp tracks approval order.

### 3. Notification System (Event-Driven)
- Notification model: `{ user, type, title, body, read, meta, timestamps }`
- Manual POST to `/api/notify` to create notifications (no auto-triggers yet - add as service layer)
- Always include `meta` object with contextual data (taskId, timesheetId, approverId, etc.)

### 4. Frontend Authentication Flow
- Login stores JWT in `localStorage` as `auth_token`
- Every API call includes: `Authorization: Bearer ${localStorage.getItem('auth_token')}`
- On 401 response → redirect to login
- Check `req.user.role` for conditional UI rendering

## Development Workflows

### Starting the Server
```powershell
npm install
npm run dev  # watches for changes with nodemon
```

### Creating New Routes
1. Create `src/routes/feature.js` with `express.Router()`
2. Wrap endpoints with `auth, permit('role1', 'role2')` middleware
3. Register in `src/index.js`: `app.use('/api/feature', require('./routes/feature'))`
4. Response format: `{ message, data }` for errors and success

### Adding Database Fields
1. Update model schema in `src/models/ModelName.js`
2. Mongoose auto-handles backwards compatibility for new optional fields
3. Test with existing data before deploying

### Frontend Page Pattern
- Create `frontend/page.html` with same navbar & sidebar structure
- Load user data via `fetch('/api/auth/me')` on page load
- Use modals for forms (see `dashboard_manager.html` for patterns)
- Style with `assets/css/style.css` + `dashboard.css` classes

## Common Conventions

### Error Handling
- Always return 400 (bad request), 403 (forbidden), 404 (not found), 500 (server)
- Log errors with `console.error()` for debugging
- Include helpful message in response: `{ message: 'Human-readable error' }`

### ObjectId Conversion
Always convert string IDs to ObjectId for queries:
```javascript
const mongoose = require('mongoose');
const userId = new mongoose.Types.ObjectId(req.params.id);
```

### Population (Refs)
Use `.populate('fieldName', 'select fields')` to hydrate foreign keys:
```javascript
Task.findById(id).populate('assignments.employee', 'name email').populate('project', 'name')
```

### Filtering by User Role
Manager operations: ensure `String(proj.manager) === String(req.user._id)` OR `req.user.role === 'admin'`

## Integration Points

- **Auth:** `src/middleware/auth.js` provides `req.user` object after token verification
- **Notifications:** POST to `/api/notify` after state changes (task completion, approval, rejection)
- **Reports:** `/api/analysis` generates productivity metrics; used by manager/admin dashboards
- **Message System:** Separate feature; see `EMPLOYEE_MESSAGES_FEATURE.md` for details

## Testing Key Flows

1. **Task Assignment:** Create task → verify assignments array → fetch via `/api/tasks/mine`
2. **Status Updates:** PUT `/api/tasks/:id/assignment/:empId` with new status → confirm Task saved
3. **Approval:** Submit Timesheet → create Approval record → check status progression
4. **Notifications:** POST `/api/notify` → GET `/api/notify/me` → verify badge count updates

---

For feature-specific implementation, refer to task completion feature documentation in `TASK_COMPLETION_FEATURE.md`.
