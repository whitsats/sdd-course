/**
 * 发射器 —— 把解析好的规格转成四类产物。
 *
 * ⚠️ 本文件是**手写代码**（spec-as-source 的递归边界，见 spec.md §6）。
 *
 * ⛔ 幂等性铁律：**产物中不得出现任何随时间/环境变化的内容。**
 *    —— 不要生成时间戳、不要生成 hostname、不要依赖 Object.keys 的顺序、
 *       不要依赖文件系统遍历顺序。
 *    一旦违反，`git diff` 校验永远非空，门禁随机变红，然后团队会关掉它。
 */

import type { Grammar, Node, Production } from './ebnf.ts';
import { renderProduction, CHAR_CLASSES } from './ebnf.ts';
import type { ErrorCode, GeneratedArtifact } from './spec-reader.ts';

const HEADER_LINES = [
  '// ⚠️ DO NOT EDIT —— 此文件由 tools/generator 生成，请勿手动编辑。',
  '// 修改行为请改 specs/001-rulesmith-dsl/spec.md，然后运行 `pnpm generate`。',
  '// （本文件刻意不含生成时间戳：产物必须可复现，否则 CI 的 git diff 校验会随机失败。）',
];

function header(commentPrefix: '//' | '<!--' | '#'): string[] {
  if (commentPrefix === '//') return HEADER_LINES;
  return [
    '<!-- ⚠️ DO NOT EDIT —— 此文件由 tools/generator 生成，请勿手动编辑。 -->',
    '<!-- 修改行为请改 specs/001-rulesmith-dsl/spec.md，然后运行 `pnpm generate`。 -->',
    '<!-- （本文件刻意不含生成时间戳：产物必须可复现。） -->',
  ];
}

