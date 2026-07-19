import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DayPlan, Slot } from '../interfaces';
import { parseItems } from './TaskContent';
import { subjectColor } from '../subjectColors';

/** Total pages across a task's "pp.a-b" ranges */
function pagesInTask(task: string) {
    let total = 0;
    const re = /pp\.(\d+)\s*-\s*(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(task)) !== null) total += Math.max(0, Number(m[2]) - Number(m[1]) + 1);
    return total;
}

function fmtShort(d: string) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleString('default', { month: 'short', day: 'numeric' });
}

/** Header progress ring — blocks done today */
function ProgressRing({ done, total }: { done: number; total: number }) {
    const r = 20;
    const C = 2 * Math.PI * r;
    const pct = total > 0 ? done / total : 0;
    return (
        <div className="relative w-[52px] h-[52px] flex-shrink-0" role="img" aria-label={`${done} of ${total} blocks done`}>
            <svg viewBox="0 0 52 52" className="w-full h-full -rotate-90">
                <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                <circle
                    cx="26" cy="26" r={r} fill="none"
                    stroke="#adc6ff" strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={C}
                    strokeDashoffset={C * (1 - pct)}
                    style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.4, 0, 0.2, 1)' }}
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold tabular-nums text-on-surface/85">
                {done}/{total}
            </span>
        </div>
    );
}

/** Tap-to-complete circle */
function CheckCircle({
    completed, loading, hex, onClick, size = 22,
}: {
    completed: boolean; loading: boolean; hex: string;
    onClick: () => void; size?: number;
}) {
    return (
        <button
            onClick={onClick}
            aria-label={completed ? 'Undo' : 'Mark complete'}
            title={completed ? 'Undo' : 'Mark complete'}
            className="relative flex-shrink-0 rounded-full bg-transparent border-0 p-0 cursor-pointer flex items-center justify-center after:absolute after:-inset-3 after:content-[''] after:rounded-full"
            style={{ width: size, height: size }}
        >
            <span
                className="absolute inset-0 rounded-full transition-all duration-300"
                style={
                    completed
                        ? { background: hex, opacity: 0.9 }
                        : { border: '1.5px solid rgba(255,255,255,0.22)' }
                }
            />
            {loading ? (
                <span className="relative w-3 h-3 rounded-full border-[1.5px] border-white/25 border-t-white animate-spin" />
            ) : completed ? (
                <motion.span
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                    className="material-symbols-outlined relative font-bold"
                    style={{ color: '#060808', fontSize: Math.round(size * 0.58) }}
                >
                    check
                </motion.span>
            ) : null}
        </button>
    );
}

/** Page-range badge: quiet pill so numbers read as metadata, not content */
function PagePill({ pg, dim = false }: { pg: string; dim?: boolean }) {
    return (
        <span className={`flex-shrink-0 text-[10.5px] font-medium tabular-nums rounded-full px-2 py-[3px] leading-none ${
            dim ? 'text-on-surface-variant/35 bg-white/[0.04]' : 'text-on-surface-variant/75 bg-white/[0.07]'
        }`}>
            {pg.replace('pp.', '').replace(/-/g, '–')}
        </span>
    );
}

/** Small reading lines: title left, page range right */
function ReadingLines({ task, done }: { task: string; done: boolean }) {
    const items = parseItems(task);
    if (!items.length) return (
        <p className={`text-[13px] leading-snug mt-1 ${done ? 'line-through text-on-surface/45' : 'text-on-surface/85'}`}>{task}</p>
    );
    return (
        <div className="mt-1">
            {items.map((it, i) => (
                <div key={i} className="flex items-center gap-3 py-[3px]">
                    <span className={`flex-1 min-w-0 truncate text-[13px] leading-snug ${done ? 'line-through text-on-surface/45' : 'text-on-surface/85'}`}>
                        {it.t}
                    </span>
                    {it.pg && <PagePill pg={it.pg} dim={done} />}
                </div>
            ))}
        </div>
    );
}

