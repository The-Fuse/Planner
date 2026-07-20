import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { DayPlan, Slot } from '../interfaces';
import { summarizeTask } from './TaskContent';
import { subjectColor } from '../subjectColors';

export interface DayStat {
    date: string;
    done: number;
    total: number;
}

function parseLocal(d: string) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day);
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** First week of tracking: a quiet 7-dot strip — a month grid with one
    filled cell says nothing */
function WeekStrip({ pastDays }: { pastDays: DayPlan[] }) {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));

    const statByDate = new Map(pastDays.map(d => [d.date, {
        done: d.slots.filter(s => s.completed).length,
        total: d.slots.length,
    }]));

    return (
        <div className="flex justify-between px-1">
            {Array.from({ length: 7 }).map((_, i) => {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                const stat = statByDate.get(ds);
                const isToday = ds === todayStr;
                const isFuture = ds > todayStr;

                let dot = 'bg-white/[0.07]';                                  // rest / unscheduled
                if (stat && stat.total > 0) {
                    if (stat.done === stat.total) dot = 'bg-primary';
                    else if (stat.done > 0)       dot = 'bg-primary/40';
                    else if (!isFuture && !isToday) dot = 'bg-white/[0.12]';   // missed
                }
                if (isFuture) dot = 'bg-white/[0.05]';

                return (
                    <div key={ds} className="flex flex-col items-center gap-2">
                        <span className={`text-[10px] font-medium ${isToday ? 'text-primary' : 'text-on-surface-variant/45'}`}>
                            {WEEKDAYS[i]}
                        </span>
                        <span
                            className={`w-2.5 h-2.5 rounded-full ${dot}`}
                            style={isToday ? { boxShadow: '0 0 0 1.5px rgba(173,198,255,0.6)' } : undefined}
                            title={stat ? `${ds} · ${stat.done}/${stat.total}` : ds}
                        />
                    </div>
                );
            })}
        </div>
    );
}

/** Calendar-style consistency: one month per slide, chronological left→right,
    opens on the current month; filterable by subject like Catch up */
