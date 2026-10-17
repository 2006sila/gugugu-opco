import { JsonFileStore } from "../storage/jsonFile.js";

/**
 * Compiled-in seed list: the free-tier ids that `GET /zen/v1/models` returns
 * today. It is only a seed — the reconciler (models/reconcile.ts) adds ids the
 * upstream starts offering and retires the ones it stops offering, so a stale
 * entry here cannot survive a successful boot.
 */
export const DEFAULT_MODELS = [
  "big-pickle",
  "beam-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-lightning-free",
  "nemotron-3.5-super-vl-free",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "longcat-2.5-preview-free",
  "space-bunny-free",
  "jev-1.13-free",
] as const;

/**
 * Models that upstream only serves through the TypeSafe System One endpoint.
 * Their `/zen/v1/chat/completions` and `/zen/v1/responses` requests are
 * rejected with an opaque upstream error, so calls on the Chat/Responses/
 * Anthropic downstreams are refused locally with a clear message pointing
 * at `/v1/systemone`. Matching is exact per model id so other models are
 * never affected.
 */
export const SYSTEMONE_ONLY_MODELS: ReadonlySet<string> = new Set([
  "jev-1.13-free",
]);

/**
 * Models that upstream has already removed from the free list. They are
 * disabled on startup so a pre-existing models.json cannot keep advertising
 * them. New removals are handled by the reconciler instead of this list.
 */
export const RETIRED_MODELS: ReadonlyArray<{ id: string; reason: string }> = [
  { id: "cat-jam-free", reason: "Model no longer offered as a free model by upstream" },
  { id: "muse-spark-1.2-contributor-free", reason: "Model no longer offered as a free model by upstream" },
  { id: "muse-spark-1.3-contributor-free", reason: "Model no longer offered as a free model by upstream" },
  { id: "step-5-preview-free", reason: "Model no longer offered as a free model by upstream" },
  { id: "deepseek-v4-flash-free", reason: "Model no longer offered as a free model by upstream" },
  { id: "hy3-free", reason: "Model no longer offered as a free model by upstream" },
  { id: "laguna-s-2.1-free", reason: "Model no longer offered as a free model by upstream" },
  { id: "nemotron-3-super-free", reason: "Model no longer supported by upstream" },
  { id: "minimax-m3-free", reason: "Free promotion ended, now requires OpenCode Go subscription" },
  { id: "north-mini-code-free", reason: "Model no longer offered as a free model by upstream" },
  { id: "ling-3.0-flash-free", reason: "Model no longer offered as a free model by upstream" },
  { id: "longcat-2.0-free", reason: "Model no longer offered as a free model by upstream" },
];

/**
 * Models previously auto-disabled by the retirement mechanism that are
 * available again as upstream free models. On startup, entries carrying the
 * "(retired:" annotation are re-enabled and the annotation is stripped, so
 * only auto-disabled entries are touched — manual user choices are kept.
 */
export const REACTIVATED_MODELS: ReadonlySet<string> = new Set();

export interface ModelConfig {
  id: string;
  enabled: boolean;
  ownedBy: string;
  created: number;
  displayName?: string;
  /** Route this model to the upstream OpenAI Responses endpoint. */
  useResponses?: boolean;
  /** Measured input budget in tokens; overrides CONTEXT_DEFAULTS when set. */
  context?: number;
  /** Measured output budget in tokens. */
  maxOutput?: number;
  /** True when a person created this row by hand: the reconciler never retires it. */
  manual?: boolean;
  /** Derived (never persisted): this id only exists on the upstream System One endpoint. */
  systemOneOnly?: boolean;
  /** Set by the reconciler when upstream stops listing the id. */
  retiredAt?: string;
  /** Human-readable reason paired with retiredAt. */
  retiredReason?: string;
}

interface ModelConfigFile {
  version: 1;
  models: ModelConfig[];
}

export interface ModelUpdateInput {
  enabled?: boolean;
  ownedBy?: string;
  created?: number;
  displayName?: string;
  useResponses?: boolean;
  context?: number;
  maxOutput?: number;
}

