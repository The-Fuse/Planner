import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import axios from 'axios';
import { API } from '../api';
import { DayPlan, Slot } from '../interfaces';
import { parseItems } from './TaskContent';
import { subjectColor } from '../subjectColors';
import { useSettings } from '../settings';
import { calibratedMinutes, pagesInTask, fmtMinutes } from '../insights';
import { dueRevisions } from '../revision';
import { ensurePermission, schedulePhaseEnd, cancelPhaseEnd } from '../notify';


/** Task's page span: min start, max end, and pages treated as one continuous range */
function pageRangeOf(task: string) {
    let minStart = Infinity, maxEnd = 0;
    const re = /pp\.(\d+)\s*-\s*(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(task)) !== null) {
        const a = Number(m[1]), b = Number(m[2]);
        if (a < minStart) minStart = a;
        if (b > maxEnd) maxEnd = b;
    }
    if (!isFinite(minStart)) minStart = 0;
    const total = maxEnd > 0 ? maxEnd - minStart + 1 : 0;
    return { minStart, maxEnd, total };
}

function fmtShort(d: string) {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleString('default', { month: 'short', day: 'numeric' });
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

/** Looping brown-noise bed — lowpassed and quiet, a soft focus room tone */
let ambientNodes: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
function startAmbient() {
    const ctx = getAudioCtx();
    if (!ctx || ambientNodes) return;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5; // brown noise, roughly normalised
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.value = 0.04;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    ambientNodes = { src, gain, filter };
}
function stopAmbient() {
    if (!ambientNodes) return;
    try { ambientNodes.src.stop(); } catch { /* already stopped */ }
    ambientNodes.src.disconnect();
    ambientNodes.filter.disconnect();
    ambientNodes.gain.disconnect();
    ambientNodes = null;
}

/** Per-task studied seconds, persisted on device */
const STUDY_KEY = 'planner-study-time-v1';
function loadStudyTime(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(STUDY_KEY) || '{}'); } catch { return {}; }
}

/** Per-task last page reached, persisted on device */
const PAGES_KEY = 'planner-pages-v1';
function loadTaskPages(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(PAGES_KEY) || '{}'); } catch { return {}; }
}

/** Revision done-flags per revision key, persisted on device */
const REVISIONS_KEY = 'planner-revisions-v1';
function loadRevisions(): Record<string, boolean> {
    try { return JSON.parse(localStorage.getItem(REVISIONS_KEY) || '{}'); } catch { return {}; }
}

/** Habit marks (newspaper, answer writing) keyed like "habit_..._slot", on device */
const HABITS_KEY = 'planner-habits-v1';
function loadHabits(): Record<string, boolean> {
    try { return JSON.parse(localStorage.getItem(HABITS_KEY) || '{}'); } catch { return {}; }
}

/** ISO-8601 week id, e.g. "2026-W30" — Monday-first, week 1 holds the year's first Thursday */
function isoWeekId(d: Date): string {
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = dt.getUTCDay() || 7; // Sun=0 → 7
    dt.setUTCDate(dt.getUTCDate() + 4 - day); // shift to the week's Thursday
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
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
/** iOS-style swipe row: drag the card left to reveal trailing action(s).
    Actions snap open past a threshold; tapping one runs it and closes. */
function SwipeRow({
    children, actions, radius = 16, shadow, border,
}: {
    children: React.ReactNode;
    actions: { icon: string; label: string; hex: string; onAction: () => void }[];
    radius?: number;
    /** Override the container's lift shadow (e.g. the hero's colored glow) */
    shadow?: string;
    /** Border on the rounded container (so it follows the corners cleanly) */
    border?: string;
}) {
    const panelW = 76 * actions.length;
    const x = useMotionValue(0);
    // Actions stay hidden until the drag pulls the card in — otherwise their
    // tint bleeds through the translucent glass card at rest.
    const panelOpacity = useTransform(x, [-panelW, -8, 0], [1, 1, 0]);

    const close = () => animate(x, 0, { type: 'spring', stiffness: 500, damping: 44 });
    const open = () => animate(x, -panelW, { type: 'spring', stiffness: 500, damping: 44 });

    return (
        // Container owns the corner radius and clips square children, so the
        // action panel's edge meets the card flush (no rounded-corner gap).
        <div
            className="relative overflow-hidden"
            style={{
                borderRadius: radius,
                // Only the outer lift/glow here — the glass edge is an overlay
                // below, because a child's backdrop-filter paints over insets.
                boxShadow: shadow ?? '0 8px 24px -16px rgba(0,0,0,0.4)',
            }}
        >
            {/* Trailing actions, revealed from the right */}
            <motion.div className="absolute inset-y-0 right-0 flex" style={{ width: panelW, opacity: panelOpacity }}>
                {actions.map((a, i) => (
                    <button
                        key={i}
                        aria-label={a.label}
                        className="flex-1 flex flex-col items-center justify-center gap-1 border-0 cursor-pointer active:brightness-110"
                        style={{ background: `${a.hex}26`, color: a.hex }}
                        onClick={() => { a.onAction(); close(); }}
                    >
                        <span className="material-symbols-outlined text-[20px]">{a.icon}</span>
                        <span className="text-[10px] font-semibold tracking-wide">{a.label}</span>
                    </button>
                ))}
            </motion.div>
            {/* Draggable content sits on top and covers the actions when closed */}
            <motion.div
                drag="x"
                dragConstraints={{ left: -panelW, right: 0 }}
                dragElastic={0.06}
                dragMomentum={false}
                style={{ x, touchAction: 'pan-y' }}
                onDragEnd={(_, info) => {
                    if (info.offset.x < -panelW / 2 || info.velocity.x < -400) open();
                    else close();
                }}
                className="relative"
            >
                {children}
            </motion.div>
            {/* Glass edge drawn above the content so the card's backdrop-filter
                can't paint over it, and it traces the container's radius.
                Matches .glass-card exactly: hairline top edge, no border. */}
            <div
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{
                    borderRadius: radius,
                    border,
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                }}
            />
        </div>
    );
}

