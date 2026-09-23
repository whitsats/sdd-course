/**
 * 规格读取器 —— 从 spec.md 中提取生成器需要的三类输入。
 *
 * ⚠️ 本文件是**手写代码**（spec-as-source 的递归边界，见 spec.md §6）。
 *
 * 提取的三类输入：
 *   ① ```ebnf``` 代码块       → 语法（产生式、终结符、关键字）
 *   ② 错误码表（Markdown 表）  → 错误码、触发条件、报告位置
 *   ③ 生成产物表              → 产物清单（用于生成 docs 与自检）
 *
 * ⚠️ **本读取器只认「结构」，不认「措辞」。**
 *    它按 Markdown 表格的**列名**定位，而不是按行号或固定文本。
 *    这样你在 spec 里加说明段落、调整顺序、改措辞，都不会让生成器失效。
 *    但改**列名**会让它失效 —— 这是刻意的：列名是契约，措辞不是。
 */

export type ErrorCode = {
  code: string;
  trigger: string;
  location: string;
};

export type GeneratedArtifact = {
  path: string;
  content: string;
};

export type SpecInput = {
  ebnf: string;
  errorCodes: ErrorCode[];
  artifacts: GeneratedArtifact[];
  /**
   * 一段合法输入，来自 spec 的 ```rulesmith 块。
   *
   * 为什么要从 spec 读，而不是在发射器里写死：
   * 写死的示例会与 EBNF **静默脱节**。本项目真实发生过：文档示例里用了 `when`，
   * 而当时 `rule` 产生式里没有 `when` —— 文档教了一个语法不接受的写法。
   */
  example: string;
};

/** 取出第一个匹配 lang 的围栏代码块内容 */
export function extractFencedBlock(md: string, lang: string): string {
  const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```', 'i');
  const m = md.match(re);
  if (!m) throw new Error(`spec.md 中找不到 \`\`\`${lang} 代码块`);
  return m[1];
}

/**
 * 解析 Markdown 表格，按列名定位。
 *
 * @param md          全文
 * @param findHeaders 需要匹配的表头（按顺序，全部命中才算该表）
 */
export function findTable(md: string, findHeaders: string[]): string[][] {
  const lines = md.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;

    const headers = splitRow(line);
    const matched = findHeaders.every((h) =>
      headers.some((x) => x.replace(/[*`]/g, '').trim() === h),
    );
    if (!matched) continue;

    // 跳过表头下的分隔行（|---|---|）
    let j = i + 1;
    if (j < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[j])) j++;

    const rows: string[][] = [];
    for (; j < lines.length; j++) {
      const row = lines[j];
      if (!row.trim().startsWith('|')) break;
      rows.push(splitRow(row));
    }
    return rows;
  }

  throw new Error(`spec.md 中找不到表头为 [${findHeaders.join(', ')}] 的表格`);
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** 从形如 `` `PARSE_ERROR` `` 的单元格里取出裸错误码 */
function stripCode(cell: string): string {
  return cell.replace(/`/g, '').trim();
}

export function readSpec(md: string): SpecInput {
  const ebnf = extractFencedBlock(md, 'ebnf');
  // 示例是**必需**的：它既进使用文档，也被测试拿去跑生成的解析器。
  // 缺少它时明确报错，而不是让文档里的示例退化成硬编码。
  const example = extractFencedBlock(md, 'rulesmith');

  const errorRows = findTable(md, ['错误码', '触发条件', '报告位置']);
  const errorCodes: ErrorCode[] = errorRows
    .map((r) => ({ code: stripCode(r[0]), trigger: r[1], location: r[2] }))
    .filter((e) => e.code.length > 0);

  if (errorCodes.length === 0) throw new Error('spec.md 的错误码表为空');

  const artifactRows = findTable(md, ['产物', '内容']);
  const artifacts: GeneratedArtifact[] = artifactRows
    .map((r) => ({ path: stripCode(r[0]), content: r[1] }))
    .filter((a) => a.path.length > 0);

  if (artifacts.length === 0) throw new Error('spec.md 的生成产物表为空');

  return { ebnf, example, errorCodes, artifacts };
}
