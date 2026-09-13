/**
 * Biểu thức tham chiếu  ${namespace.path}
 *
 * Ba namespace hợp lệ:
 *   ${inputs.<key>}                  — tham số đầu vào
 *   ${steps.<stepId>.output.<path>}  — output của bước trước
 *   ${runtime.<var>}                 — giá trị hệ thống cấp
 *
 * Không dùng eval ở bất kỳ đâu (NFR-09).
 */

import {
  REFERENCE_GLOBAL,
  REFERENCE_ONLY,
  RUNTIME_VARS,
  type ArgValue,
  type RuntimeVar,
} from "./schema.js";

/* ────────────────────────────────────────────────────────────
 * Kiểu
 * ──────────────────────────────────────────────────────────── */

export type Reference =
  | { kind: "input"; key: string; raw: string }
  | { kind: "step"; stepId: string; path: string[]; raw: string }
  | { kind: "runtime"; name: RuntimeVar; raw: string };

export class ReferenceError_ extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "ReferenceError_";
  }
}

/* ────────────────────────────────────────────────────────────
 * Phân tích
 * ──────────────────────────────────────────────────────────── */

/** Phân tích một tham chiếu đơn, ví dụ "${steps.s1.output.count}". */
export function parseReference(raw: string): Reference {
  if (!REFERENCE_ONLY.test(raw)) {
    throw new ReferenceError_("không phải biểu thức tham chiếu hợp lệ", raw);
  }

  const inner = raw.slice(2, -1).trim();
  const parts = inner.split(".");
  if (
    parts.some((p) => ["__proto__", "prototype", "constructor"].includes(p))
  ) {
    throw new ReferenceError_("không được truy cập thuộc tính prototype", raw);
  }
  const [ns, ...rest] = parts;

  switch (ns) {
    case "inputs": {
      if (rest.length !== 1) {
        throw new ReferenceError_(
          "inputs chỉ nhận đúng một cấp: ${inputs.<key>}",
          raw,
        );
      }
      return { kind: "input", key: rest[0]!, raw };
    }

    case "steps": {
      // steps.<stepId>.output[.path...]
      if (rest.length < 2 || rest[1] !== "output") {
        throw new ReferenceError_(
          "tham chiếu step phải có dạng ${steps.<stepId>.output...}",
          raw,
        );
      }
      return { kind: "step", stepId: rest[0]!, path: rest.slice(2), raw };
    }

    case "runtime": {
      if (rest.length !== 1) {
        throw new ReferenceError_(
          "runtime chỉ nhận đúng một cấp: ${runtime.<var>}",
          raw,
        );
      }
      const name = rest[0]!;
      if (!(RUNTIME_VARS as readonly string[]).includes(name)) {
        throw new ReferenceError_(
          `biến runtime không tồn tại: "${name}" (hợp lệ: ${RUNTIME_VARS.join(", ")})`,
          raw,
        );
      }
      return { kind: "runtime", name: name as RuntimeVar, raw };
    }

    default:
      throw new ReferenceError_(
        `namespace không hợp lệ: "${ns}" (hợp lệ: inputs, steps, runtime)`,
        raw,
      );
  }
}

/** Trích mọi tham chiếu nhúng trong một chuỗi. */
export function extractReferences(text: string): Reference[] {
  const out: Reference[] = [];
  let cursor = 0;
  while (true) {
    const start = text.indexOf("${", cursor);
    if (start < 0) break;
    const end = text.indexOf("}", start + 2);
    if (end < 0)
      throw new ReferenceError_(
        "tham chiếu thiếu dấu đóng }",
        text.slice(start),
      );
    out.push(parseReference(text.slice(start, end + 1)));
    cursor = end + 1;
  }
  return out;
}

/** Duyệt đệ quy một cây ArgValue, thu thập mọi tham chiếu. */
export function collectReferences(value: ArgValue): Reference[] {
  if (typeof value === "string") return extractReferences(value);
  if (Array.isArray(value)) return value.flatMap(collectReferences);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(collectReferences);
  }
  return [];
}

/* ────────────────────────────────────────────────────────────
 * Resolve (FR-EXE-03)
 * ──────────────────────────────────────────────────────────── */

export interface ResolveContext {
  inputs: Record<string, string | number | boolean>;
  /** stepId -> output đã trả về của bước đó */
  stepOutputs: Record<string, unknown>;
  runtime: Record<RuntimeVar, string>;
}

