/**
 * Workflow DSL — Zod schema
 *
 * Đây là NGUỒN SỰ THẬT DUY NHẤT cho Workflow Plan.
 * Từ file này sinh ra:
 *   1. Runtime validation  → Validator tầng 1 (FR-VAL-01)
 *   2. TypeScript types    → Engine, API
 *   3. Types cho frontend  → vẽ sơ đồ DAG
 *   4. JSON Schema         → ép LLM trả đúng định dạng (structured output)
 *
 * Mọi thay đổi về DSL BẮT BUỘC bắt đầu từ file này.
 */

import { z } from "zod";

/* ────────────────────────────────────────────────────────────
 * Hằng số và kiểu cơ bản
 * ──────────────────────────────────────────────────────────── */

export const DSL_VERSION = "1.0" as const;

/** Giá trị runtime do hệ thống cung cấp (FR-PLN-08).
 *  KHÔNG để LLM tự tính ngày tháng. */
export const RUNTIME_VARS = [
  "now",
  "today",
  "week_start",
  "week_end",
  "month_start",
  "month_end",
  "run_id",
  "user_id",
] as const;

export type RuntimeVar = (typeof RUNTIME_VARS)[number];

/** Id của step: chữ thường, số, gạch dưới. Bắt đầu bằng chữ. */
export const StepIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,31}$/,
    "step id phải khớp /^[a-z][a-z0-9_]{0,31}$/",
  );

/** Tên khoá trong `inputs`. */
export const InputKeySchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,31}$/,
    "input key phải khớp /^[a-z][a-z0-9_]{0,31}$/",
  );

/* ────────────────────────────────────────────────────────────
 * Biểu thức tham chiếu  ${...}
 * ──────────────────────────────────────────────────────────── */

/** Một chuỗi CHỈ chứa đúng một tham chiếu, ví dụ "${inputs.board_id}". */
export const REFERENCE_ONLY =
  /^\$\{\s*[a-z][a-z0-9_]*(?:\.[a-zA-Z0-9_]+)*\s*\}$/;

/** Tìm tất cả tham chiếu nhúng trong một chuỗi, ví dụ "Báo cáo ${runtime.week_start}". */
export const REFERENCE_GLOBAL =
  /\$\{\s*([a-z][a-z0-9_]*(?:\.[a-zA-Z0-9_]+)*)\s*\}/g;

/* ────────────────────────────────────────────────────────────
 * Giá trị tham số của tool
 * ──────────────────────────────────────────────────────────── */

/**
 * Giá trị đối số có thể là literal (string/number/boolean/null),
 * chuỗi chứa tham chiếu, mảng, hoặc object lồng nhau.
 *
 * Lưu ý: KHÔNG dùng z.any() — giữ kiểu đóng để validator tầng 2
 * còn đối chiếu được với inputSchema của MCP Server.
 */
export type ArgValue =
  string | number | boolean | null | ArgValue[] | { [key: string]: ArgValue };

export const ArgValueSchema: z.ZodType<ArgValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(ArgValueSchema),
    z.record(z.string(), ArgValueSchema),
  ]),
);

/* ────────────────────────────────────────────────────────────
 * Tool reference
 * ──────────────────────────────────────────────────────────── */

export const ToolRefSchema = z
  .object({
    /** Id của MCP Server trong Tool Registry (FR-VAL-02). */
    server: z.string().min(1),
    /** Tên tool do MCP Server khai báo qua tools/list. */
    name: z.string().min(1),
    /** Đối số truyền cho tool; giá trị có thể chứa ${...} (FR-EXE-03). */
    args: z.record(z.string(), ArgValueSchema).default({}),
  })
  .strict();

export type ToolRef = z.infer<typeof ToolRefSchema>;

/* ────────────────────────────────────────────────────────────
 * Retry policy
 * ──────────────────────────────────────────────────────────── */