/** 确定性的 JSON：键按字母序输出，保证同一输入产出同一字节序列 */
function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 词法分析器
// ─────────────────────────────────────────────────────────────────────────────
export function emitLexer(g: Grammar): string {
  const keywords = [...g.keywords].sort();
  // 符号按长度降序 → 最大匹配（maximal munch），保证 `>=` 不会被切成 `>` `=`
  const symbols = [...g.symbols].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));

  // 全大写产生式名 → 扫描器种类（IDENT → "ident"），名字小写即种类。
  // 这个映射的合法性由 ebnf.ts 的引用校验保证（不在 TOKEN_SCANNERS 里就构建期报错）。
  const tokenKinds = Object.fromEntries(
    g.tokenTypes.map((p) => [p.name, p.name.toLowerCase()]),
  );

  return [
    ...header('//'),
    '',
    'export const KEYWORDS = ' + stableJson(keywords) + ' as const;',
    '',
    '/** 符号按长度降序，保证最大匹配：>= 需先于 > 尝试 */',
    'export const SYMBOLS = ' + stableJson(symbols) + ' as const;',
    '',
    '/**',
    ' * token 类型 ← spec.md 中**全大写名字**的产生式（IDENT / NUMBER / STRING …）。',
    ' * 它们不进语法产生式表：它们描述的是「扫描器怎么切出一个 token」，不是语法规则。',
    ' * 语法里引用 IDENT 的意思是「此处放一枚 kind 为 "ident" 的 token」。',
    ' */',
    'export const TOKEN_KINDS = ' + stableJson(tokenKinds) + ' as const;',
    '',
    'export type TokenKind = (typeof TOKEN_KINDS)[keyof typeof TOKEN_KINDS];',
    '',
    'const KEYWORD_SET = new Set<string>(KEYWORDS);',
    '',
    'export type TokenType = "keyword" | "symbol" | "ident" | "number" | "string" | "eof";',
    '',
    'export type Token = { type: TokenType; value: string; line: number; col: number };',
    '',
    'export class LexError extends Error {',
    '  line: number; col: number;',
    '  constructor(message: string, line: number, col: number) {',
    '    super(message);',
    '    this.name = "PARSE_ERROR";',
    '    this.line = line;',
    '    this.col = col;',
    '  }',
    '}',
    '',
    '/** 扫描整个输入，返回 token 流（末尾必有 eof） */',
    'export function tokenize(src: string): Token[] {',
    '  const out: Token[] = [];',
    '  let i = 0;',
    '  let line = 1;',
    '  let col = 1;',
    '',
    '  const advance = (n = 1) => {',
    '    for (let k = 0; k < n; k++) {',
    '      if (src[i] === "\\n") { line++; col = 1; } else { col++; }',
    '      i++;',
    '    }',
    '  };',
    '',
    '  while (i < src.length) {',
    '    const c = src[i];',
    '',
    '    if (c === " " || c === "\\t" || c === "\\r" || c === "\\n") { advance(); continue; }',
    '',
    '    // 行注释：// 到行尾',
    '    if (c === "/" && src[i + 1] === "/") {',
    '      while (i < src.length && src[i] !== "\\n") advance();',
    '      continue;',
    '    }',
    '',
    '    // 字符串字面量',
    '    if (c === \'"\') {',
    '      const startLine = line, startCol = col;',
    '      let v = "";',
    '      advance();',
    '      while (i < src.length && src[i] !== \'"\') {',
    '        if (src[i] === "\\\\" && i + 1 < src.length) { v += src[i + 1]; advance(2); continue; }',
    '        v += src[i]; advance();',
    '      }',
    '      if (i >= src.length) throw new LexError("字符串未闭合", startLine, startCol);',
    '      advance();',
    '      out.push({ type: "string", value: v, line: startLine, col: startCol });',
    '      continue;',
    '    }',
    '',
    '    // 数字',
    '    if (c >= "0" && c <= "9") {',
    '      const startLine = line, startCol = col;',
    '      let v = "";',
    '      while (i < src.length && src[i] >= "0" && src[i] <= "9") { v += src[i]; advance(); }',
    '      if (src[i] === ".") {',
    '        v += "."; advance();',
    '        while (i < src.length && src[i] >= "0" && src[i] <= "9") { v += src[i]; advance(); }',
    '      }',
    '      out.push({ type: "number", value: v, line: startLine, col: startCol });',
    '      continue;',
    '    }',
    '',
    '    // 标识符 / 关键字',
    '    if (/[A-Za-z_]/.test(c)) {',
    '      const startLine = line, startCol = col;',
    '      let v = "";',
    '      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) { v += src[i]; advance(); }',
    '      out.push({',
    '        type: KEYWORD_SET.has(v) ? "keyword" : "ident",',
    '        value: v, line: startLine, col: startCol,',
    '      });',
    '      continue;',
    '    }',
    '',
    '    // 符号（最大匹配）',
    '    const hit = SYMBOLS.find((s) => src.startsWith(s, i));',
    '    if (hit) {',
    '      out.push({ type: "symbol", value: hit, line, col });',
    '      advance(hit.length);',
    '      continue;',
    '    }',
    '',
    '    throw new LexError(`无法识别的字符 ${JSON.stringify(c)}`, line, col);',
    '  }',
    '',
    '  out.push({ type: "eof", value: "", line, col });',
    '  return out;',
    '}',
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 语法分析器（表驱动 + 全回溯）
// ─────────────────────────────────────────────────────────────────────────────
export function emitParser(g: Grammar): string {
  // 只发射 AST 结构（不发射函数），运行时是固定的通用回溯解析器。
  //
  // ⚠️ 这里只能用 g.productions（**语法层**）—— 绝不能把 g.tokenTypes 也塞进来。
  //    曾经这么干过，后果是 PRODUCTIONS["IDENT"] 引用了字符类 letter，
  //    生成的 parser 在运行期抛 `未定义的产生式: letter`。
  const productions = g.productions.map((p: Production) => ({ name: p.name, rhs: p.rhs }));

  return [
    ...header('//'),
    '',
    'import { tokenize, TOKEN_KINDS, type Token } from "./lexer.ts";',
    '',
    'export type AstNode =',
    '  | { k: "seq"; items: AstNode[] }',
    '  | { k: "alt"; items: AstNode[] }',
    '  | { k: "rep"; item: AstNode }',
    '  | { k: "opt"; item: AstNode }',
    '  | { k: "term"; value: string }',
    '  | { k: "ref"; name: string };',
    '',
    '/** 产生式表 —— 直接来自 spec.md 的 ```ebnf 块 */',
    'export const PRODUCTIONS: Record<string, AstNode> = ' + stableJson(
      Object.fromEntries(productions.map((p) => [p.name, p.rhs])),
    ) + ';',
    '',
    'export const START = ' + JSON.stringify(g.start) + ';',
    '',
    'export type ParseOk  = { ok: true;  node: AstNode; pos: number };',
    'export type ParseErr = { ok: false; pos: number; expected: string[] };',
    '',
    'type Result = ParseOk | ParseErr;',
    '',
    '/**',
    ' * 表驱动回溯解析器。',
    ' * 它不认识任何具体语法 —— 语法全部来自 PRODUCTIONS 表。',
    ' * 因此改 spec.md 的 EBNF → 重新生成 → 解析器行为自动变化。',
    ' */',
    'function match(node: AstNode, toks: Token[], pos: number): Result {',
    '  switch (node.k) {',
    '    case "term": {',
    '      const t = toks[pos];',
    '      if (t && t.value === node.value) return { ok: true, node, pos: pos + 1 };',
    '      return { ok: false, pos, expected: [node.value] };',
    '    }',
    '',
    '    case "ref": {',
    '      // ① 引用的是一个 **token 类型**（全大写产生式）',
    '      //    → 期望此处有一枚对应种类的 token，就地消费一枚。',
    '      const kind = (TOKEN_KINDS as Record<string, string | undefined>)[node.name];',
    '      if (kind !== undefined) {',
    '        const t = toks[pos];',
    '        if (t && t.type === kind) return { ok: true, node, pos: pos + 1 };',
    '        return { ok: false, pos, expected: [node.name] };',
    '      }',
    '',
    '      // ② 引用的是一个普通产生式 → 递归',
    '      const sub = PRODUCTIONS[node.name];',
    '      if (!sub) throw new Error(`未定义的产生式: ${node.name}`);',
    '      return match(sub, toks, pos);',
    '    }',
    '',
    '    case "seq": {',
    '      const items: AstNode[] = [];',
    '      let p = pos;',
    '      for (const item of node.items) {',
    '        const r = match(item, toks, p);',
    '        if (!r.ok) return { ok: false, pos: r.pos, expected: r.expected };',
    '        items.push(r.node);',
    '        p = r.pos;',
    '      }',
    '      return { ok: true, node: { k: "seq", items }, pos: p };',
    '    }',
    '',
    '    case "alt": {',
    '      const expected: string[] = [];',
    '      let furthest = pos;',
    '      for (const item of node.items) {',
    '        const r = match(item, toks, pos);',
    '        if (r.ok) return r;',
    '        if (r.pos > furthest) furthest = r.pos;',
    '        expected.push(...r.expected);',
    '      }',
    '      return { ok: false, pos: furthest, expected };',
    '    }',
    '',
    '    case "rep": {',
    '      const items: AstNode[] = [];',
    '      let p = pos;',
    '      for (;;) {',
    '        const r = match(node.item, toks, p);',
    '        if (!r.ok) break;',
    '        if (r.pos === p) break;   // 防左递归导致的死循环',
    '        items.push(r.node);',
    '        p = r.pos;',
    '      }',
    '      return { ok: true, node: { k: "rep", item: node.item }, pos: p };',
    '    }',
    '',
    '    case "opt": {',
    '      const r = match(node.item, toks, pos);',
    '      if (r.ok) return r;',
    '      return { ok: true, node: { k: "opt", item: node.item }, pos };',
    '    }',
    '  }',
    '}',
    '',
    'export type ParseFailure = { ok: false; message: string; line: number; col: number };',
    '',
    'export function parse(src: string): { ok: true; pos: number } | ParseFailure {',
    '  const toks = tokenize(src);',
    '  const r = match(PRODUCTIONS[START], toks, 0);',
    '',
    '  if (!r.ok) {',
    '    const t = toks[r.pos] ?? toks[toks.length - 1];',
    '    return {',
    '      ok: false,',
    '      message: `语法错误：期望 ${[...new Set(r.expected)].join(" 或 ")}，实际 ${JSON.stringify(t.value) || "输入结束"}`,',
    '      line: t.line, col: t.col,',
    '    };',
    '  }',
    '',
    '  if (r.pos !== toks.length - 1) {',
    '    const t = toks[r.pos];',
    '    return { ok: false, message: `语法错误：多余的 ${JSON.stringify(t.value)}`, line: t.line, col: t.col };',
    '  }',
    '',
    '  return { ok: true, pos: r.pos };',
    '}',
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 语义校验器
// ─────────────────────────────────────────────────────────────────────────────
export function emitValidator(g: Grammar, codes: ErrorCode[]): string {
  const operators = g.productions.find((p) => p.name === 'operator');
  const opList: string[] = [];
  const collectTerms = (n: Node): void => {
    switch (n.k) {
      case 'term': opList.push(n.value); break;
      case 'seq': case 'alt': n.items.forEach(collectTerms); break;
      case 'rep': case 'opt': collectTerms(n.item); break;
      case 'ref': break;
    }
  };
  if (operators) collectTerms(operators.rhs);

  const numericOps = opList.filter((o) => /^[<>]=?$/.test(o));
  const listOps = opList.filter((o) => o === 'in' || o === 'notin');

  return [
    ...header('//'),
    '',
    'import { parse } from "./parser.ts";',
    '',
    '/** 错误码 —— 直接来自 spec.md §4 的错误码表 */',
    'export const ERROR_CODES = ' + stableJson(codes.map((c) => c.code)) + ' as const;',
    'export type ErrorCode = (typeof ERROR_CODES)[number];',
    '',
    '/** 每个错误码的报告位置格式 —— 同样来自 spec.md §4 */',
    'export const ERROR_LOCATION = ' + stableJson(
      Object.fromEntries(codes.map((c) => [c.code, c.location])),
    ) + ';',
    '',
    '/** 运算符分类 —— 来自 spec.md §2 的 operator 产生式 */',
    'export const NUMERIC_OPERATORS = ' + stableJson(numericOps.sort()) + ' as const;',
    'export const LIST_OPERATORS    = ' + stableJson(listOps.sort()) + ' as const;',
    '',
    'export type FieldSchema = Record<string, unknown>;',
    '',
    'export type Diagnostic = { code: ErrorCode; rule?: string; detail: string };',
    '',
    '/**',
    ' * 核心不变量（spec §3 最后一条）：',
    ' *   任何通过本校验的规则集，运行期都不会因语法或类型原因出错。',
    ' * 因此校验器必须**穷尽**所有可能出错的地方 —— 宁可多报，不可漏报。',
    ' */',
    'export function validate(src: string, schema: FieldSchema): Diagnostic[] {',
    '  const out: Diagnostic[] = [];',
    '',
    '  const parsed = parse(src);',
    '  if (!parsed.ok) {',
    '    out.push({ code: "PARSE_ERROR", detail: `${parsed.line}:${parsed.col} ${parsed.message}` });',
    '    return out;   // 语法都没过，语义检查无意义',
    '  }',
    '',
    '  // TODO: 字段路径解析（UNKNOWN_FIELD）、类型检查（TYPE_MISMATCH）、',
    '  //       规则名唯一性（DUPLICATE_RULE）、冲突检测（PRIORITY_CONFLICT）。',
    '  // 这些检查依赖 AST 的具体形状，需要 parser 产出带语义的节点，',
    '  // 而不是当前的通用 AstNode。见 spec.md §7 的「被否决的设计 ③」：',
    '  // 通用 EBNF 回溯解析器能覆盖语法，但语义检查仍需针对本语法的访问器。',
    '  void schema;',
    '  return out;',
    '}',
    '',
    'export function hasFatal(diags: Diagnostic[]): boolean {',
    '  return diags.some((d) => d.code === "PARSE_ERROR" || d.code === "UNEXPECTED_EOF");',
    '}',
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ 用户文档
// ─────────────────────────────────────────────────────────────────────────────
export function emitDocs(
  g: Grammar,
  codes: ErrorCode[],
  artifacts: GeneratedArtifact[],
  example: string,
): string {
  const rows = (items: string[]): string => items.map((x) => '`' + x + '`').join(' · ');

  // 示例来自 spec 的 ```rulesmith 代码块 —— **不是**硬编码。
  // 硬编码的后果是真实的：本文件原先把示例写成带 `when` 的版本，
  // 而当时 EBNF 的 rule 产生式里根本没有 `when` —— 文档与语法互相矛盾。
  const exampleLines = example.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');

  return [
    ...header('<!--'),
    '',
    '# 报表规则 DSL 使用文档',
    '',
    '> 本文件由 `tools/generator` 从 `specs/001-rulesmith-dsl/spec.md` 生成。',
    '> **语法速查与 spec 的 EBNF 块自动一致** —— 因为它们来自同一份输入。',
    '',
    '## 一个规则长什么样',
    '',
    '```',
    ...exampleLines,
    '```',
    '',
    '> 上面这段示例直接从 spec 的 ```rulesmith 块注入，并由测试逐字跑过生成的解析器：',
    '> **规格自带的例子过不了自己的语法，构建就失败。**',
    '',
    '## 关键字（' + g.keywords.length + ' 个）',
    '',
    rows([...g.keywords].sort()),
    '',
    '## 符号（' + g.symbols.length + ' 个）',
    '',
    rows([...g.symbols].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))),
    '',
    '## 语法（' + g.productions.length + ' 条产生式）',
    '',
    '```ebnf',
    ...g.productions.map(renderProduction),
    '```',
    '',
    '## 词法层（' + g.tokenTypes.length + ' 种 token）',
    '',
    '这些产生式全大写，描述的是**扫描器怎么切出一个 token**，不是语法规则。',
    '完整语法里引用 `IDENT` 的意思是「此处放一枚标识符」。',
    '',
    '```ebnf',
    ...g.tokenTypes.map(renderProduction),
    ...CHAR_CLASSES.map((c) => `(* ${c} = 预定义字符类 *)`),
    '```',
    '',
    '## 错误码（' + codes.length + ' 个）',
    '',
    '| 错误码 | 触发条件 | 报告位置 |',
    '|--------|---------|---------|',
    ...codes.map((c) => `| \`${c.code}\` | ${c.trigger} | ${c.location} |`),
    '',
    '## 常见写法对照',
    '',
    '| 你可能想写 | 实际要写 | 原因 |',
    '|-----------|---------|------|',
    '| `region not in [...]` | `region notin [...]` | 运算符是**一个词**，见 spec §7 被否决的设计 ① |',
    '| `priority 5` | 不要写 | 用静态冲突检查替代显式优先级，见 spec §7 被否决的设计 ② |',
    '| `amount > "100"` | `amount > 100` | 数值运算符右侧必须是数字（`TYPE_MISMATCH`） |',
    '',
    '## 本项目生成的产物',
    '',
    '| 产物 | 内容 |',
    '|------|------|',
    ...artifacts.map((a) => `| \`${a.path}\` | ${a.content} |`),
    '',
    '## 修改 DSL 的正确方式',
    '',
    '1. 改 `specs/001-rulesmith-dsl/spec.md` 的 ```ebnf``` 代码块或错误码表',
    '2. 运行 `pnpm generate`',
    '3. 检查 `git diff` —— 本文件与其他三个产物都会自动更新',
    '4. 提交 spec 与全部产物的变更',
    '',
    '⛔ **不要直接编辑生成产物。** CI 会重新生成并校验 `git diff` 为空，手改必然失败。',
    '',
  ].join('\n');
}
