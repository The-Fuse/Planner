import { Capacitor } from '@capacitor/core';

/** Single reused id so only one phase-end notification is ever pending */
const PHASE_END_ID = 8801;

/** Check permission, requesting once if undetermined. Returns whether granted.
    No-op (false) on web. */
export async function ensurePermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        let perm = await LocalNotifications.checkPermissions();
        if (perm.display !== 'granted' && perm.display !== 'denied') {
            perm = await LocalNotifications.requestPermissions();
        }
        return perm.display === 'granted';
    } catch { return false; }
}

/** Cancel any pending phase-end notification, then schedule one at `atMs`.
    Waits for permission first so a first-session grant doesn't race the
    schedule. Cancel-then-reschedule keeps exactly one pending. No-op on web. */
export async function schedulePhaseEnd(atMs: number, title: string, body: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    const granted = await ensurePermission();
    if (!granted) return;
    try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.cancel({ notifications: [{ id: PHASE_END_ID }] });
        await LocalNotifications.schedule({
            notifications: [{
                id: PHASE_END_ID,
                title,
                body,
                schedule: { at: new Date(atMs), allowWhileIdle: true },
            }],
        });
    } catch { /* denied or plugin unavailable */ }
}

/** Cancel the pending phase-end notification. No-op on web. */
export async function cancelPhaseEnd(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.cancel({ notifications: [{ id: PHASE_END_ID }] });
    } catch { /* plugin unavailable */ }
}
