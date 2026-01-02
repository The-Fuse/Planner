import { useEffect, useState } from 'react';
import axios from 'axios';
import { ChevronLeft, ChevronRight, Moon, Sun, Check, RefreshCw, AlertCircle } from 'lucide-react';
import Dashboard from './components/Dashboard';
import './App.css';

const API_BASE_URL = 'https://planner-936q.onrender.com';

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

const QUOTES = [
    "Start now. Finish strong.",
    "One task at a time.",
    "Action beats perfection.",
    "Do it now.",
    "Finish what you started.",
    "Keep going. You're almost there.",
    "Today's work builds tomorrow's success.",
    "Small steps. Big results.",
    "Show up. Do the work.",
    "Focus. Execute. Repeat.",
    "Done is better than perfect.",
    "The best time is now.",
    "Make today count.",
    "Discipline equals freedom.",
    "Work hard. Stay humble.",
    "Progress over perfection.",
    "You got this.",
    "Stay focused. Stay disciplined.",
    "Every task completed is progress made.",
    "Trust the process.",
    "Consistency is key.",
    "No excuses. Just results.",
    "Winners finish what they start.",
    "Stop thinking. Start doing.",
    "Your future depends on today's work.",
    "Outwork your doubts.",
    "Show up every single day.",
    "Results require relentless effort.",
    "Be disciplined. Be unstoppable.",
    "Finish strong today."
];

