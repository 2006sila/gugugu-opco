/**
 * runtimeStatus.ts — process-wide runtime facts that /health and the CLI tools
 * read. Kept free of imports so any layer can depend on it without cycles.
 */

export type UpstreamState = "unknown" | "ok" | "rate_limited" | "blocked" | "unreachable" | "degraded";

export interface UpstreamStatusSnapshot {
  state: UpstreamState;
  checkedAt: string | null;
  statusCode: number | null;
  lastError: string | null;
}

export const upstreamStatus: UpstreamStatusSnapshot = {
  state: "unknown",
  checkedAt: null,
  statusCode: null,
  lastError: null,
};

/** Records one observation about the upstream gate. Never throws. */
export const markUpstream = (patch: Partial<UpstreamStatusSnapshot>): void => {
  upstreamStatus.checkedAt = new Date().toISOString();
  if (patch.state !== undefined) upstreamStatus.state = patch.state;
  if (patch.statusCode !== undefined) upstreamStatus.statusCode = patch.statusCode;
  if (patch.lastError !== undefined) upstreamStatus.lastError = patch.lastError;
};

export interface ServerInfoSnapshot {
  port: number;
  startedAt: string;
  version: string;
}

export const serverInfo: ServerInfoSnapshot = {
  port: 0,
  startedAt: new Date().toISOString(),
  version: "0.2.0",
};
