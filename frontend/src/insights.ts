import { DayPlan, Slot } from './interfaces';

/** Total pages across a task's "pp.a-b" ranges */
export function pagesInTask(task: string) {
    let total = 0;
    const re = /pp\.(\d+)\s*-\s*(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(task)) !== null) total += Math.max(0, Number(m[2]) - Number(m[1]) + 1);
    return total;
}

/** "45 min" / "1h 20m" */
export function fmtMinutes(min: number) {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
}


/** Study time cache — same key TodayView persists ("date_slot" → seconds) */
const STUDY_KEY = 'planner-study-time-v1';

/** Read the on-device studied-seconds map (kept fresh by TodayView) */
export function loadStudyTime(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(STUDY_KEY) || '{}'); } catch { return {}; }
}

/** A completed block counts toward pace only with a real stretch of focus on it */
const MIN_STUDIED_SEC = 600;
const MIN_BLOCKS = 3;

/** Per-subject actual minutes-per-page, learned from completed, well-studied blocks.
    A subject is included only once it has ≥3 qualifying blocks. */
export function personalPace(plan: DayPlan[], studyTime: Record<string, number>): Record<string, number> {
    const acc: Record<string, { sum: number; n: number }> = {};
    for (const day of plan) {
        for (const slot of day.slots) {
            if (!slot.completed) continue;
            const sec = studyTime[`${day.date}_${slot.name}`] || 0;
            if (sec < MIN_STUDIED_SEC) continue;
            const pages = pagesInTask(slot.task);
            if (pages <= 0) continue;
            const a = acc[slot.subject] || (acc[slot.subject] = { sum: 0, n: 0 });
            a.sum += (sec / 60) / pages;
            a.n += 1;
        }
    }
    const out: Record<string, number> = {};
    for (const [subject, a] of Object.entries(acc)) {
        if (a.n >= MIN_BLOCKS) out[subject] = a.sum / a.n;
    }
    return out;
}

/** One quiet line for the subject whose real pace runs furthest over its estimate
    (≥30% over, ≥3 qualifying blocks). Null when nothing is running notably long. */
export function overrunInsight(plan: DayPlan[], studyTime: Record<string, number>): string | null {
    const acc: Record<string, { actual: number; planned: number; n: number; evening: number }> = {};
    for (const day of plan) {
        for (const slot of day.slots) {
            if (!slot.completed) continue;
            const sec = studyTime[`${day.date}_${slot.name}`] || 0;
            if (sec < MIN_STUDIED_SEC) continue;
            const pages = pagesInTask(slot.task);
            if (pages <= 0) continue;
            if (typeof slot.minutes !== 'number' || slot.minutes <= 0) continue;
            const a = acc[slot.subject] || (acc[slot.subject] = { actual: 0, planned: 0, n: 0, evening: 0 });
            a.actual += (sec / 60) / pages;
            a.planned += slot.minutes / pages;
            a.n += 1;
            if (/evening/i.test(slot.name)) a.evening += 1;
        }
    }
    let worst: { subject: string; ratio: number; evening: boolean } | null = null;
    for (const [subject, a] of Object.entries(acc)) {
        if (a.n < MIN_BLOCKS) continue;
        const avgPlanned = a.planned / a.n;
        if (avgPlanned <= 0) continue;
        const ratio = (a.actual / a.n) / avgPlanned;
        if (ratio < 1.3) continue;
        if (!worst || ratio > worst.ratio) worst = { subject, ratio, evening: a.evening * 2 >= a.n };
    }
    if (!worst) return null;
    const pct = Math.round((worst.ratio - 1) * 100 / 5) * 5;
    const tail = worst.evening ? 'consider lighter evenings' : 'estimates adjusted';
    return `${worst.subject} blocks run ~${pct}% over — ${tail}`;
}

/** Calibrated estimate for a slot from learned pace: pages × min/page, to the
    nearest 5 minutes. Null when the subject has no learned pace (or no pages). */
export function calibratedMinutes(slot: Slot, pace: Record<string, number>): number | null {
    const p = pace[slot.subject];
    if (typeof p !== 'number') return null;
    const pages = pagesInTask(slot.task);
    if (pages <= 0) return null;
    return Math.round((pages * p) / 5) * 5;
}
