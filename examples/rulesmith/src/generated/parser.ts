// ⚠️ DO NOT EDIT —— 此文件由 tools/generator 生成，请勿手动编辑。
// 修改行为请改 specs/001-rulesmith-dsl/spec.md，然后运行 `pnpm generate`。
// （本文件刻意不含生成时间戳：产物必须可复现，否则 CI 的 git diff 校验会随机失败。）

import { tokenize, TOKEN_KINDS, type Token } from "./lexer.ts";

export type AstNode =
  | { k: "seq"; items: AstNode[] }
  | { k: "alt"; items: AstNode[] }
  | { k: "rep"; item: AstNode }
  | { k: "opt"; item: AstNode }
  | { k: "term"; value: string }
  | { k: "ref"; name: string };

/** 产生式表 —— 直接来自 spec.md 的 ```ebnf 块 */
export const PRODUCTIONS: Record<string, AstNode> = {
  "action": {
    "items": [
      {
        "k": "term",
        "value": "flag"
      },
      {
        "k": "ref",
        "name": "STRING"
      },
      {
        "item": {
          "items": [
            {
              "k": "term",
              "value": "escalate"
            },
            {
              "k": "term",
              "value": "to"
            },
            {
              "k": "ref",
              "name": "STRING"
            }
          ],
          "k": "seq"
        },
        "k": "opt"
      }
    ],
    "k": "seq"
  },
  "and_expr": {
    "items": [
      {
        "k": "ref",
        "name": "comparison"
      },
      {
        "item": {
          "items": [
            {
              "k": "term",
              "value": "and"
            },
            {
              "k": "ref",
              "name": "comparison"
            }
          ],
          "k": "seq"
        },
        "k": "rep"
      }
    ],
    "k": "seq"
  },
  "comparison": {
    "items": [
      {
        "items": [
          {
            "k": "ref",
            "name": "field"
          },
          {
            "k": "ref",
            "name": "operator"
          },
          {
            "k": "ref",
            "name": "value"
          }
        ],
        "k": "seq"
      },
      {
        "items": [
          {
            "k": "term",
            "value": "("
          },
          {
            "k": "ref",
            "name": "or_expr"
          },
          {
            "k": "term",
            "value": ")"
          }
        ],
        "k": "seq"
      }
    ],
    "k": "alt"
  },
  "condition": {
    "k": "ref",
    "name": "or_expr"
  },
  "field": {
    "items": [
      {
        "k": "ref",
        "name": "IDENT"
      },
      {
        "item": {
          "items": [
            {
              "k": "term",
              "value": "."
            },
            {
              "k": "ref",
              "name": "IDENT"
            }
          ],
          "k": "seq"
        },
        "k": "rep"
      }
    ],
    "k": "seq"
  },
  "list": {
    "items": [
      {
        "k": "term",
        "value": "["
      },
      {
        "item": {
          "items": [
            {
              "k": "ref",
              "name": "value"
            },
            {
              "item": {
                "items": [
                  {
                    "k": "term",
                    "value": ","
                  },
                  {
                    "k": "ref",
                    "name": "value"
                  }
                ],
                "k": "seq"
              },
              "k": "rep"
            }
          ],
          "k": "seq"
        },
        "k": "opt"
      },
      {
        "k": "term",
        "value": "]"
      }
    ],
    "k": "seq"
  },
  "operator": {
    "items": [
      {
        "k": "term",
        "value": ">"
      },
      {
        "k": "term",
        "value": ">="
      },
      {
        "k": "term",
        "value": "<"
      },
      {
        "k": "term",
        "value": "<="
      },
      {
        "k": "term",
        "value": "="
      },
      {
        "k": "term",
        "value": "!="
      },
      {
        "k": "term",
        "value": "in"
      },
      {
        "k": "term",
        "value": "notin"
      }
    ],
    "k": "alt"
  },
  "or_expr": {
    "items": [
      {
        "k": "ref",
        "name": "and_expr"
      },
      {
        "item": {
          "items": [
            {
              "k": "term",
              "value": "or"
            },
            {
              "k": "ref",
              "name": "and_expr"
            }
          ],
          "k": "seq"
        },
        "k": "rep"
      }
    ],
    "k": "seq"
  },
  "program": {
    "item": {
      "k": "ref",
      "name": "rule"
    },
    "k": "rep"
  },
  "rule": {
    "items": [
      {
        "k": "term",
        "value": "rule"
      },
      {
        "k": "ref",
        "name": "IDENT"
      },
      {
        "k": "term",
        "value": "{"
      },
      {
        "k": "term",
        "value": "when"
      },
      {
        "k": "ref",
        "name": "condition"
      },
      {
        "k": "term",
        "value": "then"
      },
      {
        "k": "ref",
        "name": "action"
      },
      {
        "k": "term",
        "value": "}"
      }
    ],
    "k": "seq"
  },
  "value": {
    "items": [
      {
        "k": "ref",
        "name": "NUMBER"
      },
      {
        "k": "ref",
        "name": "STRING"
      },
      {
        "k": "ref",
        "name": "list"
      }
    ],
    "k": "alt"
  }
};

