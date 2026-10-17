/**
 * compat.ts — the upstream gate probe.
 *
 * The Zen free tier admits a request only when it looks like it came from the
 * official CLI: canonical headers plus a DESCENDING session id. When upstream
 * changes that contract every inference starts failing with an opaque 403, so
 * this module turns "is the gate still open?" into a single cheap call whose
 * result is visible in /health and in `npm run compat:check`.
 */
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { markUpstream, type UpstreamState } from "../runtime/runtimeStatus.js";
import { ocSessionId } from "../utils/ids.js";
import { createOpenCodeHeaders, OPENCODE_USER_AGENT } from "./opencodeHeaders.js";

const GATE_PATTERN = /free tier can only be used from within|access has been restricted due to repeated policy violations/i;

/** True when an upstream body is the "you are not OpenCode" rejection. */
export const isGateBlockedText = (text: string): boolean => GATE_PATTERN.test(text);

/**
 * The gate demands both declarations, lowercase, in every request — including
 * this probe. The bodies are never called; they only satisfy the contract.
 */
const GATE_TOOLS = [
  {
    type: "function",
    function: {
      name: "read",
      description: "Placeholder; not available in this session.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description: "Placeholder; not available in this session.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export interface GateProbeInput {
  hostname: string;
  chatPath: string;
  model: string;
  timeoutMs: number;
  /** Empty = direct connection; otherwise an http(s) proxy URL. */
  proxyUrl: string;
}

export interface GateProbeResult {
  state: UpstreamState;
  statusCode: number | null;
  message: string;
  userAgent: string;
}

const classify = (statusCode: number, body: string): { state: UpstreamState; message: string } => {
  if (statusCode >= 200 && statusCode < 300) {
    return { state: "ok", message: "gate open" };
  }
  if (statusCode === 403 && isGateBlockedText(body)) {
    return {
      state: "blocked",
      message: "upstream rejected the request identity (FreeTierError): the session/header contract changed",
    };
  }
  if (statusCode === 429) {
    return { state: "rate_limited", message: "upstream rate limit reached for this egress" };
  }
  return { state: "degraded", message: "upstream answered HTTP " + statusCode };
};

/**
 * Sends one minimal chat request through the same wire identity the gateway
 * uses. Never throws; the outcome is also written to the shared status.
 */
export const probeGate = (input: GateProbeInput): Promise<GateProbeResult> =>
  new Promise((resolve) => {
    const body = JSON.stringify({
      model: input.model,
      stream: true,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
      tools: GATE_TOOLS,
    });
    const headers = createOpenCodeHeaders(body, ocSessionId());
    const options: https.RequestOptions = {
      hostname: input.hostname,
      port: 443,
      path: input.chatPath,
      method: "POST",
      headers: { ...headers },
      timeout: input.timeoutMs,
    };
    if (input.proxyUrl) options.agent = new HttpsProxyAgent(input.proxyUrl);

    let finished = false;
    const done = (result: GateProbeResult): void => {
      if (finished) return;
      finished = true;
      markUpstream({ state: result.state, statusCode: result.statusCode, lastError: result.state === "ok" ? null : result.message });
      resolve(result);
    };

    let req: ReturnType<typeof https.request>;
    try {
      req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString();
          const verdict = classify(status, text);
          done({ state: verdict.state, statusCode: status, message: verdict.message, userAgent: OPENCODE_USER_AGENT });
        });
      });
    } catch (error) {
      done({
        state: "unreachable",
        statusCode: null,
        message: error instanceof Error ? error.message : "failed to create the probe request",
        userAgent: OPENCODE_USER_AGENT,
      });
      return;
    }

    req.on("timeout", () => {
      req.destroy(new Error("probe timeout after " + input.timeoutMs + " ms"));
    });
    req.on("error", (error: Error) => {
      done({ state: "unreachable", statusCode: null, message: error.message, userAgent: OPENCODE_USER_AGENT });
    });
    req.end(body);
  });

export { OPENCODE_USER_AGENT };
