import { DayPlan, Slot } from '../interfaces';
import { TaskContent } from './TaskContent';
import { motion, LayoutGroup } from 'framer-motion';

export function DashboardView({
    today,
    backlog,
    toggle,
    busy
}: {
    today: DayPlan | null;
    backlog: { slot: Slot; date: string }[];
    toggle: (date: string, name: string, cur: boolean) => void;
    busy: string | null;
}) {
    // Helper to format backlog dates
    const fmtDate = (d: string) => {
        const dt = new Date(d);
        return `${dt.getDate()} ${dt.toLocaleString('default', { month: 'short' })}`;
    };

    const blPolity = backlog.filter(b => b.slot.subject === 'Polity');
    const blHistory = backlog.filter(b => b.slot.subject === 'History');
    const blEconomy = backlog.filter(b => b.slot.subject === 'Economy');

    const colorMap: Record<string, { text: string, bgFill: string, shadowBox: string, glowBorder: string }> = {
        Polity: { text: 'text-primary', bgFill: 'bg-primary', shadowBox: 'rgba(173, 198, 255, 0.2)', glowBorder: 'rgba(75,142,255,0.25)' },
        History: { text: 'text-secondary', bgFill: 'bg-secondary', shadowBox: 'rgba(194, 193, 255, 0.2)', glowBorder: 'rgba(194,193,255,0.25)' },
        Economy: { text: 'text-tertiary', bgFill: 'bg-tertiary', shadowBox: 'rgba(104, 211, 255, 0.2)', glowBorder: 'rgba(104,211,255,0.25)' },
        Geography: { text: 'text-primary', bgFill: 'bg-primary', shadowBox: 'rgba(173, 198, 255, 0.2)', glowBorder: 'rgba(75,142,255,0.25)' },
        Science: { text: 'text-secondary', bgFill: 'bg-secondary', shadowBox: 'rgba(194, 193, 255, 0.2)', glowBorder: 'rgba(194,193,255,0.25)' },
        CurrentAffairs: { text: 'text-tertiary', bgFill: 'bg-tertiary', shadowBox: 'rgba(104, 211, 255, 0.2)', glowBorder: 'rgba(104,211,255,0.25)' },
    };

    return (
        <main className="mx-auto pt-0 pb-20 max-w-[800px]">
            {today && (
                <>
                    <div className="flex flex-col items-center px-gutter mb-6">
                        <h1 className="mission-title text-[11px] text-on-surface-variant mb-2">Today's Mission</h1>
                        <div className="w-12 h-[1px] bg-primary/40"></div>
                    </div>

                    <section className="spatial-glass sm:rounded-xl mx-0 sm:mx-gutter mb-8">
                        <div className="p-10 pb-6">
                            <div className="flex justify-between items-start">
                                <div className="flex items-baseline gap-2 relative">
                                    <span className="text-8xl ultra-refined-num text-on-surface">
                                        {String(new Date(today.date).getDate()).padStart(2, '0')}
                                    </span>
                                    <span
                                        className="text-[13px] font-light text-on-surface-variant uppercase tracking-widest absolute ml-2"
                                        style={{ transform: 'rotate(90deg)', transformOrigin: 'left center', left: '100%', top: '50%', marginTop: '-10px' }}
                                    >
                                        {new Date(today.date).toLocaleString('default', { month: 'short' })}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end gap-6">
                                    <span className="px-6 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-light text-on-surface tracking-[0.4em] uppercase">
                                        {today.day}
                                    </span>
                                    <p className="italic text-on-surface-variant/40 text-right text-sm">"Finish what you started."</p>
                                </div>
                            </div>
                            <div className="mt-10 section-divider w-full"></div>
                        </div>

                        <LayoutGroup>
                            <div className="pb-12 space-y-10 px-4 sm:px-8">
                                {today.slots.map((slot, index) => {
                                    const id = `${today.date}-${slot.name}`;
                                    const isLoading = busy === id;
                                    const isNext = !slot.completed && slot === today.slots.find(s => !s.completed);
                                    const cm = colorMap[slot.subject] || colorMap.Polity;

                                    const smoothTransition = { type: "tween", ease: [0.25, 1, 0.5, 1], duration: 0.5 } as any;

                                    return (
                                        <motion.div layout transition={smoothTransition} key={slot.name} className="relative z-10 flex gap-5 sm:gap-6 group">
                                            {/* Timeline Node Column */}
                                            <div className="flex flex-col items-center relative z-10">
                                                <motion.div
                                                    layout
                                                    transition={smoothTransition}
                                                    className={`w-7 h-7 rounded-full flex items-center justify-center cursor-pointer z-10 bg-[#0A0A0A] ${slot.completed ? 'opacity-40' : 'hover:scale-110 hover:shadow-lg transition-transform'}`}
                                                    onClick={() => toggle(today.date, slot.name, slot.completed)}
                                                    whileTap={{ scale: 0.8 }}
                                                    title="Mark as Complete"
                                                >
                                                    {isLoading ? (
                                                        <div className="w-full h-full rounded-full border-[1.5px] border-white/20 border-t-primary animate-spin"></div>
                                                    ) : slot.completed ? (
                                                        <motion.div
                                                            initial={{ scale: 0, rotate: -90 }}
                                                            animate={{ scale: 1, rotate: 0 }}
                                                            transition={{ type: "spring", stiffness: 200, damping: 10 }}
                                                            className="w-full h-full rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
                                                        >
                                                            <span className="material-symbols-outlined text-[14px] text-on-surface font-bold">check</span>
                                                        </motion.div>
                                                    ) : isNext ? (
                                                        <motion.div
                                                            layoutId="active-timeline-dot-container"
                                                            transition={smoothTransition}
                                                            className="w-full h-full rounded-full border border-white/20 flex items-center justify-center bg-background"
                                                        >
                                                            <motion.div
                                                                animate={{ scale: [1, 1.2, 1], opacity: [0.8, 1, 0.8] }}
                                                                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                                                                className={`w-2 h-2 rounded-full ${cm.bgFill}`}
                                                                style={{ boxShadow: `0 0 12px 2px ${cm.shadowBox}` }}
                                                            ></motion.div>
                                                        </motion.div>
                                                    ) : (
                                                        <div className="w-full h-full rounded-full border border-white/10 flex items-center justify-center opacity-30">
                                                        </div>
                                                    )}
                                                </motion.div>
                                                {/* Connecting Line */}
                                                {index !== today.slots.length - 1 && (
                                                    <div className="w-[1px] absolute top-7 -bottom-10 bg-gradient-to-b from-white/10 to-white-[0.02] z-0"></div>
                                                )}
                                            </div>

                                            {/* Content Column */}
                                            <motion.div layout transition={smoothTransition} className={`flex-grow pb-2 transition-all duration-500 ${slot.completed ? 'opacity-40' : (isNext ? 'opacity-100' : 'opacity-[0.55] hover:opacity-100')}`}>
                                                <motion.div layout transition={smoothTransition} className="flex items-center gap-4 mb-3 pt-1">
                                                    <span className="text-[10px] font-bold text-on-surface-variant/40 tracking-[0.3em] uppercase">Block {index + 1}</span>
                                                    <span className={`text-[10px] font-bold ${slot.completed ? 'text-on-surface-variant' : cm.text} tracking-[0.3em] uppercase`}>{slot.subject}</span>
                                                </motion.div>

                                                {/* Content Card */}
                                                <motion.div
                                                    layout
                                                    transition={smoothTransition}
                                                    className={`relative rounded-[20px] p-5 sm:p-6 z-0 overflow-hidden ${isNext ? '' : 'bg-transparent border border-white/[0.03] hover:bg-white/[0.02] hover:border-white/[0.08] transition-colors duration-500'}`}
                                                >
                                                    {isNext && (
                                                        <motion.div
                                                            layoutId="active-card-bg-layer"
                                                            transition={smoothTransition}
                                                            className={`absolute inset-0 rounded-[20px] bg-white/[0.04] -z-10 border-none`}
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                        />
                                                    )}
                                                    <motion.div layout="position" transition={smoothTransition}>
                                                        <TaskContent task={slot.task} isDone={slot.completed} styleType={isNext ? 'normal' : 'compact'} />
                                                    </motion.div>
                                                </motion.div>
                                            </motion.div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </LayoutGroup>
                    </section>
                </>
            )}

            {backlog.length > 0 ? (
                <section className="space-y-8 mt-16 pb-12">
                    <div className="flex items-center gap-4 mb-8 px-4 sm:px-gutter">
                        <h2 className="mission-title text-[11px] text-on-surface-variant flex-shrink-0">Subject Backlogs</h2>
                        <div className="h-[0.5px] flex-grow bg-gradient-to-r from-white/10 to-transparent"></div>
                    </div>

                    <div className="space-y-8">
                        {[
                            { items: blPolity, label: 'Polity Backlog', color: colorMap.Polity },
                            { items: blHistory, label: 'History Backlog', color: colorMap.History },
                            { items: blEconomy, label: 'Economy Backlog', color: colorMap.Economy }
                        ].map(({ items, label, color }) => items.length > 0 && (
                            <div key={label} className="space-y-6">
                                <div className="flex items-center justify-between px-4 sm:px-gutter">
                                    <h3 className={`text-[10px] font-bold ${color.text} tracking-[0.3em] uppercase`}>{label}</h3>
                                    {(() => {
                                        const days = new Set(items.map(i => i.date)).size;
                                        return <span className="px-3 py-1 rounded-sm bg-error/10 border border-error/20 text-[9px] font-bold text-error tracking-[0.2em] uppercase">{days} {days === 1 ? 'Day' : 'Days'} Delay</span>;
                                    })()}
                                </div>
                                <div className="flex justify-start gap-5 overflow-x-auto no-scrollbar pt-4 pb-8 snap-x snap-mandatory px-4 sm:px-gutter scroll-pl-4 sm:scroll-pl-gutter scroll-pr-4 sm:scroll-pr-gutter">
                                    {items.map((item, idx) => {
                                        const id = `${item.date}-${item.slot.name}`;
                                        const isLoading = busy === id;
                                        return (
                                            <div
                                                key={`${item.date}-${idx}`}
                                                className="flex-shrink-0 w-[300px] rounded-[24px] p-6 flex flex-col gap-5 snap-start relative overflow-hidden transition-all duration-300 hover:-translate-y-1 backdrop-blur-xl"
                                                style={{
                                                    background: 'rgba(255, 255, 255, 0.03)',
                                                    border: '0.5px solid rgba(255, 255, 255, 0.08)',
                                                    boxShadow: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.05), 0 8px 32px -8px rgba(0,0,0,0.2)',
                                                }}
                                            >
                                                {/* Date header and check button group */}
                                                <div className="flex flex-col gap-3 relative z-10">
                                                    <div className="flex justify-between items-center">
                                                        <button
                                                            className={`w-7 h-7 rounded-full border border-white/10 flex items-center justify-center transition-all duration-300 group-hover:bg-white/5 group-hover:border-white/20 hover:!bg-white/10 hover:!border-white/30 hover:scale-110 cursor-pointer p-0 bg-transparent ${isLoading ? 'opacity-100' : 'opacity-40 group-hover:opacity-100'} ${color.text}`}
                                                            onClick={() => toggle(item.date, item.slot.name, item.slot.completed)}
                                                            title="Mark as Complete"
                                                        >
                                                            {isLoading ? (
                                                                <div className="w-3.5 h-3.5 rounded-full border-[1.5px] border-current/20 border-t-current animate-spin"></div>
                                                            ) : (
                                                                <span className="material-symbols-outlined text-[14px]">check</span>
                                                            )}
                                                        </button>

                                                        <div className="text-right">
                                                            <p className="text-[9px] font-bold text-on-surface-variant/30 tracking-[0.35em] uppercase leading-relaxed">{new Date(item.date).toLocaleString('default', { weekday: 'short' }).toUpperCase()}</p>
                                                            <p className="text-[9px] font-light text-on-surface-variant/25 tracking-widest leading-relaxed uppercase">{`${new Date(item.date).toLocaleString('default', { month: 'short' }).toUpperCase()} ${String(new Date(item.date).getDate()).padStart(2, '0')}`}</p>
                                                        </div>
                                                    </div>
                                                    <div className="h-[0.5px] w-full bg-white/10"></div>
                                                </div>

                                                {/* Task Content */}
                                                <div className="flex-1 relative z-10">
                                                    <div className="transition-opacity duration-300">
                                                        <TaskContent task={item.slot.task} styleType="backlog-compact" />
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            ) : (
                <section className="mt-16 pb-12 flex flex-col items-center justify-center text-center opacity-50 px-4">
                    <span className="material-symbols-outlined text-[32px] text-on-surface-variant/30 mb-4">task_alt</span>
                    <h2 className="text-[11px] font-bold tracking-[0.3em] text-on-surface-variant uppercase mb-1">Zero Backlogs</h2>
                    <p className="text-[10px] text-on-surface-variant/60 font-light tracking-wide">You're completely caught up. Great job!</p>
                </section>
            )}
        </main>
    );
}
