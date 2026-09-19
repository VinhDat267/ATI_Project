import type { AiProvider } from "./config.js";

const APPROVAL_FIELDS = new Set([
  "kind",
  "campaignId",
  "phase",
  "profileId",
  "configHash",
  "providers",
  "models",
  "budgetMicros",
  "approvedAt",
  "expiresAt",
]);
const MODEL_ROLES = new Set([
  "planning",
  "repair",
  "replan",
  "query_expansion",
  "embedding",
]);

export interface AiLiveApprovalRecord {
  readonly kind: "ai-live-approval";
  readonly campaignId: string;
  readonly phase: string;
  readonly profileId: string;
  readonly configHash: string;
  readonly providers: readonly AiProvider[];
  readonly models: Readonly<Record<string, string>>;
  readonly budgetMicros: number;
  readonly approvedAt: string;
  readonly expiresAt: string;
}

export class AiApprovalError extends Error {
  readonly code = "AI_APPROVAL_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "AiApprovalError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasSecretLikeKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (/key|secret|token|credential|authorization/i.test(key)) return true;
    if (hasSecretLikeKey(child)) return true;
  }
  return false;
}

export function parseAiLiveApprovalRecord(
  value: unknown,
): AiLiveApprovalRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiApprovalError("approval record must be an object");
  }
  if (hasSecretLikeKey(value)) {
    throw new AiApprovalError(
      "approval record must not contain credentials or tokens",
    );
  }
  const record = value as Record<string, unknown>;
  const unknownFields = Object.keys(record).filter(
    (field) => !APPROVAL_FIELDS.has(field),
  );
  if (unknownFields.length > 0)
    throw new AiApprovalError(
      `approval record contains unknown fields: ${unknownFields.join(", ")}`,
    );
  const required = [
    "campaignId",
    "phase",
    "profileId",
    "configHash",
    "approvedAt",
    "expiresAt",
  ];
  for (const field of required) {
    if (!isNonEmptyString(record[field]))
      throw new AiApprovalError(`${field} is required`);
  }
  if (record.kind !== "ai-live-approval")
    throw new AiApprovalError("kind must be ai-live-approval");
  if (
    typeof record.configHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.configHash)
  ) {
    throw new AiApprovalError("configHash must be a lowercase SHA-256 hash");
  }
  if (
    !Array.isArray(record.providers) ||
    record.providers.length === 0 ||
    new Set(record.providers).size !== record.providers.length ||
    record.providers.some(
      (provider) => provider !== "openai" && provider !== "google",
    )
  ) {
    throw new AiApprovalError("providers must contain openai and/or google");
  }
  if (
    !record.models ||
    typeof record.models !== "object" ||
    Array.isArray(record.models)
  ) {
    throw new AiApprovalError("models is required");
  }
  for (const [role, model] of Object.entries(
    record.models as Record<string, unknown>,
  )) {
    if (!MODEL_ROLES.has(role) || !isNonEmptyString(model))
      throw new AiApprovalError("models contains an invalid role/model");
  }
  if (
    !Number.isInteger(record.budgetMicros) ||
    Number(record.budgetMicros) <= 0
  ) {
    throw new AiApprovalError("budgetMicros must be a positive integer");
  }
  const approvedAt = Date.parse(String(record.approvedAt));
  const expiresAt = Date.parse(String(record.expiresAt));
  if (
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= approvedAt
  ) {
    throw new AiApprovalError("approval timestamps are invalid");
  }
  return {
    kind: "ai-live-approval",
    campaignId: String(record.campaignId),
    phase: String(record.phase),
    profileId: String(record.profileId),
    configHash: String(record.configHash),
    providers: [...(record.providers as AiProvider[])],
    models: { ...(record.models as Record<string, string>) },
    budgetMicros: Number(record.budgetMicros),
    approvedAt: String(record.approvedAt),
    expiresAt: String(record.expiresAt),
  };
}

export function assertAiLiveApproval(
  record: AiLiveApprovalRecord,
  expected: Pick<
    AiLiveApprovalRecord,
    "campaignId" | "phase" | "profileId" | "configHash" | "providers" | "models"
  >,
  now = new Date(),
): void {
  const nowMs = now.getTime();
  const approvedAt = Date.parse(record.approvedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (approvedAt > nowMs)
    throw new AiApprovalError("approval is not yet valid");
  if (expiresAt <= nowMs)
    throw new AiApprovalError("approval record is expired");
  for (const field of [
    "campaignId",
    "phase",
    "profileId",
    "configHash",
  ] as const) {
    if (record[field] !== expected[field])
      throw new AiApprovalError(
        `approval ${field} does not match execution scope`,
      );
  }
  if (
    record.providers.length !== expected.providers.length ||
    record.providers.some((provider) => !expected.providers.includes(provider))
  ) {
    throw new AiApprovalError("approval providers do not match execution scope");
  }
  for (const [role, model] of Object.entries(expected.models)) {
    if (record.models[role] !== model)
      throw new AiApprovalError(
        `approval model ${role} does not match execution scope`,
      );
  }
}
