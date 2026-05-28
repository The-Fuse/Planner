import { DayPlan } from '../interfaces';
import { TaskContent } from './TaskContent';

export function SubjectsView({
    subjects,
    upcoming,
    toggle,
    busy,
}: {
    subjects: { name: string; pct: number; completed: number; total: number }[];
    upcoming: DayPlan[];
    toggle: (date: string, name: string, cur: boolean) => void;
    busy: string | null;
}) {
    const fmtDay = (d: string) =>
        new Date(d).toLocaleString('default', { weekday: 'short' }).toUpperCase();

    const fmtMonthDate = (d: string) => {
        const dt = new Date(d);
        return `${dt.toLocaleString('default', { month: 'short' }).toUpperCase()} ${String(dt.getDate()).padStart(2, '0')}`;
    };

    const colorMap: Record<string, {
        text: string;
        bgFill: string;
        barShadow: string;
        glowBox: string;
        glowBorder: string;
    }> = {
        Polity: {
            text: 'text-primary',
            bgFill: 'bg-primary',
            barShadow: 'shadow-[0_0_12px_rgba(173,198,255,0.6)]',
            glowBox: 'rgba(75,142,255,0.08)',
            glowBorder: 'rgba(75,142,255,0.2)',
        },
        History: {
            text: 'text-secondary',
            bgFill: 'bg-secondary',
            barShadow: 'shadow-[0_0_12px_rgba(194,193,255,0.6)]',
            glowBox: 'rgba(194,193,255,0.08)',
            glowBorder: 'rgba(194,193,255,0.2)',
        },
        Economy: {
            text: 'text-tertiary',
            bgFill: 'bg-tertiary',
            barShadow: 'shadow-[0_0_12px_rgba(104,211,255,0.6)]',
            glowBox: 'rgba(104,211,255,0.08)',
            glowBorder: 'rgba(104,211,255,0.2)',
        },
    };

    return (
        <>
            <header className="flex flex-col items-center px-gutter pt-2 mb-10">
                <h1 className="mission-title text-[11px] text-on-surface-variant tracking-[0.2em] mb-2 uppercase">Subjects Explorer</h1>
                <div className="w-12 h-[1px] bg-primary/40"></div>
            </header>

            <main className="max-w-[800px] mx-auto pb-24 w-full space-y-14">

                {/* ── Core Mastery — original line progress bar design ── */}
                {subjects.length > 0 && (
                    <section className="px-gutter space-y-6">
                        <div className="flex items-center gap-4 mb-2">
                            <h2 className="mission-title text-[11px] text-on-surface-variant flex-shrink-0 uppercase tracking-widest">Core Mastery</h2>
                            <div className="h-[0.5px] flex-grow bg-white/10"></div>
                        </div>
                        <div className="space-y-8">
                            {subjects.map(s => {
                                const cm = colorMap[s.name] || colorMap.Polity;
                                return (
                                    <div key={s.name} className="space-y-4">
                                        <div className="flex justify-between items-end px-1">
                                            <span className={`text-[12px] font-bold ${cm.text} tracking-[0.2em] uppercase leading-none`}>{s.name}</span>
                                            <div className="flex items-end gap-3">
                                                <span className="text-[9px] font-medium text-on-surface/30 tabular-nums tracking-widest leading-none pb-[1px]">{s.completed}/{s.total}</span>
                                                <span className="text-[11px] font-bold text-on-surface/40 tabular-nums tracking-widest leading-none">{s.pct}%</span>
                                            </div>
                                        </div>
                                        <div className="w-full bg-white/[0.04] h-[3px] rounded-full overflow-hidden">
                                            <div
                                                className={`${cm.bgFill} h-full rounded-full transition-all duration-1000`}
                                                style={{ width: `${s.pct}%`, boxShadow: s.pct > 0 ? `0 0 8px 1px ${cm.glowBorder}` : 'none' }}
                                            ></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* ── Upcoming Days — minimal day-wise read-only cards ── */}
                {upcoming.length > 0 && (
                    <section>
                        <div className="px-gutter flex items-center gap-4 mb-6 mt-4">
                            <h2 className="mission-title text-[11px] text-on-surface-variant flex-shrink-0 uppercase tracking-widest">Upcoming Tasks</h2>
                            <div className="h-[0.5px] flex-grow bg-white/10"></div>
                        </div>

                        <div className="flex gap-5 overflow-x-auto no-scrollbar px-gutter scroll-pl-gutter scroll-pr-gutter pt-4 pb-8 snap-x snap-mandatory">
                            {upcoming.slice(0, 10).map((day, idx) => {
                                const MAX_SLOTS = 4;
                                const slots = day.slots.slice(0, MAX_SLOTS);
                                const extraSlots = day.slots.length - MAX_SLOTS;
                                return (
                                    <div
                                        key={day.date}
                                        className={`flex-shrink-0 w-[300px] rounded-[24px] p-6 flex flex-col gap-5 snap-start relative overflow-hidden transition-all duration-300 hover:shadow-[0_12px_40px_rgba(0,0,0,0.3)] hover:-translate-y-2`}
                                        style={{
                                            background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.005) 100%)',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            borderTop: '1px solid rgba(255,255,255,0.15)',
                                            borderLeft: '1px solid rgba(255,255,255,0.15)',
                                            boxShadow: '0 4px 24px -1px rgba(0,0,0,0.15)',
                                            backdropFilter: 'blur(20px)',
                                            WebkitBackdropFilter: 'blur(20px)',
                                        }}
                                    >
                                        {/* Subtle internal glow */}
                                        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-50 pointer-events-none rounded-[24px]"></div>

                                        {/* Date header */}
                                        <div className="flex justify-end pb-2">
                                            <div className="text-right">
                                                <p className="text-[9px] font-bold text-on-surface-variant/40 tracking-[0.35em] uppercase leading-relaxed">{fmtDay(day.date)}</p>
                                                <p className="text-[9px] font-light text-on-surface-variant/40 tracking-widest leading-relaxed uppercase">{fmtMonthDate(day.date)}</p>
                                            </div>
                                        </div>

                                        <div className="h-[0.5px] w-full bg-white/[0.06]"></div>

                                        {/* Slots */}
                                        <div className="space-y-5 relative z-10 pt-1">
                                            {slots.map(slot => {
                                                const cm = colorMap[slot.subject] || colorMap.Polity;
                                                return (
                                                    <div
                                                        key={slot.name}
                                                        className={`flex flex-col gap-2 cursor-pointer transition-all duration-300 hover:opacity-70 group`}
                                                        onClick={() => toggle(day.date, slot.name, slot.completed)}
                                                    >
                                                        <div className="flex items-center gap-2.5">
                                                            <span
                                                                className={`flex-shrink-0 w-1.5 h-1.5 rounded-full transition-all duration-300 ${cm.bgFill} ${slot.completed ? 'opacity-30' : ''}`}
                                                                style={slot.completed ? {} : { boxShadow: `0 0 8px 1px ${cm.glowBorder}` }}
                                                            ></span>
                                                            <p className={`text-[10px] font-bold ${cm.text} tracking-[0.25em] uppercase leading-none mt-[1px] transition-all duration-300 ${slot.completed ? 'line-through opacity-50' : ''}`}>
                                                                {slot.subject}
                                                            </p>
                                                        </div>
                                                        <div className="text-on-surface/70 leading-relaxed pl-4">
                                                            <TaskContent task={slot.task} isDone={slot.completed} styleType="compact" />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {extraSlots > 0 && (
                                                <div className="pt-2 text-center">
                                                    <span className="text-[11px] font-light text-on-surface/40 tracking-wider">
                                                        + {extraSlots} more task{extraSlots > 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}
            </main>
        </>
    );
}
