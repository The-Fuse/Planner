export interface Slot {
    name: string;
    subject: string;
    task: string;
    completed: boolean;
    /** Estimated reading time from the scheduler (hardness-weighted) */
    minutes?: number;
}

export interface DayPlan {
    date: string;
    day: string;
    slots: Slot[];
}

export interface SubjectStats {
    total: number;
    completed: number;
}
