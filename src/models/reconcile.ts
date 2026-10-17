/**
 * reconcile.ts — keeps models.json honest against the live free catalog.
 *
 * Upstream adds and retires free models without notice. A gateway that only
 * ever appends advertises dead ids forever, so every call to them fails; the
 * opposite case (an id still listed locally that upstream dropped) is worse
 * because it looks healthy until the first request. This reconciler runs at
 * boot and then every six hours, and it is deliberately conservative:
 *
 *   - unknown ids are ADDED and enabled;
 *   - ids upstream no longer lists are RETIRED (disabled + reason), never
 *     deleted, and never touched when the user created them by hand;
 *   - an id that comes back is re-enabled automatically.
 *
 * A failed fetch changes nothing: an offline box keeps serving its local list.
 */
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { AppConfig } from "../config/env.js";
import type { ModelConfigStore } from "./catalog.js";

export const isFreeTierId = (id: string): boolean => id === "big-pickle" || id.endsWith("-free");

/** The slice of a logger this module needs (Fastify's app.log satisfies it). */
export interface ReconcileLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface ReconcileResult {
  added: string[];
  retired: string[];
  revived: string[];
  liveFreeCount: number;
  error: string | null;
}

/** Reads /zen/v1/models and returns the ids reachable with the anonymous tier. */
export const fetchLiveFreeIds = (config: AppConfig, timeoutMs = 6000): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: config.zenHost,
      port: 443,
      path: "/zen/v1/models",
      method: "GET",
      timeout: timeoutMs,
      headers: { Accept: "application/json", "Accept-Encoding": "identity" },
    };
    if (config.upstreamProxyUrl) options.agent = new HttpsProxyAgent(config.upstreamProxyUrl);

    let req: ReturnType<typeof https.request>;
    try {
      req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error("catalog HTTP " + status));
            return;
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString()) as { data?: Array<{ id?: string }> };
            const ids = (parsed.data ?? [])
              .map((item) => (item.id ?? "").trim())
              .filter((id) => id.length > 0 && isFreeTierId(id));
            resolve(ids);
          } catch (error) {
            reject(error instanceof Error ? error : new Error("invalid catalog payload"));
          }
        });
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("failed to create catalog request"));
      return;
    }
    req.on("timeout", () => req.destroy(new Error("catalog timeout")));
    req.on("error", (error: Error) => reject(error));
    req.end();
  });

/** One reconciliation pass. Never throws: failures come back in the result. */
export const reconcileCatalog = async (models: ModelConfigStore, config: AppConfig): Promise<ReconcileResult> => {
  try {
    const liveIds = await fetchLiveFreeIds(config);
    if (liveIds.length === 0) {
      return { added: [], retired: [], revived: [], liveFreeCount: 0, error: "upstream returned no free ids" };
    }
    const changes = models.applyLiveCatalog(liveIds);
    return { ...changes, liveFreeCount: liveIds.length, error: null };
  } catch (error) {
    return {
      added: [],
      retired: [],
      revived: [],
      liveFreeCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/** Boot-time pass plus a slow periodic one. */
export const startCatalogReconciliation = (models: ModelConfigStore, config: AppConfig, log: ReconcileLogger): NodeJS.Timeout => {
  const run = async (): Promise<void> => {
    const result = await reconcileCatalog(models, config);
    if (result.error) {
      log.warn({ error: result.error }, "catalog_reconcile_skipped");
      return;
    }
    if (result.added.length > 0 || result.retired.length > 0 || result.revived.length > 0) {
      log.info(
        { added: result.added, retired: result.retired, revived: result.revived, liveFreeCount: result.liveFreeCount },
        "catalog_reconciled",
      );
    }
  };
  void run();
  const timer = setInterval(() => void run(), 6 * 60 * 60 * 1000);
  timer.unref();
  return timer;
};