export const BackoffSchema = z.enum(["fixed", "linear", "exponential"]);

export const RetryPolicySchema = z
  .object({
    max_attempts: z.number().int().min(1).max(10).default(3),
    backoff: BackoffSchema.default("exponential"),
    initial_delay_ms: z.number().int().min(0).max(60_000).default(500),
  })
  .strict();

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const DEFAULT_RETRY: RetryPolicy = {
  max_attempts: 3,
  backoff: "exponential",
  initial_delay_ms: 500,
};

/* ────────────────────────────────────────────────────────────
 * Side effect & error handling
 * ──────────────────────────────────────────────────────────── */

/** read = chỉ đọc, chạy thật trong dry-run.
 *  write = có side-effect, KHÔNG chạy trong dry-run (FR-APR-01, FR-APR-02). */
export const SideEffectSchema = z.enum(["read", "write"]);
export type SideEffect = z.infer<typeof SideEffectSchema>;

/** fail    = dừng cả workflow
 *  continue = bỏ qua, chạy tiếp các bước không phụ thuộc
 *  replan   = đẩy lỗi về LLM để sửa kế hoạch (FR-EXE-08, FR-EXE-12) */
export const OnErrorSchema = z.enum(["fail", "continue", "replan"]);
export type OnError = z.infer<typeof OnErrorSchema>;

/* ────────────────────────────────────────────────────────────
 * Step
 * ──────────────────────────────────────────────────────────── */

export const StepSchema = z
  .object({
    id: StepIdSchema,

    /** Mô tả bước bằng ngôn ngữ tự nhiên — hiển thị trên UI và trace. */
    description: z.string().min(1).max(500),

    tool: ToolRefSchema,

    /** Các step phải hoàn tất trước bước này. Rỗng = có thể chạy ngay. */
    depends_on: z.array(StepIdSchema).default([]),

    /**
     * Biểu thức điều kiện; bước bị bỏ qua nếu điều kiện sai (FR-EXE-09).
     * Được phân tích bằng parser riêng — TUYỆT ĐỐI không eval (NFR-09).
     */
    condition: z.string().max(500).nullable().default(null),

    retry: RetryPolicySchema.default(DEFAULT_RETRY),

    /** Bắt buộc với bước write (FR-PLN-07, FR-VAL-06). */
    idempotency_key: z.string().min(1).max(200).nullable().default(null),

    side_effect: SideEffectSchema,

    on_error: OnErrorSchema.default("fail"),

    /** Timeout riêng cho bước, ms (FR-EXE-16). */
    timeout_ms: z.number().int().min(1_000).max(300_000).default(30_000),
  })
  .strict();

export type Step = z.infer<typeof StepSchema>;

/* ────────────────────────────────────────────────────────────
 * Khai báo input
 * ──────────────────────────────────────────────────────────── */

export const InputTypeSchema = z.enum(["string", "number", "boolean"]);