export const START = "program";

export type ParseOk  = { ok: true;  node: AstNode; pos: number };
export type ParseErr = { ok: false; pos: number; expected: string[] };

type Result = ParseOk | ParseErr;

/**
 * 表驱动回溯解析器。
 * 它不认识任何具体语法 —— 语法全部来自 PRODUCTIONS 表。
 * 因此改 spec.md 的 EBNF → 重新生成 → 解析器行为自动变化。
 */
function match(node: AstNode, toks: Token[], pos: number): Result {
  switch (node.k) {
    case "term": {
      const t = toks[pos];
      if (t && t.value === node.value) return { ok: true, node, pos: pos + 1 };
      return { ok: false, pos, expected: [node.value] };
    }

    case "ref": {
      // ① 引用的是一个 **token 类型**（全大写产生式）
      //    → 期望此处有一枚对应种类的 token，就地消费一枚。
      const kind = (TOKEN_KINDS as Record<string, string | undefined>)[node.name];
      if (kind !== undefined) {
        const t = toks[pos];
        if (t && t.type === kind) return { ok: true, node, pos: pos + 1 };
        return { ok: false, pos, expected: [node.name] };
      }

      // ② 引用的是一个普通产生式 → 递归
      const sub = PRODUCTIONS[node.name];
      if (!sub) throw new Error(`未定义的产生式: ${node.name}`);
      return match(sub, toks, pos);
    }

    case "seq": {
      const items: AstNode[] = [];
      let p = pos;
      for (const item of node.items) {
        const r = match(item, toks, p);
        if (!r.ok) return { ok: false, pos: r.pos, expected: r.expected };
        items.push(r.node);
        p = r.pos;
      }
      return { ok: true, node: { k: "seq", items }, pos: p };
    }

    case "alt": {
      const expected: string[] = [];
      let furthest = pos;
      for (const item of node.items) {
        const r = match(item, toks, pos);
        if (r.ok) return r;
        if (r.pos > furthest) furthest = r.pos;
        expected.push(...r.expected);
      }
      return { ok: false, pos: furthest, expected };
    }

    case "rep": {
      const items: AstNode[] = [];
      let p = pos;
      for (;;) {
        const r = match(node.item, toks, p);
        if (!r.ok) break;
        if (r.pos === p) break;   // 防左递归导致的死循环
        items.push(r.node);
        p = r.pos;
      }
      return { ok: true, node: { k: "rep", item: node.item }, pos: p };
    }

    case "opt": {
      const r = match(node.item, toks, pos);
      if (r.ok) return r;
      return { ok: true, node: { k: "opt", item: node.item }, pos };
    }
  }
}

export type ParseFailure = { ok: false; message: string; line: number; col: number };

export function parse(src: string): { ok: true; pos: number } | ParseFailure {
  const toks = tokenize(src);
  const r = match(PRODUCTIONS[START], toks, 0);

  if (!r.ok) {
    const t = toks[r.pos] ?? toks[toks.length - 1];
    return {
      ok: false,
      message: `语法错误：期望 ${[...new Set(r.expected)].join(" 或 ")}，实际 ${JSON.stringify(t.value) || "输入结束"}`,
      line: t.line, col: t.col,
    };
  }

  if (r.pos !== toks.length - 1) {
    const t = toks[r.pos];
    return { ok: false, message: `语法错误：多余的 ${JSON.stringify(t.value)}`, line: t.line, col: t.col };
  }

  return { ok: true, pos: r.pos };
}
