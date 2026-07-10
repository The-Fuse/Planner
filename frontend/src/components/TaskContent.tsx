export function parseItems(task: string) {
    const re = /(\d+)[.:]\s*(.*?)\s*\((pp\.[^)]+)\)(?:,\s*)?/g;
    const out: { n: string; t: string; pg: string | null }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(task)) !== null) {
        out.push({ n: m[1], t: m[2].trim(), pg: m[3] || null });
    }
    return out;
}

/** First reading title, "+n" if the block has more */
export function summarizeTask(task: string) {
    const items = parseItems(task);
    if (!items.length) return task;
    return items.length > 1 ? `${items[0].t}  +${items.length - 1}` : items[0].t;
}

export function TaskContent({ task, isDone = false, styleType = 'normal' }: { task: string; isDone?: boolean; styleType?: 'normal' | 'compact' | 'backlog' | 'backlog-compact' }) {
    const items = parseItems(task);
    
    if (items.length > 0) {
        return (
            <div className={styleType === 'compact' ? "space-y-2" : "space-y-3"}>
                {items.map((it, i) => (
                    <div key={i} className={`flex justify-between items-start gap-4 group ${isDone ? 'opacity-30' : ''}`}>
                        <div className="flex items-start gap-2.5 overflow-hidden">
                            {styleType === 'compact' || styleType === 'backlog-compact' ? (
                                <div className="flex gap-2">
                                    <span className={`text-[12px] font-medium tabular-nums pt-[1px] ${styleType === 'backlog-compact' ? 'text-on-surface/35' : 'text-on-surface/30'}`}>{it.n}.</span>
                                    <span className={`text-[13px] font-normal leading-relaxed ${isDone ? 'line-through text-on-surface/30' : (styleType === 'backlog-compact' ? 'text-on-surface/90' : 'text-on-surface/70')}`}>
                                        {it.t}
                                    </span>
                                </div>
                            ) : (
                                <span className={`text-[14px] font-normal flex-1 leading-relaxed ${isDone ? 'line-through text-on-surface' : 'text-on-surface/90'}`}>
                                    {styleType === 'backlog' ? (
                                        <>
                                            <span className="ultra-refined-num text-sm opacity-40 mr-1.5">{it.n}.</span>
                                            {it.t}
                                        </>
                                    ) : (
                                        `${it.n}. ${it.t}`
                                    )}
                                </span>
                            )}
                        </div>
                        {it.pg && (
                            styleType === 'compact' || styleType === 'backlog-compact' ? (
                                <span className={`text-[10px] font-medium tracking-wide flex-shrink-0 ml-2 mt-[3px] whitespace-nowrap tabular-nums ${isDone ? 'text-on-surface/15' : (styleType === 'backlog-compact' ? 'text-on-surface/50' : 'text-on-surface/35')}`}>
                                    {it.pg}
                                </span>
                            ) : (
                                <span className={`text-[10px] font-medium tracking-wide flex-shrink-0 ml-3 mt-[3px] whitespace-nowrap tabular-nums ${isDone ? 'text-on-surface/25' : 'text-on-surface/45'}`}>
                                    {it.pg}
                                </span>
                            )
                        )}
                    </div>
                ))}
            </div>
        );
    }
    
    // Fallback for unparsed tasks
    if (styleType === 'compact' || styleType === 'backlog-compact') {
        return <p className={`text-[13px] font-normal flex-1 leading-relaxed ${isDone ? 'line-through text-on-surface/30' : (styleType === 'backlog-compact' ? 'text-on-surface/90' : 'text-on-surface/70')}`}>{task}</p>;
    }
    return <p className={`text-[14px] font-normal flex-1 leading-relaxed ${isDone ? 'line-through opacity-30' : 'text-on-surface/90'}`}>{task}</p>;
}
