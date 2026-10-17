import type { FastifyInstance } from "fastify";
import type { ApiKeyPolicy, ApiKeyStore } from "../auth/apiKeys.js";
import type { AppConfig } from "../config/env.js";
import { adminAuthMode, isAdminRequest, passwordMatches, tokenFromRequest } from "../auth/adminAuth.js";
import type { AdminSessionStore } from "../auth/adminSessions.js";
import type { ModelConfigStore, ModelUpdateInput } from "../models/catalog.js";
import type { ModelAliasStore, ModelAliasUpdateInput } from "../models/aliases.js";
import type { SettingsStore, SystemSettingsUpdate } from "../settings/settingsStore.js";
import type { ProxyInput, ProxyPoolStore } from "../proxy/proxyPool.js";
import type { AsyncLimiter } from "../rateLimit/limiter.js";
import type { RequestTracker } from "../runtime/requestTracker.js";
import type { MetricsStore } from "../observability/metrics.js";

interface CreateKeyBody {
  name?: string;
}

interface UpdateKeyBody {
  name?: string;
  enabled?: boolean;
  description?: string;
  labels?: string[];
  policy?: ApiKeyPolicy;
}

interface LoginBody {
  password?: string;
}

interface ImportProxiesBody {
  text?: string;
  url?: string;
  type?: "http" | "https" | "socks5";
}

interface ProxyListQuery {
  page?: string | number;
  pageSize?: string | number;
}

