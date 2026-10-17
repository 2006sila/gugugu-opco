import { motion } from "motion/react";
import { ArrowRight, Boxes, Cable, Route, ServerCog, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fadeUp, staggerContainer } from "@/lib/motion";
import type { ConsoleData } from "../hooks/useConsoleData";
import type { View } from "../types";

const flow = [
  { icon: Boxes, title: "客户端", sub: "Cursor、Cline、Claude Code" },
  { icon: ServerCog, title: "Fastify 网关", sub: "OpenAI + Anthropic 兼容" },
  { icon: Route, title: "前置代理", sub: "可选链式 7897" },
  { icon: Cable, title: "Zen 上游", sub: "opencode.ai" },
];

export function DashboardView({ data, onSelect }: { data: ConsoleData; onSelect: (view: View) => void }) {
  const { apiKeys, models } = data;
  const enabledModels = models.filter((m) => m.enabled).length;
  const enabledKeys = apiKeys.filter((k) => k.enabled).length;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
    >
      <motion.div variants={fadeUp} className="lg:col-span-2">
        <Card className="h-full p-5">
          <h2 className="text-sm font-semibold">网关拓扑</h2>
          <p className="mt-1 text-xs text-muted-foreground">请求自客户端经网关、可选前置代理抵达 Zen 上游</p>
          <motion.div
            variants={staggerContainer}
            className="mt-5 flex flex-wrap items-center gap-3"
          >
            {flow.map((node, idx) => {
              const Icon = node.icon;
              return (
                <motion.div key={node.title} variants={fadeUp} className="flex items-center gap-3">
                  <div className="flex w-32 flex-col items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-3 text-center">
                    <span className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary ring-1 ring-inset ring-primary/20">
                      <Icon size={18} />
                    </span>
                    <span className="text-sm font-medium">{node.title}</span>
                    <span className="text-[11px] leading-tight text-muted-foreground">{node.sub}</span>
                  </div>
                  {idx < flow.length - 1 && <ArrowRight size={16} className="text-muted-foreground/60" />}
                </motion.div>
              );
            })}
          </motion.div>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="h-full p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck size={16} className="text-primary" /> 摘要
            </h2>
            <Button variant="ghost" size="sm" onClick={() => onSelect("keys")}>
              管理
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="surface-inset p-3">
              <div className="text-xs text-muted-foreground">API Key</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {enabledKeys}
                <span className="text-sm font-normal text-muted-foreground">/{apiKeys.length}</span>
              </div>
              <MiniBar ratio={apiKeys.length ? enabledKeys / apiKeys.length : 0} tone="primary" />
            </div>
            <div className="surface-inset p-3">
              <div className="text-xs text-muted-foreground">启用模型</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {enabledModels}
                <span className="text-sm font-normal text-muted-foreground">/{models.length}</span>
              </div>
              <MiniBar ratio={models.length ? enabledModels / models.length : 0} tone="success" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {apiKeys.slice(0, 4).map((key) => (
              <div key={key.id} className="flex items-center justify-between text-sm">
                <span className="truncate text-foreground/80">{key.name}</span>
                <Badge variant={key.enabled ? "success" : "muted"}>{key.enabled ? "启用" : "禁用"}</Badge>
              </div>
            ))}
            {apiKeys.length === 0 && <p className="text-sm text-muted-foreground/70">暂无 API Key</p>}
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}

function MiniBar({ ratio, tone }: { ratio: number; tone: "primary" | "success" }) {
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
      <motion.div
        className={cn("h-full rounded-full", tone === "primary" ? "bg-primary" : "bg-success")}
        initial={false}
        animate={{ transform: `scaleX(${Math.min(1, ratio)})` }}
        style={{ transformOrigin: "left" }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
