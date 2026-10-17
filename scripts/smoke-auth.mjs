#!/usr/bin/env node
/**
 * smoke-auth.mjs — proves the two access switches actually work.
 *
 *   1. console protected by default (no token -> 401)
 *   2. login with the password from .env.local
 *   3. switch the console password OFF  -> admin routes open, session says "off"
 *   4. switch API key auth OFF          -> /v1 works with no Authorization header
 *   5. restore both switches (safe defaults) and prove 401 is back
 *
 * Never prints the password or any API key.
 */
import fs from "node:fs";
import path from "node:path";

const port = process.env.PROXY_PORT || "8790";
const baseUrl = process.env.ZEN_HUB_URL || "http://127.0.0.1:" + port;

const readPassword = () => {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD.trim();
  for (const name of ["config.env", ".env.local"]) {
    const file = path.resolve(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, "utf8").match(/^ADMIN_PASSWORD=(.+)$/m);
    if (match) return match[1].trim();
  }
  return "";
};

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log("  " + name.padEnd(26) + " " + (ok ? "PASS" : "FAIL").padEnd(6) + " " + detail);
};

const call = async (pathname, init = {}) => {
  const response = await fetch(baseUrl + pathname, init);
  const text = await response.text();
  return { status: response.status, text };
};

const main = async () => {
  const password = readPassword();
  if (!password) {
    console.error("no ADMIN_PASSWORD found in .env.local — cannot run this check");
    process.exit(1);
  }
  console.log("");
  console.log("zen-hub auth smoke  ->  " + baseUrl);
  console.log("");

  const login = await call("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  let token = "";
  try {
    token = JSON.parse(login.text).data.token;
  } catch {
    token = "";
  }
  record("password login", login.status === 200 && Boolean(token), "POST /admin/login -> HTTP " + login.status);

  const auth = { "Content-Type": "application/json", Authorization: "Bearer " + token };

  // Start from a known baseline so the script is repeatable even when the
  // switches were left off by a previous run or by hand.
  await call("/admin/settings", { method: "PATCH", headers: auth, body: JSON.stringify({ consoleAuthMode: "password", apiAuthMode: "key" }) });
  const baseline = await call("/admin/session");
  record("console locked (baseline)", baseline.status === 401, "GET /admin/session -> HTTP " + baseline.status);

  const off = await call("/admin/settings", { method: "PATCH", headers: auth, body: JSON.stringify({ consoleAuthMode: "off" }) });
  record("console auth -> off", off.status === 200, "PATCH /admin/settings -> HTTP " + off.status);

  const session = await call("/admin/session");
  let mode = "";
  try {
    mode = JSON.parse(session.text).data.mode;
  } catch {
    mode = "";
  }
  record("console opens without token", session.status === 200 && mode === "off", "mode=" + (mode || "?") + ", HTTP " + session.status);

  const openKeys = await call("/admin/api-keys");
  record("admin route without token", openKeys.status === 200, "GET /admin/api-keys -> HTTP " + openKeys.status);

  const apiOff = await call("/admin/settings", { method: "PATCH", headers: auth, body: JSON.stringify({ apiAuthMode: "off" }) });
  record("api auth -> off", apiOff.status === 200, "PATCH /admin/settings -> HTTP " + apiOff.status);

  const noKey = await call("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.SMOKE_MODEL || "big-pickle", messages: [{ role: "user", content: "say ok" }], max_tokens: 8 }),
  });
  record("v1 without API key", noKey.status === 200, "POST /v1/chat/completions -> HTTP " + noKey.status);

  const restoreApi = await call("/admin/settings", { method: "PATCH", headers: auth, body: JSON.stringify({ apiAuthMode: "key" }) });
  const restoreConsole = await call("/admin/settings", { method: "PATCH", headers: auth, body: JSON.stringify({ consoleAuthMode: "password" }) });
  record("restore switches", restoreApi.status === 200 && restoreConsole.status === 200, "back to key + password");

  const locked = await call("/admin/session");
  record("console locked again", locked.status === 401, "GET /admin/session -> HTTP " + locked.status);

  const withToken = await call("/admin/session", { headers: auth });
  record("session token still valid", withToken.status === 200, "GET /admin/session -> HTTP " + withToken.status);

  const failed = results.filter((item) => !item.ok).length;
  console.log("");
  console.log("summary: " + (results.length - failed) + " pass, " + failed + " fail");
  console.log("");
  process.exitCode = failed > 0 ? 1 : 0;
};

await main();