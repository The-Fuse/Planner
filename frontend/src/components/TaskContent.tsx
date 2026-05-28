export function parseItems(task: string) {
    const re = /(\d+)\.\s*(.*?)\s*\((pp\.[^)]+)\)(?:,\s*)?/g;
    const out: { n: string; t: string; pg: string | null }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(task)) !== null) {
        out.push({ n: m[1], t: m[2].trim(), pg: m[3] || null });
    }
    return out;
}

export function TaskContent({ task, isDone = false, styleType = 'normal' }: { task: string; isDone?: boolean; styleType?: 'normal' | 'compact' | 'backlog' }) {
    const items = parseItems(task);
    if (items.length > 0) {
        return (
            <div className="space-y-3">
                {items.map((it, i) => (
                    <div key={i} className={`flex justify-between items-start gap-4 group ${isDone ? 'opacity-30' : ''}`}>
                        <div className="flex items-start gap-3 overflow-hidden">
                            <span className={`text-[12px] font-light tracking-wide flex-1 leading-snug ${isDone ? 'line-through text-on-surface' : 'text-on-surface/90'}`}>
                                {styleType === 'backlog' ? (
                                    <>
                                        <span className="ultra-refined-num text-sm opacity-40 mr-1.5">{it.n}.</span>
                                        {it.t}
                                    </>
                                ) : (
                                    `${it.n}. ${it.t}`
                                )}
                            </span>
                        </div>
                        {it.pg && (
                            <span className="px-2 py-0.5 rounded-md bg-surface-bright/20 border border-white/5 text-[8px] font-bold text-on-surface/70 tracking-[0.1em] uppercase flex-shrink-0 ml-3 whitespace-nowrap">
                                {it.pg}
                            </span>
                        )}
                    </div>
                ))}
            </div>
        );
    }
    return <p className={`text-[12px] font-light text-on-surface/90 tracking-wide flex-1 leading-snug ${isDone ? 'line-through opacity-30' : ''}`}>{task}</p>;
}
