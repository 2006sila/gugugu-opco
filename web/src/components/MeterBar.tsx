import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface MeterBarProps {
  label: string;
  current: number;
  max: number;
  unlimitedText?: string;
}

export function MeterBar({ label, current, max, unlimitedText = "不限" }: MeterBarProps) {
  const unlimited = !max || max <= 0;
  const ratio = unlimited ? 0 : Math.min(1, current / max);
  const tone = ratio >= 0.9 ? "bg-destructive" : ratio >= 0.7 ? "bg-warning" : "bg-success";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {current}
          {unlimited ? ` / ${unlimitedText}` : ` / ${max}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className={cn("h-full rounded-full", unlimited ? "bg-info/60" : tone)}
          initial={false}
          animate={{ transform: `scaleX(${unlimited ? 0 : ratio})` }}
          style={{ transformOrigin: "left" }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
