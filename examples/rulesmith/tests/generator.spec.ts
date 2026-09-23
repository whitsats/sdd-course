/**
 * 生成器自身的测试。
 *
 * ⚠️ 为什么生成器需要测试：`tools/generator/` 是**手写代码**，
 *    它是 spec-as-source 的递归边界（自己不能被生成）。
 *    因此这里的测试是**整条链路上唯一没有上一层保障的部分** —— 它必须自己立住。
 *
 * 运行：node --test tests/*.spec.ts     （Node 内置测试运行器，零依赖）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEbnf, CHAR_CLASSES, TOKEN_SCANNERS } from '../tools/generator/ebnf.ts';
import { readSpec } from '../tools/generator/spec-reader.ts';
import { emitLexer, emitParser, emitValidator, emitDocs } from '../tools/generator/emit.ts';

// ── 测试夹具：一个**刻意独立于本项目 spec** 的小语法 ────────────────────
// 用它测解析器，好处是：改本项目的 spec 不会连带改坏这里的期望值。
const FIXTURE = `
program = { rule } ;
rule    = "rule" IDENT "{" cond "then" "flag" STRING "}" ;
cond    = cmp { "or" cmp } ;
cmp     = IDENT op val ;
op      = ">" | ">=" | "in" ;
val     = NUMBER | STRING ;
IDENT   = letter { letter | digit | "_" } ;
NUMBER  = digit { digit } ;
STRING  = '"' { any_char } '"' ;
`;

const readSpecFile = (): string =>
  readFileSync(new URL('../specs/001-rulesmith-dsl/spec.md', import.meta.url), 'utf8');

const lf = (s: string): string => s.replace(/\r\n/g, '\n');

const readGenerated = (rel: string): string =>
  lf(readFileSync(new URL('../' + rel, import.meta.url), 'utf8'));

// ─────────────────────────────────────────────────────────────────────
describe('EBNF 解析器：分层', () => {
  test('全大写名字进 tokenTypes，其余进 productions', () => {
    const g = parseEbnf(FIXTURE);
    assert.deepEqual(
      g.productions.map((p) => p.name),
      ['program', 'rule', 'cond', 'cmp', 'op', 'val'],
    );
    assert.deepEqual(g.tokenTypes.map((p) => p.name), ['IDENT', 'NUMBER', 'STRING']);
  });

  test('起始产生式是第一条**语法层**产生式', () => {
    assert.equal(parseEbnf(FIXTURE).start, 'program');
  });

  test('本项目 spec 的分层正确', () => {
    const g = parseEbnf(readSpec(readSpecFile()).ebnf);
    assert.equal(g.productions.length, 11);
    assert.deepEqual(g.tokenTypes.map((p) => p.name), ['IDENT', 'NUMBER', 'STRING']);
    assert.equal(g.start, 'program');
    // 词法层名字绝不能出现在语法层
    for (const t of g.tokenTypes) {
      assert.ok(!g.productions.some((p) => p.name === t.name), `${t.name} 同时出现在两层`);
    }
  });

  test('关键字集合 = 字母开头的终结符（两层都算）', () => {
    const g = parseEbnf(FIXTURE);
    assert.deepEqual([...g.keywords].sort(), ['flag', 'in', 'or', 'rule', 'then'].sort());
  });

  test('符号集合 = 非字母开头的终结符', () => {
    const g = parseEbnf(FIXTURE);
    for (const s of ['>', '>=', '{', '}']) assert.ok(g.symbols.includes(s), `应包含 ${s}`);
  });

  test('非终结符（letter/digit/any_char）不进入关键字或符号表', () => {
    const g = parseEbnf(FIXTURE);
    for (const nt of ['letter', 'digit', 'any_char']) {
      assert.ok(!g.keywords.includes(nt), `${nt} 不应是关键字`);
      assert.ok(!g.symbols.includes(nt), `${nt} 不应是符号`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 📌 这一组测试固化一次**真实事故**，也是 L10 最值钱的一段经验。
//
//    事故：生成器把 `IDENT` 当成语法产生式发射，而它的右部引用了字符类 `letter`。
//    `letter` 不是产生式 → 生成的 parser 在**运行期**抛 `未定义的产生式: letter`。
//    生成器当时**成功退出**，产物看起来一切正常。
//
//    结论：spec-as-source 的危险不在于「生成器报错」，而在于
//    **生成器不报错、但产出会在运行期炸**。所以这类输入必须在**构建期**被拒绝。
describe('构建期校验：让运行期才炸的东西根本生不出来', () => {
  test('引用未定义的非终结符 → 构建期报错', () => {
    assert.throws(() => parseEbnf('a = b ;'), /引用了未定义的非终结符 `b`/);
  });

  test('语法层引用字符类 → 构建期报错（就是那场事故）', () => {
    assert.throws(() => parseEbnf('a = letter ;'), /引用了字符类 `letter`/);
  });

  test('词法层引用非字符类 → 构建期报错', () => {
    assert.throws(
      () => parseEbnf('a = "x" ;\nIDENT = other ;'),
      /词法层只允许引用预定义字符类/,
    );
  });

  test('token 类型没有对应扫描器 → 构建期报错', () => {
    assert.throws(
      () => parseEbnf('a = "x" ;\nBOOL = letter { letter } ;'),
      /需要扫描器种类 "bool"/,
    );
  });

  test('只有词法层产生式 → 构建期报错（无法确定起始符号）', () => {
    assert.throws(() => parseEbnf('IDENT = letter ;'), /没有语法层产生式/);
  });

  test('报错信息里列出可用名字，便于修复', () => {
    assert.throws(() => parseEbnf('a = "x" ;\nIDENT = letter ;\nb = c ;'), /已定义的语法层产生式/);
  });

  test('预定义字符类是固定清单（防止有人偷偷加一个字符类）', () => {
    assert.deepEqual(CHAR_CLASSES, ['letter', 'digit', 'any_char', 'ws']);
  });

  test('扫描器能力是固定清单（规格不能凭空要求）', () => {
    assert.deepEqual(TOKEN_SCANNERS, ['ident', 'number', 'string']);
  });

  test('合法的分层写法应当通过', () => {
    assert.doesNotThrow(() => parseEbnf('a = "x" IDENT ;\nIDENT = letter { letter | digit } ;'));
  });
});

// ─────────────────────────────────────────────────────────────────────
// 📌 回归测试：固化另一个**真实发生过的 bug**。
//    第一版把 `"_"` 放进了关键字表 —— 因为 `_` 匹配「标识符字符」类。
//    但它其实是**字符级**终结符（扫描器的输入字符），不是 token。
//    这个 bug 是「跑生成器看输出」时发现的，不是读代码发现的。
describe('回归：终结符分类', () => {
  test('字符级终结符 "_" 不进关键字表，也不进符号表', () => {
    const g = parseEbnf(FIXTURE);
    assert.ok(!g.keywords.includes('_'), '"_" 被误判为关键字（回归！）');
    assert.ok(!g.symbols.includes('_'), '"_" 被误判为符号（回归！）');
  });

  test('字符串定界符 \'"\' 不进符号表', () => {
    const g = parseEbnf(FIXTURE);
    assert.ok(!g.symbols.includes('"'), '字符串定界符被当成语法符号（回归！）');
  });

  test('本项目 spec 同样干净', () => {
    const g = parseEbnf(readSpec(readSpecFile()).ebnf);
    assert.ok(!g.keywords.includes('_'));
    assert.ok(!g.symbols.includes('_'));
    assert.ok(!g.symbols.includes('"'));
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('spec 读取器', () => {
  test('能从真实 spec 读出 EBNF / 示例 / 错误码 / 产物表', () => {
    const spec = readSpec(readSpecFile());
    assert.ok(spec.ebnf.includes('program'), 'EBNF 块应被取出');
    assert.ok(spec.example.includes('rule high_value'), '示例块应被取出');
    assert.ok(spec.errorCodes.length >= 6, '错误码应 ≥ 6 条');
    assert.ok(spec.errorCodes.some((c) => c.code === 'PARSE_ERROR'));
    assert.ok(spec.artifacts.length >= 4, '产物表应 ≥ 4 行');
  });

  test('错误码单元格里的反引号被剥掉，取出裸错误码', () => {
    const spec = readSpec(readSpecFile());
    assert.ok(!spec.errorCodes.some((c) => c.code.includes('`')));
  });

  // 📌 列名是契约，措辞不是 —— 这条测试固定这个边界。
  test('列名被改动 → 报错（列名是契约，不能悄悄变）', () => {
    const broken = readSpecFile().replace(
      '| 错误码 | 触发条件 | 报告位置 |',
      '| Code | Trigger | Where |',
    );
    assert.throws(() => readSpec(broken), /找不到表头/);
  });

  test('表格里的措辞被改动 → 不影响（措辞不是契约）', () => {
    const reworded = readSpecFile().replace(
      '| 不符合 §2 的语法 | 行号 + 列号 |',
      '| 不符合 §2 定义的语法 | 行号与列号 |',
    );
    assert.doesNotThrow(() => readSpec(reworded));
  });

  test('缺少 ```rulesmith 示例块 → 明确报错（示例是契约的一部分）', () => {
    const noExample = readSpecFile().replace('```rulesmith', '```text');
    assert.throws(() => readSpec(noExample), /找不到 ```rulesmith/);
  });

  test('缺少 ```ebnf 代码块 → 明确报错', () => {
    assert.throws(() => readSpec('# 没有代码块'), /找不到 ```ebnf/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 📌 幂等性是四条硬约束（spec §6 第 4 条）中最容易违反的一条，
//    而它一旦失败，CI 的 `git diff` 校验就会随机变红 → 门禁会被关掉。
describe('幂等性与确定性', () => {
  const spec = readSpec(readSpecFile());
  const g = parseEbnf(spec.ebnf);

  const emitters: Array<[string, () => string]> = [
    ['lexer.ts', () => emitLexer(g)],
    ['parser.ts', () => emitParser(g)],
    ['validator.ts', () => emitValidator(g, spec.errorCodes)],
    ['rules-dsl.md', () => emitDocs(g, spec.errorCodes, spec.artifacts, spec.example)],
  ];

  for (const [name, emit] of emitters) {
    test(`${name}：连续发射两次字节级相同`, () => {
      assert.equal(emit(), emit());
    });

    test(`${name}：不含日期/时刻/时间 API`, () => {
      const out = emit();
      assert.doesNotMatch(out, /\b20\d\d[-/]\d\d[-/]\d\d\b/, '含日期，破坏幂等性');
      assert.doesNotMatch(out, /\b\d\d:\d\d:\d\d\b/, '含时刻，破坏幂等性');
      assert.doesNotMatch(out, /new Date\(\)|Date\.now\(\)/, '含时间 API，破坏幂等性');
    });

    test(`${name}：不含生成耗时`, () => {
      assert.doesNotMatch(emit(), /耗时|\b\d+\s*ms\b/i);
    });
  }

  test('输出一律使用 LF（CRLF 会在 Windows 上造成假差异）', () => {
    for (const [, emit] of emitters) {
      assert.doesNotMatch(emit(), /\r\n/);
    }
  });

  test('可执行产物带 DO NOT EDIT 头部', () => {
    for (const name of ['lexer.ts', 'parser.ts', 'validator.ts'] as const) {
      const out =
        name === 'lexer.ts'
          ? emitLexer(g)
          : name === 'parser.ts'
            ? emitParser(g)
            : emitValidator(g, spec.errorCodes);
      assert.match(out, /DO NOT EDIT/, `${name} 缺少 DO NOT EDIT 头部`);
    }
  });

  test('词法分析器产物里带 TOKEN_KINDS（分层被真正传导到产物）', () => {
    assert.match(emitLexer(g), /export const TOKEN_KINDS = \{/);
  });

  test('语法分析器产物里**不含**词法层产生式（就是那场事故的防线）', () => {
    const out = emitParser(g);
    assert.doesNotMatch(out, /"IDENT":/, 'PRODUCTIONS 里出现了 IDENT —— 分层没生效');
    assert.doesNotMatch(out, /letter/, '产物里出现了字符类 letter');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 📌 这段就是 spec §6 第 3 条「CI SHALL 重新生成并校验 git diff 为空」的单元版本。
//    它是一个**真门禁**：改了 spec 忘了 `pnpm generate` → 此测试失败。
describe('产物与规格一致（禁止手改）', () => {
  const spec = readSpec(readSpecFile());
  const g = parseEbnf(spec.ebnf);

  const pairs: Array<[string, () => string]> = [
    ['src/generated/lexer.ts', () => emitLexer(g)],
    ['src/generated/parser.ts', () => emitParser(g)],
    ['src/generated/validator.ts', () => emitValidator(g, spec.errorCodes)],
    ['docs/rules-dsl.md', () => emitDocs(g, spec.errorCodes, spec.artifacts, spec.example)],
  ];

  for (const [path, emit] of pairs) {
    test(`${path} 与当前 spec 一致`, () => {
      assert.equal(
        readGenerated(path),
        emit(),
        `${path} 已过期或被手改。修复：pnpm generate 并提交结果。`,
      );
    });
  }
});