function CompactRow({
    slot, date, busy, toggle, meta, progress = 0, onFocus, storedPage,
}: {
    slot: Slot; date: string; busy: string | null;
    toggle: (date: string, name: string, cur: boolean) => void;
    meta?: string;
    progress?: number;
    onFocus?: () => void;
    /** Last page recorded on this task — shown passively when set */
    storedPage?: number;
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
                    <span className="flex items-baseline gap-2 flex-shrink-0 tabular-nums">
                        {storedPage && !slot.completed && (
                            <span className="text-[11px] font-medium" style={{ color: c.hex }}>p.{storedPage}</span>
                        )}
                        {meta && <span className="text-[11px] text-on-surface-variant/40">{meta}</span>}
                    </span>
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
const BREAK_HEX = '#68d3ff';

function FocusSheet({
    slot, studiedSeconds, onStudyTick, onClose, onDone, onStopHere, busy, pace,
}: {
    slot: Slot; studiedSeconds: number; onStudyTick: () => void;
    onClose: () => void; onDone: () => void;
    /** Record the page stopped at, then close without completing */
    onStopHere: (page: number) => void;
    busy: boolean;
    /** Learned per-subject pace, for a calibrated "planned ~" estimate */
    pace: Record<string, number>;
}) {
    const [settings, setSettings] = useSettings();
    const [phase, setPhase] = useState<'focus' | 'break'>('focus');
    // Timestamp-driven countdown: wall-clock survives a suspended/locked phone.
    // phaseStartedAt = when the current running span began; phaseBaseElapsed =
    // seconds already banked in this phase before that span (for pause support).
    const [phaseStartedAt, setPhaseStartedAt] = useState(() => Date.now());
    const [phaseBaseElapsed, setPhaseBaseElapsed] = useState(0);
    // Pure re-render heartbeat — the countdown VALUE derives from timestamps,
    // not from counting these ticks.
    const [, setTick] = useState(0);
    const [paused, setPaused] = useState(false);
    const [cycles, setCycles] = useState(0);
    // Focus seconds accumulated this session — gates the "where did you stop?" step
    const [sessionSecs, setSessionSecs] = useState(0);
    // "Where did you stop?" interstitial + the page being picked
    const pageRange = pageRangeOf(slot.task);
    const hasPages = pageRange.total > 0;
    const [ending, setEnding] = useState(false);
    const [page, setPage] = useState(pageRange.maxEnd);
    // "Recall the main points" moment after a long, finished session
    const [recall, setRecall] = useState(false);
    const [recallLeft, setRecallLeft] = useState(60);
    // Every 4th focus phase earns the longer break
    const [longBreak, setLongBreak] = useState(false);
    const [interruptions, setInterruptions] = useState(0);

    const chime = (kind: 'break' | 'focus') => { if (settings.chimes) playChime(kind); };

    // Parent recreates onStudyTick every render (state update per tick);
    // route through a ref so the interval isn't torn down each second
    const tickRef = useRef(onStudyTick);
    tickRef.current = onStudyTick;

    const focusSecs = settings.focusMin * 60;
    const breakSecs = (longBreak ? settings.longBreakMin : settings.breakMin) * 60;
    const phaseLen = phase === 'focus' ? focusSecs : breakSecs;

    // Heartbeat: the countdown VALUE comes from wall-clock timestamps (so a
    // suspended/locked phone doesn't freeze it), while study-seconds accrual
    // stays tick-based and foreground-only (never credit time the app slept).
    useEffect(() => {
        if (paused) return;
        const t = window.setInterval(() => {
            setTick(x => (x + 1) % 1_000_000);
            if (phase === 'focus' && document.visibilityState === 'visible') {
                tickRef.current();
                setSessionSecs(s => s + 1);
            }
            const elapsed = phaseBaseElapsed + (Date.now() - phaseStartedAt) / 1000;
            if (elapsed >= phaseLen) {
                if (phase === 'focus') {
                    setCycles(c => { const n = c + 1; setLongBreak(n % 4 === 0); return n; });
                    setPhase('break');
                    chime('break');
                } else {
                    setPhase('focus');
                    setLongBreak(false);
                    chime('focus');
                }
                setPhaseBaseElapsed(0);
                setPhaseStartedAt(Date.now());
            }
        }, 1000);
        return () => window.clearInterval(t);
    }, [paused, phase, phaseStartedAt, phaseBaseElapsed, phaseLen]);

    // Local notification for the moment the current phase ends — so the
    // pomodoro survives a locked screen. Native-only; no-op on web.
    useEffect(() => {
        if (paused) { cancelPhaseEnd(); return; }
        const endAt = phaseStartedAt + (phaseLen - phaseBaseElapsed) * 1000;
        if (phase === 'focus') {
            schedulePhaseEnd(endAt, 'Break time', `${longBreak ? settings.longBreakMin : settings.breakMin}-minute break`);
        } else {
            schedulePhaseEnd(endAt, 'Back to focus', `${slot.subject} — ${slot.name}`);
        }
    }, [phase, phaseStartedAt, phaseBaseElapsed, paused, phaseLen, longBreak]);

    // Ask notification permission once when a session opens; cancel any
    // pending phase-end when it closes (unmount covers the close button too).
    useEffect(() => {
        ensurePermission();
        return () => { cancelPhaseEnd(); };
    }, []);

    // Screen wake lock — keep the display on through a session, re-acquire on return
    useEffect(() => {
        let lock: WakeLockSentinel | null = null;
        let released = false;
        const request = async () => {
            try { lock = (await navigator.wakeLock?.request('screen')) ?? null; }
            catch { /* denied or unsupported */ }
        };
        const onVis = () => { if (document.visibilityState === 'visible' && !released) request(); };
        request();
        document.addEventListener('visibilitychange', onVis);
        return () => {
            released = true;
            document.removeEventListener('visibilitychange', onVis);
            lock?.release().catch(() => { /* already gone */ });
        };
    }, []);

    // Count times focus was broken away from (backgrounded mid-focus)
    const focusState = useRef({ phase, paused });
    focusState.current = { phase, paused };
    useEffect(() => {
        const onHide = () => {
            const s = focusState.current;
            if (document.visibilityState === 'hidden' && s.phase === 'focus' && !s.paused) {
                setInterruptions(n => n + 1);
            }
        };
        document.addEventListener('visibilitychange', onHide);
        return () => document.removeEventListener('visibilitychange', onHide);
    }, []);

    // Ambient bed: only while focusing, unpaused, and enabled
    const ambientOn = settings.ambient && phase === 'focus' && !paused;
    useEffect(() => {
        if (ambientOn) startAmbient(); else stopAmbient();
    }, [ambientOn]);
    useEffect(() => () => stopAmbient(), []);

    const c = subjectColor(slot.subject);
    const items = parseItems(slot.task);
    const elapsedNow = paused ? phaseBaseElapsed : phaseBaseElapsed + (Date.now() - phaseStartedAt) / 1000;
    // Whole seconds — elapsedNow is fractional wall-clock time
    const remaining = Math.ceil(Math.max(0, phaseLen - elapsedNow));

    // Pause banks the running span; resume starts a fresh one from now
    const togglePause = () => {
        if (!paused) {
            setPhaseBaseElapsed(be => be + (Date.now() - phaseStartedAt) / 1000);
            setPaused(true);
        } else {
            setPhaseStartedAt(Date.now());
            setPaused(false);
        }
    };
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(remaining % 60).padStart(2, '0');
    const onBreak = phase === 'break';
    const phaseHex = onBreak ? BREAK_HEX : c.hex;
    const studiedMin = Math.floor(studiedSeconds / 60);
    // Calibrated estimate when the subject has a learned pace, else the scheduler's
    const plannedEst = calibratedMinutes(slot, pace) ?? (typeof slot.minutes === 'number' && slot.minutes > 0 ? slot.minutes : null);

    // Closing after a real stretch of focus offers the "where did you stop?" step;
    // a quick peek (<5 min) just closes, as before.
    const requestClose = () => {
        if (hasPages && sessionSecs >= 300) setEnding(true);
        else onClose();
    };

    // "Finished it" → after a real (≥10 min) session, offer a recall moment first
    const finish = () => {
        if (settings.recall && sessionSecs >= 600) setRecall(true);
        else onDone();
    };

    // Recall countdown — auto-advances to completion at zero
    useEffect(() => {
        if (!recall) return;
        if (recallLeft <= 0) { onDone(); return; }
        const t = window.setTimeout(() => setRecallLeft(n => n - 1), 1000);
        return () => window.clearTimeout(t);
    }, [recall, recallLeft]);

    // ── "Book closed" — a 60s recall moment before the task is marked done ──
    if (recall) {
        const rmm = String(Math.floor(recallLeft / 60)).padStart(2, '0');
        const rss = String(recallLeft % 60).padStart(2, '0');
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
                        aria-label="Skip recall"
                        className="w-10 h-10 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70"
                        onClick={onDone}
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center text-center min-h-0">
                    <p className={`text-[11px] font-semibold tracking-[0.14em] uppercase ${c.text} opacity-80`}>{slot.subject}</p>
                    <h2 className="font-display text-[24px] font-semibold text-on-surface tracking-tight mt-1.5">Book closed</h2>
                    <p className="text-[14px] leading-snug text-on-surface/75 mt-2 max-w-[260px]">Recall the 3 main points out loud</p>
                    <span className="font-display text-[64px] font-semibold tabular-nums tracking-tight mt-8 leading-none text-on-surface">
                        {rmm}:{rss}
                    </span>
                </div>

                <div className="space-y-3">
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
                        Done
                    </button>
                    <button
                        className="w-full bg-transparent border-0 cursor-pointer py-1 text-[13px] font-medium text-on-surface-variant/50 hover:text-on-surface-variant/80"
                        onClick={onDone}
                    >
                        Skip
                    </button>
                </div>
            </motion.div>
        );
    }

    // ── "Where did you stop?" — same backdrop, swapped content ──
    if (ending) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                className="fixed inset-0 z-[70] flex flex-col bg-[#060808]/95 backdrop-blur-2xl px-8 pb-10 pt-[calc(env(safe-area-inset-top)+1.5rem)]"
            >
                <div className="flex justify-between">
                    <button
                        aria-label="Back to timer"
                        className="w-10 h-10 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70"
                        onClick={() => setEnding(false)}
                    >
                        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                    </button>
                    <button
                        aria-label="Close focus session"
                        className="w-10 h-10 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70"
                        onClick={onClose}
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center text-center min-h-0">
                    <p className={`text-[11px] font-semibold tracking-[0.14em] uppercase ${c.text} opacity-80`}>{slot.subject}</p>
                    <h2 className="font-display text-[24px] font-semibold text-on-surface tracking-tight mt-1.5">Where did you stop?</h2>

                    <div className="mt-10 flex items-center gap-7">
                        <button
                            aria-label="Previous page"
                            disabled={page <= pageRange.minStart}
                            className="w-12 h-12 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70 disabled:opacity-25"
                            onClick={() => setPage(p => Math.max(pageRange.minStart, p - 1))}
                        >
                            <span className="material-symbols-outlined text-[22px]">remove</span>
                        </button>
                        <span className="font-display text-[44px] font-semibold tabular-nums leading-none text-on-surface w-[92px]">
                            {page}
                        </span>
                        <button
                            aria-label="Next page"
                            disabled={page >= pageRange.maxEnd}
                            className="w-12 h-12 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70 disabled:opacity-25"
                            onClick={() => setPage(p => Math.min(pageRange.maxEnd, p + 1))}
                        >
                            <span className="material-symbols-outlined text-[22px]">add</span>
                        </button>
                    </div>
                    <p className="text-[12px] text-on-surface-variant/50 mt-5 tabular-nums">
                        of pp. {pageRange.minStart}–{pageRange.maxEnd}
                    </p>
                </div>

                <div className="space-y-3">
                    <button
                        className="w-full rounded-full py-4 text-[15px] font-semibold border-0 cursor-pointer flex items-center justify-center gap-2 active:scale-[0.985] transition-transform"
                        style={{ background: `${c.hex}26`, border: `1.5px solid ${c.hex}59`, color: c.hex }}
                        onClick={finish}
                    >
                        {busy ? (
                            <span className="w-4 h-4 rounded-full border-[1.5px] border-white/25 border-t-white animate-spin" />
                        ) : (
                            <span className="material-symbols-outlined text-[20px]">check</span>
                        )}
                        Finished it
                    </button>
                    <button
                        className="w-full bg-transparent border-0 cursor-pointer py-1 text-[13px] font-medium text-on-surface-variant/50 hover:text-on-surface-variant/80"
                        onClick={() => onStopHere(page)}
                    >
                        Stopped here
                    </button>
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="fixed inset-0 z-[70] flex flex-col bg-[#060808]/95 backdrop-blur-2xl px-8 pb-10 pt-[calc(env(safe-area-inset-top)+1.5rem)]"
        >
            <div className="flex justify-between">
                <button
                    aria-label={settings.ambient ? 'Mute ambient noise' : 'Play ambient noise'}
                    className="w-10 h-10 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70"
                    onClick={() => setSettings({ ambient: !settings.ambient })}
                >
                    <span className="material-symbols-outlined text-[20px]">{settings.ambient ? 'volume_up' : 'volume_off'}</span>
                </button>
                <button
                    aria-label="Close focus session"
                    className="w-10 h-10 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70"
                    onClick={requestClose}
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
                    {onBreak ? (longBreak ? 'Long break' : 'Break') : 'Focus'}
                </span>

                {/* Countdown — tap to pause/resume */}
                <button
                    className={`bg-transparent border-0 p-0 cursor-pointer font-display text-[64px] font-semibold tabular-nums tracking-tight mt-3 leading-none transition-opacity ${paused ? 'opacity-40' : 'opacity-100'} text-on-surface`}
                    onClick={togglePause}
                    aria-label={paused ? 'Resume timer' : 'Pause timer'}
                >
                    {mm}:{ss}
                </button>
                <p className="text-[12px] text-on-surface-variant/50 mt-2.5 tabular-nums">
                    {paused ? 'Paused — tap the timer to resume'
                        : `studied ${fmtMinutes(Math.max(studiedMin, 0))}${plannedEst ? ` · planned ~${fmtMinutes(plannedEst)}` : ''}`}
                </p>
                {interruptions > 0 && (
                    <p className="text-[11px] text-on-surface-variant/40 mt-1 tabular-nums">
                        {interruptions} interruption{interruptions === 1 ? '' : 's'}
                    </p>
                )}

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
                        onClick={() => { setPhase('focus'); setPhaseBaseElapsed(0); setPhaseStartedAt(Date.now()); setLongBreak(false); chime('focus'); }}
                    >
                        Skip break
                    </button>
                )}
            </div>

            <button
                className="w-full rounded-full py-4 text-[15px] font-semibold border-0 cursor-pointer flex items-center justify-center gap-2 active:scale-[0.985] transition-transform"
                style={{ background: `${c.hex}26`, border: `1.5px solid ${c.hex}59`, color: c.hex }}
                onClick={() => hasPages ? setEnding(true) : onDone()}
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

