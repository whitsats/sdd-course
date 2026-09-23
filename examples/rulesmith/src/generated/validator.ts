// ⚠️ DO NOT EDIT —— 此文件由 tools/generator 生成，请勿手动编辑。
// 修改行为请改 specs/001-rulesmith-dsl/spec.md，然后运行 `pnpm generate`。
// （本文件刻意不含生成时间戳：产物必须可复现，否则 CI 的 git diff 校验会随机失败。）

import { parse } from "./parser.ts";

/** 错误码 —— 直接来自 spec.md §4 的错误码表 */
export const ERROR_CODES = [
  "PARSE_ERROR",
  "UNEXPECTED_EOF",
  "UNKNOWN_FIELD",
  "TYPE_MISMATCH",
  "PRIORITY_CONFLICT",
  "DUPLICATE_RULE",
  "UNKNOWN_OPERATOR",
  "UNDEFINED_RULE_REF"
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** 每个错误码的报告位置格式 —— 同样来自 spec.md §4 */
export const ERROR_LOCATION = {
  "DUPLICATE_RULE": "规则名 + 两处行号",
  "PARSE_ERROR": "行号 + 列号",
  "PRIORITY_CONFLICT": "两个规则名",
  "TYPE_MISMATCH": "规则名 + 运算符 + 实际类型",
  "UNDEFINED_RULE_REF": "规则名",
  "UNEXPECTED_EOF": "行号",
  "UNKNOWN_FIELD": "规则名 + 字段路径",
  "UNKNOWN_OPERATOR": "行号"
};

/** 运算符分类 —— 来自 spec.md §2 的 operator 产生式 */
export const NUMERIC_OPERATORS = [
  "<",
  "<=",
  ">",
  ">="
] as const;
export const LIST_OPERATORS    = [
  "in",
  "notin"
] as const;

export type FieldSchema = Record<string, unknown>;

export type Diagnostic = { code: ErrorCode; rule?: string; detail: string };

/**
 * 核心不变量（spec §3 最后一条）：
 *   任何通过本校验的规则集，运行期都不会因语法或类型原因出错。
 * 因此校验器必须**穷尽**所有可能出错的地方 —— 宁可多报，不可漏报。
 */
export function validate(src: string, schema: FieldSchema): Diagnostic[] {
  const out: Diagnostic[] = [];

  const parsed = parse(src);
  if (!parsed.ok) {
    out.push({ code: "PARSE_ERROR", detail: `${parsed.line}:${parsed.col} ${parsed.message}` });
    return out;   // 语法都没过，语义检查无意义
  }

  // TODO: 字段路径解析（UNKNOWN_FIELD）、类型检查（TYPE_MISMATCH）、
  //       规则名唯一性（DUPLICATE_RULE）、冲突检测（PRIORITY_CONFLICT）。
  // 这些检查依赖 AST 的具体形状，需要 parser 产出带语义的节点，
  // 而不是当前的通用 AstNode。见 spec.md §7 的「被否决的设计 ③」：
  // 通用 EBNF 回溯解析器能覆盖语法，但语义检查仍需针对本语法的访问器。
  void schema;
  return out;
}

export function hasFatal(diags: Diagnostic[]): boolean {
  return diags.some((d) => d.code === "PARSE_ERROR" || d.code === "UNEXPECTED_EOF");
}
