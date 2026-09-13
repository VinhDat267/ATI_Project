/**
 * Validator tầng 3 — Graph (FR-VAL-04, FR-VAL-05)
 *
 * Kiểm tra hai thứ mà schema không kiểm được:
 *   1. Đồ thị phụ thuộc không có chu trình
 *   2. Mọi ${steps.sX.output...} trỏ tới bước CHẮC CHẮN chạy TRƯỚC
 *
 * Điểm tinh tế ở (2): "chạy trước" nghĩa là sX phải nằm trong tập phụ thuộc
 * BẮC CẦU của bước đang xét — không phải chỉ cần xuất hiện sớm hơn trong
 * mảng steps. Nếu không kiểm bắc cầu, engine sẽ gặp lỗi lúc chạy khi hai
 * bước độc lập chạy song song mà bước này lại đọc output của bước kia.
 */

import type { WorkflowPlan, Step, ArgValue } from "./schema.js";
import {
  collectReferences,
  parseReference,
  type Reference,
} from "./reference.js";
import { conditionReferences, parseCondition } from "./condition.js";

export interface GraphIssue {
  path: (string | number)[];
  message: string;
}

export interface GraphValidationResult {
  ok: boolean;
  issues: GraphIssue[];
  warnings: GraphIssue[];
  /** Các lớp thực thi: layers[0] chạy trước, phần tử trong cùng lớp chạy song song. */
  layers: string[][];
}

/* ────────────────────────────────────────────────────────────
 * Phát hiện chu trình
 * ──────────────────────────────────────────────────────────── */

function findCycle(steps: Step[]): string[] | null {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const st = state.get(id);
    if (st === "done") return null;
    if (st === "visiting") {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }

    state.set(id, "visiting");
    stack.push(id);

    for (const dep of byId.get(id)?.depends_on ?? []) {
      if (!byId.has(dep)) continue; // xử lý riêng ở chỗ khác
      const cycle = visit(dep);
      if (cycle) return cycle;
    }

    stack.pop();
    state.set(id, "done");
    return null;
  };

  for (const s of steps) {
    const cycle = visit(s.id);
    if (cycle) return cycle;
  }
  return null;
}

/* ────────────────────────────────────────────────────────────
 * Tập phụ thuộc bắc cầu
 * ──────────────────────────────────────────────────────────── */

function transitiveDeps(steps: Step[]): Map<string, Set<string>> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const memo = new Map<string, Set<string>>();

  const compute = (id: string, seen: Set<string>): Set<string> => {
    const cached = memo.get(id);
    if (cached) return cached;
    if (seen.has(id)) return new Set(); // chu trình — đã báo lỗi riêng

    seen.add(id);
    const out = new Set<string>();
    for (const dep of byId.get(id)?.depends_on ?? []) {
      out.add(dep);
      for (const t of compute(dep, seen)) out.add(t);
    }
    seen.delete(id);

    memo.set(id, out);
    return out;
  };

  for (const s of steps) compute(s.id, new Set());
  return memo;
}

/* ────────────────────────────────────────────────────────────
 * Phân lớp thực thi (dùng cho scheduler và cho UI vẽ DAG)
 * ──────────────────────────────────────────────────────────── */

export function executionLayers(steps: Step[]): string[][] {
  const remaining = new Map(steps.map((s) => [s.id, new Set(s.depends_on)]));
  const layers: string[][] = [];
  const done = new Set<string>();

  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, deps]) => [...deps].every((d) => done.has(d)))
      .map(([id]) => id);

    if (ready.length === 0) break; // chu trình — đã báo lỗi riêng

    layers.push(ready);
    for (const id of ready) {
      remaining.delete(id);
      done.add(id);
    }
  }

  return layers;
}

/* ────────────────────────────────────────────────────────────
 * Validate
 * ──────────────────────────────────────────────────────────── */

