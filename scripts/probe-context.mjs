#!/usr/bin/env node
/**
 * probe-context.mjs — how much context does the free tier really accept?
 *
 *   node scripts/probe-context.mjs            # ladder: 200k -> 500k -> advertised
 *   node scripts/probe-context.mjs --full     # binary search to ~1.2M
 *   node scripts/probe-context.mjs deepseek-v4.1-flash-free 600000
 *
 * Hits the upstream endpoint directly (same wire identity as the gateway) so
 * the gateway's 120 s timeout cannot mask a slow prefill. Results are written
 * to data/context-probe.json for `doctor` to compare against the advertised
 * budgets in src/models/catalog.ts.
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const { createOpenCodeHeaders } = await import(new URL("../dist/providers/opencodeHeaders.js", import.meta.url));
const { ocSessionId } = await import(new URL("../dist/utils/ids.js", import.meta.url));
const { CONTEXT_DEFAULTS } = await import(new URL("../dist/models/catalog.js", import.meta.url));

const SENTENCE = "这是一个用于填充上下文长度的测试句子，请忽略它的具体含义。";
// Measured chars-per-token on this filler: deepseek ~2.07, glm ~1.81.
const RATIO = { "deepseek-v4.1-flash-free": 2.07, "glm-5.3-flash-free": 1.81 };
const DEFAULT_RATIO = 2.0;
const REQUEST_TIMEOUT_MS = 240000;

const buildFiller = (chars) => {
  const repeats = Math.ceil(chars / SENTENCE.length);
  return SENTENCE.repeat(repeats).slice(0, chars);
};

const attempt = (model, targetTokens) => new Promise((resolve) => {
  const ratio = RATIO[model] ?? DEFAULT_RATIO;
  const chars = Math.max(2000, Math.floor(targetTokens * ratio));
  const body = JSON.stringify({
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 8,
    messages: [{ role: "user", content: buildFiller(chars) }],
    tools: [
      { type: "function", function: { name: "read", description: "placeholder", parameters: { type: "object", properties: {} } } },
      { type: "function", function: { name: "bash", description: "placeholder", parameters: { type: "object", properties: {} } } },
    ],
  });
  const started = Date.now();
  const request = https.request({
    hostname: "opencode.ai",
    port: 443,
    path: "/zen/v1/chat/completions",
    method: "POST",
    headers: createOpenCodeHeaders(body, ocSessionId()),
    timeout: REQUEST_TIMEOUT_MS,
  }, (res) => {
    let text = "";
    res.on("data", (chunk) => { text += chunk.toString(); });
    res.on("end", () => {
      const status = res.statusCode ?? 0;
      const usageLine = text.split("\n").filter((line) => line.includes('"usage"')).pop() || "";
      let promptTokens = 0;
      try { promptTokens = JSON.parse(usageLine.replace(/^data:\s*/, "")).usage.prompt_tokens; } catch { promptTokens = 0; }
      const contextError = text.includes("context_length_exceeded");
      resolve({
        ok: status >= 200 && status < 300,
        status,
        promptTokens,
        chars,
        ms: Date.now() - started,
        contextError,
        detail: text.replace(/\s+/g, " ").slice(0, 400),
      });
    });
  });
  request.on("timeout", () => request.destroy(new Error("client timeout")));
  request.on("error", (error) => resolve({ ok: false, status: 0, promptTokens: 0, chars, ms: Date.now() - started, contextError: false, detail: error.message }));
  request.end(body);
});

const search = async (model, ladder) => {
  let maxAccepted = 0;
  let minRejected = 0;
  let lastOk = null;
  for (const target of ladder) {
    let result = await attempt(model, target);
    // 429/5xx "Endpoint is unavailable" is transient noise, not a context verdict.
    if (!result.ok && result.status !== 400) result = await attempt(model, target);
    const label = "  " + model.padEnd(26) + " target=" + String(target).padStart(8) +
      " -> HTTP " + String(result.status).padStart(3) +
      " tokens=" + String(result.promptTokens).padStart(8) + "  " + result.ms + "ms" +
      (result.contextError ? "  [context_length_exceeded]" : "");
    console.log(label);
    if (result.ok) {
      maxAccepted = Math.max(maxAccepted, result.promptTokens || target);
      lastOk = result;
    } else {
      minRejected = result.promptTokens || target;
      if (result.contextError) break;
    }
  }
  return { model, maxAcceptedTokens: maxAccepted, minRejectedTokens: minRejected || null, lastOkMs: lastOk?.ms ?? null };
};

const main = async () => {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const full = process.argv.includes("--full");
  const models = args.length >= 1 && !Number.isFinite(Number(args[0])) ? [args[0]] : Object.keys(CONTEXT_DEFAULTS);
  const advertised = CONTEXT_DEFAULTS;
  const results = [];

  console.log("");
  console.log("zen-hub context probe  (" + new Date().toISOString() + ")");
  console.log("");

  for (const model of models) {
    const budget = advertised[model]?.context ?? 200000;
    const ladder = args.length === 2
      ? [Number(args[1])]
      : full
        ? [200000, 400000, 600000, 800000, 1000000, 1200000]
        : [200000, 500000, budget];
    const result = await search(model, [...new Set(ladder)].sort((a, b) => a - b));
    results.push({ ...result, advertisedTokens: budget, checkedAt: new Date().toISOString() });
    console.log("");
  }

  // A single-size run is a smoke test, not a ceiling measurement: it must not
  // judge "shrunk" and must not overwrite the file `doctor` reads.
  const singleSize = args.length === 2;
  if (singleSize) {
    console.log("summary:");
    for (const item of results) {
      console.log("  " + item.model.padEnd(26) + " accepted≈" + item.maxAcceptedTokens + "  (single-size probe, verdict skipped)");
    }
    console.log("");
    process.exitCode = 0;
    return;
  }

  const outFile = path.resolve(process.cwd(), "data", "context-probe.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + "\n", "utf8");

  console.log("summary:");
  for (const item of results) {
    const shrink = item.maxAcceptedTokens < item.advertisedTokens * 0.95;
    console.log("  " + item.model.padEnd(26) + " accepted≈" + item.maxAcceptedTokens +
      "  advertised=" + item.advertisedTokens + (shrink ? "   << SHRUNK (upstream tightened?)" : ""));
  }
  console.log("");
  console.log("written: " + outFile);
  const shrunk = results.some((item) => item.maxAcceptedTokens < item.advertisedTokens * 0.95);
  process.exitCode = shrunk ? 2 : 0;
};

await main();
