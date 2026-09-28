import { openDatabase } from "@wap/db";
import { evaluateChecklist, sourceKey, type PilotConfig, type PilotPolicy, type SourceRow } from "@wap/engine";
import { createApi } from "./app.js";
import { loadConfig } from "./config.js";
import { createPilot9RouterPlanner } from "./pilot-9router.js";

// Intentionally inert unless the operator passes the explicit one-shot flag.
if (process.argv.length !== 3 || process.argv[2] !== "--dispatch-once") {
  console.log("OFFLINE: no database, SaaS, or AI request. Review docs before --dispatch-once.");
} else {
  if (process.env.PILOT_V2_WRITE_ENABLED === "true") throw new Error("Pilot writes must remain disabled");
  const config = loadConfig();
  if (!config.pilotRouter || !config.allowProviderCalls ||
      !process.env.PILOT_ONE_SHOT_PASSWORD || !process.env.G1_DATABASE_URL)
    throw new Error("One-shot prerequisites missing");
  const db = openDatabase(process.env.G1_DATABASE_URL);
  const campaignId = `pilot-v2:${config.userId}`;
  let api: ReturnType<typeof createApi> | undefined;
  try {
    const grant = await db.client<Array<{ max_calls: number; count: number; valid: boolean }>>`
      SELECT g.max_calls,(SELECT count(*)::int FROM ai_provider_calls c
        WHERE c.campaign_id=g.campaign_id) AS count,
        (g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND NOT p.halted
          AND g.provider='openai' AND g.model='cx/gpt-5.6-sol'
          AND g.billing_mode='INCLUDED_SUBSCRIPTION' AND g.endpoint='http://localhost:20128/v1'
          AND g.no_paid_fallback AND g.max_estimated_cost_micros=0) AS valid
      FROM pilot_ai_grants g JOIN ai_provider_campaigns p
        ON p.campaign_id=g.campaign_id AND p.user_id=g.principal_id
      WHERE g.campaign_id=${campaignId} AND g.principal_id=${config.userId}`;
    if (grant.length !== 1 || !grant[0]?.valid || grant[0].max_calls !== 1 || grant[0].count !== 0)
      throw new Error("One-shot grant must be valid, unconsumed, and max_calls=1");
    const row: SourceRow = {
      request_id: "REQ-ATI-SYNTH-ONE-SHOT", client_ref: "Synthetic client",
      request_type: "web_change", raw_request: "Prepare a synthetic /landing banner update",
      deliverable: "Synthetic landing banner", due_date: "2026-12-15",
      decision_status: "confirmed", source_note: "Synthetic source only; no SaaS read",
    };
    const checklist = evaluateChecklist(row);
    if (checklist.status !== "pass") throw new Error("Synthetic checklist not eligible");
    const pilotConfig: PilotConfig = { enabled: true, principals: [config.userId],
      spreadsheetId: "synthetic-source", tabId: "synthetic-tab", boardId: "synthetic-board",
      trello: { listId: "synthetic-list" } };
    const pilotPolicy: PilotPolicy = { enabled: true, principals: pilotConfig.principals,
      spreadsheetId: pilotConfig.spreadsheetId, tabId: pilotConfig.tabId,
      boardId: pilotConfig.boardId };
    api = createApi({ db, config: { ...config, port: 0 }, pilotConfig, pilotPolicy,
      pilotLiveWriteEnabled: false,
      pilotPlanner: createPilot9RouterPlanner(config.pilotRouter),
      readSheetsRequestFn: async () => ({ row, checklist,
        sourceRevision: checklist.sourceRevision,
        sourceKey: sourceKey({ groupId: pilotConfig.boardId,
          spreadsheetId: pilotConfig.spreadsheetId, tabId: pilotConfig.tabId,
          requestId: row.request_id }) }),
    });
    const url = await api.listen();
    const login = await fetch(`${url}/auth/login`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: config.email, password: process.env.PILOT_ONE_SHOT_PASSWORD }) });
    if (!login.ok) throw new Error("One-shot login rejected");
    const { token } = await login.json() as { token: string };
    const pilotUrl = url.replace(/\/api\/v1$/, "") + "/pilot/v2/runs";
    const result = await fetch(pilotUrl, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ spreadsheetId: pilotConfig.spreadsheetId, tabId: pilotConfig.tabId,
        requestId: row.request_id, userPrompt: "Review synthetic source and recommend one advisory branch" }) });
    // Never print response bodies: they are not evidence-safe by default.
    if (result.status !== 202) throw new Error(`One-shot preview unavailable (HTTP ${result.status})`);
    const accepted = await result.json() as { runId: string };
    const detail = await fetch(`${pilotUrl}/${accepted.runId}`, { headers: { authorization: `Bearer ${token}` } });
    const body = await detail.json() as { status: string; preview: unknown };
    console.log(JSON.stringify({ evidence: "SYNTHETIC_SOURCE_REAL_AI_NOT_SAAS_READ",
      runId: accepted.runId, status: body.status, previewPresent: Boolean(body.preview),
      writesEnabled: false }));
  } finally { await api?.close(); await db.close(); }
}
