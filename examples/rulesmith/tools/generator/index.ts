/**
 * rulesmith 生成器 CLI
 *
 * 用法：
 *   node tools/generator/index.ts                 # 使用默认路径
 *   node tools/generator/index.ts --check         # 只校验产物是否最新，不写盘（CI 用）
 *   node tools/generator/index.ts --spec <path>   # 指定 spec 路径
 *
 * ⚠️ 本文件是**手写代码**（spec-as-source 的递归边界，见 spec.md §6）。
 *
 * 为什么用 `.ts` 而不是先编译到 `.js`：
 *   Node ≥ 22.6 支持直接运行「可擦除类型」的 TypeScript（`--experimental-strip-types`，
 *   Node ≥ 23 默认开启）。本仓库的 Node 版本满足要求，因此**无需构建步骤**。
 *   要求：不使用 enum / namespace / 参数属性等不可擦除语法。
 *
 * ⛔ 幂等性铁律：不得输出时间戳、路径分隔符、环境相关内容。
 *    本文件刻意不打印生成耗时，只打印文件与行数。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join, sep } from 'node:path';
import { parseEbnf } from './ebnf.ts';
import { readSpec } from './spec-reader.ts';
import { emitLexer, emitParser, emitValidator, emitDocs } from './emit.ts';

const DEFAULT_SPEC = 'specs/001-rulesmith-dsl/spec.md';

type Emitted = { path: string; content: string };

function main(): void {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const specIdx = argv.indexOf('--spec');
  const specPath = specIdx >= 0 ? (argv[specIdx + 1] ?? DEFAULT_SPEC) : DEFAULT_SPEC;

  if (!existsSync(specPath)) {
    fail(`找不到规格文件：${specPath}\n请在项目根目录运行，或用 --spec 指定路径。`);
  }

  const md = readFileSync(specPath, 'utf8');

  // ── ① 读取规格的三类输入 ──────────────────────────────────────────
  let spec;
  try {
    spec = readSpec(md);
  } catch (e) {
    fail(`读取规格失败：${(e as Error).message}`);
  }

  // ── ② 解析 EBNF ─────────────────────────────────────────────────
  let grammar;
  try {
    grammar = parseEbnf(spec.ebnf);
  } catch (e) {
    fail(`解析 EBNF 失败：${(e as Error).message}\n请检查 ${specPath} 的 \`\`\`ebnf 代码块。`);
  }

  // ── ③ 一致性自检（规格内部的矛盾在这一步暴露）────────────────────
  const problems: string[] = [];

  const declaredPaths = new Set(spec.artifacts.map((a) => a.path));

  // 语法里出现的状态/运算符应当都能在错误码表里找到对应的失败模式
  const hasUnknownOperator = spec.errorCodes.some((c) => c.code === 'UNKNOWN_OPERATOR');
  if (!hasUnknownOperator) {
    problems.push('错误码表缺少 UNKNOWN_OPERATOR，但 operator 产生式存在枚举 —— 建议补上');
  }

  // 生成产物表必须覆盖我们实际要发射的四类
  for (const required of ['lexer.ts', 'parser.ts', 'validator.ts', 'rules-dsl.md']) {
    if (![...declaredPaths].some((p) => p.endsWith(required))) {
      problems.push(`生成产物表未声明 ${required} —— 但发射器会产出它。请同步 spec.md §6`);
    }
  }

  // 分层是否存在：没有词法层 → 说明 spec 把字符类当成了产生式，或漏了 token 定义
  if (grammar.tokenTypes.length === 0) {
    problems.push(
      'EBNF 里没有任何词法层（全大写）产生式 —— 扫描器将只能识别关键字与符号。请同步 spec.md §2',
    );
  }

  // 示例的存在性（缺了它，使用文档的示例会退化成硬编码）
  if (!spec.example.trim()) {
    problems.push('spec.md 的 ```rulesmith 示例块为空 —— 使用文档会没有示例。');
  }

  // ── ④ 发射 ──────────────────────────────────────────────────────
  const emitted: Emitted[] = [
    { path: 'src/generated/lexer.ts',      content: emitLexer(grammar) },
    { path: 'src/generated/parser.ts',     content: emitParser(grammar) },
    { path: 'src/generated/validator.ts',  content: emitValidator(grammar, spec.errorCodes) },
    { path: 'docs/rules-dsl.md',           content: emitDocs(grammar, spec.errorCodes, spec.artifacts, spec.example) },
  ];

  // ── ⑤ 写盘或校验 ────────────────────────────────────────────────
  const drift: string[] = [];
  const written: string[] = [];

  for (const f of emitted) {
    const target = resolve(f.path);
    const next = f.content.replace(/\r\n/g, '\n');   // 强制 LF，避免 Windows 下 CRLF 造成假差异

    if (checkOnly) {
      if (!existsSync(target)) { drift.push(`${f.path}（缺失）`); continue; }
      const cur = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
      if (cur !== next) drift.push(f.path);
      continue;
    }

    mkdirSync(dirname(target), { recursive: true });
    const prev = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
    if (prev === next) continue;                      // 内容未变 → 不写盘，保持 mtime
    writeFileSync(target, next, 'utf8');
    written.push(f.path);
  }

  // ── ⑥ 摘要 ──────────────────────────────────────────────────────
  const p = (s: string): string => s.split(sep).join('/');

  console.log(`规格: ${p(specPath)}`);
  console.log(`产生式: ${grammar.productions.length}   词法 token 类型: ${grammar.tokenTypes.length}   关键字: ${grammar.keywords.length}   符号: ${grammar.symbols.length}   错误码: ${spec.errorCodes.length}`);
  console.log(`起始产生式: ${grammar.start}`);
  console.log('');

  for (const f of emitted) {
    const lines = f.content.split('\n').length;
    const mark = checkOnly
      ? (drift.includes(f.path) ? '✗ 需重新生成' : '✓ 一致')
      : (written.includes(f.path) ? '✎ 已更新' : '· 未变');
    console.log(`  ${mark}  ${f.path}  (${lines} 行)`);
  }

  if (problems.length > 0) {
    console.log('');
    console.log('⚠️ 规格内部一致性问题：');
    for (const x of problems) console.log(`   - ${x}`);
  }

  if (checkOnly) {
    if (drift.length > 0) {
      console.log('');
      fail(
        `生成产物与规格不一致（${drift.length} 个文件）。\n` +
        `  两种情况：① 有人手改了生成物 ② 改了 spec 但忘了重新生成\n` +
        `  修复：运行 \`pnpm generate\` 并提交结果`,
      );
    }
    console.log('');
    console.log('✅ 生成产物与规格一致');
    return;
  }

  if (written.length === 0) {
    console.log('');
    console.log('✅ 无变更（幂等）');
  }
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main();
