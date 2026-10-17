#!/usr/bin/env node
/**
 * dev-console-auth.mjs — flip the console password switch from the CLI.
 *
 *   node scripts/dev-console-auth.mjs off       # console opens without a password
 *   node scripts/dev-console-auth.mjs password  # restore the password gate
 *
 * Reads ADMIN_PASSWORD from .env.local so the secret never appears in a command.
 */
import fs from "node:fs";
import path from "node:path";

const wanted = (process.argv[2] || "").toLowerCase();
if (!["off", "password"].includes(wanted)) {
  console.error("usage: node scripts/dev-console-auth.mjs <off|password>");
  process.exit(1);
}

const port = process.env.PROXY_PORT || "8790";
const baseUrl = process.env.ZEN_HUB_URL || "http://127.0.0.1:" + port;

const password = (() => {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD.trim();
  for (const name of ["config.env", ".env.local"]) {
    const file = path.resolve(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, "utf8").match(/^ADMIN_PASSWORD=(.+)$/m);
    if (match) return match[1].trim();
  }
  return "";
})();
if (!password) {
  console.error("ADMIN_PASSWORD not found in .env.local");
  process.exit(1);
}

const login = await fetch(baseUrl + "/admin/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
if (!login.ok) {
  console.error("login failed: HTTP " + login.status);
  process.exit(1);
}
const token = (await login.json()).data.token;
const patch = await fetch(baseUrl + "/admin/settings", {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
  body: JSON.stringify({ consoleAuthMode: wanted }),
});
console.log("consoleAuthMode -> " + wanted + ": HTTP " + patch.status);
process.exitCode = patch.ok ? 0 : 1;