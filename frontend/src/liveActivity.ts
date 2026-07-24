import { Capacitor, registerPlugin } from '@capacitor/core';

/** Payload mirroring PomodoroAttributes.ContentState on the native side.
    Timestamps are epoch ms — the same ones driving the in-app countdown, so
    the Lock Screen timer can't drift away from the sheet. */
export interface PomodoroState {
    phase: 'focus' | 'break';
    /** When the current phase ends */
    endsAt: number;
    /** When the current phase (or resumed span) began */
    startedAt: number;
    paused: boolean;
    /** Seconds left — the only truth while paused */
    remaining: number;
    cycles: number;
    longBreak: boolean;
    /** Surface the activity as a banner (phase flips only) */
    alert?: boolean;
}

interface Session {
    subject: string;
    task: string;
    colorHex: string;
}

/** A control tapped on the Live Activity itself */
export type PomodoroAction = 'pause' | 'resume' | 'restart' | 'stop';

const LiveActivity = registerPlugin<{
    isSupported(): Promise<{ supported: boolean }>;
    start(opts: Session & PomodoroState): Promise<{ started: boolean }>;
    update(opts: PomodoroState): Promise<void>;
    end(): Promise<void>;
    drainActions(): Promise<{ actions: PomodoroAction[] }>;
    addListener(
        event: 'pomodoroAction',
        cb: (data: { action: PomodoroAction }) => void,
    ): Promise<{ remove: () => Promise<void> }>;
}>('LiveActivity');

/** Guards every call: web builds and pre-16.2 iOS silently do nothing. */
const native = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

/** Put the pomodoro on the Lock Screen / Dynamic Island. Safe to call twice —
    a second call just updates the running activity. */
export async function startPomodoroActivity(session: Session, state: PomodoroState): Promise<void> {
    if (!native()) return;
    try {
        const r = await LiveActivity.start({ ...session, ...state });
        // Loud on failure — a silently missing Lock Screen timer is
        // indistinguishable from a broken build otherwise.
        if (!r?.started) console.warn('[LiveActivity] not started:', (r as { reason?: string })?.reason);
    } catch (e) {
        console.warn('[LiveActivity] plugin unavailable:', e);
    }
}

/** Push a new phase / pause state. `alert: true` makes it pop as a banner. */
export async function updatePomodoroActivity(state: PomodoroState): Promise<void> {
    if (!native()) return;
    try { await LiveActivity.update(state); }
    catch { /* activity already gone */ }
}

/** Tear the activity down — always call this when the session sheet closes. */
export async function endPomodoroActivity(): Promise<void> {
    if (!native()) return;
    try { await LiveActivity.end(); }
    catch { /* nothing running */ }
}

/** Listen for pause/restart/stop tapped on the Live Activity's own controls.
    Also drains anything queued natively while the web layer was asleep — a tap
    on a locked screen arrives before JS is running again. Returns a teardown. */
export function onPomodoroAction(handler: (action: PomodoroAction) => void): () => void {
    if (!native()) return () => { /* web: nothing to unsubscribe */ };

    let remove: (() => Promise<void>) | null = null;
    let stopped = false;

    LiveActivity.addListener('pomodoroAction', ({ action }) => handler(action))
        .then(h => {
            if (stopped) { h.remove(); return; }
            remove = h.remove;
        })
        .catch(() => { /* plugin unavailable */ });

    const drain = () => {
        if (document.visibilityState !== 'visible') return;
        LiveActivity.drainActions()
            .then(({ actions }) => actions.forEach(handler))
            .catch(() => { /* plugin unavailable */ });
    };
    drain();
    document.addEventListener('visibilitychange', drain);

    return () => {
        stopped = true;
        document.removeEventListener('visibilitychange', drain);
        remove?.();
    };
}
