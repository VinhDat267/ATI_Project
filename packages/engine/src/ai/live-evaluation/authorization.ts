import { createHash } from "node:crypto";
import type { AiProvider, AiPurpose } from "../providers/config.js";
import type { LiveProfileConfig } from "./contracts.js";

export type LiveExecutionPhase =
  "probe" | "index" | "smoke" | "dev" | "legacy-regression";

export interface LiveExecutionScope {
  readonly configHash: string;
  readonly providers: readonly AiProvider[];
  readonly models: Readonly<Record<AiPurpose, string>>;
}

const ALL_MODEL_ROLES: readonly AiPurpose[] = [
  "planning",
  "repair",
  "replan",
  "query_expansion",
  "embedding",
];

function rolesForPhase(phase: LiveExecutionPhase): readonly AiPurpose[] {
  return phase === "index" ? ["embedding"] : ALL_MODEL_ROLES;
}

export function hashLiveConfig(rawConfig: Uint8Array | string): string {
  return createHash("sha256").update(rawConfig).digest("hex");
}

export function deriveLiveExecutionScope(
  profile: LiveProfileConfig,
  phase: LiveExecutionPhase,
  configHash: string,
): LiveExecutionScope {
  const roleProfiles = {
    planning: profile.planning,
    repair: profile.planning,
    replan: profile.planning,
    query_expansion: profile.queryExpansion,
    embedding: profile.embedding,
  } as const;
  const roles = rolesForPhase(phase);
  const providers = [
    ...new Set(roles.map((role) => roleProfiles[role].provider)),
  ];
  const models = Object.fromEntries(
    roles.map((role) => [role, roleProfiles[role].model]),
  ) as Readonly<Record<AiPurpose, string>>;

  return {
    configHash,
    providers,
    models,
  };
}
