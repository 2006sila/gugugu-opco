/**
 * bootstrap.ts — first-run setup for a single-user, loopback-bound gateway.
 *
 * Runs BEFORE loadConfig(): it creates the data directory, migrates an old
 * .env.local to the visible config.env, and makes sure an administrator
 * password exists (the upstream default "admin" counts as unset).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Visible config file so it is easy to find in Explorer. */
export const CONFIG_FILE_NAME = "config.env";
export const CONFIG_PATH = path.resolve(process.cwd(), CONFIG_FILE_NAME);
/** Pre-0.2.1 name, auto-migrated on first start. */
export const LEGACY_CONFIG_PATH = path.resolve(process.cwd(), ".env.local");

export const DATA_DIR = path.resolve(process.cwd(), "data");

export const ensureRuntimeDirs = (): void => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "logs"), { recursive: true });
};

const writeConfigValue = (name: string, value: string): void => {
  const current = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf8") : "";
  const line = name + "=" + value;
  const pattern = new RegExp("^" + name + "=.*$", "m");
  let next: string;
  if (pattern.test(current)) {
    next = current.replace(pattern, line);
  } else {
    const trimmed = current.replace(/\s*$/, "");
    next = (trimmed ? trimmed + "\n" : "") + line + "\n";
  }
  fs.writeFileSync(CONFIG_PATH, next, "utf8");
};

export interface BootstrapResult {
  adminPassword: string;
  generatedAdminPassword: boolean;
  migratedConfig: boolean;
  configPath: string;
}

/** Creates data/, migrates .env.local -> config.env, guarantees an admin password. */
export const bootstrapRuntime = (): BootstrapResult => {
  ensureRuntimeDirs();

  let migratedConfig = false;
  if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(LEGACY_CONFIG_PATH)) {
    fs.renameSync(LEGACY_CONFIG_PATH, CONFIG_PATH);
    migratedConfig = true;
  }

  const configured = (process.env.ADMIN_PASSWORD || "").trim();
  if (configured && configured !== "admin") {
    return { adminPassword: configured, generatedAdminPassword: false, migratedConfig, configPath: CONFIG_PATH };
  }
  const password = crypto.randomBytes(12).toString("base64url");
  writeConfigValue("ADMIN_PASSWORD", password);
  process.env.ADMIN_PASSWORD = password;
  return { adminPassword: password, generatedAdminPassword: true, migratedConfig, configPath: CONFIG_PATH };
};
