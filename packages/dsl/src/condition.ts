/**
 * Parser cho biểu thức điều kiện (FR-VAL-07, NFR-09).
 *
 * ⚠️  KHÔNG dùng eval, Function(), vm, hay bất kỳ cơ chế thực thi động nào.
 *     Nội dung này do LLM sinh ra — phải coi là dữ liệu không tin cậy.
 *
 * Grammar (cố ý hẹp):
 *
 *   expr       := or
 *   or         := and ( '||' and )*
 *   and        := not ( '&&' not )*
 *   not        := '!' not | primary
 *   primary    := '(' expr ')' | comparison | operand
 *   comparison := operand compOp operand
 *   compOp     := '==' | '!=' | '>' | '>=' | '<' | '<='
 *   operand    := reference | number | string | 'true' | 'false' | 'null'
 *   reference  := '${' ... '}'
 *
 * Không hỗ trợ: phép toán số học, gọi hàm, truy cập thuộc tính ngoài
 * tham chiếu, toán tử ba ngôi, regex. Cần gì thêm thì mở rộng grammar
 * một cách có kiểm soát — không bao giờ mở cửa cho eval.
 */

import { REFERENCE_ONLY } from "./schema.js";
import {
  parseReference,
  resolveReference,
  type ResolveContext,
} from "./reference.js";

/* ────────────────────────────────────────────────────────────
 * AST
 * ──────────────────────────────────────────────────────────── */

export type CondNode =
  | { type: "or"; left: CondNode; right: CondNode }
  | { type: "and"; left: CondNode; right: CondNode }
  | { type: "not"; operand: CondNode }
  | { type: "compare"; op: CompareOp; left: Operand; right: Operand }
  | { type: "operand"; value: Operand };

export type CompareOp = "==" | "!=" | ">" | ">=" | "<" | "<=";

export type Operand =
  | { type: "ref"; raw: string }
  | { type: "literal"; value: string | number | boolean | null };

export class ConditionSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
    readonly source: string,
  ) {
    super(`${message} (vị trí ${position}) trong: ${source}`);
    this.name = "ConditionSyntaxError";
  }
}

/* ────────────────────────────────────────────────────────────
 * Tokenizer
 * ──────────────────────────────────────────────────────────── */

type TokenType =
  | "ref"
  | "number"
  | "string"
  | "bool"
  | "null"
  | "op"
  | "lparen"
  | "rparen"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

const COMPARE_OPS: readonly string[] = ["==", "!=", ">=", "<=", ">", "<"];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i]!;

    // Bỏ qua khoảng trắng
    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // Tham chiếu ${...}
    if (c === "$" && src[i + 1] === "{") {
      const end = src.indexOf("}", i);
      if (end === -1)
        throw new ConditionSyntaxError("thiếu '}' đóng tham chiếu", i, src);
      const raw = src.slice(i, end + 1);
      if (!REFERENCE_ONLY.test(raw)) {
        throw new ConditionSyntaxError(
          `tham chiếu không hợp lệ: ${raw}`,
          i,
          src,
        );
      }
      tokens.push({ type: "ref", value: raw, pos: i });
      i = end + 1;
      continue;
    }

    // Chuỗi — chỉ hỗ trợ nháy đơn, không hỗ trợ escape phức tạp
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end === -1)
        throw new ConditionSyntaxError("thiếu nháy đóng chuỗi", i, src);
      tokens.push({ type: "string", value: src.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }

    // Số
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^-?[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new ConditionSyntaxError("số không hợp lệ", i, src);
      tokens.push({ type: "number", value: m[0], pos: i });
      i += m[0].length;
      continue;
    }

    // Ngoặc
    if (c === "(") {
      tokens.push({ type: "lparen", value: c, pos: i });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen", value: c, pos: i });
      i++;
      continue;
    }

    // Toán tử logic
    if (src.startsWith("&&", i) || src.startsWith("||", i)) {
      tokens.push({ type: "op", value: src.slice(i, i + 2), pos: i });
      i += 2;
      continue;
    }

    // Toán tử so sánh (2 ký tự trước, 1 ký tự sau)
    const two = src.slice(i, i + 2);
    if (COMPARE_OPS.includes(two)) {
      tokens.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if (COMPARE_OPS.includes(c)) {
      tokens.push({ type: "op", value: c, pos: i });
      i++;
      continue;
    }

    // Phủ định
    if (c === "!") {
      tokens.push({ type: "op", value: "!", pos: i });
      i++;
      continue;
    }

    // Từ khoá
    const word = /^[a-z]+/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      if (w === "true" || w === "false") {
        tokens.push({ type: "bool", value: w, pos: i });
      } else if (w === "null") {
        tokens.push({ type: "null", value: w, pos: i });
      } else {
        throw new ConditionSyntaxError(`từ khoá không hợp lệ: "${w}"`, i, src);
      }
      i += w.length;
      continue;
    }

    throw new ConditionSyntaxError(`ký tự không hợp lệ: "${c}"`, i, src);
  }

  tokens.push({ type: "eof", value: "", pos: src.length });
  return tokens;
}

