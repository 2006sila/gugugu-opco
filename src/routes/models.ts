import type { FastifyInstance } from "fastify";
import type { ModelConfigStore } from "../models/catalog.js";
import type { ModelAliasStore } from "../models/aliases.js";
import type { SettingsStore } from "../settings/settingsStore.js";

export const registerModelRoutes = async (
  app: FastifyInstance,
  models: ModelConfigStore,
  aliases: ModelAliasStore,
  settingsStore: SettingsStore,
): Promise<void> => {
  app.get("/v1/models", async () => {
    const aliasConfig = aliases.get();
    const unlockContext = settingsStore.get().contextUnlock;
    const allModels = models.list();
    const modelMetadata = new Map(allModels.map((model) => [model.id, model]));
    const aliasModels = aliasConfig.aliases.map((alias) => ({
      id: alias.downstreamModelId,
      object: "model",
      created: modelMetadata.get(alias.upstreamModelId)?.created ?? 0,
      owned_by: modelMetadata.get(alias.upstreamModelId)?.ownedBy || "model-alias",
    }));
    const baseModels = aliasConfig.onlyConfiguredAliases ? [] : allModels.filter((model) => model.enabled).map((model) => {
      // Switch-off keeps this response byte-identical to the upstream shape:
      // no budget fields, so the client keeps using its own catalog (200k).
      const budget = unlockContext ? models.budgetFor(model) : null;
      return {
        id: model.id,
        object: "model",
        created: model.created,
        owned_by: model.ownedBy,
        ...(budget
          ? {
              context_length: budget.context,
              context_window: budget.context,
              max_completion_tokens: budget.maxOutput,
            }
          : {}),
      };
    });
    const seen = new Set<string>();
    const data = [...aliasModels, ...baseModels].filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
    return {
      object: "list",
      data,
    };
  });
};
