import { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { DayPlan, Slot, SubjectStats } from './interfaces';
import { TodayView } from './components/TodayView';
import { ProgressView, DayStat } from './components/ProgressView';

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

    const { backlog, history, today, upcoming, streak, pastDays } = useMemo(() => {
        const bl: { slot: Slot; date: string }[] = [];
        const hist: { slot: Slot; date: string }[] = [];
        const upc: DayPlan[] = [];
        const ds: DayStat[] = [];
        const pd: DayPlan[] = [];
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

                if (day.date <= todayStr && day.slots.length) {
                    ds.push({
                        date: day.date,
                        done: day.slots.filter(s => s.completed).length,
                        total: day.slots.length,
                    });
                    pd.push(day);
                }
            });
            hist.sort((a, b) => b.date.localeCompare(a.date));
        }

        // Streak: consecutive fully-completed days counting back from today.
        // An unfinished today doesn't break the streak — the day isn't over yet.
        ds.sort((a, b) => a.date.localeCompare(b.date));
        let current = 0;
        for (let i = ds.length - 1; i >= 0; i--) {
            const full = ds[i].done === ds[i].total;
            if (ds[i].date === todayStr) {
                if (full) current++;
                continue;
            }
            if (full) current++;
            else break;
        }
        let best = 0, run = 0;
        ds.forEach(s => {
            if (s.done === s.total) { run++; if (run > best) best = run; }
            else if (s.date !== todayStr) run = 0;
        });

        pd.sort((a, b) => a.date.localeCompare(b.date));
        return { backlog: bl, history: hist, today: tp, upcoming: upc, streak: { current, best }, pastDays: pd };
    }, [schedule, todayStr]);

    const [busy, setBusy] = useState<string | null>(null);
    // Mistake-proofing: after marking complete, offer a transient Undo
    const [undoInfo, setUndoInfo] = useState<{ date: string; name: string } | null>(null);
    const undoTimer = useRef<number | undefined>(undefined);

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

            window.clearTimeout(undoTimer.current);
            if (!cur) {
                // Just marked complete — keep an undo window open
                setUndoInfo({ date, name });
                undoTimer.current = window.setTimeout(() => setUndoInfo(null), 6000);
            } else {
                setUndoInfo(null);
            }
        } catch {
            // Revert on failure
            setSchedule(prev => prev.map(d => d.date !== date ? d : {
                ...d, slots: d.slots.map(s => s.name === name ? { ...s, completed: cur } : s)
            }));
        } finally { setBusy(null); }
    };

    const undoLast = () => {
        if (!undoInfo) return;
        const { date, name } = undoInfo;
        window.clearTimeout(undoTimer.current);
        setUndoInfo(null);
        toggle(date, name, true);
    };

    const [view, setView] = useState<'today' | 'progress'>('today');

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
        { key: 'today',    label: 'Today',    icon: 'today' },
        { key: 'progress', label: 'Progress', icon: 'monitoring' },
    ] as const;

    return (
        <div className="relative min-h-screen bg-[#060808] flex flex-col">

            {/* ── Ambient light fields — give the glass something to refract ── */}
            <div aria-hidden className="ambient-bg">
                <div className="ambient-blob ambient-blob--one" />
                <div className="ambient-blob ambient-blob--two" />
                <div className="ambient-blob ambient-blob--three" />
            </div>

            {/* ── Desktop top nav (hidden on mobile) ── */}
            <div className="hidden md:flex fixed top-0 left-0 right-0 z-50 justify-center pt-5 pointer-events-none">
                <nav className="backdrop-blur-xl bg-surface/30 border border-white/[0.08] rounded-full flex items-center px-1 py-1 pointer-events-auto shadow-lg">
                    {navItems.map(({ key, label }) => (
                        <button
                            key={key}
                            className={`relative px-5 py-2 rounded-full text-[12px] font-medium tracking-wide transition-colors duration-300 ${
                                view === key
                                    ? 'text-on-surface'
                                    : 'text-on-surface-variant/40 hover:text-on-surface-variant/70'
                            }`}
                            onClick={() => setView(key)}
                        >
                            {view === key && (
                                <motion.span
                                    layoutId="nav-pill-desktop"
                                    className="absolute inset-0 rounded-full bg-white/[0.08]"
                                    style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)' }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                                />
                            )}
                            <span className="relative z-10">{label}</span>
                        </button>
                    ))}
                </nav>
            </div>

            {/* ── iOS status bar: pure blur, no tint — the header's own glass
                   provides the color; a tint here would stack into a solid band ── */}
            <div aria-hidden className="md:hidden status-bar-blur" />

            {/* ── Content ── */}
            <div className="relative w-full bg-transparent min-h-screen pt-0 md:pt-20 pb-28 md:pb-0">
                <div className="max-w-7xl mx-auto w-full">
                    {view === 'today' && (
                        <TodayView
                            today={today}
                            todayStr={todayStr}
                            backlog={backlog}
                            upcoming={upcoming}
                            toggle={toggle}
                            busy={busy}
                            streak={streak}
                        />
                    )}
                    {view === 'progress' && (
                        <ProgressView
                            subjects={subjectsList}
                            pastDays={pastDays}
                            streak={streak}
                            history={history}
                            toggle={toggle}
                            busy={busy}
                        />
                    )}
                </div>
            </div>

            {/* ── Undo toast — appears briefly after marking complete ── */}
            <AnimatePresence>
                {undoInfo && (
                    <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 16 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                        className="fixed bottom-28 md:bottom-8 left-0 right-0 z-[60] flex justify-center px-4 pointer-events-none"
                    >
                        <div className="glass-chip backdrop-blur-xl bg-surface/80 rounded-full pl-5 pr-1.5 py-1.5 flex items-center gap-3 pointer-events-auto shadow-2xl">
                            <span className="text-[13px] text-on-surface/85">Marked complete</span>
                            <button
                                className="rounded-full px-4 py-2 text-[13px] font-semibold text-primary bg-white/[0.07] border-0 cursor-pointer hover:bg-white/[0.12] transition-colors"
                                onClick={undoLast}
                            >
                                Undo
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Mobile bottom nav: glass segmented control — the sliding thumb
                   owns half the track, inset by the track's padding ── */}
            <div className="md:hidden fixed bottom-6 left-0 right-0 z-50 flex justify-center px-6 pointer-events-none">
                <nav className="backdrop-blur-xl bg-surface/40 rounded-full grid grid-cols-2 border border-white/10 shadow-2xl w-full p-1.5 pointer-events-auto">
                    {navItems.map(({ key, label, icon }) => (
                        <button
                            key={key}
                            className={`relative flex flex-col items-center justify-center gap-1 py-2 rounded-full bg-transparent border-0 cursor-pointer transition-colors duration-300 ${
                                view === key ? 'text-primary' : 'text-on-surface-variant/50 hover:text-primary'
                            }`}
                            onClick={() => setView(key)}
                        >
                            {view === key && (
                                <motion.span
                                    layoutId="nav-pill-mobile"
                                    className="absolute inset-0 rounded-full bg-white/[0.08] backdrop-blur-xl"
                                    style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 12px -6px rgba(0,0,0,0.5)' }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                                />
                            )}
                            <span className="material-symbols-outlined text-[24px] relative z-10">{icon}</span>
                            <span className={`text-[10px] tracking-wide relative z-10 ${view === key ? 'font-semibold' : 'font-medium'}`}>{label}</span>
                        </button>
                    ))}
                </nav>
            </div>
        </div>
    );
}