/** −/value/+ stepper: 32px round chips flanking a large tabular value */
function Stepper({
    label, value, min, max, step, onChange,
}: {
    label: string; value: number; min: number; max: number; step: number;
    onChange: (v: number) => void;
}) {
    const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
    return (
        <div className="flex items-center justify-between">
            <span className="text-[14px] text-on-surface/85">{label}</span>
            <div className="flex items-center gap-4">
                <button
                    aria-label={`Decrease ${label}`}
                    disabled={value <= min}
                    className="w-8 h-8 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70 disabled:opacity-30"
                    onClick={() => set(value - step)}
                >
                    <span className="material-symbols-outlined text-[18px]">remove</span>
                </button>
                <span className="font-display text-[22px] font-semibold tabular-nums text-on-surface w-9 text-center">{value}</span>
                <button
                    aria-label={`Increase ${label}`}
                    disabled={value >= max}
                    className="w-8 h-8 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70 disabled:opacity-30"
                    onClick={() => set(value + step)}
                >
                    <span className="material-symbols-outlined text-[18px]">add</span>
                </button>
            </div>
        </div>
    );
}

/** iOS-style glass switch row */
function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            className="w-full flex items-center justify-between bg-transparent border-0 p-0 cursor-pointer"
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={() => onChange(!on)}
        >
            <span className="text-[14px] text-on-surface/85">{label}</span>
            <span
                className="relative w-[46px] h-[28px] rounded-full transition-colors flex-shrink-0"
                style={{ background: on ? '#adc6ff' : 'rgba(255,255,255,0.12)' }}
            >
                <span
                    className="absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white transition-all"
                    style={{ left: on ? '21px' : '3px' }}
                />
            </span>
        </button>
    );
}

