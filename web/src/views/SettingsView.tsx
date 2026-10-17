import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Gauge, Route, ShieldCheck, Waypoints } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fadeUp, staggerContainer } from "@/lib/motion";
import type { ConsoleData } from "../hooks/useConsoleData";
import type { SystemSettings } from "../types";

const proxyModes = [
  { value: "direct", label: "直连", description: "所有请求不使用代理池" },
  { value: "optional", label: "优先代理", description: "有可用节点则使用，否则直连" },
  { value: "required", label: "强制代理", description: "无可用节点时请求失败" },
] as const;

export function SettingsView({ data }: { data: ConsoleData }) {
  const { settings, busy, updateSettings } = data;
  const [preProxyDraft, setPreProxyDraft] = useState("");

  useEffect(() => {
    setPreProxyDraft(settings?.outboundPreProxyUrl ?? "");
  }, [settings?.outboundPreProxyUrl]);

  if (!settings) return <p className="text-sm text-muted-foreground">设置加载中…</p>;

  const numberField = (label: string, key: keyof SystemSettings, disabled = false, min?: number, max?: number) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        disabled={busy || disabled}
        min={min}
        max={max}
        step={min !== undefined || max !== undefined ? 1 : undefined}
        value={settings[key] as number}
        onChange={(e) => updateSettings({ [key]: Number(e.target.value) } as Partial<SystemSettings>)}
      />
    </div>
  );

  const toggleField = (label: string, key: keyof SystemSettings, disabled = false) => (
    <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-3">
      <span className="text-sm">{label}</span>
      <Switch
        disabled={busy || disabled}
        checked={settings[key] as boolean}
        onCheckedChange={(v) => updateSettings({ [key]: v } as Partial<SystemSettings>)}
      />
    </div>
  );

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <motion.div variants={fadeUp}>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">网关参数</h2>
          <div className="mt-4 space-y-4">
            {numberField("上游超时（毫秒）", "upstreamTimeoutMs")}
            {numberField("请求体限制（字节）", "requestBodyLimitBytes")}
            <div>
              {numberField("自动重试次数", "autoRetryCount", false, 0, 10)}
              <p className="mt-1 text-xs text-muted-foreground">失败后自动切换代理重试的次数，0 表示关闭，最多 10 次。</p>
            </div>
            {toggleField("默认流式输出", "defaultStream")}
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">访问与启动</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            前两个开关即时生效；"启动后自动打开控制台"在下次启动时生效。只在本机绑定时才建议关闭密码。
          </p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">控制台免密</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {settings.consoleAuthMode === "off"
                    ? "已关闭：打开控制台不再要求输入密码"
                    : "已开启：进入控制台需要密码"}
                </div>
              </div>
              <Switch
                disabled={busy}
                checked={settings.consoleAuthMode === "off"}
                aria-label="控制台免密"
                onCheckedChange={(enabled) => updateSettings({ consoleAuthMode: enabled ? "off" : "password" })}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">接口免密（跳过 API Key）</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {settings.apiAuthMode === "off"
                    ? "已关闭：/v1 接口不再校验 API Key"
                    : "已开启：/v1 接口要求 Bearer API Key"}
                </div>
              </div>
              <Switch
                disabled={busy}
                checked={settings.apiAuthMode === "off"}
                aria-label="接口免密"
                onCheckedChange={(enabled) => updateSettings({ apiAuthMode: enabled ? "off" : "key" })}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">启动后自动打开控制台</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {settings.openConsoleOnStart
                    ? "已开启：下次启动会自动打开本页"
                    : "已关闭：启动后需要自己打开地址"}
                </div>
              </div>
              <Switch
                disabled={busy}
                checked={settings.openConsoleOnStart}
                aria-label="启动后自动打开控制台"
                onCheckedChange={(enabled) => updateSettings({ openConsoleOnStart: enabled })}
              />
            </div>
          </div>
          {(settings.consoleAuthMode === "off" || settings.apiAuthMode === "off") && (
            <p className="mt-3 text-xs text-warning">
              有开关处于关闭状态：任何能访问 {window.location.host} 的本机进程都可以直接使用。
            </p>
          )}
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Gauge size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">上下文上限</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            官方目录给免费模型标的是 200k，但实测上游能吃更多。打开后 /v1/models 会广播实测值；关闭则与官方口径一致。只改元数据，不拦请求。
          </p>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">对外宣称实测上限</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {settings.contextUnlock ? "已开启：deepseek 1M / glm 786k" : "已关闭：按官方目录 200k"}
              </div>
            </div>
            <Switch
              disabled={busy}
              checked={settings.contextUnlock}
              aria-label="对外宣称实测上限"
              onCheckedChange={(enabled) => updateSettings({ contextUnlock: enabled })}
            />
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-muted-foreground">
            <div className="flex justify-between gap-3">
              <dt>deepseek-v4.1-flash-free</dt>
              <dd className="tabular-nums">1,000,000 / 384,000</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>glm-5.3-flash-free</dt>
              <dd className="tabular-nums">786,432 / 131,072</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-warning">超过上游真实上限（glm 实测 ~800k 被拒）仍会收到 400 context_length_exceeded。</p>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">速率限制</h2>
          <p className="mt-1 text-xs text-muted-foreground">设为 0 表示不限制</p>
          <div className="mt-4 space-y-4">
            {numberField("全局请求数/分钟", "globalRequestsPerMinute")}
            {numberField("API Key 请求数/分钟", "apiKeyRequestsPerMinute")}
            {numberField("API Key 最大并发请求", "apiKeyMaxConcurrentRequests")}
            {numberField("API Key 最大并发流", "apiKeyMaxConcurrentStreams")}
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">错误日志</h2>
          <div className="mt-4 space-y-3">
            {toggleField("启用错误文件日志", "logEnabled")}
            <div className="grid grid-cols-2 gap-3">
              {numberField("日志保留天数", "logRetentionDays", !settings.logEnabled)}
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Route size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">代理使用模式</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">控制请求是否使用出口代理池，修改后对下一个请求即时生效。</p>
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
            {proxyModes.map((mode) => {
              const active = settings.proxyMode === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  className={cn(
                    "group relative rounded-lg border p-3 text-left transition-colors",
                    active ? "border-primary bg-primary/10 ring-1 ring-inset ring-primary/30" : "border-border bg-muted/30 hover:bg-muted/50",
                  )}
                  disabled={busy}
                  onClick={() => updateSettings({ proxyMode: mode.value })}
                >
                  {active && (
                    <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-content">
                      <Check size={12} strokeWidth={3} />
                    </span>
                  )}
                  <span className={cn("block text-sm font-medium", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                    {mode.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{mode.description}</span>
                </button>
              );
            })}
          </div>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Waypoints size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">出站前置代理（链式代理）</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            所有实际选中代理节点的出站连接会先经此地址再连上游，修改后无需重启。
          </p>
          <div className="mt-4 flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">前置代理</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {settings.outboundPreProxyEnabled ? "已开启，节点经前置代理出网" : "已关闭，节点直连上游"}
              </div>
            </div>
            <Switch
              disabled={busy}
              checked={settings.outboundPreProxyEnabled}
              onCheckedChange={() => updateSettings({ outboundPreProxyEnabled: !settings.outboundPreProxyEnabled })}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label className="text-xs text-muted-foreground">前置代理地址（http/https）</Label>
              <Input
                value={preProxyDraft}
                disabled={busy}
                onChange={(e) => setPreProxyDraft(e.target.value)}
                placeholder="http://127.0.0.1:7897"
              />
            </div>
            <Button
              size="sm"
              disabled={busy || preProxyDraft.trim() === (settings.outboundPreProxyUrl || "").trim()}
              onClick={() => updateSettings({ outboundPreProxyUrl: preProxyDraft.trim() })}
            >
              保存
            </Button>
          </div>
          {!(settings.outboundPreProxyUrl || "").trim() && (
            <p className="mt-2 text-xs text-warning/90">请先填写并保存地址，再开启前置代理。</p>
          )}
        </Card>
      </motion.div>
    </motion.div>
  );
}
