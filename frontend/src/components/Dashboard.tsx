import React from 'react';
import { CheckCircle, Circle } from 'lucide-react';
import './Dashboard.css';

interface SubjectStats {
    total: number;
    completed: number;
}

interface Slot {
    name: string;
    subject: string;
    task: string;
    completed: boolean;
}

interface DayPlan {
    date: string;
    day: string;
    slots: Slot[];
}

interface DashboardProps {
    stats: {
        [key: string]: SubjectStats;
    };
    schedule: DayPlan[];
}

const Dashboard: React.FC<DashboardProps> = ({ stats, schedule }) => {
    const calculateProgress = (subject: string) => {
        const s = stats[subject];
        if (!s || s.total === 0) return 0;
        return Math.round((s.completed / s.total) * 100);
    };

    // Find today's plan
    const todayStr = new Date().toISOString().split('T')[0];
    // For testing/demo purposes, if today isn't in schedule (e.g. before start date), 
    // we might want to show the first day or nothing. 
    // Let's stick to strict "today" for now, but maybe fallback to first day if today < start date?
    // The user asked for "Today's task in focus".
    // Let's try to find exact match, if not found, maybe show "No tasks for today".

    // Actually, for the demo to work nicely if the user is running this on a date 
    // that matches the schedule (Nov 27 onwards), it will work.
    // If they run it later, it works.

    const todayPlan = schedule.find(d => d.date === todayStr);

    return (
        <div className="dashboard-container">
            {todayPlan && (
                <div className="todays-focus">
                    <h2>Today's Focus</h2>
                    <div className="focus-grid">
                        {todayPlan.slots.map((slot, idx) => (
                            <div key={idx} className={`focus-card ${slot.completed ? 'completed' : ''}`}>
                                <div className="focus-header">
                                    <span className="focus-subject">{slot.subject}</span>
                                    <span className="focus-slot-name">{slot.name}</span>
                                </div>
                                <div className="focus-task">{slot.task}</div>
                                <div className="focus-status">
                                    {slot.completed ? <CheckCircle size={18} /> : <Circle size={18} />}
                                    <span>{slot.completed ? 'Completed' : 'Pending'}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="dashboard">
                <h2>Overall Progress</h2>
                <div className="stats-grid">
                    {Object.keys(stats).map((subject) => (
                        <div key={subject} className="stat-card">
                            <div className="stat-header">
                                <span className="stat-subject">{subject}</span>
                                <span className="stat-percentage">{calculateProgress(subject)}%</span>
                            </div>
                            <div className="progress-bar-bg">
                                <div
                                    className="progress-bar-fill"
                                    style={{ width: `${calculateProgress(subject)}%` }}
                                ></div>
                            </div>
                            <div className="stat-details">
                                {stats[subject].completed} / {stats[subject].total} slots completed
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