export function validateGraph(plan: WorkflowPlan): GraphValidationResult {
  const issues: GraphIssue[] = [];
  const warnings: GraphIssue[] = [];
  const referencedSteps = new Set<string>();
  const stepIds = new Set(plan.steps.map((s) => s.id));

  /* 1. depends_on phải trỏ tới step có thật */
  plan.steps.forEach((step, i) => {
    step.depends_on.forEach((dep, j) => {
      if (!stepIds.has(dep)) {
        issues.push({
          path: ["steps", i, "depends_on", j],
          message: `bước "${step.id}" phụ thuộc vào step không tồn tại: "${dep}"`,
        });
      }
    });
  });

  /* 2. Không có chu trình (FR-VAL-04) */
  const cycle = findCycle(plan.steps);
  if (cycle) {
    issues.push({
      path: ["steps"],
      message: `đồ thị phụ thuộc có chu trình: ${cycle.join(" → ")}`,
    });
    // Có chu trình thì các kiểm tra thứ tự phía dưới không còn ý nghĩa
    return { ok: false, issues, warnings, layers: [] };
  }

  const deps = transitiveDeps(plan.steps);
  const declaredInputs = new Set(Object.keys(plan.inputs));

  /* 3. Tham chiếu trong args và condition (FR-VAL-05) */
  plan.steps.forEach((step, i) => {
    const refs: { ref: Reference; path: (string | number)[] }[] = [];
    const collect = (value: ArgValue, path: (string | number)[]) => {
      if (Array.isArray(value)) {
        value.forEach((v, j) => collect(v, [...path, j]));
        return;
      }
      if (value !== null && typeof value === "object") {
        Object.entries(value).forEach(([k, v]) => collect(v, [...path, k]));
        return;
      }
      try {
        refs.push(...collectReferences(value).map((ref) => ({ ref, path })));
      } catch (err) {
        issues.push({ path, message: (err as Error).message });
      }
    };
    collect(step.tool.args, ["steps", i, "tool", "args"]);
    collect(step.idempotency_key, ["steps", i, "idempotency_key"]);

    if (step.condition) {
      try {
        for (const raw of conditionReferences(parseCondition(step.condition))) {
          refs.push({
            ref: parseReference(raw),
            path: ["steps", i, "condition"],
          });
        }
      } catch (err) {
        issues.push({
          path: ["steps", i, "condition"],
          message: `điều kiện không hợp lệ: ${(err as Error).message}`,
        });
      }
    }

    for (const { ref, path } of refs) {
      if (ref.kind === "input") {
        if (!declaredInputs.has(ref.key)) {
          issues.push({
            path,
            message: `bước "${step.id}" dùng input chưa khai báo: "${ref.key}"`,
          });
        }
        continue;
      }

      if (ref.kind !== "step") continue;
      referencedSteps.add(ref.stepId);

      if (!stepIds.has(ref.stepId)) {
        issues.push({
          path,
          message: `bước "${step.id}" tham chiếu step không tồn tại: "${ref.stepId}"`,
        });
        continue;
      }

      if (ref.stepId === step.id) {
        issues.push({
          path,
          message: `bước "${step.id}" tham chiếu output của chính nó`,
        });
        continue;
      }

      // ★ Kiểm tra bắc cầu: nguồn dữ liệu phải CHẮC CHẮN chạy trước
      if (!deps.get(step.id)?.has(ref.stepId)) {
        issues.push({
          path,
          message:
            `bước "${step.id}" đọc output của "${ref.stepId}" nhưng không phụ thuộc ` +
            `vào bước đó — thêm "${ref.stepId}" vào depends_on`,
        });
      }
    }
  });

  /* 4. Tham chiếu trong outputs của workflow */
  Object.entries(plan.outputs).forEach(([key, expr]) => {
    try {
      const ref = parseReference(expr);
      if (ref.kind === "step" && !stepIds.has(ref.stepId)) {
        issues.push({
          path: ["outputs", key],
          message: `outputs."${key}" tham chiếu step không tồn tại: "${ref.stepId}"`,
        });
      }
      if (ref.kind === "input" && !declaredInputs.has(ref.key)) {
        issues.push({
          path: ["outputs", key],
          message: `outputs."${key}" tham chiếu input chưa khai báo: "${ref.key}"`,
        });
      }
    } catch (err) {
      issues.push({
        path: ["outputs", key],
        message: (err as Error).message,
      });
    }
  });

  /* 5. Cảnh báo: step không được dùng và không phải bước ghi */
  for (const expr of Object.values(plan.outputs)) {
    try {
      const ref = parseReference(expr);
      if (ref.kind === "step") referencedSteps.add(ref.stepId);
    } catch {
      /* đã báo ở trên */
    }
  }

  plan.steps.forEach((step, i) => {
    const isUsed = referencedSteps.has(step.id);
    const isDependedOn = plan.steps.some((s) => s.depends_on.includes(step.id));
    if (step.side_effect === "read" && !isUsed && !isDependedOn) {
      warnings.push({
        path: ["steps", i],
        message: `bước read "${step.id}" không được bước nào dùng tới — có thể thừa`,
      });
    }
  });

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    layers: executionLayers(plan.steps),
  };
}
