import { useEffect, useState } from 'react';
import axios from 'axios';
import { CheckCircle, Circle } from 'lucide-react';
import Dashboard from './components/Dashboard';
import './App.css';

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

interface SubjectStats {
    total: number;
    completed: number;
}

function App() {
    const [schedule, setSchedule] = useState<DayPlan[]>([]);
    const [stats, setStats] = useState<{ [key: string]: SubjectStats }>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [planRes, statsRes] = await Promise.all([
                axios.get('http://localhost:8000/api/plan'),
                axios.get('http://localhost:8000/api/stats')
            ]);
            setSchedule(planRes.data);
            setStats(statsRes.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const [view, setView] = useState<'focus' | 'history'>('focus');
    const [backlog, setBacklog] = useState<{ slot: Slot, date: string }[]>([]);
    const [history, setHistory] = useState<{ slot: Slot, date: string }[]>([]);
    const [todayPlan, setTodayPlan] = useState<DayPlan | null>(null);
    const [upcoming, setUpcoming] = useState<DayPlan[]>([]);

    const todayStr = new Date().toISOString().split('T')[0];

    useEffect(() => {
        if (schedule.length > 0) {
            const bl: { slot: Slot, date: string }[] = [];
            const hist: { slot: Slot, date: string }[] = [];
            const upc: DayPlan[] = [];
            let tPlan: DayPlan | null = null;

            schedule.forEach(day => {
                if (day.date < todayStr) {
                    // Past Day
                    day.slots.forEach(slot => {
                        if (!slot.completed) {
                            bl.push({ slot, date: day.date });
                        } else {
                            hist.push({ slot, date: day.date });
                        }
                    });
                } else if (day.date === todayStr) {
                    // Today
                    tPlan = day;
                } else {
                    // Future
                    upc.push(day);
                }
            });

            // Sort history by date desc
            hist.sort((a, b) => b.date.localeCompare(a.date));

            setBacklog(bl);
            setHistory(hist);
            setTodayPlan(tPlan);
            setUpcoming(upc);
        }
    }, [schedule, todayStr]);

    const toggleComplete = async (date: string, slotName: string, currentStatus: boolean) => {
        try {
            await axios.post('http://localhost:8000/api/mark', null, {
                params: { date, slot_name: slotName, completed: !currentStatus }
            });

            setSchedule(prev => prev.map(day => {
                if (day.date === date) {
                    return {
                        ...day,
                        slots: day.slots.map(slot => {
                            if (slot.name === slotName) {
                                return { ...slot, completed: !currentStatus };
                            }
                            return slot;
                        })
                    };
                }
                return day;
            }));

            const statsRes = await axios.get('http://localhost:8000/api/stats');
            setStats(statsRes.data);

        } catch (err) {
            console.error(err);
        }
    };

    if (loading) return <div className="loading">LOADING</div>;

    return (
        <div className="container">
            <header className="header">
                <div className="logo">UPSC PLANNER</div>
                <nav className="nav-toggle">
                    <button
                        className={`nav-btn ${view === 'focus' ? 'active' : ''}`}
                        onClick={() => setView('focus')}
                    >
                        FOCUS
                    </button>
                    <button
                        className={`nav-btn ${view === 'history' ? 'active' : ''}`}
                        onClick={() => setView('history')}
                    >
                        HISTORY
                    </button>
                </nav>
            </header>

            {view === 'focus' && (
                <div className="view-focus">
                    {/* TODAY SECTION - MOVED TO TOP */}
                    {todayPlan && (
                        <div className="section today-section">
                            <h2 className="section-title">TODAY'S MISSION</h2>
                            <div className="today-card-container">
                                <div className="today-header">
                                    <div className="today-date-box">
                                        <span className="today-num">{todayPlan.date.split('-')[2]}</span>
                                        <span className="today-month">{new Date(todayPlan.date).toLocaleString('default', { month: 'short' }).toUpperCase()}</span>
                                    </div>
                                    <div className="today-day">{todayPlan.day.toUpperCase()}</div>
                                </div>
                                <div className="today-slots">
                                    {todayPlan.slots.map((slot) => (
                                        <div key={slot.name} className={`slot-row ${slot.completed ? 'completed' : ''}`} onClick={() => toggleComplete(todayPlan!.date, slot.name, slot.completed)}>
                                            <div className="slot-check-col">
                                                <div className={`checkbox ${slot.completed ? 'checked' : ''}`}></div>
                                            </div>
                                            <div className="slot-content">
                                                <div className="slot-meta">
                                                    <span className="slot-time">{slot.name}</span>
                                                    <span className="slot-subj">{slot.subject}</span>
                                                </div>
                                                <div className="slot-desc">{slot.task}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* DASHBOARD STATS */}
                    <Dashboard stats={stats} schedule={schedule} />

                    {/* BACKLOG SECTION */}
                    {backlog.length > 0 && (
                        <div className="section backlog-section">
                            <div className="section-header">
                                <h2 className="section-title">BACKLOG</h2>
                                <span className="badge">{backlog.length}</span>
                            </div>
                            <div className="backlog-scroll">
                                {backlog.map((item, idx) => (
                                    <div key={`${item.date}-${idx}`} className="card backlog-card" onClick={() => toggleComplete(item.date, item.slot.name, item.slot.completed)}>
                                        <div className="card-top">
                                            <span className="card-date">{item.date.split('-').slice(1).join('/')}</span>
                                            <span className="card-subject">{item.slot.subject}</span>
                                        </div>
                                        <div className="card-task">{item.slot.task}</div>
                                        <div className="card-action">MARK DONE</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* UPCOMING SECTION */}
                    <div className="section upcoming-section">
                        <div className="section-header">
                            <h2 className="section-title">UPCOMING</h2>
                            <span className="badge">{upcoming.length} DAYS</span>
                        </div>
                        <div className="upcoming-scroll">
                            {upcoming.map((day) => (
                                <div key={day.date} className="upcoming-card">
                                    <div className="u-header">
                                        <span className="u-date">{day.date.split('-')[2]} {new Date(day.date).toLocaleString('default', { month: 'short' }).toUpperCase()}</span>
                                        <span className="u-day">{day.day.slice(0, 3).toUpperCase()}</span>
                                    </div>
                                    <div className="u-slots">
                                        {day.slots.map((slot) => (
                                            <div
                                                key={slot.name}
                                                className={`u-slot-item ${slot.completed ? 'completed' : ''}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleComplete(day.date, slot.name, slot.completed);
                                                }}
                                            >
                                                <div className={`u-checkbox ${slot.completed ? 'checked' : ''}`}></div>
                                                <div className="u-slot-content">
                                                    <div className="u-slot-subj">{slot.subject}</div>
                                                    <div className="u-slot-task">{slot.task}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {view === 'history' && (
                <div className="view-history">
                    <h2 className="section-title">COMPLETED TASKS</h2>
                    <div className="history-list">
                        {history.map((item, idx) => (
                            <div key={`${item.date}-${idx}`} className="history-row" onClick={() => toggleComplete(item.date, item.slot.name, item.slot.completed)}>
                                <div className="h-date-col">
                                    <span className="h-date">{item.date}</span>
                                </div>
                                <div className="h-content">
                                    <span className="h-subject">{item.slot.subject}</span>
                                    <span className="h-task">{item.slot.task}</span>
                                </div>
                                <div className="h-action">UNDO</div>
                            </div>
                        ))}
                        {history.length === 0 && <div className="empty-state">NO HISTORY YET</div>}
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