/** Full-screen settings sheet: focus lengths, sounds, and the reminder topic */
function SettingsSheet({ onClose }: { onClose: () => void }) {
    const [settings, setSettings] = useSettings();
    const [topic, setTopic] = useState('');
    const savedTopic = useRef('');

    useEffect(() => {
        axios.get(`${API}/api/preferences/ntfy_topic`).then(res => {
            const v = typeof res.data?.value === 'string' ? res.data.value : '';
            savedTopic.current = v;
            setTopic(v);
        }).catch(() => { /* offline — leave blank */ });
    }, []);

    const saveTopic = () => {
        const v = topic.trim();
        if (v === savedTopic.current) return;
        savedTopic.current = v;
        axios.post(`${API}/api/preferences`, { key: 'ntfy_topic', value: v }).catch(() => { /* retry on next blur */ });
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="fixed inset-0 z-[70] flex flex-col bg-[#060808]/95 backdrop-blur-2xl px-8 pb-10 pt-[calc(env(safe-area-inset-top)+1.5rem)]"
        >
            <div className="flex items-center justify-between">
                <h2 className="font-display text-[22px] font-semibold text-on-surface tracking-tight">Settings</h2>
                <button
                    aria-label="Close settings"
                    className="w-10 h-10 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70"
                    onClick={onClose}
                >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar mt-6 space-y-4">
                <div className="glass-card rounded-[24px] px-5 py-5 space-y-5">
                    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-on-surface-variant/50">Session lengths</p>
                    <Stepper label="Focus" value={settings.focusMin} min={15} max={60} step={5}
                        onChange={v => setSettings({ focusMin: v })} />
                    <Stepper label="Break" value={settings.breakMin} min={3} max={15} step={1}
                        onChange={v => setSettings({ breakMin: v })} />
                    <Stepper label="Long break" value={settings.longBreakMin} min={10} max={30} step={5}
                        onChange={v => setSettings({ longBreakMin: v })} />
                </div>

                <div className="glass-card rounded-[24px] px-5 py-5 space-y-4">
                    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-on-surface-variant/50">Sound</p>
                    <ToggleRow label="Phase chimes" on={settings.chimes} onChange={v => setSettings({ chimes: v })} />
                    <ToggleRow label="Ambient noise" on={settings.ambient} onChange={v => setSettings({ ambient: v })} />
                </div>

                <div className="glass-card rounded-[24px] px-5 py-5 space-y-4">
                    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-on-surface-variant/50">Memory</p>
                    <ToggleRow label="Recall after finishing" on={settings.recall} onChange={v => setSettings({ recall: v })} />
                </div>

                <div className="glass-card rounded-[24px] px-5 py-5">
                    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-on-surface-variant/50 mb-3">Daily reminder topic</p>
                    <input
                        type="text"
                        value={topic}
                        placeholder="ntfy.sh topic"
                        className="w-full bg-white/[0.06] rounded-xl px-4 py-3 text-white placeholder:text-on-surface-variant/35 border-0 outline-none text-[14px]"
                        onChange={e => setTopic(e.target.value)}
                        onBlur={saveTopic}
                    />
                    <p className="text-on-surface-variant/40 text-[11px] mt-2">Get a 6 AM plan notification via the ntfy app</p>
                </div>
            </div>
        </motion.div>
    );
}