const positiveInteger = (value: unknown, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

interface ParsedProxy {
  name: string;
  type: "http" | "https" | "socks5";
  url: string;
}

/**
 * Accepts the shapes people actually paste: full URLs, host:port, and the
 * "host:port:user:pass" form most proxy vendors hand out.
 */
const parseProxyLines = (text: string, defaultType: "http" | "https" | "socks5"): ParsedProxy[] => {
  const fallbackType = defaultType === "socks5" ? "socks5" : defaultType;
  const fallbackScheme = defaultType === "socks5" ? "socks5" : defaultType;
  const out: ParsedProxy[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    let type: "http" | "https" | "socks5" = fallbackType;
    let url = line;
    const scheme = line.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (scheme) {
      const name = (scheme[1] ?? "").toLowerCase();
      if (name.startsWith("socks")) {
        type = "socks5";
        if (!/^socks5:\/\//i.test(url)) url = "socks5://" + url.slice(line.indexOf("://") + 3);
      } else if (name === "https") {
        type = "https";
      } else if (name === "http") {
        type = "http";
      } else {
        continue;
      }
    } else if (/^[^\s:]+:\d+:[^\s:]+:[^\s:]+$/.test(line)) {
      const [host, port, user, pass] = line.split(":");
      if (!host || !port || !user || !pass) continue;
      url = fallbackScheme + "://" + encodeURIComponent(user) + ":" + encodeURIComponent(pass) + "@" + host + ":" + port;
      type = fallbackType;
    } else {
      url = fallbackScheme + "://" + line;
      type = fallbackType;
    }
    try {
      const parsed = new URL(url);
      if (!parsed.hostname || !parsed.port) continue;
      out.push({ name: parsed.hostname + ":" + parsed.port, type, url });
    } catch {
      continue;
    }
  }
  const seen = new Set<string>();
  return out.filter((entry) => {
    const key = entry.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const registerAdminRoutes = async (
  app: FastifyInstance,
  config: AppConfig,
  keyStore: ApiKeyStore,
  modelStore: ModelConfigStore,
  modelAliasStore: ModelAliasStore,
  settingsStore: SettingsStore,
  proxyPool: ProxyPoolStore,
  limiter: AsyncLimiter,
  requestTracker: RequestTracker,
  metrics: MetricsStore,
  adminSessions: AdminSessionStore,
): Promise<void> => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin/")) return;
    // The console switch: with the password off, every admin route is open.
    // Safe only because the listener is loopback by default.
    if (settingsStore.get().consoleAuthMode === "off") return;
    if (request.url.split("?", 1)[0] === "/admin/login") return;
    if (isAdminRequest(request, adminSessions)) return;
    return reply.code(401).send({ error: { message: "Unauthorized" } });
  });

  app.post<{ Body: LoginBody }>("/admin/login", async (request, reply) => {
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!passwordMatches(password, config.adminPassword)) {
      return reply.code(401).send({ error: { message: "控制台密码不正确" } });
    }
    const token = adminSessions.create();
    return reply.send({ data: { authenticated: true, mode: "password", token } });
  });

  app.get("/admin/session", async (request) => ({
    data: {
      authenticated: true,
      mode: settingsStore.get().consoleAuthMode === "off" ? "off" : (adminAuthMode(request, adminSessions) ?? "password"),
    },
  }));

  app.post("/admin/logout", async (request, reply) => {
    adminSessions.revoke(tokenFromRequest(request));
    return reply.code(204).send();
  });

  app.get("/admin/api-keys", async () => ({ data: keyStore.list() }));

  app.post<{ Body: CreateKeyBody }>("/admin/api-keys", async (request, reply) => {
    try {
      const created = keyStore.create(request.body?.name || "");
      return reply.code(201).send({ data: created });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create API key";
      return reply.code(400).send({ error: { message } });
    }
  });

  app.get<{ Params: { id: string } }>("/admin/api-keys/:id/secret", async (request, reply) => {
    const key = keyStore.getSecret(request.params.id);
    if (!key) return reply.code(404).send({ error: { message: "API key plaintext is not available for this key" } });
    return reply.send({ data: { key } });
  });

  app.patch<{ Params: { id: string }; Body: UpdateKeyBody }>("/admin/api-keys/:id", async (request, reply) => {
    try {
      const updated = keyStore.update(request.params.id, request.body || {});
      return reply.send({ data: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update API key";
      const status = message === "API key not found" ? 404 : 400;
      return reply.code(status).send({ error: { message } });
    }
  });

  app.delete<{ Params: { id: string } }>("/admin/api-keys/:id", async (request, reply) => {
    const deleted = keyStore.delete(request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: { message: "API key not found" } });
    }
    return reply.code(204).send();
  });

  app.get("/admin/models", async () => ({ data: modelStore.list() }));

  app.get("/admin/model-aliases", async () => ({ data: modelAliasStore.get() }));

  app.put<{ Body: ModelAliasUpdateInput }>("/admin/model-aliases", async (request, reply) => {
    try {
      const config = modelAliasStore.update(request.body || {});
      return reply.send({ data: config });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save model aliases";
      return reply.code(400).send({ error: { message } });
    }
  });

  app.put<{ Params: { id: string }; Body: ModelUpdateInput }>("/admin/models/:id", async (request, reply) => {
    try {
      const model = modelStore.upsert(request.params.id, request.body || {});
      return reply.send({ data: model });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save model";
      return reply.code(400).send({ error: { message } });
    }
  });

  app.delete<{ Params: { id: string } }>("/admin/models/:id", async (request, reply) => {
    const deleted = modelStore.delete(request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: { message: "Model not found" } });
    }
    return reply.code(204).send();
  });

  app.post("/admin/models/sync-free", async (request, reply) => {
    try {
      const upstreamUrl = "https://opencode.ai/zen/v1/models";
      const response = await fetch(upstreamUrl, { cache: "no-store", headers: { "Accept-Encoding": "identity" } });
      if (!response.ok) {
        throw new Error(`Failed to fetch models from upstream: ${response.status}`);
      }
      const data = await response.json() as { data?: Array<{ id: string; object: string; created: number; owned_by: string }> };
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error("Invalid response format from upstream");
      }

      const freeModels = data.data.filter((model) =>
        model.id.endsWith("-free") || model.id === "big-pickle"
      );

      let syncedCount = 0;
      for (const model of freeModels) {
        modelStore.upsert(model.id, {
          // Omit enabled: existing models retain the administrator's choice;
          // upsert still enables newly discovered models by default.
          ownedBy: model.owned_by || "opencode-free",
          created: model.created || Math.floor(Date.now() / 1000),
        });
        syncedCount++;
      }

      return reply.send({
        data: {
          synced: syncedCount,
          models: freeModels.map((m) => m.id)
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync free models";
      return reply.code(500).send({ error: { message } });
    }
  });

  app.get("/admin/settings", async () => ({ data: settingsStore.get() }));

  app.patch<{ Body: SystemSettingsUpdate }>("/admin/settings", async (request, reply) => {
    try {
      const settings = settingsStore.update(request.body || {});
      // Both switches are live: no restart, no reconnect.
      keyStore.setAuthMode(settings.apiAuthMode);
      return reply.send({ data: settings });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update settings";
      return reply.code(400).send({ error: { message } });
    }
  });

  app.get("/admin/proxies/summary", async () => ({ data: proxyPool.summary() }));

  app.get<{ Querystring: ProxyListQuery }>("/admin/proxies", async (request) => {
    const page = positiveInteger(request.query.page, 1);
    const pageSize = Math.min(200, positiveInteger(request.query.pageSize, 200));
    return { data: proxyPool.listPage(page, pageSize) };
  });

  app.get("/admin/runtime", async () => ({
    data: {
      runtime: requestTracker.snapshot(),
      limiter: await limiter.snapshot(),
    },
  }));

  app.get("/admin/metrics", async () => ({ data: metrics.snapshot() }));

  app.post<{ Body: ImportProxiesBody }>("/admin/proxies/import", async (request, reply) => {
    const body = request.body || {};
    let text = typeof body.text === "string" ? body.text : "";
    if (!text && typeof body.url === "string" && body.url.trim()) {
      try {
        const response = await fetch(body.url.trim(), { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        text = await response.text();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: { message: "cannot fetch proxy list: " + message } });
      }
    }
    if (!text.trim()) return reply.code(400).send({ error: { message: "text or url is required" } });

    const defaultType: "http" | "https" | "socks5" = body.type === "socks5" ? "socks5" : body.type === "https" ? "https" : "http";
    const parsed = parseProxyLines(text, defaultType);
    const known = new Set(proxyPool.list().map((node) => node.url.trim().toLowerCase()));
    const added: string[] = [];
    const skipped: string[] = [];
    const invalid: string[] = [];
    for (const entry of parsed) {
      const key = entry.url.toLowerCase();
      if (known.has(key)) { skipped.push(entry.url); continue; }
      try {
        proxyPool.create({ name: entry.name, type: entry.type, url: entry.url });
        known.add(key);
        added.push(entry.url);
      } catch (error) {
        invalid.push(entry.url + " :: " + (error instanceof Error ? error.message : String(error)));
      }
    }
    return reply.code(added.length > 0 ? 201 : 200).send({
      data: { added: added.length, skipped: skipped.length, invalid: invalid.slice(0, 5), items: added.slice(0, 20) },
    });
  });

  app.post<{ Body: ProxyInput }>("/admin/proxies", async (request, reply) => {
    try {
      const proxy = proxyPool.create(request.body || {});
      return reply.code(201).send({ data: proxy });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create proxy";
      return reply.code(400).send({ error: { message } });
    }
  });

  app.patch<{ Params: { id: string }; Body: ProxyInput }>("/admin/proxies/:id", async (request, reply) => {
    try {
      const proxy = proxyPool.update(request.params.id, request.body || {});
      return reply.send({ data: proxy });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update proxy";
      const status = message === "Proxy not found" ? 404 : 400;
      return reply.code(status).send({ error: { message } });
    }
  });

  app.delete<{ Params: { id: string } }>("/admin/proxies/:id", async (request, reply) => {
    const deleted = proxyPool.delete(request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: { message: "Proxy not found" } });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/admin/proxies/:id/test", async (request, reply) => {
    try {
      const healthCheckModel = modelStore.isEnabled(config.proxyHealthCheckModel)
        ? config.proxyHealthCheckModel
        : modelStore.enabledIds()[0] || config.proxyHealthCheckModel;
      const systemOneOnly = modelStore.isSystemOneOnly(healthCheckModel);
      const useResponses = !systemOneOnly && modelStore.usesResponses(healthCheckModel);
      const proxy = await proxyPool.test(request.params.id, {
        hostname: config.zenHost,
        path: systemOneOnly ? config.zenSystemonePath : useResponses ? config.zenResponsesPath : config.zenPath,
        protocol: systemOneOnly ? "systemone" : useResponses ? "responses" : "chat_completions",
        model: healthCheckModel,
        timeoutMs: config.proxyHealthCheckTimeoutMs,
      });
      return reply.send({ data: proxy });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to test proxy";
      return reply.code(400).send({ error: { message } });
    }
  });

  app.post<{ Params: { id: string } }>("/admin/proxies/:id/stats/clear", async (request, reply) => {
    try {
      const proxy = proxyPool.clearStats(request.params.id);
      return reply.send({ data: proxy });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to clear proxy statistics";
      const status = message === "Proxy not found" ? 404 : 400;
      return reply.code(status).send({ error: { message } });
    }
  });
};