function ConsistencyCalendar({ pastDays, allSubjects }: { pastDays: DayPlan[]; allSubjects?: string[] }) {
    const [subject, setSubject] = useState<string | null>(null);

    // Same subject list as the Subjects section — chips shouldn't disagree
    const subjects: string[] = allSubjects && allSubjects.length
        ? allSubjects
        : (() => {
            const derived: string[] = [];
            pastDays.forEach(d => d.slots.forEach(s => { if (!derived.includes(s.subject)) derived.push(s.subject); }));
            return derived;
        })();

    // Day stats, scoped to the selected subject when one is active
    const dayStats: DayStat[] = pastDays.map(d => {
        const slots = subject ? d.slots.filter(s => s.subject === subject) : d.slots;
        return { date: d.date, done: slots.filter(s => s.completed).length, total: slots.length };
    });

    // Every month since the schedule started, chronological
    const monthKeys = [...new Set(dayStats.map(s => s.date.slice(0, 7)))].sort();
    const currentIdx = Math.max(0, monthKeys.length - 1);
    const [page, setPage] = useState(currentIdx);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Land on the current month
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollLeft = el.clientWidth * currentIdx;
        setPage(currentIdx);
    }, [currentIdx]);

    if (!pastDays.length) return null;

    const todayStr = new Date().toISOString().split('T')[0];
    const statByDate = new Map(dayStats.map(s => [s.date, s]));

    const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        setPage(Math.min(monthKeys.length - 1, Math.round(el.scrollLeft / el.clientWidth)));
    };

    return (
        <div className="w-full">
            {/* Subject filter — same pattern as Catch up */}
            {subjects.length > 1 && (
                <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar -mx-6 px-6">
                    <button
                        className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap border-0 cursor-pointer transition-[color,transform] active:scale-95 ${
                            !subject ? 'glass-chip text-on-surface' : 'bg-white/[0.03] text-on-surface-variant/50 hover:text-on-surface-variant/80'
                        }`}
                        onClick={() => setSubject(null)}
                    >
                        All
                    </button>
                    {subjects.map(subj => {
                        const c = subjectColor(subj);
                        const active = subject === subj;
                        return (
                            <button
                                key={subj}
                                className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap border-0 cursor-pointer transition-[color,transform] active:scale-95 flex items-center gap-1.5 ${
                                    active ? 'glass-chip text-on-surface' : 'bg-white/[0.03] text-on-surface-variant/50 hover:text-on-surface-variant/80'
                                }`}
                                onClick={() => setSubject(active ? null : subj)}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full ${c.bg} ${active ? 'opacity-90' : 'opacity-40'}`} />
                                {subj}
                            </button>
                        );
                    })}
                </div>
            )}
            <div ref={scrollRef} className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory" onScroll={onScroll}>
                {monthKeys.map(mk => {
                const [y, m] = mk.split('-').map(Number);
                const daysInMonth = new Date(y, m, 0).getDate();
                const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Mon = 0
                const monthName = new Date(y, m - 1, 1).toLocaleString('default', { month: 'long' });

                const monthStats = dayStats.filter(s => s.date.startsWith(mk) && s.total > 0);
                const fullDays = monthStats.filter(s => s.done === s.total).length;

                return (
                    <section key={mk} className="flex-shrink-0 w-full snap-start">
                        <div className="flex justify-between items-baseline mb-2.5">
                            <h4 className="font-display text-[13px] font-medium text-on-surface/80">{monthName}</h4>
                            <span className="text-[11px] text-on-surface-variant/50 tabular-nums">{fullDays}/{monthStats.length} days</span>
                        </div>
                        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                            {WEEKDAYS.map((w, i) => (
                                <div key={i} className="text-center text-[10px] font-medium text-on-surface-variant/45">{w}</div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1.5">
                            {Array.from({ length: offset }).map((_, i) => <div key={`pad-${i}`} />)}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1;
                                const dateStr = `${mk}-${String(day).padStart(2, '0')}`;
                                const stat = statByDate.get(dateStr);
                                const isToday = dateStr === todayStr;
                                const isFuture = dateStr > todayStr;

                                let cls = 'bg-white/[0.02] text-on-surface-variant/20';       // unscheduled / rest
                                if (stat && stat.total > 0) {
                                    const ratio = stat.done / stat.total;
                                    if (ratio === 1)      cls = 'bg-primary text-[#0a2050] font-semibold';
                                    else if (ratio > 0)   cls = 'bg-primary/25 text-primary/90';
                                    else                  cls = 'bg-white/[0.04] text-on-surface-variant/40';
                                }
                                if (isFuture) cls = 'bg-transparent text-on-surface-variant/25';

                                return (
                                    <div
                                        key={day}
                                        className={`aspect-square md:aspect-auto md:h-10 rounded-[10px] flex items-center justify-center text-[11px] tabular-nums ${cls}`}
                                        style={isToday ? { boxShadow: 'inset 0 0 0 1.5px rgba(173,198,255,0.7)' } : undefined}
                                        title={stat ? `${dateStr} · ${stat.done}/${stat.total}` : dateStr}
                                    >
                                        {day}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                );
            })}
            </div>

            {monthKeys.length > 1 && (
                <div className="flex justify-center gap-1.5 mt-4">
                    {monthKeys.map((mk, i) => (
                        <span
                            key={mk}
                            className={`h-1 rounded-full transition-all duration-300 ${i === page ? 'w-4 bg-primary/70' : 'w-1 bg-white/15'}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function ProgressView({
    subjects, pastDays, streak, history, toggle, busy, endDate,
}: {
    subjects: { name: string; pct: number; completed: number; total: number }[];
    pastDays: DayPlan[];
    streak: { current: number; best: number };
    history: { slot: Slot; date: string }[];
    toggle: (date: string, name: string, cur: boolean) => void;
    busy: string | null;
    endDate?: string | null;
}) {
    const totalAll = subjects.reduce((a, s) => a + s.total, 0);
    const doneAll = subjects.reduce((a, s) => a + s.completed, 0);
    const overallPct = totalAll ? Math.round((doneAll / totalAll) * 100) : 0;

    const stats = [
        { value: `${overallPct}%`, label: `${doneAll} of ${totalAll} blocks`, cls: 'text-on-surface' },
        { value: String(streak.current), label: 'day streak', cls: streak.current > 0 ? 'text-amber-200/95' : 'text-on-surface' },
        { value: String(streak.best), label: 'best streak', cls: 'text-on-surface' },
    ];

    // Day count since the schedule began (pastDays arrives sorted ascending)
    const prepDay = pastDays.length
        ? Math.floor((Date.now() - parseLocal(pastDays[0].date).getTime()) / 86400000) + 1
        : 0;

    return (
        <main className="max-w-[560px] mx-auto pb-16">
            <header className="sticky-glass-header bg-[#060808]/70 backdrop-blur-lg md:static md:bg-transparent md:backdrop-blur-none px-6 z-40">
                <div className="max-w-[560px] mx-auto">
                    {prepDay > 0 && (
                        <p className="text-[13px] text-on-surface-variant/50 font-medium">
                            Day {prepDay} of preparation
                            {endDate ? (
                                <span className="text-on-surface-variant/40"> · finishes {parseLocal(endDate).toLocaleString('default', { month: 'short', day: 'numeric' })}</span>
                            ) : null}
                        </p>
                    )}
                    <h1 className="font-display text-[24px] font-semibold text-on-surface tracking-tight leading-tight">Progress</h1>
                </div>
            </header>

            <div className="px-6">
                {/* ── Stat tiles ── */}
                <div className="grid grid-cols-3 gap-3 mt-5 mb-10">
                    {stats.map(s => (
                        <div key={s.label} className="glass-card rounded-2xl px-3 py-5 text-center">
                            <p className={`font-display text-[24px] font-semibold tabular-nums leading-none ${s.cls}`}>{s.value}</p>
                            <p className="text-[11px] text-on-surface-variant/50 mt-2 whitespace-nowrap">{s.label}</p>
                        </div>
                    ))}
                </div>

                {/* ── Consistency ── */}
                {pastDays.length > 0 && (
                    <section className="mb-10">
                        <h3 className="text-[12px] font-medium text-on-surface-variant/55 mb-4">Consistency</h3>
                        {pastDays.length < 7 ? (
                            <WeekStrip pastDays={pastDays} />
                        ) : (
                            <ConsistencyCalendar pastDays={pastDays} allSubjects={subjects.map(s => s.name)} />
                        )}
                    </section>
                )}

                {/* ── Subjects ── */}
                {subjects.length > 0 && (
                    <section className="mb-10">
                        <h3 className="text-[12px] font-medium text-on-surface-variant/55 mb-1">Subjects</h3>
                        <div>
                            {subjects.map(s => {
                                const c = subjectColor(s.name);
                                return (
                                    <div key={s.name} className="py-3.5 border-b border-white/[0.04] last:border-0">
                                        <div className="flex justify-between items-baseline mb-2.5">
                                            <span className="flex items-center gap-2 text-[13px] font-medium text-on-surface/85">
                                                <span className={`w-1.5 h-1.5 rounded-full ${c.bg} opacity-70`} />
                                                {s.name}
                                            </span>
                                            <span className="text-[12px] text-on-surface-variant/45 tabular-nums">{s.completed}/{s.total} · {s.pct}%</span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                                            <motion.div
                                                className={`h-full rounded-full ${c.bg}`}
                                                initial={{ width: 0 }}
                                                animate={{ width: `${s.pct}%` }}
                                                transition={{ duration: 0.9, ease: [0.25, 1, 0.5, 1] }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* ── Recent completions (tap to undo) ── */}
                {history.length > 0 && (
                    <section>
                        <h3 className="text-[12px] font-medium text-on-surface-variant/55 mb-1">Recent</h3>
                        <div>
                            {history.slice(0, 10).map(item => {
                                const id = `${item.date}-${item.slot.name}`;
                                const isLoading = busy === id;
                                const c = subjectColor(item.slot.subject);
                                return (
                                    <button
                                        key={id}
                                        className="w-full flex items-center gap-3 py-3 px-1 text-left bg-transparent border-0 border-b border-white/[0.04] last:border-0 cursor-pointer group"
                                        onClick={() => toggle(item.date, item.slot.name, item.slot.completed)}
                                        title="Tap to undo"
                                    >
                                        <span className="flex-1 min-w-0">
                                            <span className={`block text-[11px] font-semibold tracking-[0.08em] uppercase ${c.text} opacity-80`}>{item.slot.subject}</span>
                                            <span className="block text-[13px] text-on-surface/70 truncate mt-0.5">{summarizeTask(item.slot.task)}</span>
                                        </span>
                                        <span className="text-[12px] text-on-surface-variant/40 tabular-nums flex-shrink-0">
                                            {parseLocal(item.date).toLocaleString('default', { month: 'short', day: 'numeric' })}
                                        </span>
                                        <span className="w-5 flex-shrink-0 flex justify-center">
                                            {isLoading ? (
                                                <span className="w-3 h-3 rounded-full border border-white/30 border-t-white animate-spin" />
                                            ) : (
                                                <span className="material-symbols-outlined text-[15px] text-on-surface-variant/30 group-hover:text-on-surface-variant/70 transition-colors">rotate_left</span>
                                            )}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}
            </div>
        </main>
    );
}