/** Standalone "log pages" sheet — record how far you've read on a task
    without running a focus session. Writes the last page reached. */
function PagePicker({
    slot, initialPage, onSave, onClose,
}: {
    slot: Slot; initialPage: number;
    onSave: (page: number) => void; onClose: () => void;
}) {
    const range = pageRangeOf(slot.task);
    const [page, setPage] = useState(Math.min(range.maxEnd, Math.max(range.minStart, initialPage)));
    const c = subjectColor(slot.subject);

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
                    aria-label="Close"
                    className="w-10 h-10 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70"
                    onClick={onClose}
                >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center text-center min-h-0">
                <p className={`text-[11px] font-semibold tracking-[0.14em] uppercase ${c.text} opacity-80`}>{slot.subject}</p>
                <h2 className="font-display text-[24px] font-semibold text-on-surface tracking-tight mt-1.5">Pages read?</h2>

                <div className="mt-10 flex items-center gap-7">
                    <button
                        aria-label="Fewer pages"
                        disabled={page <= range.minStart}
                        className="w-12 h-12 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70 disabled:opacity-25"
                        onClick={() => setPage(p => Math.max(range.minStart, p - 1))}
                    >
                        <span className="material-symbols-outlined text-[22px]">remove</span>
                    </button>
                    <span className="font-display text-[44px] font-semibold tabular-nums leading-none text-on-surface w-[92px]">
                        {page}
                    </span>
                    <button
                        aria-label="More pages"
                        disabled={page >= range.maxEnd}
                        className="w-12 h-12 rounded-full glass-chip flex items-center justify-center border-0 cursor-pointer text-on-surface-variant/70 disabled:opacity-25"
                        onClick={() => setPage(p => Math.min(range.maxEnd, p + 1))}
                    >
                        <span className="material-symbols-outlined text-[22px]">add</span>
                    </button>
                </div>
                <p className="text-[12px] text-on-surface-variant/50 mt-5 tabular-nums">
                    of pp. {range.minStart}–{range.maxEnd}
                </p>
            </div>

            <div className="space-y-3">
                <button
                    className="w-full rounded-full py-4 text-[15px] font-semibold border-0 cursor-pointer flex items-center justify-center gap-2 active:scale-[0.985] transition-transform"
                    style={{ background: `${c.hex}26`, border: `1.5px solid ${c.hex}59`, color: c.hex }}
                    onClick={() => onSave(page)}
                >
                    <span className="material-symbols-outlined text-[20px]">bookmark</span>
                    Save
                </button>
                <button
                    className="w-full bg-transparent border-0 cursor-pointer py-1 text-[13px] font-medium text-on-surface-variant/50 hover:text-on-surface-variant/80"
                    onClick={onClose}
                >
                    Cancel
                </button>
            </div>
        </motion.div>
    );
}

