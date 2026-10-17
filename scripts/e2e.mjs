#!/usr/bin/env node
/**
 * e2e.mjs — end-to-end check against a RUNNING gateway.
 *
 *   node scripts/e2e.mjs [--model big-pickle]
 *
 * The API key comes from E2E_API_KEY, or from data/api-keys.json when the
 * gateway was started with STORE_PLAINTEXT_API_KEYS=true. Exit code 0 means
 * every required case passed.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const modelArg = (() => {
  const index = args.indexOf("--model");
  return index >= 0 ? args[index + 1] : undefined;
})();

const key = (() => {
  if (process.env.E2E_API_KEY) return process.env.E2E_API_KEY;
  try {
    const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data", "api-keys.json"), "utf8"));
    const first = (file.keys || []).find((item) => item.keyPlaintext);
    return first ? first.keyPlaintext : "";
  } catch {
    return "";
  }
})();

const port = process.env.PROXY_PORT || "8790";
const baseUrl = process.env.ZEN_HUB_URL || "http://127.0.0.1:" + port;
const model = modelArg || process.env.E2E_MODEL || "big-pickle";
const authMode = (process.env.AUTH_MODE || "key").toLowerCase();

const headers = (withAuth) => {
  const out = { "Content-Type": "application/json" };
  if (withAuth && key) out.Authorization = "Bearer " + key;
  return out;
};

const results = [];
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  console.log("  " + name.padEnd(18) + " " + status.padEnd(6) + " " + detail);
};

const request = async (pathname, init = {}, timeoutMs = 90000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + pathname, { ...init, signal: controller.signal });
    const text = await response.text();
    return { status: response.status, text };
  } catch (error) {
    return { status: 0, text: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
};

const brief = (text) => text.replace(/\s+/g, " ").slice(0, 160);

const main = async () => {
  console.log("");
  console.log("zen-hub e2e  ->  " + baseUrl + "  model=" + model + "  auth=" + authMode);
  console.log("");

  const health = await request("/health");
  let healthBody = null;
  try {
    healthBody = JSON.parse(health.text);
  } catch {
    healthBody = null;
  }
  record("health", health.status === 200 && healthBody ? "PASS" : "FAIL", healthBody ? "v" + healthBody.version + " gate=" + healthBody.gate.state : "HTTP " + health.status);

  const models = await request("/v1/models");
  let modelCount = 0;
  try {
    modelCount = JSON.parse(models.text).data.length;
  } catch {
    modelCount = 0;
  }
  record("models", models.status === 200 && modelCount > 0 ? "PASS" : "FAIL", modelCount + " models advertised");

  const chat = await request("/v1/chat/completions", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word: pong" }], max_tokens: 32, stream: false }),
  });
  let chatText = "";
  let chatFinish = "";
  try {
    const parsed = JSON.parse(chat.text);
    chatText = parsed?.choices?.[0]?.message?.content ?? "";
    chatFinish = parsed?.choices?.[0]?.finish_reason ?? "";
  } catch {
    chatText = "";
  }
  record("chat", chat.status === 200 && (chatText.length > 0 || chatFinish.length > 0) ? "PASS" : "FAIL", chat.status === 200 ? "content=" + brief(chatText || "(tools only)") : "HTTP " + chat.status + " " + brief(chat.text));

  const stream = await request("/v1/chat/completions", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Count to three." }], max_tokens: 32, stream: true }),
  });
  const dataFrames = (stream.text.match(/^data: /gm) || []).length;
  const hasDone = stream.text.includes("[DONE]");
  record("chat-stream", stream.status === 200 && dataFrames > 0 ? "PASS" : "FAIL", dataFrames + " data frames, [DONE]=" + hasDone);

  const tooled = await request("/v1/chat/completions", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "What time is it? Use the tool." }],
      max_tokens: 64,
      tools: [{ type: "function", function: { name: "get_time", description: "Returns the current time", parameters: { type: "object", properties: {} } } }],
      tool_choice: "auto",
    }),
  });
  let finish = "";
  let toolNames = "";
  try {
    const parsed = JSON.parse(tooled.text);
    finish = parsed?.choices?.[0]?.finish_reason ?? "";
    toolNames = (parsed?.choices?.[0]?.message?.tool_calls || []).map((call) => call.function?.name).join(",");
  } catch {
    finish = "";
  }
  const leaked = /\b(bash|read)\b/.test(toolNames) && toolNames.length > 0;
  record("tools", tooled.status === 200 && !leaked ? "PASS" : "FAIL", "finish=" + (finish || "?") + " calls=" + (toolNames || "none"));

  const responses = await request("/v1/responses", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ model, input: "Reply with the single word: pong", max_output_tokens: 256 }),
  });
  record("responses-api", responses.status === 200 ? "PASS" : "FAIL", responses.status === 200 ? brief(responses.text) : "HTTP " + responses.status + " " + brief(responses.text));

  const anthropic = await request("/v1/messages", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ model, max_tokens: 256, messages: [{ role: "user", content: "Reply with the single word: pong" }] }),
  });
  record("anthropic-api", anthropic.status === 200 ? "PASS" : "FAIL", anthropic.status === 200 ? brief(anthropic.text) : "HTTP " + anthropic.status + " " + brief(anthropic.text));

  // Trust the running gateway's own switch (/health.auth.api), not the shell env:
  // AUTH_MODE only seeds the first start, after that the console setting wins.
  const runtimeApiAuth = healthBody?.auth?.api || authMode;
  if (runtimeApiAuth === "key") {
    const denied = await request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer not-a-real-key" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 4 }),
    });
    record("auth-reject", denied.status === 401 ? "PASS" : "FAIL", "wrong key -> HTTP " + denied.status);
  } else {
    record("auth-off", "SKIP", "/health reports api auth = off");
  }

  const failed = results.filter((item) => item.status === "FAIL").length;
  console.log("");
  console.log("summary: " + (results.length - failed) + " pass, " + failed + " fail");
  console.log("");
  process.exitCode = failed > 0 ? 1 : 0;
};

await main();
