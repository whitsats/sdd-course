// ⚠️ DO NOT EDIT —— 此文件由 tools/generator 生成，请勿手动编辑。
// 修改行为请改 specs/001-rulesmith-dsl/spec.md，然后运行 `pnpm generate`。
// （本文件刻意不含生成时间戳：产物必须可复现，否则 CI 的 git diff 校验会随机失败。）

export const KEYWORDS = [
  "and",
  "escalate",
  "flag",
  "in",
  "notin",
  "or",
  "rule",
  "then",
  "to",
  "when"
] as const;

/** 符号按长度降序，保证最大匹配：>= 需先于 > 尝试 */
export const SYMBOLS = [
  "!=",
  "<=",
  ">=",
  "(",
  ")",
  ",",
  ".",
  "<",
  "=",
  ">",
  "[",
  "]",
  "{",
  "}"
] as const;

/**
 * token 类型 ← spec.md 中**全大写名字**的产生式（IDENT / NUMBER / STRING …）。
 * 它们不进语法产生式表：它们描述的是「扫描器怎么切出一个 token」，不是语法规则。
 * 语法里引用 IDENT 的意思是「此处放一枚 kind 为 "ident" 的 token」。
 */
export const TOKEN_KINDS = {
  "IDENT": "ident",
  "NUMBER": "number",
  "STRING": "string"
} as const;

export type TokenKind = (typeof TOKEN_KINDS)[keyof typeof TOKEN_KINDS];

const KEYWORD_SET = new Set<string>(KEYWORDS);

export type TokenType = "keyword" | "symbol" | "ident" | "number" | "string" | "eof";

export type Token = { type: TokenType; value: string; line: number; col: number };

export class LexError extends Error {
  line: number; col: number;
  constructor(message: string, line: number, col: number) {
    super(message);
    this.name = "PARSE_ERROR";
    this.line = line;
    this.col = col;
  }
}

/** 扫描整个输入，返回 token 流（末尾必有 eof） */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") { line++; col = 1; } else { col++; }
      i++;
    }
  };

  while (i < src.length) {
    const c = src[i];

    if (c === " " || c === "\t" || c === "\r" || c === "\n") { advance(); continue; }

    // 行注释：// 到行尾
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") advance();
      continue;
    }

    // 字符串字面量
    if (c === '"') {
      const startLine = line, startCol = col;
      let v = "";
      advance();
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) { v += src[i + 1]; advance(2); continue; }
        v += src[i]; advance();
      }
      if (i >= src.length) throw new LexError("字符串未闭合", startLine, startCol);
      advance();
      out.push({ type: "string", value: v, line: startLine, col: startCol });
      continue;
    }

    // 数字
    if (c >= "0" && c <= "9") {
      const startLine = line, startCol = col;
      let v = "";
      while (i < src.length && src[i] >= "0" && src[i] <= "9") { v += src[i]; advance(); }
      if (src[i] === ".") {
        v += "."; advance();
        while (i < src.length && src[i] >= "0" && src[i] <= "9") { v += src[i]; advance(); }
      }
      out.push({ type: "number", value: v, line: startLine, col: startCol });
      continue;
    }

    // 标识符 / 关键字
    if (/[A-Za-z_]/.test(c)) {
      const startLine = line, startCol = col;
      let v = "";
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) { v += src[i]; advance(); }
      out.push({
        type: KEYWORD_SET.has(v) ? "keyword" : "ident",
        value: v, line: startLine, col: startCol,
      });
      continue;
    }

    // 符号（最大匹配）
    const hit = SYMBOLS.find((s) => src.startsWith(s, i));
    if (hit) {
      out.push({ type: "symbol", value: hit, line, col });
      advance(hit.length);
      continue;
    }

    throw new LexError(`无法识别的字符 ${JSON.stringify(c)}`, line, col);
  }

  out.push({ type: "eof", value: "", line, col });
  return out;
}
