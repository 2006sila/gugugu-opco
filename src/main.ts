import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { buildApp } from "./app.js";
import { bootstrapRuntime } from "./config/bootstrap.js";
import { loadConfig } from "./config/env.js";
import { startCatalogReconciliation } from "./models/reconcile.js";
import { probeGate } from "./providers/compat.js";
import { openConsole } from "./runtime/openConsole.js";
import { serverInfo } from "./runtime/runtimeStatus.js";

// First run: create data/ and mint an admin password into config.env before
// the config is read, so a fresh checkout never runs with the known default.
const boot = bootstrapRuntime();
const config = loadConfig();

const isPortFree = (port: number, host: string): Promise<boolean> =>
  new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, host);
  });

const pickPort = async (): Promise<number> => {
  const preferred = config.port;
  const candidates: number[] = [preferred];
  if (config.portFallback) {
    for (let candidate = preferred + 1; candidate <= config.portFallbackMax; candidate += 1) {
      candidates.push(candidate);
    }
  }
  for (const candidate of candidates) {
    if (await isPortFree(candidate, config.host)) return candidate;
  }
  return 0;
};

const { app, keyStore, modelStore, settingsStore } = await buildApp(config);
const port = await pickPort();

if (port === 0) {
  app.log.error(
    { host: config.host, port: config.port, fallbackMax: config.portFallbackMax },
    "no free port: another process owns every candidate; set PROXY_PORT to a free port",
  );
  const hint = "Run: node scripts/port-check.mjs   (lists listening ports and their owners)";
  console.error(hint);
  process.exit(1);
}

if (port !== config.port) {
  app.log.warn({ wanted: config.port, using: port }, "port_in_use_fell_back");
}

try {
  await app.listen({ host: config.host, port });
} catch (error) {
  app.log.error(error, "failed_to_start");
  process.exit(1);
}

serverInfo.port = port;

// 0.0.0.0 is not a browsable address; loopback is.
const browseHost = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
const baseUrl = "http://" + browseHost + ":" + port;
// OPEN_CONSOLE, when set in config.env, wins over the console toggle.
const openConsoleOnStart = config.openConsoleOnStartExplicit
  ? config.openConsoleOnStart
  : settingsStore.get().openConsoleOnStart;
console.log("");
console.log("  zen-hub " + serverInfo.version + "  (loopback build)");
console.log("  ------------------------------------------------");
console.log("  API base : " + baseUrl + "/v1");
console.log("  Console  : " + baseUrl + "/app/");
console.log("  Health   : " + baseUrl + "/health");
console.log("  Auth     : " + (config.authMode === "off" ? "off (no key needed)" : "api key"));
console.log("  Egress   : " + (config.upstreamProxyUrl ? "proxy " + config.upstreamProxyUrl : "direct (no proxy)"));
console.log("  Data     : " + config.keysFile.replace(/[^\\/]+$/, ""));
console.log("  Config   : " + boot.configPath);
try {
  fs.writeFileSync(
    path.resolve(process.cwd(), "data", "runtime.txt"),
    "url=" + baseUrl + "/app/\n" +
      "open=" + (openConsoleOnStart ? "1" : "0") + "\n" +
      "port=" + port + "\n" +
      "pid=" + process.pid + "\n",
    "utf8",
  );
} catch (error) {
  app.log.warn({ error: error instanceof Error ? error.message : String(error) }, "runtime_file_failed");
}
const browserLine = !openConsoleOnStart
  ? "auto-open off"
  : process.env.ZEN_HUB_SUPPRESS_OPEN === "1"
    ? "start.cmd opens " + baseUrl + "/app/"
    : "opening " + baseUrl + "/app/";
console.log("  Browser  : " + browserLine);
console.log("  ------------------------------------------------");
if (boot.migratedConfig) {
  console.log("  Migrated .env.local -> config.env (the old name is gone)");
}
if (boot.generatedAdminPassword) {
  console.log("  Console password (generated now, stored in config.env):");
  console.log("    " + boot.adminPassword);
}
const createdKeys = keyStore.consumeCreatedOnLoad();
for (const created of createdKeys) {
  console.log("  New API key [" + created.name + "] (shown once):");
  console.log("    " + created.key);
}
console.log("");

// start.cmd opens the browser itself (it runs in the interactive desktop), so
// it sets ZEN_HUB_SUPPRESS_OPEN=1 to avoid a second tab.
if (openConsoleOnStart && process.env.ZEN_HUB_SUPPRESS_OPEN !== "1") {
  openConsole(baseUrl + "/app/", (message) => {
    app.log.warn({ error: message }, "open_console_failed");
    console.warn("  [!] could not open the browser automatically: " + message);
  });
}

void startCatalogReconciliation(modelStore, config, app.log);

const firstModel = modelStore.enabledIds().find((id) => !modelStore.isSystemOneOnly(id)) || "big-pickle";
void probeGate({
  hostname: config.zenHost,
  chatPath: config.zenPath,
  model: firstModel,
  timeoutMs: 8000,
  proxyUrl: config.upstreamProxyUrl,
}).then((result) => {
  app.log.info({ state: result.state, statusCode: result.statusCode, message: result.message }, "upstream_gate_probe");
  if (result.state === "blocked") {
    console.warn("  [!] upstream rejected the probe identity: the free-tier gate changed. Run: npm run compat:check");
  }
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "shutting_down");
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
