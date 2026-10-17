import { cn } from "@/lib/utils";

interface ResultStripProps {
  results: Array<{ ok: boolean }>;
  slots?: number;
}

export function ResultStrip({ results, slots = 20 }: ResultStripProps) {
  const recent = results.slice(-slots);
  const pad = Math.max(0, slots - recent.length);
  const cells = [...Array.from({ length: pad }, () => null), ...recent];
  return (
    <div className="flex gap-px" title={`近 ${recent.length} 次请求结果（最新在右）`}>
      {cells.map((cell, i) => (
        <div
          key={i}
          className={cn(
            "h-2 flex-1 rounded-sm transition-colors",
            cell === null ? "bg-muted" : cell.ok ? "bg-success/80" : "bg-destructive/80"
          )}
        />
      ))}
    </div>
  );
}
