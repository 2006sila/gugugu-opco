import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToastMessage } from "../hooks/useConsoleData";

const toneMap: Record<ToastMessage["tone"], { Icon: React.ComponentType<{ size?: number; className?: string }>; iconCls: string; box: string }> = {
  success: { Icon: CheckCircle2, iconCls: "text-success", box: "border-success/25 bg-success/[0.08]" },
  error: { Icon: XCircle, iconCls: "text-destructive", box: "border-destructive/25 bg-destructive/[0.08]" },
  info: { Icon: Info, iconCls: "text-info", box: "border-info/25 bg-info/[0.08]" },
};

export function Toasts({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-full max-w-sm flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const { Icon, iconCls, box } = toneMap[toast.tone];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-popover/95 p-3 shadow-xl shadow-black/40 backdrop-blur",
                box
              )}
              onClick={() => onDismiss(toast.id)}
              role="status"
            >
              <Icon size={16} className={cn("mt-0.5 shrink-0", iconCls)} />
              <span className="text-sm text-popover-foreground">{toast.text}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
