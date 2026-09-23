/**
 * EBNF 解析器 —— 把 spec.md 中的 ```ebnf``` 块解析为产生式 AST。
 *
 * ⚠️ 本文件是**手写代码**，属于 spec-as-source 的递归边界。
 *    它不会（也不能）由规格生成 —— 总得有一层是人写的。
 *    见 spec.md §6「生成器自身的约束」。
 *
 * 支持的 EBNF 子集（够本项目用，且严格 LL(1)）：
 *   产生式    name = rhs ;
 *   序列      由空白分隔
 *   选择      a | b | c
 *   重复      { x }
 *   可选      [ x ]
 *   分组      ( x )
 *   终结符    "..."  或  '...'
 *   非终结符  标识符
 */

export type Node =
  | { k: 'seq'; items: Node[] }
  | { k: 'alt'; items: Node[] }
  | { k: 'rep'; item: Node }
  | { k: 'opt'; item: Node }
  | { k: 'term'; value: string }
  | { k: 'ref'; name: string };

export type Production = { name: string; rhs: Node };

export type Grammar = {
  /** 语法层产生式（全小写名字）—— 进解析器的 PRODUCTIONS 表 */
  productions: Production[];
  /** 词法层产生式（全大写名字）—— 扫描器的 token 类型，**不进** PRODUCTIONS */
  tokenTypes: Production[];
  /** 所有终结符（去重，按首次出现顺序） */
  terminals: string[];
  /** 终结符中的关键字（纯字母开头） */
  keywords: string[];
  /** 终结符中的符号（其余） */
  symbols: string[];
  /** 起始产生式（第一条**语法层**产生式） */
  start: string;
};

/**
 * 预定义字符类 —— EBNF 方言的固定部分，不是产生式。
 * 它们只能出现在**词法层**（全大写）产生式里。
 */
export const CHAR_CLASSES: string[] = ['letter', 'digit', 'any_char', 'ws'];

/**
 * 扫描器支持的 token 种类。
 *
 * ⚠️ 这是**手写层的能力边界**：规格不能凭空要求一个扫描器没实现的种类。
 *    若 spec 声明了 `BOOL`（→ "bool"），生成器在**构建期**报错。
 */
export const TOKEN_SCANNERS: string[] = ['ident', 'number', 'string'];

type Tok =
  | { t: 'lbrace' } | { t: 'rbrace' }
  | { t: 'lbrack' } | { t: 'rbrack' }
  | { t: 'lparen' } | { t: 'rparen' }
  | { t: 'pipe' } | { t: 'eq' } | { t: 'semi' }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }

    // 注释行（EBNF 块里允许 (* ... *) 形式）
    if (c === '(' && src[i + 1] === '*') {
      const end = src.indexOf('*)', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }

    if (c === '{') { out.push({ t: 'lbrace' }); i++; continue; }
    if (c === '}') { out.push({ t: 'rbrace' }); i++; continue; }
    if (c === '[') { out.push({ t: 'lbrack' }); i++; continue; }
    if (c === ']') { out.push({ t: 'rbrack' }); i++; continue; }
    if (c === '(') { out.push({ t: 'lparen' }); i++; continue; }
    if (c === ')') { out.push({ t: 'rparen' }); i++; continue; }
    if (c === '|') { out.push({ t: 'pipe' }); i++; continue; }
    if (c === '=') { out.push({ t: 'eq' }); i++; continue; }
    if (c === ';') { out.push({ t: 'semi' }); i++; continue; }

    // 终结符："..." 或 '...'
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let v = '';
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < src.length) { v += src[j + 1]; j += 2; continue; }
        v += src[j]; j++;
      }
      if (j >= src.length) throw new Error(`EBNF 解析失败：终结符未闭合，位置 ${i}`);
      out.push({ t: 'str', v });
      i = j + 1;
      continue;
    }

    // 标识符 / 关键字
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'ident', v: src.slice(i, j) });
      i = j;
      continue;
    }

    throw new Error(`EBNF 解析失败：无法识别的字符 ${JSON.stringify(c)}，位置 ${i}`);
  }
  return out;
}

