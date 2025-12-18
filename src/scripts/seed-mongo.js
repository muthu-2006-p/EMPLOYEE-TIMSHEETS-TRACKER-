require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Timesheet = require('../models/Timesheet');

async function upsertUser({ name, email, password, role, department, manager }) {
    const existing = await User.findOne({ email });
    if (existing) return existing;
    const user = new User({ name, email, password, role, department, manager });
    await user.save();
    return user;
}

async function seed() {
    await connectDB();

    try {
        console.log('Seeding users...');
        const manager = await upsertUser({
            name: 'Manager User',
            email: 'manager@example.com',
            password: 'password123',
            role: 'manager',
            department: 'Management'
        });

        const employee = await upsertUser({
            name: 'Employee User',
            email: 'employee@example.com',
            password: 'password123',
            role: 'employee',
            department: 'Development',
            manager: manager._id
        });

        console.log('Seeding project...');
        let project = await Project.findOne({ name: 'Test Project - Workflow Verification' });
        if (!project) {
            project = new Project({
                name: 'Test Project - Workflow Verification',
                description: 'Test project for end-to-end workflow',
                manager: manager._id,
                employees: [employee._id]
            });
            await project.save();
        }

        console.log('Seeding task...');
        let task = await Task.findOne({ title: 'Complete API Integration Tests', project: project._id });
        if (!task) {
            task = new Task({
                title: 'Complete API Integration Tests',
                description: 'Write and run comprehensive API tests for the timesheet system',
                project: project._id,
                createdBy: manager._id,
                assignments: [{ employee: employee._id, deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }]
            });
            await task.save();
        }

        console.log('Seeding sample timesheet...');
        const tsExists = await Timesheet.findOne({ employee: employee._id, task: task._id, date: new Date().setHours(0, 0, 0, 0) });
        if (!tsExists) {
            const timesheet = new Timesheet({
                employee: employee._id,
                project: project._id,
                task: task._id,
                date: new Date(),
                startTime: '09:00',
                endTime: '17:00',
                breakMinutes: 60,
                totalHours: 7,
                description: 'Seed timesheet for E2E testing',
                status: 'pending'
            });
            await timesheet.save();
            console.log('  - Timesheet created:', timesheet._id.toString());
        } else {
            console.log('  - Timesheet already exists');
        }

        console.log('\n✅ Seeding complete.');
        process.exit(0);
    } catch (err) {
        console.error('Seeding failed:', err);
        process.exit(1);
    }
}

seed();