function lookupPath(root: unknown, path: string[], raw: string): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur === null || cur === undefined) {
      throw new ReferenceError_(
        `đường dẫn "${path.join(".")}" gặp giá trị null`,
        raw,
      );
    }
    if (typeof cur !== "object") {
      throw new ReferenceError_(
        `đường dẫn "${path.join(".")}" đi vào giá trị không phải object`,
        raw,
      );
    }
    if (!Object.hasOwn(cur, seg)) {
      throw new ReferenceError_(`không tìm thấy thuộc tính "${seg}"`, raw);
    }
    // Hỗ trợ chỉ số mảng dạng số
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) {
        throw new ReferenceError_(
          `"${seg}" không phải chỉ số mảng hợp lệ`,
          raw,
        );
      }
      cur = cur[idx];
    } else {
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

/** Lấy giá trị của một tham chiếu từ context. */
export function resolveReference(ref: Reference, ctx: ResolveContext): unknown {
  switch (ref.kind) {
    case "input": {
      if (!Object.hasOwn(ctx.inputs, ref.key)) {
        throw new ReferenceError_(
          `input "${ref.key}" chưa được cung cấp`,
          ref.raw,
        );
      }
      return ctx.inputs[ref.key];
    }
    case "runtime":
      return ctx.runtime[ref.name];
    case "step": {
      if (!Object.hasOwn(ctx.stepOutputs, ref.stepId)) {
        throw new ReferenceError_(
          `bước "${ref.stepId}" chưa chạy hoặc không có output`,
          ref.raw,
        );
      }
      return lookupPath(ctx.stepOutputs[ref.stepId], ref.path, ref.raw);
    }
  }
}

/**
 * Resolve một giá trị đối số.
 *
 * - Chuỗi CHỈ chứa một tham chiếu  → trả về giá trị gốc, GIỮ NGUYÊN KIỂU
 *   ("${steps.s1.output.count}" → 12, không phải "12")
 * - Chuỗi có tham chiếu nhúng      → nội suy thành chuỗi
 * - Mảng / object                  → đệ quy
 */
export function resolveValue(value: ArgValue, ctx: ResolveContext): unknown {
  if (typeof value === "string") {
    extractReferences(value); // Also reject malformed ${...}; never silently keep it as a literal.
    if (REFERENCE_ONLY.test(value)) {
      return resolveReference(parseReference(value), ctx);
    }
    return value.replace(REFERENCE_GLOBAL, (_match, inner: string) => {
      const v = resolveReference(parseReference(`\${${inner}}`), ctx);
      if (v === undefined || (v !== null && typeof v === "object")) {
        throw new ReferenceError_(
          "chỉ nội suy giá trị scalar; dùng tham chiếu đơn để truyền object/mảng",
          value,
        );
      }
      return v === null ? "" : String(v);
    });
  }

  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx));

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveValue(v, ctx)]),
    );
  }

  return value;
}

/** Resolve toàn bộ args của một tool. */
export function resolveArgs(
  args: Record<string, ArgValue>,
  ctx: ResolveContext,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [k, resolveValue(v, ctx)]),
  );
}

/* ────────────────────────────────────────────────────────────
 * Giá trị runtime (FR-PLN-08)
 * ──────────────────────────────────────────────────────────── */

export function buildRuntime(opts: {
  now?: Date;
  runId: string;
  userId: string;
  /** 1 = thứ Hai (mặc định, theo ISO-8601) */
  weekStartsOn?: 0 | 1;
  /** Persist this IANA timezone alongside the returned runtime snapshot. */
  timeZone?: string;
}): Record<RuntimeVar, string> {
  const now = opts.now ?? new Date();
  const weekStartsOn = opts.weekStartsOn ?? 1;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: opts.timeZone ?? "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) =>
    Number(parts.find((p) => p.type === name)!.value);
  // UTC arithmetic on local calendar components avoids DST and host-timezone drift.
  const calendar = new Date(
    Date.UTC(part("year"), part("month") - 1, part("day")),
  );

  const startOfDay = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  const day = calendar.getUTCDay();
  const diff = (day - weekStartsOn + 7) % 7;

  const weekStart = startOfDay(calendar);
  weekStart.setUTCDate(weekStart.getUTCDate() - diff);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const monthStart = new Date(
    Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, 0),
  );

  const iso = (d: Date) => d.toISOString();
  const date = (d: Date) => d.toISOString().slice(0, 10);

  return {
    now: iso(now),
    today: date(calendar),
    week_start: date(weekStart),
    week_end: date(weekEnd),
    month_start: date(monthStart),
    month_end: date(monthEnd),
    run_id: opts.runId,
    user_id: opts.userId,
  };
}
