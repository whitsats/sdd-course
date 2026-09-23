/**
 * 校验器的测试 —— 含 spec §3 那条**核心不变量**的属性测试。
 *
 * 核心不变量（spec §3 最后一条）：
 *   > 任何通过本校验的规则集，在运行期都不会因语法或类型原因出错。
 *
 * 这是一个**全称命题**（∀ 规则集）。单元测试只能覆盖有限个例子，
 * 所以这里用**属性测试**：随机生成大量规则集，对每一个断言
 *   validate 通过  ⇒  parse 必不失败
 *
 * ⚠️ 诚实说明：当前 `validator.ts` 的语义检查是 **TODO 状态**
 *    （字段路径 / 类型 / 重复规则 / 冲突检测都未实现）。
 *    因此下面属性测试的强度是**被削弱的** —— 它目前只能验证「语法层无假阴性」。
 *    这个缺口是 L10 特意保留的教学点：**生成器能覆盖语法，覆盖不了语义。**
 *
 * 运行：node --test tests/
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, hasFatal } from '../src/generated/validator.ts';
import { parse } from '../src/generated/parser.ts';
import { tokenize } from '../src/generated/lexer.ts';
import { extractFencedBlock } from '../tools/generator/spec-reader.ts';

const SCHEMA = {
  amount: 'number',
  region: 'string',
  user: { tier: 'string', age: 'number' },
  tags: 'string[]',
};

const VALID_RULE = `rule high_value {
  when amount > 10000 and region in ["APAC", "EMEA"]
  then flag "high_value" escalate to "finance-review"
}`;

// ─────────────────────────────────────────────────────────────────────
// 📌 这是 spec-as-source 里最划算的一条约束：
//    **规格里自带的例子，必须能被这份规格自己生成的解析器接受。**
//
//    它抓住的是一类真实的、静默的错：
//    本项目的使用文档曾经教了一个带 `when` 的写法，而当时 `rule` 产生式里没有 `when` ——
//    文档与语法互相矛盾，双方都“看起来正常”。
//    现在示例只存在于 spec 一处，并被两条测试盯住：
//      ① 生成器测试：文档里的示例必须等于 spec 里的示例（不可能脱节）
//      ② 本测试：示例必须真的能 parse
//    实测有效：本文写好后第一次跑，这里就报错了 —— 因为当时的 rule 产生式确实没有 `when`。
describe('规格自带的示例必须通过自己的语法', () => {
  const specMd = readFileSync(
    new URL('../specs/001-rulesmith-dsl/spec.md', import.meta.url),
    'utf8',
  );
  const example = extractFencedBlock(specMd, 'rulesmith');

  test('spec 里确实有 ```rulesmith 示例块', () => {
    assert.ok(example.trim().length > 0);
  });

  test('示例能被生成的解析器接受', () => {
    const r = parse(example);
    assert.equal(r.ok, true, r.ok ? '' : `示例过不了本规格的语法：${r.message}`);
  });

  test('示例用到的每个关键字都在词法表里（防“文档教了不存在的词”）', () => {
    const toks = tokenize(example);
    const words = toks.filter((t) => t.type === 'ident' || t.type === 'keyword');
    // `when` 必须在关键字表里 —— 它正是当初漏掉的那个。
    assert.ok(
      toks.some((t) => t.type === 'keyword' && t.value === 'when'),
      '示例里的 when 没被识别为关键字 —— 说明 EBNF 漏了它',
    );
    assert.ok(words.length > 0);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('语法层：接受合法输入', () => {
  test('合法规则解析成功', () => {
    assert.equal(parse(VALID_RULE).ok, true);
  });

  test('合法规则不产生 PARSE_ERROR', () => {
    const diags = validate(VALID_RULE, SCHEMA);
    assert.ok(!diags.some((d) => d.code === 'PARSE_ERROR'), JSON.stringify(diags));
  });

  test('空规则集合法（program 允许零条规则）', () => {
    assert.equal(parse('').ok, true);
  });

  test('嵌套字段路径 a.b 合法', () => {
    assert.equal(parse('rule r { when user.age >= 18 then flag "adult" }').ok, true);
  });

  test('or / notin / 列表混合', () => {
    assert.equal(
      parse('rule r { when region notin ["US"] or amount < 10 then flag "x" }').ok,
      true,
    );
  });
});

describe('语法层：拒绝非法输入', () => {
  const bad: Array<[string, string]> = [
    ['规则中途结束', 'rule r { when'],
    ['缺少 then', 'rule r { when amount > 1 flag "x" }'],
    ['缺少右括号', 'rule r { when ( amount > 1 then flag "x" }'],
    ['缺少规则名', 'rule { when amount > 1 then flag "x" }'],
    ['运算符残缺', 'rule r { when amount > then flag "x" }'],
  ];

  for (const [name, src] of bad) {
    test(`拒绝：${name}`, () => {
      const diags = validate(src, SCHEMA);
      assert.ok(diags.some((d) => d.code === 'PARSE_ERROR'), '应报 PARSE_ERROR');
      assert.equal(hasFatal(diags), true, 'PARSE_ERROR 应被标记为致命');
    });
  }
});

describe('词法分析器', () => {
  test('关键字被识别为 keyword 而非 ident', () => {
    const toks = tokenize('rule when then or and in notin');
    const words = toks.filter((t) => t.type !== 'eof');
    assert.ok(words.every((t) => t.type === 'keyword'), JSON.stringify(toks));
    assert.equal(words.length, 7);
  });

  test('标识符不会因为前缀是关键字而被切错', () => {
    // "rules" 以 "rule" 开头 —— 若词法分析器偷懒用 startsWith，这里会错。
    const toks = tokenize('rules');
    assert.equal(toks[0].type, 'ident');
    assert.equal(toks[0].value, 'rules');
  });

  test('多字符运算符不被拆成两个 token', () => {
    const toks = tokenize('>=');
    assert.equal(toks.length, 2, '应为 [>=, EOF]');   // 含 EOF
    assert.equal(toks[0].value, '>=');
  });

  test('token 带行列号', () => {
    const toks = tokenize('rule\n  x');
    assert.equal(toks[0].line, 1);
    assert.equal(toks[1].line, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 📌 属性测试：随机生成规则集，验证核心不变量。
//    它替代不了穷举证明，但能抓到「我以为会失败、其实不会」和反过来的情况。
describe('核心不变量（属性测试）', () => {
  // 固定种子的线性同余伪随机：保证测试**可复现**，不引入外部依赖。
  let seed = 20260923;
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

  const FIELDS = ['amount', 'region', 'user.age', 'user.tier', 'tags', 'nope'];
  const OPS = ['>', '>=', '<', '<=', '=', '!=', 'in', 'notin'];
  const VALUES = ['10000', '"APAC"', '["A","B"]', '[]'];

  const randomRuleSet = (n: number): string => {
    let out = '';
    for (let i = 0; i < n; i++) {
      out += `rule r${i} { when ${pick(FIELDS)} ${pick(OPS)} ${pick(VALUES)} then flag "f${i}" }\n`;
    }
    return out;
  };

  test('校验通过 ⇒ 解析必不失败（语法层无假阴性）', () => {
    let accepted = 0;
    for (let i = 0; i < 500; i++) {
      const src = randomRuleSet(1 + Math.floor(rnd() * 3));
      const diags = validate(src, SCHEMA);
      const acceptedHere = diags.length === 0;
      if (acceptedHere) {
        accepted++;
        assert.equal(parse(src).ok, true, `假阴性！校验通过但解析失败：\n${src}`);
      }
    }
    // 有意义的属性测试必须真的接受了足够样本，否则是空转。
    assert.ok(accepted > 0, '样本全部被拒 —— 测试在空转，不构成证据');
  });

  test('hasFatal 只在语法错误时为真', () => {
    for (let i = 0; i < 200; i++) {
      const src = randomRuleSet(1);
      const diags = validate(src, SCHEMA);
      const hadParseError = diags.some((d) => d.code === 'PARSE_ERROR');
      assert.equal(hasFatal(diags), hadParseError);
    }
  });

  test('校验器对同一输入是确定性的', () => {
    const src = randomRuleSet(3);
    assert.deepEqual(validate(src, SCHEMA), validate(src, SCHEMA));
  });
});

// ─────────────────────────────────────────────────────────────────────
// 📌 这个 describe 块是「已知缺口」的显式记录，不是失败的测试。
//    它存在的意义：**让缺口在测试报告里可见**，而不是藏在代码注释里。
describe('已知缺口（TODO —— 语义层尚未实现）', () => {
  test('未引用 schema 的字段：当前**不会**报 UNKNOWN_FIELD', () => {
    const diags = validate('rule r { when ghost_field > 1 then flag "x" }', SCHEMA);
    assert.deepEqual(
      diags,
      [],
      '若此断言失败，说明语义检查已实现 —— 请把本测试移到上面的正式用例里',
    );
  });

  test('类型不匹配（number 用 in）：当前**不会**报 TYPE_MISMATCH', () => {
    const diags = validate('rule r { when amount in ["x"] then flag "f" }', SCHEMA);
    assert.deepEqual(diags, [], '若此断言失败，说明语义检查已实现 —— 请迁移本测试');
  });

  test('重复规则名：当前**不会**报 DUPLICATE_RULE', () => {
    const dup = 'rule same { when amount > 1 then flag "a" }\nrule same { when amount < 9 then flag "b" }';
    assert.deepEqual(validate(dup, SCHEMA), [], '若此断言失败，请迁移本测试');
  });
});