/** Compact block digest: subject + readings with their page ranges */
function CompactRow({
    slot, date, busy, toggle, meta,
}: {
    slot: Slot; date: string; busy: string | null;
    toggle: (date: string, name: string, cur: boolean) => void;
    meta?: string;
}) {
    const c = subjectColor(slot.subject);
    return (
        <div className={`flex items-start gap-3.5 transition-opacity ${slot.completed ? 'opacity-45' : ''}`}>
            <CheckCircle
                completed={slot.completed}
                loading={busy === `${date}-${slot.name}`}
                hex={c.hex}
                onClick={() => toggle(date, slot.name, slot.completed)}
            />
            <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                    <p className={`text-[10px] font-semibold tracking-[0.09em] uppercase leading-tight ${c.text} ${slot.completed ? 'opacity-60' : ''}`}>
                        {slot.subject}
                    </p>
                    {meta && <span className="text-[11px] text-on-surface-variant/40 tabular-nums flex-shrink-0">{meta}</span>}
                </div>
                <ReadingLines task={slot.task} done={slot.completed} />
            </div>
        </div>
    );
}

/** Checkbox-less list row: the whole row is the tap target.
    Completed rows render struck through (they stay listed for Upcoming;
    Catch up rows leave the list once completed). */
function ListRow({
    slot, date, busy, toggle, meta,
}: {
    slot: Slot; date: string; busy: string | null;
    toggle: (date: string, name: string, cur: boolean) => void;
    meta?: string;
}) {
    const c = subjectColor(slot.subject);
    const isBusy = busy === `${date}-${slot.name}`;
    return (
        <button
            className={`w-full text-left bg-transparent border-0 p-0 cursor-pointer transition-opacity ${
                isBusy ? 'opacity-40' : slot.completed ? 'opacity-45' : ''
            }`}
            onClick={() => toggle(date, slot.name, slot.completed)}
            aria-label={slot.completed ? 'Undo' : 'Mark complete'}
            title={slot.completed ? 'Tap to undo' : 'Tap to mark complete'}
        >
            <div className="flex items-baseline justify-between gap-3">
                <p className={`text-[10px] font-semibold tracking-[0.09em] uppercase leading-tight ${c.text} ${slot.completed ? 'opacity-60' : ''}`}>
                    {slot.subject}
                </p>
                {meta && <span className="text-[11px] text-on-surface-variant/40 tabular-nums flex-shrink-0">{meta}</span>}
            </div>
            <ReadingLines task={slot.task} done={slot.completed} />
        </button>
    );
}

