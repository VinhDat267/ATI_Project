import type postgres from "postgres";

export type PilotOutcomeKind = "plan" | "clarification" | "refusal" | "failure";
export type PilotReasonCode =
  "PLAN_PROPOSED" | "CLARIFICATION_REQUIRED" | "REFUSED" | "PLANNING_FAILED";

const messages: Record<PilotOutcomeKind, { code: PilotReasonCode; message: string | null }> = {
  plan: { code: "PLAN_PROPOSED", message: null },
  clarification: {
    code: "CLARIFICATION_REQUIRED",
    message: "Vui lòng làm rõ yêu cầu trước khi tiếp tục.",
  },
  refusal: {
    code: "REFUSED",
    message: "Đề xuất không thể tiếp tục trong pilot.",
  },
  failure: {
    code: "PLANNING_FAILED",
    message: "Lập kế hoạch AI không khả dụng; vui lòng kiểm tra trạng thái.",
  },
};

/** Only fixed server-owned text may enter the pilot outcome or projection. */
export function pilotOutcomeMessage(
  kind: PilotOutcomeKind,
  reasonCode: PilotReasonCode,
): string | null {
  const entry = messages[kind];
  if (entry.code !== reasonCode) throw new Error("Invalid pilot outcome code");
  return entry.message;
}

export async function savePilotPlannerOutcome(
  tx: postgres.TransactionSql,
  input: {
    runId: string;
    principalId: string;
    kind: PilotOutcomeKind;
    reasonCode: PilotReasonCode;
  },
): Promise<void> {
  const message = pilotOutcomeMessage(input.kind, input.reasonCode);
  const rows = await tx`
    INSERT INTO pilot_planner_outcomes(run_id,principal_id,kind,reason_code,message)
    SELECT ${input.runId},${input.principalId},${input.kind},${input.reasonCode},${message}
    FROM runs WHERE id=${input.runId} AND user_id=${input.principalId}
      AND profile='pilot-v2'
    RETURNING run_id`;
  if (rows.length !== 1) throw new Error("Pilot outcome owner unavailable");
}
