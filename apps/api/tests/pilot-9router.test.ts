import { describe, expect, it, vi } from "vitest";
import { createPilot9RouterPlanner } from "../src/pilot-9router.js";
import { requestAccountedPilotProposal } from "../src/pilot-planner.js";

const input = {
  runId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  sourceKey: "synthetic-source", sourceRevision: "a".repeat(64),
  context: { systemPrompt: "No secrets", userPrompt: "synthetic source", envelope: {
    clientUntrustedIntakeXml: "synthetic source", checklistSummaryXml: "pass",
  } },
};
const valid = { model: "gpt-5.6-sol", choices: [{ message: { role: "assistant", content: '{"kind":"plan","tool":"trello.create_card"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 8, total_tokens: 15 } };
const config = { token: "router-test-secret", endpoint: "http://localhost:20128/v1" as const, route: "cx/gpt-5.6-sol" as const };
function planner(fetchImpl: typeof fetch) { return createPilot9RouterPlanner({ ...config, fetchImpl }); }

describe("9router advisory adapter (fake fetch only)", () => {
  it("makes one bounded nonstream request and accepts router-reported route identity", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(_url).toBe("http://localhost:20128/v1/chat/completions");
      expect(init?.redirect).toBe("error");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: config.route, stream: false, max_tokens: 256 });
      expect(JSON.stringify(body)).not.toContain(config.token);
      expect(init?.signal).toBeDefined();
      return new Response(JSON.stringify({ ...valid, model: config.route }), { status: 200 });
    });
    expect(await requestAccountedPilotProposal(planner(fetchImpl as typeof fetch), input, 100))
      .toMatchObject({ proposal: { kind: "plan" }, costMicros: 0,
        usage: { inputTokens: 7, outputTokens: 8, totalTokens: 15 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...valid, model: "gpt-5.6" }, { ...valid, model: "other" },
    { ...valid, usage: null }, { ...valid, choices: [] },
    { ...valid, choices: [{ message: { content: '{"kind":"plan","tool":"trello.create_card"}' }, finish_reason: "length" }] },
  ])("fails closed on unknown model, missing usage or incomplete output", async (response) => {
    await expect(requestAccountedPilotProposal(planner(async () => new Response(JSON.stringify(response))), input, 100)).rejects.toThrow();
  });
  it("does not retry HTTP errors or leak the token", async () => {
    const fetchImpl = vi.fn(async () => new Response("router-test-secret", { status: 503 }));
    await expect(requestAccountedPilotProposal(planner(fetchImpl), input, 100)).rejects.not.toThrow(/router-test-secret/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("forwards timeout abort and ignores late results", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>(() => {});
    });
    await expect(requestAccountedPilotProposal(planner(fetchImpl as typeof fetch), input, 10)).rejects.toThrow(/timed out/);
    expect(signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
