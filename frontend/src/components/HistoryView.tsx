import { Slot } from '../interfaces';
import { TaskContent } from './TaskContent';

export function HistoryView({
    history,
    toggle,
    busy
}: {
    history: { slot: Slot; date: string }[];
    toggle: (date: string, name: string, cur: boolean) => void;
    busy: string | null;
}) {
    // Group history by date for better presentation, or just flat list as in original design
    // The design shows a flat list but with dates on each card.
    
    return (
        <>
            <header className="flex flex-col items-center px-gutter pt-2 mb-8">
                <h1 className="mission-title text-[11px] text-on-surface-variant mb-2">Completed Tasks</h1>
                <div className="w-12 h-[1px] bg-primary/40"></div>
            </header>

            <main className="max-w-[800px] mx-auto px-gutter md:px-8 lg:px-12 pb-32 space-y-6">
                {history.length === 0 && (
                    <div className="text-center py-20 text-on-surface-variant/50 text-sm">
                        No completed tasks yet.
                    </div>
                )}
                {history.map((item, idx) => {
                    const id = `${item.date}-${item.slot.name}`;
                    const isLoading = busy === id;
                    
                    return (
                        <div key={`${id}-${idx}`} className="history-card spatial-glass rounded-2xl p-6 group cursor-pointer relative overflow-hidden" tabIndex={0}>
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <span className="text-[11px] font-light text-on-surface-variant tracking-widest uppercase">{item.date}</span>
                                    <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-on-surface-variant opacity-40">{item.slot.subject}</span>
                                </div>
                                <button 
                                    className="undo-button rounded-full bg-white/5 border border-white/10 text-[10px] font-bold text-on-surface tracking-[0.2em] uppercase hover:bg-white/10 transition-all w-8 h-8 flex items-center justify-center"
                                    onClick={() => toggle(item.date, item.slot.name, item.slot.completed)}
                                    title="Undo Completion"
                                >
                                    {isLoading ? (
                                        <div className="w-3 h-3 rounded-full border border-white/40 border-t-white animate-spin"></div>
                                    ) : (
                                        <span className="material-symbols-outlined text-[18px]">rotate_left</span>
                                    )}
                                </button>
                            </div>
                            <div className="text-on-surface/90">
                                <TaskContent task={item.slot.task} styleType="compact" />
                            </div>
                        </div>
                    );
                })}
            </main>
        </>
    );
}
