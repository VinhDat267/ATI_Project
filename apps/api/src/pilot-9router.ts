import { z } from "zod";
import type { PilotAccountedPlanner } from "./pilot-planner.js";

export const PILOT_ROUTER_ENDPOINT = "http://localhost:20128/v1";
export const PILOT_ROUTER_ROUTE = "cx/gpt-5.6-sol";

const WireResponse = z.object({
  model: z.string(),
  choices: z.tuple([z.object({
    finish_reason: z.literal("stop"),
    message: z.object({ role: z.literal("assistant"), content: z.string().min(1).max(4096) }).passthrough(),
  }).passthrough()]),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().safe(),
    completion_tokens: z.number().int().nonnegative().safe(),
    total_tokens: z.number().int().positive().safe(),
  }).passthrough(),
}).passthrough();

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Pilot router response unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) throw new Error("Pilot router response invalid");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new Error("Pilot router response invalid"); }
}

/** This is a router-reported identity, not an independently attested upstream receipt. */
export function createPilot9RouterPlanner(options: {
  token: string;
  endpoint: typeof PILOT_ROUTER_ENDPOINT;
  route: typeof PILOT_ROUTER_ROUTE;
  fetchImpl?: typeof fetch;
  callsEnabled?: () => boolean;
}): PilotAccountedPlanner {
  if (options.endpoint !== PILOT_ROUTER_ENDPOINT || options.route !== PILOT_ROUTER_ROUTE ||
      !options.token || options.token.length < 4 || /[\r\n]/.test(options.token))
    throw new Error("Invalid pilot router configuration");
  return {
    provider: "openai", model: options.route, estimatedCostMicros: 0,
    billingMode: "INCLUDED_SUBSCRIPTION", endpoint: options.endpoint,
    noPaidFallback: true,
    async propose({ context, signal }) {
      if (options.callsEnabled?.() === false) throw new Error("Pilot provider calls disabled");
      const response = await (options.fetchImpl ?? fetch)(`${options.endpoint}/chat/completions`, {
        method: "POST", redirect: "error", signal,
        headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: options.route, stream: false, max_tokens: 256,
          messages: [{ role: "system", content: context.systemPrompt.slice(0, 8000) },
            { role: "user", content: context.userPrompt.slice(0, 16000) }] }),
      });
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error("Pilot router HTTP unavailable"); }
      const wire = WireResponse.parse(await boundedJson(response));
      if (wire.model !== options.route && wire.model !== "gpt-5.6-sol")
        throw new Error("Pilot router identity mismatch");
      if (wire.usage.total_tokens < wire.usage.prompt_tokens + wire.usage.completion_tokens)
        throw new Error("Pilot router usage invalid");
      let proposal: unknown;
      try { proposal = JSON.parse(wire.choices[0].message.content); }
      catch { throw new Error("Pilot router proposal invalid"); }
      return { proposal, usage: { inputTokens: wire.usage.prompt_tokens,
        outputTokens: wire.usage.completion_tokens, totalTokens: wire.usage.total_tokens },
        costMicros: 0 };
    },
  };
}