export interface ModelBudget {
  context: number;
  maxOutput: number;
}

/**
 * MEASURED budgets for the free tier, produced by scripts/probe-context.mjs on
 * 2026-10-17 (evidence in VERIFY.md):
 *
 *   deepseek-v4.1-flash-free: 1,004,443 prompt tokens accepted, HTTP 200
 *   glm-5.3-flash-free:         772,586 accepted, ~800,000 rejected with
 *                               context_length_exceeded -> advertise 786,432
 *
 * Upstream can tighten this at any time; the probe exists to catch that, so
 * treat these numbers as "last verified", not as a contract.
 */
export const CONTEXT_DEFAULTS: Readonly<Record<string, ModelBudget>> = {
  "deepseek-v4.1-flash-free": { context: 1_000_000, maxOutput: 384_000 },
  "glm-5.3-flash-free": { context: 786_432, maxOutput: 131_072 },
};

/** What the public catalog (= models.dev) declares, for the switch-off view. */
export const CATALOG_BUDGET: ModelBudget = { context: 200_000, maxOutput: 32_000 };

export interface LiveCatalogChanges {
  added: string[];
  retired: string[];
  revived: string[];
}

export class ModelConfigStore {
  private readonly store: JsonFileStore<ModelConfigFile>;
  private models: ModelConfig[] = [];

  constructor(modelsFile: string) {
    this.store = new JsonFileStore<ModelConfigFile>(modelsFile);
  }

  load(): void {
    const data = this.store.read({ version: 1, models: [] });
    this.models = this.mergeDefaultModels(data.models);
    this.persist();
  }

  list(): ModelConfig[] {
    return this.models.map((model) => ({ ...model, systemOneOnly: SYSTEMONE_ONLY_MODELS.has(model.id) }));
  }

  listEnabled(): ModelConfig[] {
    return this.list().filter((model) => model.enabled);
  }

  isEnabled(modelId: string): boolean {
    return this.models.some((model) => model.id === modelId && model.enabled);
  }

  usesResponses(modelId: string): boolean {
    return this.models.some((model) => model.id === modelId && model.useResponses === true);
  }

  /**
   * True when the upstream id must only be called through the System One
   * endpoint. Takes the resolved (upstream) id because aliases may remap.
   */
  isSystemOneOnly(modelId: string): boolean {
    return SYSTEMONE_ONLY_MODELS.has(modelId);
  }

  /**
   * Message used when a systemone-only model is requested on a chat-shaped
   * downstream. Mentions the local route so callers know where to go.
   */
  static systemOneOnlyMessage(downstreamModelId: string): string {
    return "Model " + downstreamModelId + " is only available through the TypeSafe System One interface (POST /v1/systemone with state/questions); it does not accept Chat Completions, Responses or Anthropic requests.";
  }

  enabledIds(): string[] {
    return this.listEnabled().map((model) => model.id);
  }

  /**
   * Budget to advertise for a model: the per-model override wins, then the
   * measured defaults, otherwise null (the client falls back to its own
   * catalog, which is what the switch-off case must also do).
   */
  budgetFor(model: Pick<ModelConfig, "id" | "context" | "maxOutput">): ModelBudget | null {
    if (model.context && model.maxOutput) return { context: model.context, maxOutput: model.maxOutput };
    return CONTEXT_DEFAULTS[model.id] ?? null;
  }

