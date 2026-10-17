import dotenv from "dotenv";

// config.env is the file this build actually uses (bootstrap writes the admin
// password there); the old .env.local is still read for pre-0.2.1 installs and
// .env stays supported for people who prefer it. dotenv never overwrites an
// already-set variable, so the first file to define a key wins.
dotenv.config({ path: "config.env" });
dotenv.config({ path: ".env.local" });
dotenv.config();

const intFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolFromEnv = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
};

const proxyModeFromEnv = (): "direct" | "optional" | "required" => {
  const raw = process.env.PROXY_MODE?.toLowerCase();
  if (raw === "direct" || raw === "optional" || raw === "required") return raw;
  return boolFromEnv("REQUIRE_PROXY", false) ? "required" : "optional";
};

/**
 * One env var for "where does my upstream traffic go". Mirrors the Go plugin's
 * OPENCODEHUB_PROXY: empty or direct/none/off means connect directly.
 */
const upstreamProxyFromEnv = (): string => {
  const raw = (process.env.UPSTREAM_PROXY || "").trim();
  if (!raw) return "";
  if (["direct", "none", "off", "0", "false"].includes(raw.toLowerCase())) return "";
  return raw;
};

const responsesPathFromChatPath = (path: string): string => {
  const converted = path.replace(/\/chat\/completions\/?$/, "/responses");
  return converted === path ? "/zen/v1/responses" : converted;
};

export interface AppConfig {
  host: string;
  port: number;
  portFallback: boolean;
  portFallbackMax: number;
  keysFile: string;
  modelsFile: string;
  modelAliasesFile: string;
  settingsFile: string;
  proxiesFile: string;
  logsDir: string;
  adminPassword: string;
  authMode: "key" | "off";
  consoleAuthMode: "password" | "off";
  /** Open the console in the default browser once the listener is up. */
  openConsoleOnStart: boolean;
  /** True when OPEN_CONSOLE was set explicitly, which overrides the console switch. */
  openConsoleOnStartExplicit: boolean;
  /** Cold-start default for the context switch (the console setting wins afterwards). */
  contextUnlock: boolean;
  upstreamProxyUrl: string;
  zenHost: string;
  zenPath: string;
  zenResponsesPath: string;
  zenSystemonePath: string;
  upstreamTimeoutMs: number;
  globalRequestsPerMinute: number;
  apiKeyRequestsPerMinute: number;
  apiKeyMaxConcurrentRequests: number;
  apiKeyMaxConcurrentStreams: number;
  redisUrl: string;
  redisKeyPrefix: string;
  shutdownDrainTimeoutMs: number;
  storePlaintextApiKeys: boolean;
  proxyMode: "direct" | "optional" | "required";
  outboundPreProxyEnabled: boolean;
  outboundPreProxyUrl: string;
  proxyHealthCheckModel: string;
  proxyHealthCheckTimeoutMs: number;
  proxyRecoveryIntervalMs: number;
  proxyRecoveryConcurrency: number;
  proxyRecoveryBatchSize: number;
  proxyPersistDebounceMs: number;
  proxyCooldownMs: number;
  proxyLargePoolWarningThreshold: number;
}

export const loadConfig = (): AppConfig => {
  const zenPath = process.env.ZEN_PATH || "/zen/v1/chat/completions";
  const authMode = (process.env.AUTH_MODE || "key").toLowerCase() === "off" ? "off" : "key";
  const consoleAuthMode = (process.env.CONSOLE_AUTH || "password").toLowerCase() === "off" ? "off" : "password";
  return {
    // Loopback by default: this build is meant for one person on one machine.
    host: process.env.PROXY_HOST || "127.0.0.1",
    // 8788 is deliberately not the default: that port belongs to another tool.
    port: intFromEnv("PROXY_PORT", 8790),
    portFallback: boolFromEnv("PORT_FALLBACK", true),
    portFallbackMax: Math.max(1, intFromEnv("PORT_FALLBACK_MAX", 8799)),
    keysFile: process.env.KEYS_FILE || "./data/api-keys.json",
    modelsFile: process.env.MODELS_FILE || "./data/models.json",
    modelAliasesFile: process.env.MODEL_ALIASES_FILE || "./data/model-aliases.json",
    settingsFile: process.env.SETTINGS_FILE || "./data/settings.json",
    proxiesFile: process.env.PROXIES_FILE || "./data/proxies.json",
    logsDir: process.env.LOGS_DIR || "./data/logs",
    adminPassword: process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN || "admin",
    authMode,
    consoleAuthMode,
    openConsoleOnStart: boolFromEnv("OPEN_CONSOLE", true),
    openConsoleOnStartExplicit: process.env.OPEN_CONSOLE !== undefined,
    contextUnlock: boolFromEnv("CONTEXT_UNLOCK", false),
    upstreamProxyUrl: upstreamProxyFromEnv(),
    zenHost: process.env.ZEN_HOST || "opencode.ai",
    zenPath,
    zenResponsesPath: process.env.ZEN_RESPONSES_PATH || responsesPathFromChatPath(zenPath),
    zenSystemonePath: process.env.ZEN_SYSTEMONE_PATH || "/zen/v1/systemone",
    upstreamTimeoutMs: intFromEnv("UPSTREAM_TIMEOUT_MS", 120000),
    globalRequestsPerMinute: intFromEnv("GLOBAL_REQUESTS_PER_MINUTE", 120),
    apiKeyRequestsPerMinute: intFromEnv("API_KEY_REQUESTS_PER_MINUTE", 60),
    apiKeyMaxConcurrentRequests: intFromEnv("API_KEY_MAX_CONCURRENT_REQUESTS", 10),
    apiKeyMaxConcurrentStreams: intFromEnv("API_KEY_MAX_CONCURRENT_STREAMS", 5),
    redisUrl: process.env.REDIS_URL || "",
    redisKeyPrefix: process.env.REDIS_KEY_PREFIX || "zen-hub:limit",
    shutdownDrainTimeoutMs: intFromEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", 30000),
    storePlaintextApiKeys: boolFromEnv("STORE_PLAINTEXT_API_KEYS", false),
    proxyMode: proxyModeFromEnv(),
    outboundPreProxyEnabled: boolFromEnv("OUTBOUND_PRE_PROXY_ENABLED", false),
    outboundPreProxyUrl: process.env.OUTBOUND_PRE_PROXY_URL || "",
    proxyHealthCheckModel: process.env.PROXY_HEALTH_CHECK_MODEL?.trim() || "big-pickle",
    proxyHealthCheckTimeoutMs: Math.max(1000, intFromEnv("PROXY_HEALTH_CHECK_TIMEOUT_MS", 10000)),
    proxyRecoveryIntervalMs: Math.max(1000, intFromEnv("PROXY_RECOVERY_INTERVAL_MS", 10 * 60 * 1000)),
    proxyRecoveryConcurrency: Math.max(1, Math.min(16, intFromEnv("PROXY_RECOVERY_CONCURRENCY", 2))),
    proxyRecoveryBatchSize: Math.max(1, Math.min(1000, intFromEnv("PROXY_RECOVERY_BATCH_SIZE", 32))),
    proxyPersistDebounceMs: Math.max(100, Math.min(60000, intFromEnv("PROXY_PERSIST_DEBOUNCE_MS", 1000))),
    proxyCooldownMs: Math.max(0, intFromEnv("PROXY_COOLDOWN_MS", 5 * 60 * 1000)),
    proxyLargePoolWarningThreshold: Math.max(1000, intFromEnv("PROXY_LARGE_POOL_WARNING_THRESHOLD", 10000)),
  };
};
