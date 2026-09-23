// ════════════════════════════════════════════════════════════════════════════
//  稳定错误码（AC 5.3）
//
//  这个文件是 ADR-001 里那条「代价」的还款：约束住在 schema 里之后，
//  调用方拿到的原始报错是 `CHECK constraint failed: qty > 0` 这种面向引擎的文本。
//  这里把它翻译成可分支的稳定错误码。
//
//  ⚠️ 坦诚说明本文件的**精度上限**（写在这里，因为下一个改它的人需要知道）：
//     映射的依据是**报错文本匹配**。引擎只告诉我们「哪条约束炸了」，
//     不告诉我们「调用方原本想干什么」。于是：
//       · 「数量是 0」和「数量是 -3」都变成 INVALID_QTY —— 丢失了细节；
//       · 「预占已过期」和「已过期但被 reap 过」都会走到 EXPIRED / INVALID_STATE，
//         而调用方无法从错误码区分，只能再去查一次状态。
//     想要更细的粒度，就必须在**报错的位置**（应用层）做判断 ——
//     而那正是我们为了拦住「绕过应用的写入」而放弃的东西。
//     这不是可以继续优化的债，这是这个方案的边界。见 docs/adr/ADR-004。
// ════════════════════════════════════════════════════════════════════════════

/** 对外暴露的全部错误码。每个都对应规格里的一条标准。 */
export const Code = Object.freeze({
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK', // AC 1.2
  INVALID_QTY: 'INVALID_QTY',               // AC 1.5
  UNKNOWN_SKU: 'UNKNOWN_SKU',               // AC 1.6
  INVALID_STATE: 'INVALID_STATE',           // AC 2.2
  EXPIRED: 'EXPIRED',                       // AC 2.6
  INVALID_EXPIRY: 'INVALID_EXPIRY',         // AC 3.1
  NEGATIVE_STOCK: 'NEGATIVE_STOCK',         // AC 4.3①
  NOT_FOUND: 'NOT_FOUND',                   // 规格未覆盖，见下方注释
});

/**
 * 规格未定义时的兜底码。
 *
 * AC 1.6 要求「目标 SKU 不存在 → UNKNOWN_SKU」，但规格没有说
 * 「**预占**不存在」时该返回什么。这里选择 NOT_FOUND 而不是 INVALID_STATE，
 * 因为两者的调用方处理方式不同（前者是地址错了，后者是时序错了）。
 * 这条缺口记录在 notes/L14 的 §6「规格还没说的地方」，值得回头补进规格。
 */
export const UNSPECIFIED = 'NOT_FOUND';

export class SpecViolation extends Error {
  constructor(code, raw) {
    super(raw ? `${code}: ${raw}` : code);
    this.name = 'SpecViolation';
    this.code = code;
    this.raw = raw;
  }
}

const RULES = [
  // 顺序有意义：先匹配我们自己 RAISE 出来的（文本精确），再匹配引擎的通用文本。
  ['INSUFFICIENT_STOCK', (m) => m.includes('INSUFFICIENT_STOCK')],
  ['EXPIRED', (m) => m.includes('EXPIRED')],
  ['INVALID_STATE', (m) => m.includes('INVALID_STATE')],
  ['NEGATIVE_STOCK', (m) => m.includes('on_hand >= 0')],
  ['INVALID_EXPIRY', (m) => m.includes('expires_at > created_at')],
  // STRICT 表拒绝把非整数塞进 INTEGER 列 —— 对「数量必须是正整数」而言
  // 这是同一个违规的另一种措辞（AC 1.5）。
  ['INVALID_QTY', (m) => m.includes('CHECK constraint failed: qty > 0')],
  ['INVALID_QTY', (m) => m.includes('cannot store') && m.includes('reservation.qty')],
  ['INVALID_QTY', (m) => m.includes('cannot store') && m.includes('qty')],
  ['UNKNOWN_SKU', (m) => m.includes('FOREIGN KEY constraint failed')],
];

/** 匹配到就抛 SpecViolation，没匹配到就原样抛出（不吞异常）。 */
export function translate(err) {
  const m = String(err?.message ?? err);
  for (const [code, test] of RULES) {
    if (test(m)) return new SpecViolation(code, m);
  }
  return err;
}

/** 幂等重放专用的内部信号：唯一约束冲突是「这个请求来过」，不是错误。 */
export const REPLAY = Symbol('REPLAY');

export function isReplay(err) {
  return String(err?.message ?? '').includes(UNIQUE_REQUEST_ID);
}

const UNIQUE_REQUEST_ID = 'UNIQUE constraint failed: reservation.request_id';
