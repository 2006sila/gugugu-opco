import type { FastifyInstance } from "fastify";
import type { ModelConfigStore } from "../models/catalog.js";
import type { SettingsStore } from "../settings/settingsStore.js";
import { serverInfo, upstreamStatus } from "../runtime/runtimeStatus.js";

const gateState = (): "ok" | "blocked" | "unknown" => {
  if (upstreamStatus.state === "blocked") return "blocked";
  if (upstreamStatus.state === "ok") return "ok";
  return "unknown";
};

export const registerHealthRoutes = async (
  app: FastifyInstance,
  models: ModelConfigStore,
  settingsStore: SettingsStore,
): Promise<void> => {
  app.get("/health", async () => {
    const settings = settingsStore.get();
    const allModels = models.list();
    return {
      status: "ok",
      version: serverInfo.version,
      uptimeSec: Math.round((Date.now() - Date.parse(serverInfo.startedAt)) / 1000),
      port: serverInfo.port,
      models: allModels.filter((model) => model.enabled).length,
      retiredModels: allModels.filter((model) => Boolean(model.retiredReason)).length,
      // Effective runtime switches (not the env defaults): scripts and the
      // console must be able to tell why a key is accepted or ignored.
      auth: {
        api: settings.apiAuthMode,
        console: settings.consoleAuthMode,
      },
      contextUnlock: settings.contextUnlock,
      upstream: {
        state: upstreamStatus.state,
        checkedAt: upstreamStatus.checkedAt,
        statusCode: upstreamStatus.statusCode,
        lastError: upstreamStatus.lastError,
      },
      gate: {
        state: gateState(),
        checkedAt: upstreamStatus.checkedAt,
      },
      endpoints: ["/v1/chat/completions", "/v1/responses", "/v1/messages", "/v1/systemone", "/zen/v1/systemone", "/v1/models"],
    };
  });
};