export function TodayView({
    today, todayStr, backlog, upcoming, plan, toggle, busy, streak, pace = {},
}: {
    today: DayPlan | null;
    todayStr: string;
    backlog: { slot: Slot; date: string }[];
    upcoming: DayPlan[];
    /** Full schedule — the revision engine walks every completed slot */
    plan: DayPlan[];
    toggle: (date: string, name: string, cur: boolean) => void;
    busy: string | null;
    streak: { current: number; best: number };
    /** Learned per-subject pace, for calibrated time estimates */
    pace?: Record<string, number>;
}) {
    const [catchUpOpen, setCatchUpOpen] = useState(false);
    const [upcomingOpen, setUpcomingOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [backlogVisible, setBacklogVisible] = useState(5);
    const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
    const [upcomingVisible, setUpcomingVisible] = useState(5);
    const [upcomingFilter, setUpcomingFilter] = useState<string | null>(null);
    // Focus session target + studied time per task ("date_slot" → seconds).
    // localStorage is the offline cache; the backend is the source of truth,
    // merged key-wise by max so no device ever loses recorded time.
    const [focusTarget, setFocusTarget] = useState<{ slot: Slot; date: string } | null>(null);
    // Direct page-logging (no pomodoro needed)
    const [pageEditTarget, setPageEditTarget] = useState<{ slot: Slot; date: string } | null>(null);
    const [studyTime, setStudyTime] = useState<Record<string, number>>(loadStudyTime);
    const studyTimeRef = useRef(studyTime);
    studyTimeRef.current = studyTime;
    const lastSynced = useRef<Record<string, number>>({});
    // Last page reached per task ("date_slot" → page). Same offline-cache /
    // backend-source-of-truth story as studyTime, merged key-wise by max.
    const [taskPages, setTaskPages] = useState<Record<string, number>>(loadTaskPages);
    // Revision done-flags: localStorage seeds instant paint, backend is truth.
    const [revisions, setRevisions] = useState<Record<string, boolean>>(loadRevisions);
    const [revClearing, setRevClearing] = useState<Set<string>>(new Set());
    // Habit marks (newspaper, answer writing): localStorage seeds, server wins on merge.
    const [habits, setHabits] = useState<Record<string, boolean>>(loadHabits);
    const [habitBusy, setHabitBusy] = useState<Set<string>>(new Set());

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

    // Merge server pages by max on mount, mirror to localStorage on change
    useEffect(() => {
        axios.get(`${API}/api/task-pages`).then(res => {
            const server: Record<string, number> = res.data && typeof res.data === 'object' ? res.data : {};
            setTaskPages(prev => {
                const merged = { ...prev };
                Object.entries(server).forEach(([k, v]) => { merged[k] = Math.max(merged[k] || 0, Number(v) || 0); });
                return merged;
            });
        }).catch(() => { /* offline — local cache carries on */ });
    }, []);
    useEffect(() => {
        try { localStorage.setItem(PAGES_KEY, JSON.stringify(taskPages)); } catch { /* quota */ }
    }, [taskPages]);

    // Revisions: merge server done-flags on mount (a done flag never un-does),
    // mirror to localStorage on change
    useEffect(() => {
        axios.get(`${API}/api/revisions`).then(res => {
            const server: Record<string, boolean> = res.data && typeof res.data === 'object' ? res.data : {};
            setRevisions(prev => {
                const merged = { ...prev };
                Object.entries(server).forEach(([k, v]) => { if (v) merged[k] = true; });
                return merged;
            });
        }).catch(() => { /* offline — local cache carries on */ });
    }, []);
    useEffect(() => {
        try { localStorage.setItem(REVISIONS_KEY, JSON.stringify(revisions)); } catch { /* quota */ }
    }, [revisions]);

    // Habit marks: merge the server's "habit_" subset on mount (server wins),
    // mirror to localStorage on change
    useEffect(() => {
        axios.get(`${API}/api/marks`, { params: { prefix: 'habit_' } }).then(res => {
            const server: Record<string, boolean> = res.data && typeof res.data === 'object' ? res.data : {};
            setHabits(prev => ({ ...prev, ...server }));
        }).catch(() => { /* offline — local cache carries on */ });
    }, []);
    useEffect(() => {
        try { localStorage.setItem(HABITS_KEY, JSON.stringify(habits)); } catch { /* quota */ }
    }, [habits]);

    // Flip a habit mark: optimistic, POST /api/mark, revert on failure.
    // These keys are not in the schedule, so they never touch the ring/streak/stats.
    const toggleHabit = (date: string, name: string) => {
        const key = `${date}_${name}`;
        if (habitBusy.has(key)) return;
        const next = !habits[key];
        setHabits(prev => ({ ...prev, [key]: next }));
        setHabitBusy(prev => new Set(prev).add(key));
        axios.post(`${API}/api/mark`, null, { params: { date, slot_name: name, completed: next } })
            .catch(() => setHabits(prev => ({ ...prev, [key]: !next })))
            .finally(() => setHabitBusy(prev => { const n = new Set(prev); n.delete(key); return n; }));
    };

    // Tick a revision: show the check for 500ms, then mark done + post
    const clearRevision = (key: string) => {
        if (revClearing.has(key)) return;
        setRevClearing(prev => new Set(prev).add(key));
        window.setTimeout(() => {
            setRevClearing(prev => { const n = new Set(prev); n.delete(key); return n; });
            setRevisions(prev => ({ ...prev, [key]: true }));
            axios.post(`${API}/api/revisions`, null, { params: { key, done: true } }).catch(() => { /* retry next mount */ });
        }, 500);
    };

    // Record a chosen page: bump local state (monotonic) and post immediately
    /** `exact` = a deliberate edit, which may also correct the page downwards.
        Automatic writes stay monotonic so a stale sync can't rewind progress. */
    const setTaskPage = (key: string, page: number, exact = false) => {
        setTaskPages(prev => ({ ...prev, [key]: exact ? page : Math.max(prev[key] || 0, page) }));
        axios.post(`${API}/api/task-pages`, null, { params: { key, page, exact } })
            .catch(() => { /* retry next time */ });
    };

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
    /** 0..1 progress = the greater of time studied and pages read (0 when done) */
    const progressOf = (slot: Slot, date: string) => {
        if (slot.completed) return 0;
        const key = studyKeyOf(date, slot.name);
        const timeShare = slot.minutes ? Math.min(1, (studyTime[key] || 0) / (slot.minutes * 60)) : 0;
        const { minStart, total } = pageRangeOf(slot.task);
        const stored = taskPages[key];
        const pagesShare = stored && total > 0
            ? Math.min(1, Math.max(0, stored - minStart + 1) / total)
            : 0;
        return Math.max(timeShare, pagesShare);
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

    // Total minutes focused today, summed across every block studied
    const todayFocusMin = Math.floor(
        Object.entries(studyTime)
            .filter(([k]) => k.startsWith(`${dateStr}_`))
            .reduce((a, [, sec]) => a + sec, 0) / 60,
    );

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
    const heroEst = hero ? (calibratedMinutes(hero, pace) ?? (typeof hero.minutes === 'number' && hero.minutes > 0 ? hero.minutes : null)) : null;
    const heroLoading = hero ? busy === `${dateStr}-${hero.name}` : false;

    // Chapters due for a spaced-repetition revision today
    const dueRevs = dueRevisions(plan, revisions, todayStr);

    // Practice habits — daily newspaper + weekly answer writing (kept out of ring/stats)
    const isoWeek = isoWeekId(new Date());
    const newsDate = `habit_${todayStr}`;
    const newsKey = `${newsDate}_news`;
    const newsDone = !!habits[newsKey];
    const awDate = `habit_${isoWeek}`;
    const awSlots = ['aw1', 'aw2', 'aw3', 'essay'];
    const awDone = awSlots.every(s => habits[`${awDate}_${s}`]);

    return (
        <main className="max-w-[560px] mx-auto pb-16">
            {/* ── Header: date + settings ── */}
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
                    <button
                        aria-label="Settings"
                        className="bg-transparent border-0 p-0 cursor-pointer text-on-surface-variant/50 flex items-center flex-shrink-0"
                        onClick={() => setSettingsOpen(true)}
                    >
                        <span className="material-symbols-outlined text-[24px]">settings</span>
                    </button>
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
                        <motion.div
                            key={hero.name}
                            layout
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.97 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                            className="mb-8"
                        >
                        <SwipeRow
                            radius={24}
                            shadow={`0 16px 40px -20px ${heroColor.hex}40`}
                            border={`1px solid ${heroColor.hex}2b`}
                            actions={[{
                                icon: 'bookmark_add', label: 'Pages', hex: heroColor.hex,
                                onAction: () => setPageEditTarget({ slot: hero, date: dateStr }),
                            }]}
                        >
                        <section
                            className="relative overflow-hidden cursor-pointer"
                            style={{
                                background: `linear-gradient(140deg, ${heroColor.hex}17 0%, rgba(255,255,255,0.03) 55%)`,
                                backdropFilter: 'blur(20px) saturate(140%)',
                                WebkitBackdropFilter: 'blur(20px) saturate(140%)',
                            }}
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

                                {/* Progress: hairline bar with the current page pinned to its end */}
                                {progressOf(hero, dateStr) > 0 && (
                                    <div className="mt-4">
                                        {taskPages[studyKeyOf(dateStr, hero.name)] && (
                                            <div className="flex justify-end mb-1.5">
                                                <span className="text-[11px] font-medium tabular-nums" style={{ color: heroColor.hex }}>
                                                    p.{taskPages[studyKeyOf(dateStr, hero.name)]}
                                                </span>
                                            </div>
                                        )}
                                        <div className="h-1 rounded-full bg-white/[0.07] overflow-hidden">
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
                                    </div>
                                )}

                                {/* Footer: quiet meta + one satisfying tap target */}
                                <div className="flex items-center justify-between mt-4 gap-3">
                                    <span className="text-[12px] text-on-surface-variant/50 tabular-nums">
                                        {heroPages > 0 ? `${heroPages} pages` : ''}
                                        {heroPages > 0 && heroEst ? ` · ~${fmtMinutes(heroEst)}` : ''}
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
                        </section>
                        </SwipeRow>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ── Revise: spaced-repetition nudges, tick to clear ── */}
                {dueRevs.length > 0 && (
                    <section className="mb-8">
                        <SectionLabel>Revise · 10 min</SectionLabel>
                        <div className="glass-card rounded-2xl px-4 py-1 overflow-hidden">
                            <AnimatePresence initial={false} mode="popLayout">
                                {dueRevs.map(rev => {
                                    const c = subjectColor(rev.subject);
                                    const inClearing = revClearing.has(rev.key);
                                    return (
                                        <motion.div
                                            key={rev.key}
                                            layout
                                            exit={{ opacity: 0, x: 56, scale: 0.97, transition: { duration: 0.3, ease: [0.4, 0, 1, 1] } }}
                                            className="py-3 border-b border-white/[0.05] last:border-0"
                                        >
                                            <div className={`flex items-start gap-3.5 transition-opacity ${inClearing ? 'opacity-45' : ''}`}>
                                                <CheckCircle
                                                    completed={inClearing}
                                                    loading={false}
                                                    hex={c.hex}
                                                    onClick={() => clearRevision(rev.key)}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-baseline justify-between gap-3">
                                                        <p className={`text-[10px] font-semibold tracking-[0.09em] uppercase leading-tight ${c.text}`}>
                                                            {rev.subject}
                                                        </p>
                                                        <span className="text-[11px] text-on-surface-variant/50 tabular-nums flex-shrink-0">
                                                            read {rev.daysAgo}d ago
                                                        </span>
                                                    </div>
                                                    <p className="text-[13px] text-on-surface/85 leading-snug truncate mt-1">
                                                        {rev.chapter}
                                                    </p>
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    </section>
                )}

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
                                <motion.div layout key={slot.name}>
                                    <SwipeRow
                                        actions={[{
                                            icon: 'bookmark_add', label: 'Pages',
                                            hex: subjectColor(slot.subject).hex,
                                            onAction: () => setPageEditTarget({ slot, date: dateStr }),
                                        }]}
                                    >
                                        <div className="glass-flat px-4 py-4">
                                            <CompactRow
                                                slot={slot} date={dateStr} busy={busy} toggle={toggle} meta={slot.name}
                                                progress={progressOf(slot, dateStr)}
                                                onFocus={() => openFocus(slot, dateStr)}
                                                storedPage={taskPages[studyKeyOf(dateStr, slot.name)]}
                                            />
                                        </div>
                                    </SwipeRow>
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

                {/* ── Practice: daily newspaper + weekly answer writing, tracked apart from the plan ── */}
                <section className="mb-8">
                    <SectionLabel>Practice</SectionLabel>
                    <div className="glass-card rounded-2xl px-4 py-1">
                        {/* Daily — newspaper */}
                        <div className={`py-3 border-b border-white/[0.05] last:border-0 flex items-center gap-3.5 transition-opacity ${newsDone ? 'opacity-45' : ''}`}>
                            <CheckCircle
                                completed={newsDone}
                                loading={habitBusy.has(newsKey)}
                                hex="#adc6ff"
                                onClick={() => toggleHabit(newsDate, 'news')}
                            />
                            <div className="flex-1 min-w-0 flex items-baseline justify-between gap-3">
                                <span className={`text-[13px] text-on-surface/85 ${newsDone ? 'line-through' : ''}`}>Newspaper</span>
                                <span className="text-[11px] text-on-surface-variant/50 tabular-nums flex-shrink-0">45 min</span>
                            </div>
                        </div>
                        {/* Weekly — answer writing */}
                        <div className={`py-3 border-b border-white/[0.05] last:border-0 flex items-center gap-3.5 transition-opacity ${awDone ? 'opacity-45' : ''}`}>
                            <div className="flex-1 min-w-0">
                                <span className={`text-[13px] text-on-surface/85 ${awDone ? 'line-through' : ''}`}>Answer writing</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {(['aw1', 'aw2', 'aw3'] as const).map((slot, i) => {
                                    const key = `${awDate}_${slot}`;
                                    return (
                                        <span key={slot} title={`Answer ${i + 1}`} className="flex">
                                            <CheckCircle
                                                completed={!!habits[key]}
                                                loading={habitBusy.has(key)}
                                                hex="#68d3ff"
                                                size={18}
                                                onClick={() => toggleHabit(awDate, slot)}
                                            />
                                        </span>
                                    );
                                })}
                                <span title="Essay" className="flex ml-2">
                                    <CheckCircle
                                        completed={!!habits[`${awDate}_essay`]}
                                        loading={habitBusy.has(`${awDate}_essay`)}
                                        hex="#68d3ff"
                                        size={18}
                                        onClick={() => toggleHabit(awDate, 'essay')}
                                    />
                                </span>
                            </div>
                            <span className="text-[11px] text-on-surface-variant/50 tabular-nums flex-shrink-0">this week</span>
                        </div>
                    </div>
                </section>

                {/* ── Oldest backlog day: tick to clear, row celebrates then slides out.
                       With nothing to catch up on, tomorrow's tasks show here instead. ── */}
                {firstBacklogRows.length > 0 ? (
                    <section className="mb-2">
                        <SectionLabel>Catch up · {fmtShort(firstBacklogRows[0].date)}</SectionLabel>
                        <div className="space-y-2.5">
                            <AnimatePresence initial={false} mode="popLayout">
                                {firstBacklogRows.map(item => {
                                    const id = `${item.date}-${item.slot.name}`;
                                    return (
                                        <motion.div
                                            key={id}
                                            layout
                                            exit={{ opacity: 0, x: 56, scale: 0.97, transition: { duration: 0.3, ease: [0.4, 0, 1, 1] } }}
                                        >
                                            <SwipeRow
                                                actions={[{
                                                    icon: 'bookmark_add', label: 'Pages',
                                                    hex: subjectColor(item.slot.subject).hex,
                                                    onAction: () => setPageEditTarget({ slot: item.slot, date: item.date }),
                                                }]}
                                            >
                                                <div className="glass-flat px-4 py-4">
                                                    <CompactRow
                                                        slot={{ ...item.slot, completed: clearing.has(id) }}
                                                        date={item.date}
                                                        busy={busy}
                                                        toggle={clearingToggle}
                                                        progress={progressOf(item.slot, item.date)}
                                                        onFocus={() => openFocus(item.slot, item.date)}
                                                        storedPage={taskPages[studyKeyOf(item.date, item.slot.name)]}
                                                    />
                                                </div>
                                            </SwipeRow>
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
                        pace={pace}
                        onClose={() => setFocusTarget(null)}
                        onDone={() => {
                            toggle(focusTarget.date, focusTarget.slot.name, focusTarget.slot.completed);
                            setFocusTarget(null);
                        }}
                        onStopHere={page => {
                            setTaskPage(studyKeyOf(focusTarget.date, focusTarget.slot.name), page);
                            setFocusTarget(null);
                        }}
                    />
                )}
            </AnimatePresence>

            {/* ── Log pages ── */}
            <AnimatePresence>
                {pageEditTarget && (
                    <PagePicker
                        slot={pageEditTarget.slot}
                        initialPage={taskPages[studyKeyOf(pageEditTarget.date, pageEditTarget.slot.name)]
                            ?? pageRangeOf(pageEditTarget.slot.task).minStart}
                        onSave={page => {
                            // Deliberate edit — authoritative, so it can lower the page too
                            setTaskPage(studyKeyOf(pageEditTarget.date, pageEditTarget.slot.name), page, true);
                            setPageEditTarget(null);
                        }}
                        onClose={() => setPageEditTarget(null)}
                    />
                )}
            </AnimatePresence>

            {/* ── Settings ── */}
            <AnimatePresence>
                {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
            </AnimatePresence>
        </main>
    );
}
