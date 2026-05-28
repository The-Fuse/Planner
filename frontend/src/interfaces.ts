export interface Slot {
    name: string;
    subject: string;
    task: string;
    completed: boolean;
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