  upsert(id: string, input: ModelUpdateInput): ModelConfig {
    const cleanId = id.trim();
    if (!cleanId) throw new Error("Model id is required");

    let model = this.models.find((item) => item.id === cleanId);
    if (!model) {
      model = { id: cleanId, enabled: true, ownedBy: "opencode-free", created: 1779000000, manual: true };
      this.models.push(model);
    }

    if (input.enabled !== undefined) {
      model.enabled = input.enabled;
      if (input.enabled) {
        delete model.retiredAt;
        delete model.retiredReason;
      }
    }
    if (input.ownedBy !== undefined) model.ownedBy = input.ownedBy.trim() || "opencode-free";
    if (input.created !== undefined) model.created = input.created;
    if (input.displayName !== undefined) model.displayName = input.displayName.trim() || undefined;
    if (input.useResponses !== undefined) model.useResponses = input.useResponses;
    if (input.context !== undefined) {
      if (!Number.isFinite(input.context) || input.context <= 0) throw new Error("context must be a positive number");
      model.context = Math.trunc(input.context);
    }
    if (input.maxOutput !== undefined) {
      if (!Number.isFinite(input.maxOutput) || input.maxOutput <= 0) throw new Error("maxOutput must be a positive number");
      model.maxOutput = Math.trunc(input.maxOutput);
    }

    this.persist();
    return { ...model };
  }

  delete(id: string): boolean {
    const before = this.models.length;
    this.models = this.models.filter((model) => model.id !== id);
    if (this.models.length === before) return false;
    this.persist();
    return true;
  }

  /**
   * Aligns the stored list with the live free catalog.
   *
   * Only auto-managed entries (`ownedBy === "opencode-free"`) are retired, so a
   * model someone added by hand is never disabled behind their back. Retirement
   * keeps the row and its reason; a returning id is revived in place.
   */
  applyLiveCatalog(liveIds: string[]): LiveCatalogChanges {
    const live = new Set(liveIds.map((id) => id.trim()).filter((id) => id.length > 0));
    const changes: LiveCatalogChanges = { added: [], retired: [], revived: [] };
    if (live.size === 0) return changes;

    const now = new Date().toISOString();
    const known = new Set(this.models.map((model) => model.id));
    for (const id of live) {
      if (known.has(id)) continue;
      this.models.push({ id, enabled: true, ownedBy: "opencode-free", created: 1779000000 });
      known.add(id);
      changes.added.push(id);
    }

    for (const model of this.models) {
      if (live.has(model.id)) {
        if (model.retiredReason) {
          model.enabled = true;
          delete model.retiredAt;
          delete model.retiredReason;
          changes.revived.push(model.id);
        }
        continue;
      }
      if (!model.enabled || model.retiredReason) continue;
      if (model.ownedBy !== "opencode-free") continue;
      // A row someone added by hand is not "stale upstream data".
      if (model.manual) continue;
      model.enabled = false;
      model.retiredAt = now;
      model.retiredReason = "not listed by the upstream free catalog";
      changes.retired.push(model.id);
    }

    if (changes.added.length > 0 || changes.retired.length > 0 || changes.revived.length > 0) {
      this.persist();
    }
    return changes;
  }

  private defaultModels(): ModelConfig[] {
    return DEFAULT_MODELS.map((id) => ({ id, enabled: true, ownedBy: "opencode-free", created: 1779000000 }));
  }

  private mergeDefaultModels(models: ModelConfig[]): ModelConfig[] {
    const merged = [...models];
    const existingIds = new Set(merged.map((model) => model.id));
    for (const model of this.defaultModels()) {
      if (!existingIds.has(model.id)) merged.push(model);
    }
    // Auto-disable retired models on startup.
    for (const retired of RETIRED_MODELS) {
      const model = merged.find((item) => item.id === retired.id);
      if (!model) continue;
      if (model.enabled) model.enabled = false;
      if (!model.displayName?.includes("(retired:")) {
        model.displayName = (model.displayName || model.id) + " (retired: " + retired.reason + ")";
      }
    }
    // Re-enable models that returned to the upstream free list and were
    // previously auto-disabled via the retirement mechanism.
    for (const model of merged) {
      if (!REACTIVATED_MODELS.has(model.id)) continue;
      if (model.enabled || !model.displayName?.includes("(retired:")) continue;
      model.enabled = true;
      const cleaned = model.displayName.replace(/\s*\(retired:[^)]*\)/g, "").trim();
      model.displayName = cleaned === model.id ? undefined : cleaned;
    }
    return merged;
  }

  private persist(): void {
    this.store.write({ version: 1, models: this.models });
  }
}
