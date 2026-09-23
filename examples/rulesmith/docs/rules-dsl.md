<!-- ⚠️ DO NOT EDIT —— 此文件由 tools/generator 生成，请勿手动编辑。 -->
<!-- 修改行为请改 specs/001-rulesmith-dsl/spec.md，然后运行 `pnpm generate`。 -->
<!-- （本文件刻意不含生成时间戳：产物必须可复现。） -->

# 报表规则 DSL 使用文档

> 本文件由 `tools/generator` 从 `specs/001-rulesmith-dsl/spec.md` 生成。
> **语法速查与 spec 的 EBNF 块自动一致** —— 因为它们来自同一份输入。

## 一个规则长什么样

```
rule high_value {
  when amount > 10000 and region in ["APAC", "EMEA"]
  then flag "high_value" escalate to "finance-review"
}
```

> 上面这段示例直接从 spec 的 ```rulesmith 块注入，并由测试逐字跑过生成的解析器：
> **规格自带的例子过不了自己的语法，构建就失败。**

## 关键字（10 个）

`and` · `escalate` · `flag` · `in` · `notin` · `or` · `rule` · `then` · `to` · `when`

## 符号（14 个）

`!=` · `(` · `)` · `,` · `.` · `<` · `<=` · `=` · `>` · `>=` · `[` · `]` · `{` · `}`

## 语法（11 条产生式）

```ebnf
program = { rule } ;
rule = "rule" IDENT "{" "when" condition "then" action "}" ;
condition = or_expr ;
or_expr = and_expr { "or" and_expr } ;
and_expr = comparison { "and" comparison } ;
comparison = field operator value | "(" or_expr ")" ;
field = IDENT { "." IDENT } ;
operator = ">" | ">=" | "<" | "<=" | "=" | "!=" | "in" | "notin" ;
value = NUMBER | STRING | list ;
list = "[" [ value { "," value } ] "]" ;
action = "flag" STRING [ "escalate" "to" STRING ] ;
```

## 词法层（3 种 token）

这些产生式全大写，描述的是**扫描器怎么切出一个 token**，不是语法规则。
完整语法里引用 `IDENT` 的意思是「此处放一枚标识符」。

```ebnf
IDENT = letter { letter | digit | "_" } ;
NUMBER = digit { digit } [ "." digit { digit } ] ;
STRING = "\"" { any_char } "\"" ;
(* letter = 预定义字符类 *)
(* digit = 预定义字符类 *)
(* any_char = 预定义字符类 *)
(* ws = 预定义字符类 *)
```

## 错误码（8 个）

| 错误码 | 触发条件 | 报告位置 |
|--------|---------|---------|
| `PARSE_ERROR` | 不符合 §2 的语法 | 行号 + 列号 |
| `UNEXPECTED_EOF` | 输入在规则中途结束 | 行号 |
| `UNKNOWN_FIELD` | 字段路径不在输入 schema 中 | 规则名 + 字段路径 |
| `TYPE_MISMATCH` | 运算符与值类型不匹配 | 规则名 + 运算符 + 实际类型 |
| `PRIORITY_CONFLICT` | 两条 escalate 目标不同的规则可能同时命中 | 两个规则名 |
| `DUPLICATE_RULE` | 两个规则用了相同名称 | 规则名 + 两处行号 |
| `UNKNOWN_OPERATOR` | 运算符不在 §2 定义的集合内 | 行号 |
| `UNDEFINED_RULE_REF` | 保留：`action` 引用了不存在的规则 | 规则名 |

## 常见写法对照

| 你可能想写 | 实际要写 | 原因 |
|-----------|---------|------|
| `region not in [...]` | `region notin [...]` | 运算符是**一个词**，见 spec §7 被否决的设计 ① |
| `priority 5` | 不要写 | 用静态冲突检查替代显式优先级，见 spec §7 被否决的设计 ② |
| `amount > "100"` | `amount > 100` | 数值运算符右侧必须是数字（`TYPE_MISMATCH`） |

## 本项目生成的产物

| 产物 | 内容 |
|------|------|
| `src/generated/lexer.ts` | 词法分析器：关键字表 + token 扫描 |
| `src/generated/parser.ts` | 语法分析器：产生式表 + 表驱动回溯，语法全部来自 §2 |
| `src/generated/validator.ts` | 语义校验器：§3 全部规则 + §4 全部错误码 |
| `docs/rules-dsl.md` | 面向业务方的 DSL 使用文档（含从 §2 自动生成的语法速查） |

## 修改 DSL 的正确方式

1. 改 `specs/001-rulesmith-dsl/spec.md` 的 ```ebnf``` 代码块或错误码表
2. 运行 `pnpm generate`
3. 检查 `git diff` —— 本文件与其他三个产物都会自动更新
4. 提交 spec 与全部产物的变更

⛔ **不要直接编辑生成产物。** CI 会重新生成并校验 `git diff` 为空，手改必然失败。
