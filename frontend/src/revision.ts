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

/** Add `n` whole days to an ISO "YYYY-MM-DD" date (calendar-safe, UTC math) */
function addDays(iso: string, n: number): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type Confidence = 'weak' | 'medium' | 'strong';

/** Per-chapter spaced-repetition state (SM-2 lite). Persisted by chapter slug. */
export interface ReviewState {
    /** Next due date, ISO "YYYY-MM-DD" */
    due: string;
    /** Current gap in days between reviews */
    interval: number;
    /** Ease factor, 1.3..3.0 — grows on Easy, shrinks on Again/Hard */
    ease: number;
    /** Successful reviews so far (Again resets to 0) */
    reps: number;
    /** Date of the last review, ISO */
    last: string;
    lastRating?: Rating;
}

const SEED_EASE = 2.3;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;

/** Implicit state for a freshly completed chapter that has never been reviewed:
    first revision falls due the day after it was finished. */
export function seedState(completedOn: string): ReviewState {
    return { due: addDays(completedOn, 1), interval: 1, ease: SEED_EASE, reps: 0, last: completedOn };
}

/** Advance an SM-2 lite state by a self-rating, scheduling the next due date.
    `today` anchors the new interval so a late review doesn't compound delay. */
export function applyRating(state: ReviewState, rating: Rating, today: string): ReviewState {
    let { interval, ease, reps } = state;
    switch (rating) {
        case 'again':
            reps = 0; interval = 1; ease = Math.max(MIN_EASE, ease - 0.2); break;
        case 'hard':
            interval = Math.max(1, Math.round(interval * 1.2)); ease = Math.max(MIN_EASE, ease - 0.15); reps += 1; break;
        case 'good':
            // Graduating steps for the first two passes, then ease-driven
            interval = reps === 0 ? 3 : reps === 1 ? 7 : Math.round(interval * ease);
            reps += 1; break;
        case 'easy':
            interval = reps === 0 ? 5 : reps === 1 ? 10 : Math.round(interval * ease * 1.3);
            ease = Math.min(MAX_EASE, ease + 0.15); reps += 1; break;
    }
    return { due: addDays(today, interval), interval, ease, reps, last: today, lastRating: rating };
}

/** The interval (days) a given rating would schedule from `state` — for showing
    "Good · 7d" style previews on the recall buttons without mutating anything. */
export function previewInterval(state: ReviewState, rating: Rating): number {
    return applyRating(state, rating, state.last).interval;
}

/** Confidence inferred from how recall has gone, when none was set by hand:
    a recent "Again" or eroded ease reads weak; steady Good/Easy reads strong. */
export function derivedConfidence(state?: ReviewState): Confidence {
    if (!state) return 'medium';
    if (state.lastRating === 'again' || state.ease < 1.6) return 'weak';
    if (state.reps >= 3 && state.ease >= SEED_EASE) return 'strong';
    return 'medium';
}

/** Manual override wins; otherwise fall back to the derived level. */
export function effectiveConfidence(
    slug: string,
    reviews: Record<string, ReviewState>,
    confidence: Record<string, Confidence>,
): Confidence {
    return confidence[slug] ?? derivedConfidence(reviews[slug]);
}

export interface DueReview {
    slug: string;
    chapter: string;
    subject: string;
    pages: string;
    completedOn: string;
    /** Stored state, or the seeded state for a never-reviewed chapter */
    state: ReviewState;
    confidence: Confidence;
    /** How many days past due (0 = due exactly today) */
    overdueDays: number;
}

const CONF_ORDER: Record<Confidence, number> = { weak: 0, medium: 1, strong: 2 };

/** Chapters whose next review falls on or before today. Weak-confidence chapters
    surface first, then the most overdue; capped so a backlog never floods. */
export function dueReviews(
    plan: DayPlan[],
    reviews: Record<string, ReviewState>,
    confidence: Record<string, Confidence>,
    todayStr: string,
    limit = 6,
): DueReview[] {
    const completions = chapterCompletions(plan);
    const due: DueReview[] = [];
    for (const c of completions) {
        const slug = slugify(c.chapter);
        const state = reviews[slug] ?? seedState(c.completedOn);
        if (state.due > todayStr) continue;
        due.push({
            slug, chapter: c.chapter, subject: c.subject, pages: c.pages,
            completedOn: c.completedOn, state,
            confidence: effectiveConfidence(slug, reviews, confidence),
            overdueDays: daysBetween(state.due, todayStr),
        });
    }
    due.sort((a, b) =>
        CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence] ||
        a.state.due.localeCompare(b.state.due),
    );
    return due.slice(0, limit);
}