/* ────────────────────────────────────────────────────────────
 * Parser (recursive descent)
 * ──────────────────────────────────────────────────────────── */

export function parseCondition(src: string): CondNode {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = (): Token => tokens[pos]!;
  const next = (): Token => tokens[pos++]!;

  const expect = (type: TokenType, value?: string): Token => {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new ConditionSyntaxError(
        `mong đợi ${value ?? type}, nhận được "${t.value || "hết biểu thức"}"`,
        t.pos,
        src,
      );
    }
    return next();
  };

  const parseOperand = (): Operand => {
    const t = next();
    switch (t.type) {
      case "ref":
        return { type: "ref", raw: t.value };
      case "number":
        return { type: "literal", value: Number(t.value) };
      case "string":
        return { type: "literal", value: t.value };
      case "bool":
        return { type: "literal", value: t.value === "true" };
      case "null":
        return { type: "literal", value: null };
      default:
        throw new ConditionSyntaxError(
          `mong đợi giá trị, nhận được "${t.value || "hết biểu thức"}"`,
          t.pos,
          src,
        );
    }
  };

  const parsePrimary = (): CondNode => {
    const t = peek();

    if (t.type === "lparen") {
      next();
      const inner = parseOr();
      expect("rparen");
      return inner;
    }

    if (t.type === "op" && t.value === "!") {
      next();
      return { type: "not", operand: parsePrimary() };
    }

    const left = parseOperand();
    const after = peek();

    if (after.type === "op" && COMPARE_OPS.includes(after.value)) {
      next();
      const right = parseOperand();
      return { type: "compare", op: after.value as CompareOp, left, right };
    }

    return { type: "operand", value: left };
  };

  const parseAnd = (): CondNode => {
    let node = parsePrimary();
    while (peek().type === "op" && peek().value === "&&") {
      next();
      node = { type: "and", left: node, right: parsePrimary() };
    }
    return node;
  };

  function parseOr(): CondNode {
    let node = parseAnd();
    while (peek().type === "op" && peek().value === "||") {
      next();
      node = { type: "or", left: node, right: parseAnd() };
    }
    return node;
  }

  const ast = parseOr();
  expect("eof");
  return ast;
}

/* ────────────────────────────────────────────────────────────
 * Đánh giá
 * ──────────────────────────────────────────────────────────── */

function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function operandValue(op: Operand, ctx: ResolveContext): unknown {
  const v =
    op.type === "literal"
      ? op.value
      : resolveReference(parseReference(op.raw), ctx);
  // Chuẩn hoá undefined → null: LLM sẽ viết `== null` để kiểm tra
  // trường không tồn tại, và đó là cách viết tự nhiên nhất.
  return v === undefined ? null : v;
}

function compare(op: CompareOp, a: unknown, b: unknown): boolean {
  switch (op) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    default: {
      // So sánh thứ tự chỉ áp dụng cho số hoặc chuỗi cùng kiểu
      if (typeof a === "number" && typeof b === "number") {
        return op === ">"
          ? a > b
          : op === ">="
            ? a >= b
            : op === "<"
              ? a < b
              : a <= b;
      }
      if (typeof a === "string" && typeof b === "string") {
        return op === ">"
          ? a > b
          : op === ">="
            ? a >= b
            : op === "<"
              ? a < b
              : a <= b;
      }
      throw new TypeError(
        `không so sánh được ${typeof a} với ${typeof b} bằng toán tử "${op}"`,
      );
    }
  }
}

export function evaluateCondition(
  node: CondNode,
  ctx: ResolveContext,
): boolean {
  switch (node.type) {
    case "or":
      return (
        evaluateCondition(node.left, ctx) || evaluateCondition(node.right, ctx)
      );
    case "and":
      return (
        evaluateCondition(node.left, ctx) && evaluateCondition(node.right, ctx)
      );
    case "not":
      return !evaluateCondition(node.operand, ctx);
    case "compare":
      return compare(
        node.op,
        operandValue(node.left, ctx),
        operandValue(node.right, ctx),
      );
    case "operand":
      return truthy(operandValue(node.value, ctx));
  }
}

/** Tiện ích: parse rồi đánh giá trong một lần gọi. */
export function evaluate(src: string, ctx: ResolveContext): boolean {
  return evaluateCondition(parseCondition(src), ctx);
}

/** Trích mọi tham chiếu xuất hiện trong một điều kiện (dùng cho validate tầng 3). */
export function conditionReferences(node: CondNode): string[] {
  switch (node.type) {
    case "or":
    case "and":
      return [
        ...conditionReferences(node.left),
        ...conditionReferences(node.right),
      ];
    case "not":
      return conditionReferences(node.operand);
    case "compare":
      return [node.left, node.right]
        .filter((o): o is { type: "ref"; raw: string } => o.type === "ref")
        .map((o) => o.raw);
    case "operand":
      return node.value.type === "ref" ? [node.value.raw] : [];
  }
}