export function parseEbnf(src: string): Grammar {
  const toks = tokenize(src);
  let p = 0;

  const peek = (): Tok | undefined => toks[p];
  const next = (): Tok | undefined => toks[p++];

  function expect(t: Tok['t'], what: string): Tok {
    const tok = next();
    if (!tok || tok.t !== t) {
      throw new Error(`EBNF 解析失败：期望 ${what}，实际 ${tok ? tok.t : '输入结束'}`);
    }
    return tok;
  }

  /** 选择： sequence { '|' sequence } */
  function parseAlternation(): Node {
    const items: Node[] = [parseSequence()];
    while (peek()?.t === 'pipe') {
      next();
      items.push(parseSequence());
    }
    return items.length === 1 ? items[0] : { k: 'alt', items };
  }

  /** 序列： item { item } —— 遇到选择/闭合符/结束即停 */
  function parseSequence(): Node {
    const items: Node[] = [];
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.t === 'pipe' || t.t === 'rbrace' || t.t === 'rbrack'
          || t.t === 'rparen' || t.t === 'semi' || t.t === 'eq') break;
      items.push(parseItem());
    }
    if (items.length === 0) {
      throw new Error('EBNF 解析失败：序列为空（可能是左递归或空产生式）');
    }
    if (items.length === 1) return items[0];
    return { k: 'seq', items };
  }

  /** item： 分组 / 重复 / 可选 / 终结符 / 非终结符 */
  function parseItem(): Node {
    const t = peek();
    if (!t) throw new Error('EBNF 解析失败：期望一个项，实际输入结束');

    if (t.t === 'lparen') { next(); const inner = parseAlternation(); expect('rparen', ')'); return inner; }
    if (t.t === 'lbrace') { next(); const inner = parseAlternation(); expect('rbrace', '}'); return { k: 'rep', item: inner }; }
    if (t.t === 'lbrack') { next(); const inner = parseAlternation(); expect('rbrack', ']'); return { k: 'opt', item: inner }; }
    if (t.t === 'str')    { next(); return { k: 'term', value: t.v }; }
    if (t.t === 'ident')  { next(); return { k: 'ref', name: t.v }; }

    throw new Error(`EBNF 解析失败：位置 ${p} 处出现意外的 ${t.t}`);
  }

  const productions: Production[] = [];
  while (peek()) {
    const nameTok = expect('ident', '产生式名');
    const name = (nameTok as { t: 'ident'; v: string }).v;
    expect('eq', '=');
    const rhs = parseAlternation();
    expect('semi', ';');
    productions.push({ name, rhs });
  }

  if (productions.length === 0) throw new Error('EBNF 解析失败：没有任何产生式');

  // ── 分层：全大写名字 = 词法层（token 类型），其余 = 语法层 ────────────────
  //
  // ⚠️ 这一步不是「代码风格」，而是**正确性所必需**。
  //    不分层的真实后果：PRODUCTIONS 里出现 `IDENT`，而它的右部引用了 `letter`
  //    （一个字符类，不是产生式）→ 生成的 parser 在**运行期**抛
  //    `未定义的产生式: letter`。
  //    而当时的生成器是**成功退出**的 —— 它看起来一切正常。
  //
  //    spec-as-source 最危险的失效模式就是这个：
  //    **生成器不报错，但产出会在运行期炸。**
  //    所以下面的引用校验必须把这类输入拦在**构建期**。
  const isTokenTypeName = (n: string): boolean => /^[A-Z][A-Z0-9_]*$/.test(n);

  const tokenTypes = productions.filter((p) => isTokenTypeName(p.name));
  const parserProductions = productions.filter((p) => !isTokenTypeName(p.name));

  if (parserProductions.length === 0) {
    throw new Error(
      'EBNF 解析失败：只有词法层（全大写）产生式，没有语法层产生式 —— 无法确定起始符号。',
    );
  }

  // ── 引用校验：把「运行期才炸」变成「构建期就炸」 ─────────────────────────
  const parserNames = new Set(parserProductions.map((p) => p.name));
  const tokenNames = new Set(tokenTypes.map((p) => p.name));
  const charClasses = new Set(CHAR_CLASSES);

  const refsOf = (n: Node): string[] => {
    switch (n.k) {
      case 'ref': return [n.name];
      case 'seq': case 'alt': return n.items.flatMap(refsOf);
      case 'rep': case 'opt': return refsOf(n.item);
      default: return [];
    }
  };

  for (const p of parserProductions) {
    for (const r of refsOf(p.rhs)) {
      if (parserNames.has(r) || tokenNames.has(r)) continue;

      if (charClasses.has(r)) {
        throw new Error(
          `EBNF 引用校验失败：语法层产生式 \`${p.name}\` 引用了字符类 \`${r}\`。\n` +
          `  字符类只能出现在词法层（全大写）产生式里。\n` +
          `  修复：把该 token 描述为独立的全大写产生式（如 IDENT = letter { letter } ;）`,
        );
      }

      throw new Error(
        `EBNF 引用校验失败：产生式 \`${p.name}\` 引用了未定义的非终结符 \`${r}\`。\n` +
        `  已定义的语法层产生式：${[...parserNames].join(', ')}\n` +
        `  已定义的词法层 token 类型：${[...tokenNames].join(', ') || '（无）'}`,
      );
    }
  }

  for (const p of tokenTypes) {
    for (const r of refsOf(p.rhs)) {
      if (charClasses.has(r)) continue;
      throw new Error(
        `EBNF 引用校验失败：词法层产生式 \`${p.name}\` 引用了 \`${r}\`。\n` +
        `  词法层只允许引用预定义字符类：${CHAR_CLASSES.join(', ')}`,
      );
    }

    const kind = p.name.toLowerCase();
    if (!TOKEN_SCANNERS.includes(kind)) {
      throw new Error(
        `EBNF 校验失败：token 类型 \`${p.name}\` 需要扫描器种类 "${kind}"，\n` +
        `  但扫描器只支持：${TOKEN_SCANNERS.join(', ')}。\n` +
        `  规格不能凭空要求一个手写层没实现的扫描器 —— 要么改名字，要么先实现它。`,
      );
    }
  }

  // 收集终结符（保持首次出现顺序，去重）—— 遍历**全部**产生式（含词法层）
  const seen = new Set<string>();
  const terminals: string[] = [];
  const walk = (n: Node): void => {
    switch (n.k) {
      case 'term': if (!seen.has(n.value)) { seen.add(n.value); terminals.push(n.value); } break;
      case 'seq': case 'alt': n.items.forEach(walk); break;
      case 'rep': case 'opt': walk(n.item); break;
      case 'ref': break;
    }
  };
  productions.forEach((prod) => walk(prod.rhs));

  // ── 终结符分类 ────────────────────────────────────────────────────────
  //
  // ⚠️ 这一步比看起来麻烦：EBNF 里的终结符混了**两个层级**的东西。
  //
  //   ① 词法层终结符（token 级）："rule" "then" ">=" "notin" "in" —— 需要进关键字/符号表
  //   ② 字符层终结符（char 级）："_" '"' "letter" "digit" —— 它们是**扫描器的输入字符**，
  //      不是待识别的 token。把它们放进关键字表是个实打实的 bug。
  //
  // 本生成器不要求 spec.md 额外标注层级（那样会增加规格负担），而是用三条启发式规则区分：
  //
  //   规则 A：只有**以字母开头**的终结符才算关键字。
  //           → 修掉 `"_"` 被判为关键字的 bug（`_` 应以标识符方式扫描）。
  //   规则 B：等于 `"` 或 `'` 的终结符是字符串定界符，由字符串扫描处理，不进符号表。
  //   规则 C：**单字符且全为标识符字符**的终结符（如 `_`）是字符级终结符，
  //           既不是关键字也不是符号 —— 扫描器会把它当作标识符的一部分吃掉。
  //
  // 为什么规则 C 是安全的：扫描器**先尝试标识符、再尝试符号**（见 lexer 的扫描顺序），
  // 所以字符级终结符永远不会被误认为独立 token。
  const isCharLevel = (x: string): boolean => x.length === 1 && /^[A-Za-z0-9_]$/.test(x);
  const isStringDelimiter = (x: string): boolean => x === '"' || x === "'";

  const keywords = terminals.filter((x) => /^[A-Za-z][A-Za-z0-9_]*$/.test(x));
  const symbols = terminals.filter(
    (x) => !keywords.includes(x) && !isStringDelimiter(x) && !isCharLevel(x),
  );

  return {
    productions: parserProductions,
    tokenTypes,
    terminals,
    keywords,
    symbols,
    start: parserProductions[0].name,
  };
}

/** 把 AST 渲染回单行 EBNF，便于在文档与生成物里做一致性展示。 */
export function renderNode(n: Node): string {
  switch (n.k) {
    case 'term':  return JSON.stringify(n.value);
    case 'ref':   return n.name;
    case 'seq':   return n.items.map(renderNode).join(' ');
    case 'alt':   return n.items.map(renderNode).join(' | ');
    case 'rep':   return `{ ${renderNode(n.item)} }`;
    case 'opt':   return `[ ${renderNode(n.item)} ]`;
  }
}

export function renderProduction(p: Production): string {
  return `${p.name} = ${renderNode(p.rhs)} ;`;
}
