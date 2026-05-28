import { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { DayPlan, Slot, SubjectStats } from './interfaces';
import { DashboardView } from './components/DashboardView';
import { SubjectsView } from './components/SubjectsView';
import { HistoryView } from './components/HistoryView';

const API = import.meta.env.VITE_API_URL || 'https://planner-936q.onrender.com';

export default function App() {
    const [schedule, setSchedule] = useState<DayPlan[]>([]);
    const [stats, setStats]       = useState<Record<string, SubjectStats>>({});
    const [loading, setLoading]   = useState(true);

    const todayStr = new Date().toISOString().split('T')[0];

    useEffect(() => {
        Promise.all([
            axios.get(`${API}/api/plan`),
            axios.get(`${API}/api/stats`),
        ]).then(([p, s]) => {
            setSchedule(p.data);
            setStats(s.data.stats || s.data);
        }).catch(console.error)
          .finally(() => setLoading(false));
    }, []);

    const { backlog, history, today, upcoming } = useMemo(() => {
        const bl: { slot: Slot; date: string }[] = [];
        const hist: { slot: Slot; date: string }[] = [];
        const upc: DayPlan[] = [];
        let tp: DayPlan | null = null;
        
        if (schedule.length) {
            schedule.forEach(day => {
                if (day.date < todayStr) {
                    day.slots.forEach(s => {
                        if (!s.completed && s.task !== 'Revision') bl.push({ slot: s, date: day.date });
                        else if (s.completed) hist.push({ slot: s, date: day.date });
                    });
                } else if (day.date === todayStr) tp = day;
                else upc.push(day);
            });
            hist.sort((a, b) => b.date.localeCompare(a.date));
        }
        return { backlog: bl, history: hist, today: tp, upcoming: upc };
    }, [schedule, todayStr]);

    const [busy, setBusy] = useState<string | null>(null);
    const toggle = async (date: string, name: string, cur: boolean) => {
        const id = `${date}-${name}`;
        if (busy === id) return;
        setBusy(id);

        // Optimistic update
        setSchedule(prev => prev.map(d => d.date !== date ? d : {
            ...d, slots: d.slots.map(s => s.name === name ? { ...s, completed: !cur } : s)
        }));

        try {
            await axios.post(`${API}/api/mark`, null, { params: { date, slot_name: name, completed: !cur } });
            const sr = await axios.get(`${API}/api/stats`);
            setStats(sr.data.stats || sr.data);
        } catch {
            // Revert on failure
            setSchedule(prev => prev.map(d => d.date !== date ? d : {
                ...d, slots: d.slots.map(s => s.name === name ? { ...s, completed: cur } : s)
            }));
        } finally { setBusy(null); }
    };

    const [view, setView] = useState<'focus' | 'subjects' | 'history'>('focus');

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [view]);
    const subjectsList = Object.entries(stats).map(([name, s]) => ({
        name, 
        pct: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
        completed: s.completed,
        total: s.total,
    }));

    if (loading) return (
        <div className="flex h-screen items-center justify-center bg-[#060808]">
            <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin"></div>
        </div>
    );

    const navItems = [
        { key: 'focus',    label: 'Focus',    icon: 'event_note' },
        { key: 'subjects', label: 'Subjects', icon: 'menu_book' },
        { key: 'history',  label: 'History',  icon: 'history' },
    ] as const;

    return (
        <div className="relative min-h-screen bg-[#060808] flex flex-col">

            {/* ── Desktop top nav (hidden on mobile) ── */}
            <div className="hidden md:flex fixed top-0 left-0 right-0 z-50 justify-center pt-5 pointer-events-none">
                <nav className="backdrop-blur-xl bg-surface/30 border border-white/[0.08] rounded-full flex items-center px-1 py-1 pointer-events-auto shadow-lg">
                    {navItems.map(({ key, label }) => (
                        <button
                            key={key}
                            className={`px-5 py-2 rounded-full text-[10px] font-bold uppercase tracking-[0.3em] transition-all duration-300 ${
                                view === key
                                    ? 'bg-white/[0.08] text-on-surface'
                                    : 'text-on-surface-variant/35 hover:text-on-surface-variant/60'
                            }`}
                            onClick={() => setView(key)}
                        >
                            {label}
                        </button>
                    ))}
                </nav>
            </div>

            {/* ── Mobile status bar glass overlay ── */}
            <div
                className="md:hidden fixed top-0 left-0 right-0 z-50 bg-[#060808]/60 backdrop-blur-lg pointer-events-none"
                style={{ height: 'env(safe-area-inset-top, 0px)' }}
            />

            {/* ── Content ── */}
            <div className="relative w-full bg-transparent min-h-screen pt-0 md:pt-20 pb-28 md:pb-0">

                <div className="max-w-7xl mx-auto w-full">
                    {view === 'focus'    && <DashboardView today={today} backlog={backlog} toggle={toggle} busy={busy} />}
                    {view === 'subjects' && <SubjectsView subjects={subjectsList} upcoming={upcoming} toggle={toggle} busy={busy} />}
                    {view === 'history'  && <HistoryView history={history} toggle={toggle} busy={busy} />}
                </div>
            </div>

            {/* ── Mobile bottom nav — Stitch design ── */}
            <div className="md:hidden fixed bottom-6 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
                <nav className="backdrop-blur-xl bg-surface/40 rounded-full flex justify-around items-center border border-white/10 shadow-2xl w-full px-6 py-4 gap-4 pointer-events-auto">
                    {navItems.map(({ key, label, icon }) => (
                        <button
                            key={key}
                            className={`flex flex-col items-center justify-center gap-1 group transition-colors min-w-[64px] bg-transparent border-0 cursor-pointer ${
                                view === key ? 'text-primary' : 'text-on-surface-variant/50 hover:text-primary'
                            }`}
                            onClick={() => setView(key)}
                        >
                            <span className="material-symbols-outlined text-[24px]">{icon}</span>
                            <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
                        </button>
                    ))}
                </nav>
            </div>
        </div>
    );
}
