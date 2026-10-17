#!/usr/bin/env node
/**
 * doctor.mjs — nine checks that answer "why isn't it working?" without reading logs.
 *
 *   node scripts/doctor.mjs
 *
 * Exit code 0 means every check either passed or was legitimately skipped.
 */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { loadConfig } from "../dist/config/env.js";
import { probeGate } from "../dist/providers/compat.js";
import { fetchLiveFreeIds } from "../dist/models/reconcile.js";

const results = [];
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  console.log("  [" + String(results.length).padStart(2, " ") + "] " + name.padEnd(16) + " " + status.padEnd(6) + " " + detail);
};

const isFree = (port, host) =>
  new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, host);
  });

const tryJson = async (url, timeoutMs = 4000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
};

const main = async () => {
  console.log("");
  console.log("zen-hub doctor");
  console.log("");

  // 1 runtime
  const major = Number(process.versions.node.split(".")[0]);
  record("runtime", major >= 20 ? "PASS" : "FAIL", "node " + process.versions.node + " on " + process.platform);

  const config = loadConfig();

  // 2 config surface (effective values come from /health when the gateway runs)
  const serviceProbe = await tryJson("http://127.0.0.1:" + config.port + "/health");
  let healthBody = null;
  try {
    healthBody = serviceProbe.status ? JSON.parse(serviceProbe.text) : null;
  } catch {
    healthBody = null;
  }
  const effectiveApiAuth = healthBody?.auth?.api ?? config.authMode;
  record("config", "INFO", config.host + ":" + config.port + " api-auth=" + effectiveApiAuth +
    (effectiveApiAuth !== config.authMode ? " (env says " + config.authMode + ")" : "") +
    " ctx-unlock=" + ((healthBody?.contextUnlock ?? config.contextUnlock) ? "on" : "off") +
    " egress=" + (config.upstreamProxyUrl || "direct"));
  record("api-auth", effectiveApiAuth === "off" ? "WARN" : "PASS",
    effectiveApiAuth === "off" ? "/v1 ignores API keys - anything on this machine can use it" : "requires a Bearer key");

  // 3 data dir
  const dataDir = path.resolve(process.cwd(), "data");
  const logsDir = path.resolve(process.cwd(), "data", "logs");
  let dataOk = true;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const probeFile = path.join(dataDir, ".doctor-write");
    fs.writeFileSync(probeFile, "ok");
    fs.unlinkSync(probeFile);
  } catch {
    dataOk = false;
  }
  record("data-dir", dataOk ? "PASS" : "FAIL", dataDir + (dataOk ? " writable" : " NOT writable"));

  // 4 admin password
  const configPath = path.resolve(process.cwd(), "config.env");
  const legacyPath = path.resolve(process.cwd(), ".env.local");
  const configSource = fs.existsSync(configPath) ? "config.env" : fs.existsSync(legacyPath) ? ".env.local (rename it to config.env)" : "";
  const password = (process.env.ADMIN_PASSWORD || "").trim();
  const passwordOk = Boolean(password) && password !== "admin";
  record("admin-password", passwordOk ? "PASS" : "FAIL", passwordOk ? "set (from " + (configSource || "environment") + ")" : "missing or still default — restart once to generate");

  // 5 console build
  const consoleIndex = path.resolve(process.cwd(), "web", "dist", "index.html");
  record("console", fs.existsSync(consoleIndex) ? "PASS" : "FAIL", fs.existsSync(consoleIndex) ? "web/dist present" : "web/dist missing — run build.cmd");

  // 6 port (in use is fine when it is this gateway holding it)
  const free = await isFree(config.port, config.host);
  let portStatus = free ? "PASS" : "WARN";
  let portDetail = config.port + (free ? " free" : " in use");
  if (!free) {
    const probe = await tryJson("http://127.0.0.1:" + config.port + "/health");
    if (probe.ok) {
      portStatus = "PASS";
      portDetail = config.port + " held by this gateway";
    } else {
      portDetail += " by another process (PORT_FALLBACK moves the gateway to the next one)";
    }
  }
  record("port", portStatus, portDetail);

  // 7 upstream catalog vs local list
  let liveIds = [];
  try {
    liveIds = await fetchLiveFreeIds(config);
    const modelsFile = path.resolve(process.cwd(), config.modelsFile);
    let stored = [];
    try {
      stored = JSON.parse(fs.readFileSync(modelsFile, "utf8")).models.map((model) => model.id);
    } catch {
      stored = [];
    }
    const missing = liveIds.filter((id) => !stored.includes(id));
    record("catalog", liveIds.length > 0 ? "PASS" : "FAIL", liveIds.length + " live free ids, " + missing.length + " not yet in models.json");
  } catch (error) {
    record("catalog", "FAIL", "cannot read upstream catalog: " + (error instanceof Error ? error.message : String(error)));
  }

  // 8 gate probe
  const gate = await probeGate({
    hostname: config.zenHost,
    chatPath: config.zenPath,
    model: liveIds[0] && liveIds[0] !== "jev-1.13-free" ? liveIds[0] : config.proxyHealthCheckModel,
    timeoutMs: 15000,
    proxyUrl: config.upstreamProxyUrl,
  });
  const gateStatus = gate.state === "ok" ? "PASS" : gate.state === "blocked" ? "FAIL" : "WARN";
  record("gate", gateStatus, gate.state + " — " + gate.message);

  // 9 local service
  if (serviceProbe.status === 0) {
    record("service", "SKIP", "not running on port " + config.port);
  } else {
    record("service", serviceProbe.ok && healthBody ? "PASS" : "FAIL", serviceProbe.ok && healthBody
      ? "v" + healthBody.version + " models=" + healthBody.models + " gate=" + healthBody.gate.state
      : "HTTP " + serviceProbe.status);
  }

  // 10 context probe vs advertised budgets
  const probeFile = path.resolve(process.cwd(), "data", "context-probe.json");
  if (!fs.existsSync(probeFile)) {
    record("context-probe", "SKIP", "no probe yet - run: npm run probe:context");
  } else {
    try {
      const probe = JSON.parse(fs.readFileSync(probeFile, "utf8"));
      const rows = Array.isArray(probe.results) ? probe.results : [];
      const shrunk = rows.filter((item) => Number(item.maxAcceptedTokens) < Number(item.advertisedTokens) * 0.95);
      const detail = rows
        .map((item) => item.model.replace(/-free$/, "") + "≈" + Math.round(Number(item.maxAcceptedTokens) / 1000) + "k/" + Math.round(Number(item.advertisedTokens) / 1000) + "k")
        .join(", ");
      record("context-probe", rows.length === 0 ? "SKIP" : shrunk.length === 0 ? "PASS" : "FAIL",
        rows.length === 0 ? "probe file is empty" : detail + (shrunk.length ? "  << upstream shrank the window" : ""));
    } catch (error) {
      record("context-probe", "SKIP", "unreadable probe file: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  const failed = results.filter((item) => item.status === "FAIL").length;
  const warned = results.filter((item) => item.status === "WARN").length;
  const skipped = results.filter((item) => item.status === "SKIP").length;
  console.log("");
  console.log("summary: " + (results.length - failed - warned - skipped) + " pass, " + warned + " warn, " + failed + " fail, " + skipped + " skipped");
  console.log("");
  process.exitCode = failed > 0 ? 1 : 0;
};

await main();
