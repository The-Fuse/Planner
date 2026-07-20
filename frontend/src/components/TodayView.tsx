import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API } from '../api';
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

/** "45 min" / "1h 20m" */
function fmtMinutes(min: number) {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
}

/** Lazily created (and iOS-unlocked from a tap) shared audio context */
let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { /* needs gesture */ });
    return audioCtx;
}

/** Soft two-note chime: descending into a break, ascending back to focus */
function playChime(kind: 'break' | 'focus') {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const notes = kind === 'break' ? [783.99, 523.25] : [523.25, 783.99]; // G5→C5 / C5→G5
    notes.forEach((freq, i) => {
        const t0 = ctx.currentTime + i * 0.22;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.1, t0 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 1.2);
    });
}

/** Per-task studied seconds, persisted on device */
const STUDY_KEY = 'planner-study-time-v1';
function loadStudyTime(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(STUDY_KEY) || '{}'); } catch { return {}; }
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

/** Tap-to-complete circle; doubles as a study-time progress ring */
function CheckCircle({
    completed, loading, hex, onClick, size = 22, progress = 0,
}: {
    completed: boolean; loading: boolean; hex: string;
    onClick: () => void; size?: number;
    /** 0..1 share of the planned time already studied */
    progress?: number;
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
            {!completed && progress > 0 && (
                <svg className="absolute inset-0 -rotate-90 pointer-events-none" viewBox="0 0 22 22" aria-hidden>
                    <circle
                        cx="11" cy="11" r="10.25" fill="none"
                        stroke={hex} strokeWidth="1.5" strokeLinecap="round"
                        pathLength={100}
                        strokeDasharray={`${Math.max(2, Math.round(Math.min(progress, 1) * 100))} 100`}
                        opacity="0.9"
                    />
                </svg>
            )}
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
    const t = pg.replace('pp.', '');
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    const label = m && m[1] === m[2] ? m[1] : t.replace(/-/g, '–');
    return (
        <span className={`flex-shrink-0 text-[10.5px] font-medium tabular-nums rounded-full px-2 py-[3px] leading-none ${
            dim ? 'text-on-surface-variant/35 bg-white/[0.04]' : 'text-on-surface-variant/75 bg-white/[0.07]'
        }`}>
            {label}
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

/** Compact block digest: subject + readings with their page ranges.
    Circle completes; the row body (when onFocus is given) starts a session. */
function CompactRow({
    slot, date, busy, toggle, meta, progress = 0, onFocus,
}: {
    slot: Slot; date: string; busy: string | null;
    toggle: (date: string, name: string, cur: boolean) => void;
    meta?: string;
    progress?: number;
    onFocus?: () => void;
}) {
    const c = subjectColor(slot.subject);
    return (
        <div className={`flex items-start gap-3.5 transition-opacity ${slot.completed ? 'opacity-45' : ''}`}>
            <CheckCircle
                completed={slot.completed}
                loading={busy === `${date}-${slot.name}`}
                hex={c.hex}
                progress={progress}
                onClick={() => toggle(date, slot.name, slot.completed)}
            />
            <div
                className={`flex-1 min-w-0 ${onFocus && !slot.completed ? 'cursor-pointer' : ''}`}
                onClick={onFocus && !slot.completed ? onFocus : undefined}
                title={onFocus && !slot.completed ? 'Start focus session' : undefined}
            >
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
    slot, date, busy, toggle, meta, armed = false,
}: {
    slot: Slot; date: string; busy: string | null;
    toggle: (date: string, name: string, cur: boolean) => void;
    meta?: string;
    /** Two-tap confirm state: first tap arms the row, second completes */
    armed?: boolean;
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
                {armed ? (
                    <span className="text-[11px] font-medium text-primary flex-shrink-0">Tap again to confirm</span>
                ) : meta ? (
                    <span className="text-[11px] text-on-surface-variant/50 tabular-nums flex-shrink-0">{meta}</span>
                ) : null}
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
                className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap border-0 cursor-pointer transition-[color,transform] active:scale-95 ${
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
                        className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap border-0 cursor-pointer transition-[color,transform] active:scale-95 flex items-center gap-1.5 ${
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
        <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-on-surface-variant/50 mb-3 px-1">
            {children}
        </p>
    );
}

/** Pomodoro focus session: 25 min focus / 5 min break cycles.
    Focus seconds are reported up via onStudyTick and persisted per task. */
const FOCUS_SECS = 25 * 60;
const BREAK_SECS = 5 * 60;
const BREAK_HEX = '#68d3ff';

function FocusSheet({
    slot, studiedSeconds, onStudyTick, onClose, onDone, busy,
}: {
    slot: Slot; studiedSeconds: number; onStudyTick: () => void;
    onClose: () => void; onDone: () => void; busy: boolean;
}) {
    const [phase, setPhase] = useState<'focus' | 'break'>('focus');
    const [phaseElapsed, setPhaseElapsed] = useState(0);
    const [paused, setPaused] = useState(false);
    const [cycles, setCycles] = useState(0);

    // Parent recreates onStudyTick every render (state update per tick);
    // route through a ref so the interval isn't torn down each second
    const tickRef = useRef(onStudyTick);
    tickRef.current = onStudyTick;

    const phaseLen = phase === 'focus' ? FOCUS_SECS : BREAK_SECS;

    useEffect(() => {
        if (paused) return;
        const t = window.setInterval(() => {
            if (phase === 'focus') tickRef.current();
            setPhaseElapsed(e => e + 1);
        }, 1000);
        return () => window.clearInterval(t);
    }, [paused, phase]);

    // Phase rollover — with a chime so eyes can stay on the book
    useEffect(() => {
        if (phaseElapsed < phaseLen) return;
        if (phase === 'focus') { setCycles(c => c + 1); setPhase('break'); playChime('break'); }
        else { setPhase('focus'); playChime('focus'); }
        setPhaseElapsed(0);
    }, [phaseElapsed, phaseLen, phase]);

    const c = subjectColor(slot.subject);
    const items = parseItems(slot.task);
    const remaining = Math.max(0, phaseLen - phaseElapsed);
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(remaining % 60).padStart(2, '0');
    const onBreak = phase === 'break';
    const phaseHex = onBreak ? BREAK_HEX : c.hex;
    const studiedMin = Math.floor(studiedSeconds / 60);

    return (
        <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="fixed inset-0 z-[70] flex flex-col bg-[#060808]/95 backdrop-blur-2xl px-8 pb-10 pt-[calc(env(safe-area-inset-top)+1.5rem)]"
        >
            <div className="flex justify-end">
                <button
                    aria-label="Close focus session"
                    className="w-10 h-10 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70"
                    onClick={onClose}
                >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center text-center min-h-0">
                <p className={`text-[11px] font-semibold tracking-[0.14em] uppercase ${c.text} opacity-80`}>{slot.name}</p>
                <h2 className="font-display text-[24px] font-semibold text-on-surface tracking-tight mt-1.5">{slot.subject}</h2>

                <div className="mt-5 space-y-2 max-w-[320px] w-full">
                    {items.length ? items.map((it, i) => (
                        <div key={i} className="flex items-center justify-center gap-3">
                            <span className="text-[14px] leading-snug text-on-surface/75 min-w-0">{it.t}</span>
                            {it.pg && <PagePill pg={it.pg} />}
                        </div>
                    )) : (
                        <p className="text-[14px] leading-snug text-on-surface/75">{slot.task}</p>
                    )}
                </div>

                {/* Phase chip */}
                <span
                    className="mt-9 rounded-full px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase leading-none"
                    style={{ background: `${phaseHex}1f`, color: phaseHex }}
                >
                    {onBreak ? 'Break' : 'Focus'}
                </span>

                {/* Countdown — tap to pause/resume */}
                <button
                    className={`bg-transparent border-0 p-0 cursor-pointer font-display text-[64px] font-semibold tabular-nums tracking-tight mt-3 leading-none transition-opacity ${paused ? 'opacity-40' : 'opacity-100'} text-on-surface`}
                    onClick={() => setPaused(p => !p)}
                    aria-label={paused ? 'Resume timer' : 'Pause timer'}
                >
                    {mm}:{ss}
                </button>
                <p className="text-[12px] text-on-surface-variant/50 mt-2.5 tabular-nums">
                    {paused ? 'Paused — tap the timer to resume'
                        : `studied ${fmtMinutes(Math.max(studiedMin, 0))}${typeof slot.minutes === 'number' && slot.minutes > 0 ? ` · planned ~${fmtMinutes(slot.minutes)}` : ''}`}
                </p>

                {/* Completed pomodoros */}
                {cycles > 0 && (
                    <div className="flex gap-1.5 mt-4">
                        {Array.from({ length: Math.min(cycles, 8) }).map((_, i) => (
                            <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: c.hex, opacity: 0.85 }} />
                        ))}
                    </div>
                )}

                {onBreak && (
                    <button
                        className="mt-4 bg-transparent border-0 cursor-pointer text-[12px] font-medium text-on-surface-variant/50 hover:text-on-surface-variant/80"
                        onClick={() => { setPhase('focus'); setPhaseElapsed(0); playChime('focus'); }}
                    >
                        Skip break
                    </button>
                )}
            </div>

            <button
                className="w-full rounded-full py-4 text-[15px] font-semibold border-0 cursor-pointer flex items-center justify-center gap-2 active:scale-[0.985] transition-transform"
                style={{ background: `${c.hex}26`, border: `1.5px solid ${c.hex}59`, color: c.hex }}
                onClick={onDone}
            >
                {busy ? (
                    <span className="w-4 h-4 rounded-full border-[1.5px] border-white/25 border-t-white animate-spin" />
                ) : (
                    <span className="material-symbols-outlined text-[20px]">check</span>
                )}
                Mark complete
            </button>
        </motion.div>
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
    const [backlogVisible, setBacklogVisible] = useState(5);
    const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
    const [upcomingVisible, setUpcomingVisible] = useState(5);
    const [upcomingFilter, setUpcomingFilter] = useState<string | null>(null);
    // Focus session target + studied time per task ("date_slot" → seconds).
    // localStorage is the offline cache; the backend is the source of truth,
    // merged key-wise by max so no device ever loses recorded time.
    const [focusTarget, setFocusTarget] = useState<{ slot: Slot; date: string } | null>(null);
    const [studyTime, setStudyTime] = useState<Record<string, number>>(loadStudyTime);
    const studyTimeRef = useRef(studyTime);
    studyTimeRef.current = studyTime;
    const lastSynced = useRef<Record<string, number>>({});

    useEffect(() => {
        axios.get(`${API}/api/study-time`).then(res => {
            const server: Record<string, number> = res.data && typeof res.data === 'object' ? res.data : {};
            lastSynced.current = { ...server };
            setStudyTime(prev => {
                const merged = { ...prev };
                Object.entries(server).forEach(([k, v]) => { merged[k] = Math.max(merged[k] || 0, Number(v) || 0); });
                return merged;
            });
        }).catch(() => { /* offline — local cache carries on */ });
    }, []);

    const pushStudy = (key: string, seconds: number) => {
        lastSynced.current[key] = seconds;
        axios.post(`${API}/api/study-time`, null, { params: { key, seconds } })
            .catch(() => { lastSynced.current[key] = Math.min(lastSynced.current[key] ?? 0, seconds - 1); });
    };
    const flushStudy = () => {
        Object.entries(studyTimeRef.current).forEach(([k, sec]) => {
            if ((lastSynced.current[k] ?? 0) < sec) pushStudy(k, sec);
        });
    };

    useEffect(() => {
        try { localStorage.setItem(STUDY_KEY, JSON.stringify(studyTime)); } catch { /* quota */ }
        // Throttled backend sync: push a key once it has advanced ≥15s
        Object.entries(studyTime).forEach(([k, sec]) => {
            if (sec - (lastSynced.current[k] ?? 0) >= 15) pushStudy(k, sec);
        });
    }, [studyTime]);

    // Flush pending seconds when a session closes or the app is backgrounded
    useEffect(() => { if (!focusTarget) flushStudy(); }, [focusTarget]);
    useEffect(() => {
        const onHide = () => { if (document.visibilityState === 'hidden') flushStudy(); };
        document.addEventListener('visibilitychange', onHide);
        return () => document.removeEventListener('visibilitychange', onHide);
    }, []);
    const studyKeyOf = (date: string, name: string) => `${date}_${name}`;
    // Opening a session is a tap — the moment to unlock audio on iOS
    const openFocus = (slot: Slot, date: string) => {
        getAudioCtx();
        setFocusTarget({ slot, date });
    };
    const addStudySecond = (key: string) =>
        setStudyTime(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
    /** 0..1 share of planned time already studied (0 when done or unplanned) */
    const progressOf = (slot: Slot, date: string) => {
        if (!slot.minutes || slot.completed) return 0;
        return Math.min(1, (studyTime[studyKeyOf(date, slot.name)] || 0) / (slot.minutes * 60));
    };

    // Two-tap confirm for tomorrow's always-visible rows — a stray scroll tap
    // must not silently complete tomorrow's reading
    const [armedId, setArmedId] = useState<string | null>(null);
    const armTimer = useRef<number | undefined>(undefined);
    const confirmToggle = (date: string, name: string, cur: boolean) => {
        if (cur) { toggle(date, name, cur); return; }
        const id = `${date}-${name}`;
        window.clearTimeout(armTimer.current);
        if (armedId === id) {
            setArmedId(null);
            toggle(date, name, cur);
            return;
        }
        setArmedId(id);
        armTimer.current = window.setTimeout(() => setArmedId(null), 2500);
    };

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
    const visibleBacklog = filteredBacklog.slice(0, backlogVisible);

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
    const visibleUpcoming = filteredUpcoming.slice(0, upcomingVisible);
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
                            className="glass-card rounded-[24px] relative overflow-hidden mb-8 cursor-pointer"
                            style={{
                                background: `linear-gradient(140deg, ${heroColor.hex}17 0%, rgba(255,255,255,0.03) 55%)`,
                                border: `1px solid ${heroColor.hex}2b`,
                                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 16px 40px -20px ${heroColor.hex}40`,
                            }}
                            whileTap={{ scale: 0.99 }}
                            onClick={() => openFocus(hero, dateStr)}
                        >
                            <div
                                aria-hidden
                                className="absolute -top-28 -right-20 w-72 h-72 rounded-full pointer-events-none"
                                style={{ background: `radial-gradient(circle, ${heroColor.hex} 0%, transparent 65%)`, opacity: 0.14 }}
                            />
                            <div className="relative p-5">
                                {/* Slot identity, then subject as the card's title, Now pill as the state */}
                                <p className="text-[10px] font-semibold tracking-[0.14em] uppercase text-on-surface-variant/50 mb-1">
                                    {hero.name}
                                </p>
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

                                {/* Studied time: same hairline bar language as the Subjects screen */}
                                {progressOf(hero, dateStr) > 0 && (
                                    <div className="mt-4 h-1 rounded-full bg-white/[0.07] overflow-hidden">
                                        <div
                                            className="h-full rounded-full"
                                            style={{
                                                width: `${Math.max(2, Math.round(progressOf(hero, dateStr) * 100))}%`,
                                                background: heroColor.hex,
                                                opacity: 0.75,
                                                transition: 'width 0.6s cubic-bezier(0.25, 1, 0.5, 1)',
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Footer: quiet meta + one satisfying tap target */}
                                <div className="flex items-center justify-between mt-4">
                                    <span className="text-[12px] text-on-surface-variant/50 tabular-nums">
                                        {heroPages > 0 ? `${heroPages} pages` : ''}
                                        {heroPages > 0 && typeof hero.minutes === 'number' && hero.minutes > 0 ? ` · ~${fmtMinutes(hero.minutes)}` : ''}
                                        {(studyTime[studyKeyOf(dateStr, hero.name)] || 0) >= 60
                                            ? ` · ${fmtMinutes(Math.floor((studyTime[studyKeyOf(dateStr, hero.name)] || 0) / 60))} studied`
                                            : ''}
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
                                        onClick={e => { e.stopPropagation(); toggle(dateStr, hero.name, hero.completed); }}
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
                        <p className="text-[16px] font-display font-semibold text-on-surface/85">Rest day</p>
                        <p className="text-[13px] text-on-surface-variant/55 mt-1.5">
                            {nextDay && nextDay.slots.length > 0
                                ? `${nextDayLabel}: ${nextDay.slots[0].subject}${nextDay.slots.length > 1 ? ` +${nextDay.slots.length - 1} more` : ''}`
                                : 'Nothing scheduled.'}
                        </p>
                    </section>
                )}

                {/* ── Up next: one-line digests, details on their turn ── */}
                {laterToday.length > 0 && (
                    <section className="mb-8">
                        <SectionLabel>Up next</SectionLabel>
                        <div className="space-y-2.5">
                            {laterToday.map(slot => (
                                <motion.div layout key={slot.name} className="glass-card rounded-2xl px-4 py-4">
                                    <CompactRow
                                        slot={slot} date={dateStr} busy={busy} toggle={toggle} meta={slot.name}
                                        progress={progressOf(slot, dateStr)}
                                        onFocus={() => openFocus(slot, dateStr)}
                                    />
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
                                                progress={progressOf(item.slot, item.date)}
                                                onFocus={() => openFocus(item.slot, item.date)}
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
                                    <ListRow
                                        slot={slot}
                                        date={nextDay.date}
                                        busy={busy}
                                        toggle={confirmToggle}
                                        meta={slot.name}
                                        armed={armedId === `${nextDay.date}-${slot.name}`}
                                    />
                                </div>
                            ))}
                        </div>
                    </section>
                ) : null}

                {/* ── Catch up / Upcoming: quiet stat cards, expand on tap ── */}
                {(backlog.length > 0 || upcomingRows.length > 0) && (
                    <section className="mt-10">
                        {(() => {
                            const both = backlog.length > 0 && upcomingRows.length > 0;
                            const tile = (
                                label: string, count: number, meta: string,
                                open: boolean, onClick: () => void,
                            ) => both ? (
                                <button
                                    key={label}
                                    className={`glass-card rounded-2xl p-4 text-left border-0 cursor-pointer transition-colors active:scale-[0.985] ${open ? 'bg-white/[0.06]' : ''}`}
                                    onClick={onClick}
                                    aria-expanded={open}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-[12px] font-medium text-on-surface-variant/60">{label}</span>
                                        <span className={`material-symbols-outlined text-[18px] text-on-surface-variant/50 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>
                                            expand_more
                                        </span>
                                    </div>
                                    <div className="font-display text-[26px] font-semibold text-on-surface tabular-nums mt-1 leading-none">
                                        {count}
                                    </div>
                                    <div className="text-[11px] text-on-surface-variant/50 mt-1.5">{meta}</div>
                                </button>
                            ) : (
                                /* Lone list — a slim row, not a giant tile for one number */
                                <button
                                    key={label}
                                    className={`glass-card rounded-2xl px-5 py-4 w-full flex items-center gap-3 text-left border-0 cursor-pointer transition-colors active:scale-[0.985] ${open ? 'bg-white/[0.06]' : ''}`}
                                    onClick={onClick}
                                    aria-expanded={open}
                                >
                                    <span className="text-[13px] font-medium text-on-surface/85">{label}</span>
                                    <span className="text-[13px] font-semibold text-on-surface tabular-nums">{count}</span>
                                    <span className="flex-1 text-[12px] text-on-surface-variant/50">{meta}</span>
                                    <span className={`material-symbols-outlined text-[18px] text-on-surface-variant/50 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>
                                        expand_more
                                    </span>
                                </button>
                            );
                            return (
                                <div className={`grid gap-3 ${both ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                    {backlog.length > 0 && tile(
                                        'Catch up', backlog.length, `oldest ${fmtShort(backlog[0].date)}`,
                                        catchUpOpen, () => { setCatchUpOpen(o => !o); setUpcomingOpen(false); },
                                    )}
                                    {upcomingRows.length > 0 && tile(
                                        'Upcoming', upcomingRows.length, `from ${fmtUpcoming(upcomingRows[0].date)}`,
                                        upcomingOpen, () => { setUpcomingOpen(o => !o); setCatchUpOpen(false); },
                                    )}
                                </div>
                            );
                        })()}

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
                                    <div className="glass-card rounded-2xl px-4 py-4 mt-3">
                                        {/* Subject filter — focus one subject at a time */}
                                        <SubjectChips
                                            total={backlog.length}
                                            counts={backlogCounts}
                                            active={activeFilter}
                                            onSelect={s => { setSubjectFilter(s); setBacklogVisible(5); }}
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
                                        {filteredBacklog.length > backlogVisible && (
                                            <button
                                                className="w-full pt-3 pb-1 text-[12px] font-medium text-on-surface-variant/50 hover:text-on-surface-variant/80 bg-transparent border-0 cursor-pointer"
                                                onClick={() => setBacklogVisible(c => c + 25)}
                                            >
                                                Show more · {filteredBacklog.length - backlogVisible} left
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
                                    <div className="glass-card rounded-2xl px-4 py-4 mt-3">
                                        {/* Subject filter — focus one subject at a time */}
                                        <SubjectChips
                                            total={upcomingRows.length}
                                            counts={upcomingCounts}
                                            active={activeUpcomingFilter}
                                            onSelect={s => { setUpcomingFilter(s); setUpcomingVisible(5); }}
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
                                        {filteredUpcoming.length > upcomingVisible && (
                                            <button
                                                className="w-full pt-3 pb-1 text-[12px] font-medium text-on-surface-variant/50 hover:text-on-surface-variant/80 bg-transparent border-0 cursor-pointer"
                                                onClick={() => setUpcomingVisible(c => c + 25)}
                                            >
                                                Show more · {filteredUpcoming.length - upcomingVisible} left
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </section>
                )}
            </div>

            {/* ── Focus session ── */}
            <AnimatePresence>
                {focusTarget && (
                    <FocusSheet
                        slot={focusTarget.slot}
                        studiedSeconds={studyTime[studyKeyOf(focusTarget.date, focusTarget.slot.name)] || 0}
                        onStudyTick={() => addStudySecond(studyKeyOf(focusTarget.date, focusTarget.slot.name))}
                        busy={busy === `${focusTarget.date}-${focusTarget.slot.name}`}
                        onClose={() => setFocusTarget(null)}
                        onDone={() => {
                            toggle(focusTarget.date, focusTarget.slot.name, focusTarget.slot.completed);
                            setFocusTarget(null);
                        }}
                    />
                )}
            </AnimatePresence>
        </main>
    );
}
