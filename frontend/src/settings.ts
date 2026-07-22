import { useEffect, useState } from 'react';

/** User-tunable focus + sound preferences, persisted on device */
export interface Settings {
    focusMin: number;
    breakMin: number;
    longBreakMin: number;
    chimes: boolean;
    ambient: boolean;
    /** Show a "recall the main points" moment after finishing a long session */
    recall: boolean;
}

const KEY = 'planner-settings-v1';
const DEFAULTS: Settings = { focusMin: 25, breakMin: 5, longBreakMin: 15, chimes: true, ambient: false, recall: true };

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
        return { ...DEFAULTS, ...raw };
    } catch {
        return { ...DEFAULTS };
    }
}

export function loadSettings(): Settings {
    return current;
}

export function saveSettings(patch: Partial<Settings>) {
    current = { ...current, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* quota */ }
    listeners.forEach(fn => fn(current));
}

/** Live settings + a setter that persists and notifies every open component */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
    const [s, setS] = useState<Settings>(current);
    useEffect(() => {
        const fn = (next: Settings) => setS(next);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, []);
    return [s, saveSettings];
}
