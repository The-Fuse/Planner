import { DayPlan } from '../interfaces';
import { TaskContent } from './TaskContent';
import { motion } from 'framer-motion';


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
        stroke: string;
        strokeTrack: string;
        glowBox: string;
        glowBorder: string;
        accent: string;
    }> = {
        Polity: {
            text: 'text-primary',
            bgFill: 'bg-primary',
            stroke: '#adc6ff',
            strokeTrack: 'rgba(173,198,255,0.08)',
            glowBox: 'rgba(75,142,255,0.08)',
            glowBorder: 'rgba(75,142,255,0.25)',
            accent: 'rgba(173,198,255,0.15)',
        },
        History: {
            text: 'text-secondary',
            bgFill: 'bg-secondary',
            stroke: '#c2c1ff',
            strokeTrack: 'rgba(194,193,255,0.08)',
            glowBox: 'rgba(194,193,255,0.08)',
            glowBorder: 'rgba(194,193,255,0.25)',
            accent: 'rgba(194,193,255,0.15)',
        },
        Economy: {
            text: 'text-tertiary',
            bgFill: 'bg-tertiary',
            stroke: '#68d3ff',
            strokeTrack: 'rgba(104,211,255,0.08)',
            glowBox: 'rgba(104,211,255,0.08)',
            glowBorder: 'rgba(104,211,255,0.25)',
            accent: 'rgba(104,211,255,0.15)',
        },
    };

    // SVG ring constants
    const RING_SIZE = 56;
    const RING_STROKE = 3;
    const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;



    return (
        <>
            <header 
                className="md:static sticky top-0 z-40 flex flex-col items-center justify-center w-full bg-[#060808]/60 backdrop-blur-lg pb-4 mb-6 md:bg-transparent md:backdrop-blur-none transition-all"
                style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
            >
                <h1 className="mission-title text-[11px] text-on-surface-variant tracking-[0.2em] mb-2 uppercase">Subjects Explorer</h1>
                <div className="w-12 h-[1px] bg-primary/40"></div>
            </header>

            <main className="max-w-[800px] mx-auto pb-24 w-full space-y-14">

                {/* ── Core Mastery — Subject cards with ring progress ── */}
                {subjects.length > 0 && (
                    <section className="px-gutter">
                        <div className="flex items-center gap-4 mb-8">
                            <h2 className="mission-title text-[11px] text-on-surface-variant flex-shrink-0 uppercase tracking-widest">Core Mastery</h2>
                            <div className="h-[0.5px] flex-grow bg-gradient-to-r from-white/10 to-transparent"></div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {subjects.map(s => {
                                const cm = colorMap[s.name] || colorMap.Polity;
                                const offset = RING_CIRCUMFERENCE - (s.pct / 100) * RING_CIRCUMFERENCE;

                                return (
                                    <div
                                        key={s.name}
                                        className="group relative rounded-[20px] p-5 overflow-hidden transition-all duration-300 hover:-translate-y-0.5"
                                        style={{
                                            background: 'rgba(255,255,255,0.04)',
                                            border: '0.5px solid rgba(255,255,255,0.1)',
                                            boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.12), 0 2px 12px rgba(0,0,0,0.15)',
                                            backdropFilter: 'blur(40px) saturate(1.4)',
                                            WebkitBackdropFilter: 'blur(40px) saturate(1.4)',
                                        }}
                                    >

                                        <div className="relative z-10 flex items-center gap-4">
                                            {/* Ring Progress */}
                                            <div className="relative flex-shrink-0">
                                                <svg width={RING_SIZE} height={RING_SIZE} className="transform -rotate-90">
                                                    {/* Track */}
                                                    <circle
                                                        cx={RING_SIZE / 2}
                                                        cy={RING_SIZE / 2}
                                                        r={RING_RADIUS}
                                                        fill="none"
                                                        stroke={cm.strokeTrack}
                                                        strokeWidth={RING_STROKE}
                                                    />
                                                    {/* Progress */}
                                                    <motion.circle
                                                        cx={RING_SIZE / 2}
                                                        cy={RING_SIZE / 2}
                                                        r={RING_RADIUS}
                                                        fill="none"
                                                        stroke={cm.stroke}
                                                        strokeWidth={RING_STROKE}
                                                        strokeLinecap="round"
                                                        strokeDasharray={RING_CIRCUMFERENCE}
                                                        initial={{ strokeDashoffset: RING_CIRCUMFERENCE }}
                                                        animate={{ strokeDashoffset: offset }}
                                                        transition={{ duration: 1.2, ease: [0.25, 1, 0.5, 1], delay: 0.2 }}
                                                        style={{
                                                            filter: s.pct > 0 ? `drop-shadow(0 0 4px ${cm.glowBorder})` : 'none',
                                                        }}
                                                    />
                                                </svg>
                                                {/* Center percentage */}
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <span className="text-[11px] font-bold text-on-surface/80 tabular-nums tracking-tight">
                                                        {s.pct}%
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Subject info */}
                                            <div className="flex flex-col gap-1.5 min-w-0">
                                                <span className={`text-[11px] font-bold ${cm.text} tracking-[0.2em] uppercase leading-none`}>
                                                    {s.name}
                                                </span>
                                                <span className="text-[10px] font-medium text-on-surface/30 tabular-nums tracking-wider leading-none">
                                                    {s.completed} of {s.total} done
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* ── Upcoming — Horizontal scrolling day cards ── */}
                {upcoming.length > 0 && (
                    <section>
                    <div className="flex items-center gap-4 mb-8 px-gutter">
                        <h2 className="mission-title text-[11px] text-on-surface-variant flex-shrink-0">Upcoming Tasks</h2>
                        <div className="h-[0.5px] flex-grow bg-gradient-to-r from-white/10 to-transparent"></div>
                    </div>

                        <div className="flex gap-5 overflow-x-auto no-scrollbar px-gutter scroll-pl-gutter scroll-pr-gutter pt-4 pb-8 snap-x snap-mandatory">
                            {upcoming.slice(0, 10).map((day) => {
                                const MAX_SLOTS = 4;
                                const slots = day.slots.slice(0, MAX_SLOTS);
                                const extraSlots = day.slots.length - MAX_SLOTS;

                                return (
                                    <div
                                        key={day.date}
                                        className="flex-shrink-0 w-[300px] rounded-[24px] p-6 flex flex-col gap-6 snap-start relative overflow-hidden transition-all duration-300 hover:-translate-y-1"
                                        style={{
                                            background: 'rgba(255,255,255,0.025)',
                                            border: '0.5px solid rgba(255,255,255,0.07)',
                                            boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.06)',
                                        }}
                                    >
                                        {/* Subtle top glow based on the first slot's subject */}
                                        {slots.length > 0 && (
                                            <div
                                                className="absolute top-0 left-0 right-0 h-24 opacity-30 pointer-events-none"
                                                style={{
                                                    background: `radial-gradient(ellipse at 50% -20%, ${colorMap[slots[0].subject]?.glowBorder || 'rgba(255,255,255,0.1)'} 0%, transparent 70%)`
                                                }}
                                            />
                                        )}

                                        {/* Date header and divider group */}
                                        <div className="flex flex-col gap-3 relative z-10">
                                            <div className="flex justify-end">
                                                <div className="text-right">
                                                    <p className="text-[9px] font-bold text-on-surface-variant/30 tracking-[0.35em] uppercase leading-relaxed">{fmtDay(day.date)}</p>
                                                    <p className="text-[9px] font-light text-on-surface-variant/25 tracking-widest leading-relaxed uppercase">{fmtMonthDate(day.date)}</p>
                                                </div>
                                            </div>
                                            <div className="h-[0.5px] w-full bg-white/[0.04]"></div>
                                        </div>

                                        {/* Slots grouped by subject */}
                                        <div className="space-y-6 relative z-10 pt-1">
                                            {Object.entries(
                                                slots.reduce((acc, slot) => {
                                                    if (!acc[slot.subject]) acc[slot.subject] = [];
                                                    acc[slot.subject].push(slot);
                                                    return acc;
                                                }, {} as Record<string, typeof slots>)
                                            ).map(([subject, subjectSlots]) => {
                                                const cm = colorMap[subject] || colorMap.Polity;
                                                const allCompleted = subjectSlots.every(s => s.completed);
                                                
                                                return (
                                                    <div key={subject} className="flex flex-col gap-3">
                                                        <div className="flex items-center gap-2.5">
                                                            <span className={`flex-shrink-0 w-1 h-1 rounded-full transition-all duration-300 ${cm.bgFill} ${allCompleted ? 'opacity-20' : 'opacity-60'}`}></span>
                                                            <p className={`text-[9px] font-medium text-on-surface/40 tracking-[0.25em] uppercase leading-none mt-[1px] ${allCompleted ? 'line-through opacity-30' : ''}`}>
                                                                {subject}
                                                            </p>
                                                        </div>
                                                        <div className="flex flex-col gap-3 pl-4 border-l-[0.5px] border-white/[0.05] ml-1.5 mt-2 py-1">
                                                            {subjectSlots.map(slot => (
                                                                <div
                                                                    key={slot.name}
                                                                    className="cursor-pointer transition-transform duration-300 hover:translate-x-1 group"
                                                                    onClick={() => toggle(day.date, slot.name, slot.completed)}
                                                                >
                                                                    <TaskContent task={slot.task} isDone={slot.completed} styleType="compact" />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            
                                            {extraSlots > 0 && (
                                                <div className="pt-2 text-center border-t border-white/[0.04]">
                                                    <span className="text-[9px] font-medium text-on-surface/20 tracking-widest uppercase">
                                                        + {extraSlots} more block{extraSlots > 1 ? 's' : ''}
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
