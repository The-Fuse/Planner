import { useEffect, useState } from 'react';
import axios from 'axios';
import { Download, CheckCircle, Circle } from 'lucide-react';
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

    const toggleComplete = async (date: string, slotName: string, currentStatus: boolean) => {
        try {
            await axios.post('http://localhost:8000/api/mark', null, {
                params: { date, slot_name: slotName, completed: !currentStatus }
            });

            // Optimistic update for schedule
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

            // Re-fetch stats to keep them in sync (or we could calculate locally)
            const statsRes = await axios.get('http://localhost:8000/api/stats');
            setStats(statsRes.data);

        } catch (err) {
            console.error(err);
        }
    };

    const downloadPdf = () => {
        window.open('http://localhost:8000/api/pdf', '_blank');
    };

    if (loading) return <div className="loading">Loading Plan...</div>;

    return (
        <div className="container">
            <header className="header">
                <h1>UPSC PLANNER</h1>
                <button onClick={downloadPdf} className="btn-download">
                    <Download size={16} /> Download PDF
                </button>
            </header>

            <Dashboard stats={stats} schedule={schedule} />

            <div className="timeline">
                {schedule.map((day) => (
                    <div key={day.date} className={`day-card ${day.day === 'Sunday' || day.day === 'Saturday' ? 'weekend' : ''}`}>
                        <div className="date-col">
                            <span className="date-num">{day.date.split('-')[2]}</span>
                            <span className="day-name">{day.day.toUpperCase().slice(0, 3)}</span>
                        </div>

                        <div className="slots-col">
                            {day.slots.map((slot) => (
                                <div key={slot.name} className={`slot ${slot.completed ? 'completed' : ''}`} onClick={() => toggleComplete(day.date, slot.name, slot.completed)}>
                                    <div className="slot-header">
                                        <span className="slot-name">{slot.name}</span>
                                        <span className="subject-tag">{slot.subject}</span>
                                    </div>
                                    <div className="slot-task">{slot.task}</div>
                                    <div className="status-icon">
                                        {slot.completed ? <CheckCircle size={20} /> : <Circle size={20} />}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default App;