/** Subject filter chips: All + one per subject with count */
function SubjectChips({
    total, counts, active, onSelect,
}: {
    total: number;
    counts: Record<string, number>;
    active: string | null;
    onSelect: (subject: string | null) => void;
}) {
    return (
        <div className="flex gap-2 -mx-4 px-4 overflow-x-auto no-scrollbar pb-1">
            <button
                className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap border-0 cursor-pointer transition-colors ${
                    !active ? 'glass-chip text-on-surface' : 'bg-white/[0.03] text-on-surface-variant/50 hover:text-on-surface-variant/80'
                }`}
                onClick={() => onSelect(null)}
            >
                All {total}
            </button>
            {Object.entries(counts).map(([subj, n]) => {
                const c = subjectColor(subj);
                const isActive = active === subj;
                return (
                    <button
                        key={subj}
                        className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap border-0 cursor-pointer transition-colors flex items-center gap-1.5 ${
                            isActive ? 'glass-chip text-on-surface' : 'bg-white/[0.03] text-on-surface-variant/50 hover:text-on-surface-variant/80'
                        }`}
                        onClick={() => onSelect(isActive ? null : subj)}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'opacity-90' : 'opacity-40'}`} style={{ background: c.hex }} />
                        {subj} · {n}
                    </button>
                );
            })}
        </div>
    );
}

/** Tiny section label */
function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-on-surface-variant/35 mb-3 px-1">
            {children}
        </p>
    );
}

export function TodayView({
    today, todayStr, backlog, upcoming, toggle, busy, streak,
}: {
    today: DayPlan | null;
    todayStr: string;
    backlog: { slot: Slot; date: string }[];
    upcoming: DayPlan[];
    toggle: (date: string, name: string, cur: boolean) => void;
    busy: string | null;
    streak: { current: number; best: number };
}) {
    const [catchUpOpen, setCatchUpOpen] = useState(false);
    const [upcomingOpen, setUpcomingOpen] = useState(false);
    const [showAllBacklog, setShowAllBacklog] = useState(false);
    const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
    const [showAllUpcoming, setShowAllUpcoming] = useState(false);
    const [upcomingFilter, setUpcomingFilter] = useState<string | null>(null);

    const slots = today?.slots ?? [];
    const done = slots.filter(s => s.completed).length;
    const hero = slots.find(s => !s.completed) ?? null;
    const laterToday = slots.filter(s => !s.completed && s !== hero);
    const doneToday = slots.filter(s => s.completed);
    const allDone = slots.length > 0 && done === slots.length;

    const dateStr = today?.date ?? todayStr;
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);

    // Backlog subject counts (insertion order = oldest first appearance)
    const backlogCounts: Record<string, number> = {};
    backlog.forEach(b => { backlogCounts[b.slot.subject] = (backlogCounts[b.slot.subject] || 0) + 1; });
    // A filter pointing at a fully-cleared subject falls back to All
    const activeFilter = subjectFilter && backlogCounts[subjectFilter] ? subjectFilter : null;
    const filteredBacklog = activeFilter ? backlog.filter(b => b.slot.subject === activeFilter) : backlog;
    const visibleBacklog = showAllBacklog ? filteredBacklog : filteredBacklog.slice(0, 5);

    // Pages remaining today, from the "pp.a-b" ranges of incomplete blocks
    const pagesLeft = slots.filter(s => !s.completed).reduce((a, s) => a + pagesInTask(s.task), 0);

    // All scheduled blocks ahead — for working ahead when there's spare time
    const upcomingRows: { slot: Slot; date: string }[] = [];
    for (const day of upcoming) {
        for (const s of day.slots) upcomingRows.push({ slot: s, date: day.date });
    }
    const upcomingCounts: Record<string, number> = {};
    upcomingRows.forEach(r => { upcomingCounts[r.slot.subject] = (upcomingCounts[r.slot.subject] || 0) + 1; });
    const activeUpcomingFilter = upcomingFilter && upcomingCounts[upcomingFilter] ? upcomingFilter : null;
    const filteredUpcoming = activeUpcomingFilter ? upcomingRows.filter(r => r.slot.subject === activeUpcomingFilter) : upcomingRows;
    const visibleUpcoming = showAllUpcoming ? filteredUpcoming : filteredUpcoming.slice(0, 5);
    const fmtUpcoming = (dd: string) => {
        const [uy, um, ud] = dd.split('-').map(Number);
        const dt = new Date(uy, um - 1, ud);
        return `${dt.toLocaleString('default', { weekday: 'short' })} ${dt.getDate()}`;
    };

    // With no backlog, the same slot previews tomorrow's tasks instead
    const nextDay = upcoming.length ? upcoming[0] : null;
    const nextDayLabel = (() => {
        if (!nextDay) return '';
        const [ny, nm, nd] = nextDay.date.split('-').map(Number);
        const ndt = new Date(ny, nm - 1, nd);
        const diff = Math.round((ndt.getTime() - dateObj.getTime()) / 86400000);
        return diff === 1 ? 'Tomorrow' : ndt.toLocaleString('default', { weekday: 'long' });
    })();

    // Oldest backlog day, surfaced on Today so light days end with something actionable.
    // Ticking a row shows the check + strikethrough first, then slides it out and syncs.
    const firstBacklogRows = backlog.length ? backlog.filter(b => b.date === backlog[0].date) : [];
    const [clearing, setClearing] = useState<Set<string>>(new Set());
    const clearingToggle = (date: string, name: string, cur: boolean) => {
        const id = `${date}-${name}`;
        if (clearing.has(id)) return;
        setClearing(prev => new Set(prev).add(id));
        window.setTimeout(() => {
            setClearing(prev => { const n = new Set(prev); n.delete(id); return n; });
            toggle(date, name, cur);
        }, 500);
    };

    const heroColor = hero ? subjectColor(hero.subject) : null;
    const heroItems = hero ? parseItems(hero.task) : [];
    const heroPages = hero ? pagesInTask(hero.task) : 0;
    const heroLoading = hero ? busy === `${dateStr}-${hero.name}` : false;

    return (
        <main className="max-w-[560px] mx-auto pb-16">
            {/* ── Header: date + progress ring ── */}
            <header className="sticky-glass-header bg-[#060808]/70 backdrop-blur-lg md:static md:bg-transparent md:backdrop-blur-none px-6 z-40">
                <div className="flex items-center justify-between gap-4 max-w-[560px] mx-auto">
                    <div className="min-w-0">
                        <p className="text-[13px] text-on-surface-variant/50 font-medium flex items-center gap-2">
                            {dateObj.toLocaleString('default', { weekday: 'long' })}
                            {streak.current > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-amber-200/80">
                                    <span className="material-symbols-outlined text-[14px]">local_fire_department</span>
                                    <span className="text-[12px] font-semibold tabular-nums">{streak.current}</span>
                                </span>
                            )}
                        </p>
                        <h1 className="font-display text-[28px] font-semibold text-on-surface tracking-tight leading-tight">
                            {dateObj.toLocaleString('default', { month: 'long', day: 'numeric' })}
                        </h1>
                    </div>
                    {slots.length > 0 && <ProgressRing done={done} total={slots.length} />}
                </div>
            </header>

            <div className="px-6 pt-2">
                {/* ── Day complete ── */}
                {allDone && (
                    <motion.section
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="glass-card rounded-[24px] px-6 py-9 mb-8 flex flex-col items-center text-center"
                    >
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
                            className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mb-4"
                        >
                            <span className="material-symbols-outlined text-[28px] text-primary">check</span>
                        </motion.div>
                        <h2 className="text-[18px] font-semibold text-on-surface font-display">Day complete</h2>
                        <p className="text-[13px] text-on-surface-variant/55 mt-1">
                            {streak.current > 0 ? `${streak.current}-day streak — see you tomorrow.` : 'See you tomorrow.'}
                        </p>
                    </motion.section>
                )}

                {/* ── Hero: the block to study right now ── */}
                <AnimatePresence mode="popLayout">
                    {hero && heroColor && (
                        <motion.section
                            key={hero.name}
                            layout
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.97 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                            className="glass-card rounded-[26px] relative overflow-hidden mb-8"
                            style={{
                                background: `linear-gradient(140deg, ${heroColor.hex}17 0%, rgba(255,255,255,0.03) 55%)`,
                                border: `1px solid ${heroColor.hex}2b`,
                                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 16px 40px -20px ${heroColor.hex}40`,
                            }}
                        >
                            <div
                                aria-hidden
                                className="absolute -top-28 -right-20 w-72 h-72 rounded-full pointer-events-none"
                                style={{ background: `radial-gradient(circle, ${heroColor.hex} 0%, transparent 65%)`, opacity: 0.14 }}
                            />
                            <div className="relative p-5">
                                {/* Subject as the card's title, Now pill as the state */}
                                <div className="flex items-center justify-between gap-3">
                                    <h2 className="font-display text-[19px] font-semibold text-on-surface tracking-tight min-w-0 truncate">
                                        {hero.subject}
                                    </h2>
                                    <span
                                        className="flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-1.5 flex-shrink-0"
                                        style={{ background: `${heroColor.hex}1f` }}
                                    >
                                        <span className="relative flex w-1.5 h-1.5">
                                            {/* Ripple keyframes start and end at opacity 0 so the loop restart is invisible */}
                                            <motion.span
                                                animate={{ scale: [1, 1, 2.4], opacity: [0, 0.55, 0] }}
                                                transition={{ repeat: Infinity, duration: 2.4, times: [0, 0.3, 1], ease: 'easeOut' }}
                                                className="absolute inset-0 rounded-full"
                                                style={{ background: heroColor.hex }}
                                            />
                                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: heroColor.hex }} />
                                        </span>
                                        <span className="text-[11px] font-semibold leading-none" style={{ color: heroColor.hex }}>Now</span>
                                    </span>
                                </div>

                                <div className="mt-4">
                                    {heroItems.length > 0 ? heroItems.map((it, idx) => (
                                        <div key={idx} className="flex items-start gap-3 py-[5px]">
                                            <span className="flex-1 min-w-0 text-[15px] leading-snug text-on-surface/90">{it.t}</span>
                                            {it.pg && <span className="mt-[2px] flex"><PagePill pg={it.pg} /></span>}
                                        </div>
                                    )) : (
                                        <p className="text-[15px] leading-snug text-on-surface/90 py-[5px]">{hero.task}</p>
                                    )}
                                </div>

                                {/* Footer: quiet meta + one satisfying tap target */}
                                <div className="flex items-center justify-between mt-4">
                                    <span className="text-[12px] text-on-surface-variant/50 tabular-nums">
                                        {heroPages > 0 ? `${heroPages} pages` : ''}
                                    </span>
                                    <motion.button
                                        aria-label="Mark complete"
                                        title="Mark complete"
                                        whileTap={{ scale: 0.92 }}
                                        className="w-[52px] h-[52px] rounded-full flex items-center justify-center cursor-pointer p-0"
                                        style={{
                                            background: `${heroColor.hex}24`,
                                            border: `1.5px solid ${heroColor.hex}59`,
                                            color: heroColor.hex,
                                        }}
                                        onClick={() => toggle(dateStr, hero.name, hero.completed)}
                                    >
                                        {heroLoading ? (
                                            <span className="w-5 h-5 rounded-full border-[1.5px] border-white/25 border-t-white animate-spin" />
                                        ) : (
                                            <span className="material-symbols-outlined text-[26px]">check</span>
                                        )}
                                    </motion.button>
                                </div>
                            </div>
                        </motion.section>
                    )}
                </AnimatePresence>

                {slots.length === 0 && (
                    <section className="glass-card rounded-[24px] p-8 mb-8 text-center">
                        <p className="text-[14px] text-on-surface-variant/55">Nothing scheduled today.</p>
                    </section>
                )}

                {/* ── Up next: one-line digests, details on their turn ── */}
                {laterToday.length > 0 && (
                    <section className="mb-8">
                        <SectionLabel>Up next</SectionLabel>
                        <div className="space-y-2.5">
                            {laterToday.map(slot => (
                                <motion.div layout key={slot.name} className="glass-card rounded-2xl px-4 py-4">
                                    <CompactRow slot={slot} date={dateStr} busy={busy} toggle={toggle} />
                                </motion.div>
                            ))}
                        </div>
                    </section>
                )}

                {/* ── Done today: dimmed, out of the way ── */}
                {doneToday.length > 0 && (
                    <section className="mb-8">
                        <SectionLabel>Done</SectionLabel>
                        <div className="space-y-1 px-1">
                            {doneToday.map(slot => (
                                <motion.div layout key={slot.name} className="py-2">
                                    <CompactRow slot={slot} date={dateStr} busy={busy} toggle={toggle} />
                                </motion.div>
                            ))}
                        </div>
                    </section>
                )}

                {/* ── Oldest backlog day: tick to clear, row celebrates then slides out.
                       With nothing to catch up on, tomorrow's tasks show here instead. ── */}
                {firstBacklogRows.length > 0 ? (
                    <section className="mb-2">
                        <SectionLabel>Catch up · {fmtShort(firstBacklogRows[0].date)}</SectionLabel>
                        <div className="glass-card rounded-2xl px-4 py-1 overflow-hidden">
                            <AnimatePresence initial={false} mode="popLayout">
                                {firstBacklogRows.map(item => {
                                    const id = `${item.date}-${item.slot.name}`;
                                    return (
                                        <motion.div
                                            key={id}
                                            layout
                                            exit={{ opacity: 0, x: 56, scale: 0.97, transition: { duration: 0.3, ease: [0.4, 0, 1, 1] } }}
                                            className="py-3 border-b border-white/[0.05] last:border-0"
                                        >
                                            <CompactRow
                                                slot={{ ...item.slot, completed: clearing.has(id) }}
                                                date={item.date}
                                                busy={busy}
                                                toggle={clearingToggle}
                                            />
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    </section>
                ) : nextDay && nextDay.slots.length > 0 ? (
                    <section className="mb-2">
                        <SectionLabel>{nextDayLabel}</SectionLabel>
                        <div className="glass-card rounded-2xl px-4 py-1">
                            {nextDay.slots.map(slot => (
                                <div key={slot.name} className="py-3 border-b border-white/[0.05] last:border-0">
                                    <ListRow slot={slot} date={nextDay.date} busy={busy} toggle={toggle} />
                                </div>
                            ))}
                        </div>
                    </section>
                ) : null}

                {/* ── Catch up / Upcoming: quiet stat cards, expand on tap ── */}
                {(backlog.length > 0 || upcomingRows.length > 0) && (
                    <section className="mt-10">
                        <div className={`grid gap-3 ${backlog.length > 0 && upcomingRows.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            {backlog.length > 0 && (
                                <button
                                    className={`glass-card rounded-[20px] p-4 text-left border-0 cursor-pointer transition-colors ${catchUpOpen ? 'bg-white/[0.06]' : ''}`}
                                    onClick={() => { setCatchUpOpen(o => !o); setUpcomingOpen(false); }}
                                    aria-expanded={catchUpOpen}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-[12px] font-medium text-on-surface-variant/60">Catch up</span>
                                        <span className={`material-symbols-outlined text-[18px] text-on-surface-variant/35 transition-transform duration-300 ${catchUpOpen ? 'rotate-180' : ''}`}>
                                            expand_more
                                        </span>
                                    </div>
                                    <div className="font-display text-[26px] font-semibold text-on-surface tabular-nums mt-1 leading-none">
                                        {backlog.length}
                                    </div>
                                    <div className="text-[11px] text-on-surface-variant/40 mt-1.5">oldest {fmtShort(backlog[0].date)}</div>
                                </button>
                            )}
                            {upcomingRows.length > 0 && (
                                <button
                                    className={`glass-card rounded-[20px] p-4 text-left border-0 cursor-pointer transition-colors ${upcomingOpen ? 'bg-white/[0.06]' : ''}`}
                                    onClick={() => { setUpcomingOpen(o => !o); setCatchUpOpen(false); }}
                                    aria-expanded={upcomingOpen}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-[12px] font-medium text-on-surface-variant/60">Upcoming</span>
                                        <span className={`material-symbols-outlined text-[18px] text-on-surface-variant/35 transition-transform duration-300 ${upcomingOpen ? 'rotate-180' : ''}`}>
                                            expand_more
                                        </span>
                                    </div>
                                    <div className="font-display text-[26px] font-semibold text-on-surface tabular-nums mt-1 leading-none">
                                        {upcomingRows.length}
                                    </div>
                                    <div className="text-[11px] text-on-surface-variant/40 mt-1.5">from {fmtUpcoming(upcomingRows[0].date)}</div>
                                </button>
                            )}
                        </div>

                        {/* Expanded backlog panel */}
                        <AnimatePresence initial={false}>
                            {catchUpOpen && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                                    className="overflow-hidden"
                                >
                                    <div className="glass-card rounded-[20px] px-4 py-4 mt-3">
                                        {/* Subject filter — focus one subject at a time */}
                                        <SubjectChips
                                            total={backlog.length}
                                            counts={backlogCounts}
                                            active={activeFilter}
                                            onSelect={s => { setSubjectFilter(s); setShowAllBacklog(false); }}
                                        />

                                        <div className="mt-1 divide-y divide-white/[0.05]">
                                            {visibleBacklog.map(item => (
                                                <div key={`${item.date}-${item.slot.name}`} className="py-3">
                                                    <ListRow
                                                        slot={item.slot}
                                                        date={item.date}
                                                        busy={busy}
                                                        toggle={toggle}
                                                        meta={fmtShort(item.date)}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                        {filteredBacklog.length > 5 && !showAllBacklog && (
                                            <button
                                                className="w-full pt-3 pb-1 text-[12px] font-medium text-on-surface-variant/50 hover:text-on-surface-variant/80 bg-transparent border-0 cursor-pointer"
                                                onClick={() => setShowAllBacklog(true)}
                                            >
                                                Show all {filteredBacklog.length}
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Expanded upcoming panel */}
                        <AnimatePresence initial={false}>
                            {upcomingOpen && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                                    className="overflow-hidden"
                                >
                                    <div className="glass-card rounded-[20px] px-4 py-4 mt-3">
                                        {/* Subject filter — focus one subject at a time */}
                                        <SubjectChips
                                            total={upcomingRows.length}
                                            counts={upcomingCounts}
                                            active={activeUpcomingFilter}
                                            onSelect={s => { setUpcomingFilter(s); setShowAllUpcoming(false); }}
                                        />

                                        <div className="mt-1 divide-y divide-white/[0.05]">
                                            {visibleUpcoming.map(item => (
                                                <div key={`${item.date}-${item.slot.name}`} className="py-3">
                                                    <ListRow
                                                        slot={item.slot}
                                                        date={item.date}
                                                        busy={busy}
                                                        toggle={toggle}
                                                        meta={fmtUpcoming(item.date)}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                        {filteredUpcoming.length > 5 && !showAllUpcoming && (
                                            <button
                                                className="w-full pt-3 pb-1 text-[12px] font-medium text-on-surface-variant/50 hover:text-on-surface-variant/80 bg-transparent border-0 cursor-pointer"
                                                onClick={() => setShowAllUpcoming(true)}
                                            >
                                                Show all {filteredUpcoming.length}
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </section>
                )}
            </div>
        </main>
    );
}