function getQuoteForToday() {
    const dayOfYear = Math.floor((new Date().getTime() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 1000 / 60 / 60 / 24);
    return QUOTES[dayOfYear % QUOTES.length];
}

function App() {
    const [schedule, setSchedule] = useState<DayPlan[]>([]);
    const [stats, setStats] = useState<{ [key: string]: SubjectStats }>({});
    const [loading, setLoading] = useState(true);

    // Calculate days until exam (May 24, 2026)
    const calculateDaysUntilExam = () => {
        const examDate = new Date('2026-05-24');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        examDate.setHours(0, 0, 0, 0);
        const diffTime = examDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    const daysUntilExam = calculateDaysUntilExam();

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [planRes, statsRes] = await Promise.all([
                axios.get(`${API_BASE_URL}/api/plan`),
                axios.get(`${API_BASE_URL}/api/stats`)
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

    const [loadingTask, setLoadingTask] = useState<string | null>(null);

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
                        if (!slot.completed && slot.task !== 'Revision') {
                            bl.push({ slot, date: day.date });
                        } else if (slot.completed) {
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
        const taskId = `${date}-${slotName}`;
        if (loadingTask === taskId) return; // Prevent double clicks

        setLoadingTask(taskId);
        try {
            await axios.post(`${API_BASE_URL}/api/mark`, null, {
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

            const statsRes = await axios.get(`${API_BASE_URL}/api/stats`);
            setStats(statsRes.data);

        } catch (err) {
            console.error(err);
        } finally {
            setLoadingTask(null);
        }
    };

    // Theme state - initialize from localStorage for instant loading
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        const savedTheme = localStorage.getItem('theme');
        return (savedTheme === 'dark' || savedTheme === 'light') ? savedTheme : 'light';
    });

    // Apply theme immediately on mount (logic moved out of effect for initial render)
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        // Save to localStorage whenever theme changes
        localStorage.setItem('theme', theme);
    }, [theme]);

    // Fetch theme preference from backend to sync (only once on mount)
    useEffect(() => {
        const fetchTheme = async () => {
            try {
                const response = await axios.get(`${API_BASE_URL}/api/preferences/theme`);
                if (response.data && response.data.value) {
                    const backendTheme = response.data.value;
                    if ((backendTheme === 'light' || backendTheme === 'dark') && backendTheme !== theme) {
                        setTheme(backendTheme);
                    }
                }
            } catch (error) {
                console.error("Failed to sync theme preference", error);
            }
        };
        fetchTheme();
    }, []);

    const toggleTheme = async () => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme); // Immediate UI update

        try {
            await axios.post(`${API_BASE_URL}/api/preferences`, {
                key: 'theme',
                value: newTheme
            });
        } catch (error) {
            console.error("Failed to save theme preference", error);
        }
    };

    // Calculate Subject Progress
    const getSubjectProgress = () => {
        // Fallback progress if stats not loaded or empty
        if (!stats) return [
            { name: 'Polity', completed: 0, total: 100, percent: 0 },
            { name: 'History', completed: 0, total: 100, percent: 0 }
        ];

        return Object.keys(stats).map(subj => {
            const s = stats[subj];
            const percent = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
            return { name: subj, completed: s.completed, total: s.total, percent };
        });
    };

    const subjectProgress = getSubjectProgress();

    if (loading) return <div className="loading">LOADING</div>;

    return (
        <div className={`container ${theme}`}>
            <header className="header">
                <div className="logo">UPSC PLANNER</div>
                <div className="header-right">
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
                    <button className="theme-toggle" onClick={toggleTheme}>
                        {theme === 'light' ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                        )}
                    </button>
                </div>
            </header>

            {view === 'focus' && (
                <div className="view-focus">
                    {/* SUBJECT PROGRESS - COMPACT TOP */}
                    <div className="subject-progress-compact">
                        {subjectProgress.map(s => (
                            <div key={s.name} className="subj-prog-item">
                                <div className="subj-meta-top">
                                    <span className="subj-name">{s.name}</span>
                                    <span className="subj-val">{s.percent}% ({s.completed}/{s.total})</span>
                                </div>
                                <div className="subj-bar"><div className="subj-fill" style={{ width: `${s.percent}%` }}></div></div>
                            </div>
                        ))}
                    </div>

                    {/* TODAY SECTION */}
                    {todayPlan && (
                        <div className="section today-section">
                            {/* UNIFIED HEADER STYLE */}
                            <div className="section-header">
                                <h2 className="section-title">TODAY'S MISSION</h2>
                                <span className="badge">{daysUntilExam} DAYS LEFT</span>
                            </div>
                            <div className="today-card-container">
                                <div className="today-header">
                                    <div className="today-date-box">
                                        <span className="today-num">{todayPlan.date.split('-')[2]}</span>
                                        <div className="today-month-row">
                                            <span className="today-month">{new Date(todayPlan.date).toLocaleString('default', { month: 'short' })}</span>
                                        </div>
                                    </div>
                                    <div className="today-right-col">
                                        <span className="today-day">{todayPlan.day}</span>
                                        <div className="quote-box">
                                            "{getQuoteForToday()}"
                                        </div>
                                    </div>
                                </div>
                                <div className="today-progress-container-internal">
                                    <div
                                        className="today-progress-bar"
                                        style={{ width: `${(todayPlan.slots.filter(s => s.completed).length / todayPlan.slots.length) * 100}%` }}
                                    ></div>
                                </div>
                                <div className="today-slots">
                                    {todayPlan.slots.map((slot) => {
                                        const taskId = `${todayPlan.date}-${slot.name}`;
                                        const isLoading = loadingTask === taskId;
                                        return (
                                            <div key={slot.name} className={`slot-row ${slot.completed ? 'completed' : ''}`} onClick={() => toggleComplete(todayPlan!.date, slot.name, slot.completed)}>
                                                <div className="slot-check-col">
                                                    {isLoading ? (
                                                        <div className="spinner-sm"></div>
                                                    ) : (
                                                        <div className={`checkbox ${slot.completed ? 'checked' : ''}`}></div>
                                                    )}
                                                </div>
                                                <div className="slot-content">
                                                    <div className="slot-meta">
                                                        <span className="slot-time">{slot.name}</span>
                                                        <span className="slot-subj">{slot.subject}</span>
                                                    </div>
                                                    <div className="slot-desc">
                                                        {(() => {
                                                            // Match pattern: "34. High Court (pp.360-362), 35. Subordinate Courts (pp.363-364)"
                                                            const itemRegex = /(\d+)\.\s*([^(,]+)\s*(?:\(([^)]+)\))?(?:,\s*)?/g;
                                                            const items = [];
                                                            let match;

                                                            while ((match = itemRegex.exec(slot.task)) !== null) {
                                                                items.push({
                                                                    number: match[1],
                                                                    title: match[2].trim(),
                                                                    pages: match[3] || null
                                                                });
                                                            }

                                                            if (items.length > 0) {
                                                                return (
                                                                    <div className="task-items">
                                                                        {items.map((item, idx) => (
                                                                            <div key={idx} className="task-item">
                                                                                <span className="item-number">{item.number}.</span>
                                                                                <span className="item-title">{item.title}</span>
                                                                                {item.pages && <span className="item-pages">{item.pages}</span>}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                );
                                                            }

                                                            return <div className="task-item-fallback">{slot.task}</div>;
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* DASHBOARD STATS */}


                    {/* BACKLOG SECTION */}
                    {backlog.length > 0 && (
                        <div className="section backlog-section">
                            <div className="section-header">
                                <h2 className="section-title">BACKLOG</h2>
                                <span className="badge">
                                    {(() => {
                                        const uniqueDays = new Set(backlog.map(item => item.date)).size;
                                        return `${uniqueDays} ${uniqueDays === 1 ? 'DAY' : 'DAYS'}`;
                                    })()}
                                </span>
                            </div>
                            <div className="backlog-scroll">
                                {backlog.map((item, idx) => {
                                    const taskId = `${item.date}-${item.slot.name}`;
                                    const isLoading = loadingTask === taskId;
                                    return (
                                        <div key={`${item.date}-${idx}`} className="card backlog-card">
                                            <div className="card-top">
                                                <span className="card-date">{item.date.split('-')[2]} {new Date(item.date).toLocaleString('default', { month: 'short' })}</span>
                                                <span className="card-subject">{item.slot.subject}</span>
                                            </div>

                                            {/* PROGRESS BAR SEPARATOR */}
                                            <div className="b-progress-container-internal">
                                                <div className="b-progress-bar" style={{ width: '0%' }}></div>
                                            </div>

                                            <div className="card-bottom">
                                                <div className="card-task">
                                                    {(() => {
                                                        const itemRegex = /(\d+)\.\s*([^(,]+)\s*(?:\(([^)]+)\))?(?:,\s*)?/g;
                                                        const items = [];
                                                        let match;

                                                        while ((match = itemRegex.exec(item.slot.task)) !== null) {
                                                            items.push({
                                                                number: match[1],
                                                                title: match[2].trim(),
                                                                pages: match[3] || null
                                                            });
                                                        }

                                                        if (items.length > 0) {
                                                            return (
                                                                <div className="task-items">
                                                                    {items.map((taskItem, taskIdx) => (
                                                                        <div key={taskIdx} className="task-item">
                                                                            <span className="item-number">{taskItem.number}.</span>
                                                                            <span className="item-title">{taskItem.title}</span>
                                                                            {taskItem.pages && <span className="item-pages">{taskItem.pages}</span>}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        }

                                                        return <div className="task-item-fallback">{item.slot.task}</div>;
                                                    })()}
                                                </div>
                                                <div
                                                    className="card-action"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleComplete(item.date, item.slot.name, item.slot.completed);
                                                    }}
                                                >
                                                    {isLoading ? <div className="spinner-xs"></div> : "MARK DONE"}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* UPCOMING SECTION */}
                    {/* UPCOMING SECTION */}
                    {upcoming.length > 0 && (
                        <div className="section upcoming-section">
                            <div className="section-header">
                                <h2 className="section-title">UPCOMING</h2>
                                <span className="badge">{upcoming.length} {upcoming.length === 1 ? 'DAY' : 'DAYS'}</span>
                            </div>
                            <div className="upcoming-scroll">
                                {upcoming.map((dayPlan) => {
                                    const totalSlots = dayPlan.slots.length;
                                    const completedSlots = dayPlan.slots.filter(s => s.completed).length;
                                    const progressPercent = totalSlots > 0 ? (completedSlots / totalSlots) * 100 : 0;

                                    return (
                                        <div key={dayPlan.date} className="upcoming-card">
                                            <div className="u-header">
                                                <div className="u-date-group">
                                                    <span className="u-date">{dayPlan.date.split('-')[2]} {new Date(dayPlan.date).toLocaleString('default', { month: 'short' })}</span>
                                                </div>
                                                <span className="u-day">{dayPlan.day}</span>
                                            </div>

                                            {/* PROGRESS BAR SEPARATOR */}
                                            <div className="u-progress-container-internal">
                                                <div
                                                    className="u-progress-bar"
                                                    style={{ width: `${progressPercent}%` }}
                                                ></div>
                                            </div>

                                            <div className="u-slots">
                                                {dayPlan.slots.map((slot) => {
                                                    const taskId = `${dayPlan.date}-${slot.name}`;
                                                    return (
                                                        <div
                                                            key={slot.name}
                                                            className={`u-slot-item ${slot.completed ? 'completed' : ''}`}
                                                            onClick={() => toggleComplete(dayPlan.date, slot.name, slot.completed)}
                                                        >
                                                            <div className="u-content">
                                                                <div className="u-slot-subj">{slot.subject} • {slot.name}</div>
                                                                <div className="u-slot-task">
                                                                    {(() => {
                                                                        const itemRegex = /(\d+)\.\s*([^(,]+)\s*(?:\(([^)]+)\))?(?:,\s*)?/g;
                                                                        const items = [];
                                                                        let match;

                                                                        while ((match = itemRegex.exec(slot.task)) !== null) {
                                                                            items.push({
                                                                                number: match[1],
                                                                                title: match[2].trim(),
                                                                                pages: match[3] || null
                                                                            });
                                                                        }

                                                                        if (items.length > 0) {
                                                                            return (
                                                                                <div className="task-items">
                                                                                    {items.map((taskItem, taskIdx) => (
                                                                                        <div key={taskIdx} className="task-item">
                                                                                            <span className="item-number">{taskItem.number}.</span>
                                                                                            <span className="item-title">{taskItem.title}</span>
                                                                                            {taskItem.pages && <span className="item-pages">{taskItem.pages}</span>}
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            );
                                                                        }

                                                                        return <div className="task-item-fallback">{slot.task}</div>;
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {view === 'history' && (
                <div className="view-history">
                    <h2 className="section-title">COMPLETED TASKS</h2>
                    <div className="history-list">
                        {history.map((item, idx) => {
                            const taskId = `${item.date}-${item.slot.name}`;
                            const isLoading = loadingTask === taskId;
                            return (
                                <div key={`${item.date}-${idx}`} className="history-row">
                                    <div className="h-date-col">
                                        <span className="h-date">{item.date}</span>
                                    </div>
                                    <div className="h-content">
                                        <span className="h-subject">{item.slot.subject}</span>
                                        <span className="h-task">{item.slot.task}</span>
                                    </div>
                                    <div
                                        className="h-action"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleComplete(item.date, item.slot.name, item.slot.completed);
                                        }}
                                    >
                                        {isLoading ? <div className="spinner-xs dark"></div> : "UNDO"}
                                    </div>
                                </div>
                            );
                        })}
                        {history.length === 0 && <div className="empty-state">NO HISTORY YET</div>}
                    </div>
                </div>
            )
            }
        </div >
    );
}

export default App;
