import { DayPlan } from './interfaces';

/** One "title (pp.a-b)" reading segment inside a task string.
    Non-greedy title so an inner "(...)" in the title is kept but the trailing
    "(pp.a-b)" is what closes the match. */
const SEG_RE = /([^,]+?)\s*\(pp\.(\d+)\s*-\s*(\d+)\)/g;

/** Drop a leading "N." / "N:" ordinal the scheduler prefixes onto chapters */
function cleanTitle(raw: string): string {
    return raw.trim().replace(/^\s*\d+\s*[.:]\s*/, '').trim();
}

/** URL/key-safe slug of a chapter title */
function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Whole-day difference toISO − fromISO, both "YYYY-MM-DD" (local-calendar safe) */
function daysBetween(fromISO: string, toISO: string): number {
    const [fy, fm, fd] = fromISO.split('-').map(Number);
    const [ty, tm, td] = toISO.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export interface ChapterCompletion {
    chapter: string;
    subject: string;
    pages: string;
    completedOn: string;
}

interface Agg {
    subject: string;
    minStart: number;
    maxEnd: number;
    /** false once any slot mentioning the chapter is still incomplete */
    allCompleted: boolean;
    /** date of the last-in-plan-order completed slot mentioning the chapter */
    lastCompletedOn: string | null;
}

/** Every chapter that is fully read, with the date its final page was completed.
    A chapter counts as completed only when ALL slots that mention it are done;
    "completedOn" is the date of the last such slot in plan order. */
export function chapterCompletions(plan: DayPlan[]): ChapterCompletion[] {
    const map = new Map<string, Agg>();

    // plan is already day-ordered; Map preserves first-seen order
    for (const day of plan) {
        for (const slot of day.slots) {
            if (slot.subject === 'Revision' || slot.subject === 'Buffer') continue;
            SEG_RE.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = SEG_RE.exec(slot.task)) !== null) {
                const title = cleanTitle(m[1]);
                if (!title) continue;
                const start = Number(m[2]);
                const end = Number(m[3]);
                let agg = map.get(title);
                if (!agg) {
                    agg = { subject: slot.subject, minStart: start, maxEnd: end, allCompleted: true, lastCompletedOn: null };
                    map.set(title, agg);
                } else {
                    if (start < agg.minStart) agg.minStart = start;
                    if (end > agg.maxEnd) agg.maxEnd = end;
                }
                if (slot.completed) agg.lastCompletedOn = day.date; // plan order → last wins
                else agg.allCompleted = false;
            }
        }
    }

    const out: ChapterCompletion[] = [];
    for (const [chapter, agg] of map) {
        if (!agg.allCompleted || !agg.lastCompletedOn) continue;
        const pages = agg.minStart === agg.maxEnd ? `pp.${agg.minStart}` : `pp.${agg.minStart}-${agg.maxEnd}`;
        out.push({ chapter, subject: agg.subject, pages, completedOn: agg.lastCompletedOn });
    }
    out.sort((a, b) => a.completedOn.localeCompare(b.completedOn));
    return out;
}

export interface DueRevision {
    key: string;
    chapter: string;
    subject: string;
    pages: string;
    daysAgo: number;
}

/** Spaced-repetition intervals (days after completion) */
const INTERVALS = [1, 7, 30];

/** Chapters due for revision today: for each interval N, a chapter whose
    completion is N..N+2 days ago (the +2 grace so one missed day doesn't drop
    it). Keys already marked done are excluded. Oldest interval first, max 3. */
export function dueRevisions(
    plan: DayPlan[],
    revisions: Record<string, boolean>,
    todayStr: string,
): DueRevision[] {
    const completions = chapterCompletions(plan);
    const due: DueRevision[] = [];
    // largest interval (oldest material) first
    for (const interval of [...INTERVALS].reverse()) {
        for (const c of completions) {
            const daysAgo = daysBetween(c.completedOn, todayStr);
            if (daysAgo < interval || daysAgo > interval + 2) continue;
            const key = `${interval}_${slugify(c.chapter)}_${c.completedOn}`;
            if (revisions[key]) continue;
            due.push({ key, chapter: c.chapter, subject: c.subject, pages: c.pages, daysAgo });
        }
    }
    return due.slice(0, 3);
}
