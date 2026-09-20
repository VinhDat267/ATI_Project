import { openDatabase } from "@wap/db";
import {
  WorkflowEngine,
  createPostgresProviderCallLedger,
  ensurePostgresProviderCampaign,
  inspectLocalGateway,
  loadFilesystemLaunch,
  openLocalGateway,
  readAiProviderConfig,
  type AiProvider,
} from "@wap/engine";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createApi } from "./app.js";
import { loadConfig } from "./config.js";
import { loadDevPlanner } from "./dev-planner.js";
import { createAiRuntime } from "./ai-runtime.js";
import { createApiAuthorizeCall } from "./ai-runtime.js";
import { createPrepareWorker } from "./worker.js";
import { createExpiryMaintenance } from "./maintenance.js";
import { createGatewayManager } from "./gateway-manager.js";

const config = loadConfig();
const databaseUrl = process.env.G1_DATABASE_URL;
if (!databaseUrl)
  throw new Error("Missing required configuration G1_DATABASE_URL");
const db = openDatabase(databaseUrl);
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const filesystemConfigured = (() => {
  const flag = process.env.G1_FILESYSTEM_ENABLED;
  return (
    flag !== undefined && !["0", "false", "off"].includes(flag.toLowerCase())
  );
})();
const gateway = createGatewayManager(
  config.userId,
  async () => {
    const filesystem = await loadFilesystemLaunch(root, config.userId);
    return openLocalGateway({
      root,
      databaseUrl,
      userId: config.userId,
      ...(filesystem ? { filesystem } : {}),
    });
  },
  async () => {
    let filesystem;
    try {
      filesystem = await loadFilesystemLaunch(root, config.userId);
    } catch {
      // Keep the task hub inspection independent when the filesystem preset
      // cannot be loaded; the catalog reports only a sanitized filesystem error.
      filesystem = undefined;
    }
    return inspectLocalGateway(
      {
        root,
        databaseUrl,
        userId: config.userId,
        ...(filesystem ? { filesystem } : {}),
      },
      { filesystemConfigured },
    );
  },
);

const aiRuntime =
  config.plannerMode === "ai"
    ? await (async () => {
        const providerConfig = readAiProviderConfig();
        const selectedProviders = new Set<AiProvider>([
          providerConfig.planning.provider,
          providerConfig.queryExpansion.provider,
          providerConfig.embedding.provider,
        ]);
        const credentials = {
          ...(selectedProviders.has("openai")
            ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
            : {}),
          ...(selectedProviders.has("google")
            ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY }
            : {}),
        };
        const campaignId = `api-local-v1:${config.userId}`;
        const rawLimit = process.env.AI_CAMPAIGN_LIMIT_MICROS ?? "1000000";
        if (!/^[1-9][0-9]*$/.test(rawLimit))
          throw new Error("AI_CAMPAIGN_LIMIT_MICROS must be a positive integer");
        const campaignLimitMicros = Number(rawLimit);
        if (!Number.isSafeInteger(campaignLimitMicros))
          throw new Error("AI_CAMPAIGN_LIMIT_MICROS is out of range");
        let accountingReady = false;
        try {
          await ensurePostgresProviderCampaign(db, {
            campaignId,
            userId: config.userId,
            limitMicros: campaignLimitMicros,
          });
          accountingReady = true;
        } catch {
          // Keep the API worker alive, but leave AI provider execution
          // fail-closed until the durable accounting migration is available.
          console.error(
            "AI durable accounting is unavailable; AI planning remains disabled",
          );
        }
        return createAiRuntime({
          db,
          gateway,
          root,
          userId: config.userId,
          config: providerConfig,
          credentials,
          ...(accountingReady
            ? {
                ledger: createPostgresProviderCallLedger(db, {
                  campaignId,
                  userId: config.userId,
                }),
                authorizeCall: createApiAuthorizeCall({
                  db,
                  userId: config.userId,
                  campaignId,
                  leaseTtlMs: Math.max(
                    providerConfig.limits.trialDeadlineMs * 2,
                    300_000,
                  ),
                }),
              }
            : {}),
          callContext: {
            campaignId,
            runId: "api-runtime-bootstrap",
            profileId: "api-profile-v1",
          },
        });
      })()
    : undefined;
const engine = new WorkflowEngine(db, gateway, config.userId, {
  secrets: [
    config.passwordHash,
    config.cursorKey.toString("base64"),
    config.cursorKey.toString("hex"),
    databaseUrl,
    decodeURIComponent(new URL(databaseUrl).password),
    ...(aiRuntime?.secrets ?? []),
  ].filter(Boolean),
  ...(aiRuntime ? { replan: aiRuntime.replan } : {}),
});
const planner =
  config.plannerMode === "dev_fixture"
    ? loadDevPlanner(root)
    : config.plannerMode === "ai" && aiRuntime
      ? aiRuntime.planner
      : undefined;
const worker = createPrepareWorker({
  db,
  userId: config.userId,
  engine,
  planner,
  onError: (code) =>
    console.error(JSON.stringify({ event: "worker_deferred", code })),
});
const maintenance = createExpiryMaintenance({
  engine,
  onError: (code) =>
    console.error(JSON.stringify({ event: "maintenance_deferred", code })),
});
const api = createApi({ db, config, engine, worker, maintenance });
const url = await api.listen();
worker?.start();
maintenance.start();
console.log(
  JSON.stringify({
    event: "api_listening",
    url,
    planner_mode: config.plannerMode,
  }),
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await api.close();
  await gateway?.close();
  await db.close();
}
process.once("SIGINT", () => {
  void stop().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void stop().finally(() => process.exit(0));
});
