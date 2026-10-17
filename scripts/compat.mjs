#!/usr/bin/env node
/**
 * compat.mjs — ask the upstream gate one question: "will you still talk to us?"
 *
 * Exits 0 when the gate is open, 2 when it is blocked (the session/header
 * contract changed upstream), 1 on any other failure. Prints the exact
 * next action so a broken upgrade is obvious.
 */
import { loadConfig } from "../dist/config/env.js";
import { probeGate } from "../dist/providers/compat.js";

const main = async () => {
  const config = loadConfig();
  const model = process.argv[2] || config.proxyHealthCheckModel || "big-pickle";
  console.log("probe: " + config.zenHost + config.zenPath + " model=" + model);
  console.log("egress: " + (config.upstreamProxyUrl || "direct"));

  const result = await probeGate({
    hostname: config.zenHost,
    chatPath: config.zenPath,
    model,
    timeoutMs: 15000,
    proxyUrl: config.upstreamProxyUrl,
  });

  console.log("user-agent: " + result.userAgent);
  console.log("state: " + result.state + (result.statusCode === null ? "" : " (HTTP " + result.statusCode + ")"));
  console.log("detail: " + result.message);

  if (result.state === "blocked") {
    console.log("");
    console.log("what this means: upstream no longer accepts the CLI identity this build impersonates.");
    console.log("what to do   : compare src/utils/ids.ts and src/providers/opencodeHeaders.ts with the");
    console.log("               current OpenCode client, bump OPENCODE_USER_AGENT, rebuild.");
    process.exitCode = 2;
    return;
  }
  process.exitCode = result.state === "ok" ? 0 : 1;
};

await main();