export const InputDeclSchema = z
  .object({
    type: InputTypeSchema,
    description: z.string().max(200).optional(),
    required: z.boolean().default(false),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .strict()
  .refine((v) => !(v.required && v.default !== undefined), {
    message: "input vừa required vừa có default là mâu thuẫn",
  })
  .refine((v) => v.default === undefined || typeof v.default === v.type, {
    message: "default phải khớp kiểu input đã khai báo",
  });

export type InputDecl = z.infer<typeof InputDeclSchema>;

/* ────────────────────────────────────────────────────────────
 * Workflow Plan
 * ──────────────────────────────────────────────────────────── */

export const WorkflowPlanSchema = z
  .object({
    version: z.literal(DSL_VERSION),

    /** Tên ngắn gọn do LLM đặt, hiển thị cho người dùng. */
    name: z.string().min(1).max(120),

    /** Mô tả gốc của người dùng — giữ lại cho trace và replan (FR-PLN-11). */
    source_prompt: z.string().min(1).max(4_000),

    inputs: z.record(InputKeySchema, InputDeclSchema).default({}),

    steps: z.array(StepSchema).min(1).max(30),

    /** Giá trị trả về của workflow; value là biểu thức tham chiếu. */
    outputs: z.record(z.string(), z.string()).default({}),
  })
  .strict()
  /* ─── Ràng buộc mức schema (Validator tầng 1) ─── */
  .superRefine((plan, ctx) => {
    // 1. Id của step phải duy nhất
    const seen = new Set<string>();
    plan.steps.forEach((step, i) => {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "id"],
          message: `step id trùng lặp: "${step.id}"`,
        });
      }
      seen.add(step.id);
    });

    // 2. Bước write BẮT BUỘC có idempotency_key (FR-VAL-06)
    plan.steps.forEach((step, i) => {
      if (step.side_effect === "write" && !step.idempotency_key) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "idempotency_key"],
          message: `bước write "${step.id}" phải có idempotency_key`,
        });
      }
    });

    // 3. Bước read không nên có idempotency_key (thừa, dễ gây hiểu nhầm)
    plan.steps.forEach((step, i) => {
      if (step.side_effect === "read" && step.idempotency_key) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "idempotency_key"],
          message: `bước read "${step.id}" không cần idempotency_key`,
        });
      }
    });

    // 4. depends_on không được tự trỏ vào chính nó
    plan.steps.forEach((step, i) => {
      if (step.depends_on.includes(step.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "depends_on"],
          message: `step "${step.id}" phụ thuộc chính nó`,
        });
      }
    });

    // 5. depends_on không được trùng lặp
    plan.steps.forEach((step, i) => {
      if (new Set(step.depends_on).size !== step.depends_on.length) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "depends_on"],
          message: `depends_on của "${step.id}" có phần tử trùng lặp`,
        });
      }
    });

    // 6. outputs phải là biểu thức tham chiếu đơn
    Object.entries(plan.outputs).forEach(([key, expr]) => {
      if (!REFERENCE_ONLY.test(expr)) {
        ctx.addIssue({
          code: "custom",
          path: ["outputs", key],
          message: `outputs."${key}" phải là một tham chiếu dạng \${...}`,
        });
      }
    });
  });

export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;

/* ────────────────────────────────────────────────────────────
 * Schema dùng cho LLM structured output
 * ──────────────────────────────────────────────────────────── */

/**
 * Bản rút gọn đưa cho LLM: bỏ các trường có default hợp lý
 * để giảm số thứ LLM phải nghĩ, giảm tỉ lệ sinh sai.
 * Sau khi nhận về, parse bằng WorkflowPlanSchema để điền default.
 */
export const LlmPlanDraftSchema = z
  .object({
    version: z.literal(DSL_VERSION),
    name: z.string().min(1).max(120),
    source_prompt: z.string().min(1).max(4_000),
    inputs: z.record(InputKeySchema, InputDeclSchema).optional(),
    steps: z
      .array(
        z
          .object({
            id: StepIdSchema,
            description: z.string().min(1).max(500),
            tool: ToolRefSchema,
            depends_on: z.array(StepIdSchema).optional(),
            condition: z.string().nullable().optional(),
            idempotency_key: z.string().nullable().optional(),
            side_effect: SideEffectSchema,
            on_error: OnErrorSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    outputs: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type LlmPlanDraft = z.infer<typeof LlmPlanDraftSchema>;

/** A refusal/clarification is a planner outcome, never an empty executable plan. */
export const PlannerResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), plan: LlmPlanDraftSchema }).strict(),
  z
    .object({ kind: z.literal("refusal"), reason: z.string().min(1).max(1000) })
    .strict(),
  z
    .object({
      kind: z.literal("clarification"),
      question: z.string().min(1).max(1000),
    })
    .strict(),
]);
export type PlannerResult = z.infer<typeof PlannerResultSchema>;
