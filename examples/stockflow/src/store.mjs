// ════════════════════════════════════════════════════════════════════════════
//  适配层 —— 刻意「薄」到不正常
//
//  施工规程（由评审守住，不是由代码守）：
//    本文件**不得包含任何业务条件判断**。
//    它只允许做三件事：开事务、绑参数、把引擎的报错翻译成稳定错误码。
//
//  一旦这里出现 `if (available < qty) throw ...`：
//    那条规则就**同时**住在 schema 和这里了。
//    这是最坏的结果 —— 不是因为它错，而是因为从此以后
//    「改一处忘一处」成为可能，而 schema 的那一份仍会生效，
//    于是测试可能全绿、线上行为却与代码的意图不符。
//
//  如果你发现某个新功能「没法不加判断地写」——
//  那通常意味着这个判断要么能变成一条约束（写进 migrations/），
//  要么属于 docs/adr/ADR-004 的第二类：**它搬不过去**。
//  两种情况的处理方式不同，但不包括「先写在 store 里再说」。
// ════════════════════════════════════════════════════════════════════════════

import { tx } from './db.mjs';
import { Code, SpecViolation, REPLAY, isReplay, translate, UNSPECIFIED } from './errors.mjs';

const toViolation = (err, fallback) => {
  const t = translate(err);
  if (t === err) throw new SpecViolation(fallback, err.message);
  throw t;
};

// ── 建 SKU ────────────────────────────────────────────────────────────────────

export function createSku(db, skuId) {
  try {
    db.prepare('INSERT INTO sku (sku_id) VALUES (?)').run(skuId);
  } catch (err) {
    toViolation(err, UNSPECIFIED);
  }
  return skuId;
}

// ── 入账（AC 5.4）─────────────────────────────────────────────────────────────
// 注意这里**没有**任何「sku 不存在就建一个」的逻辑：
// 那是业务决定，写成 `if (!exists) create` 就变成了「先查后插」的竞态。
// 现在它靠外键保证 —— 代价见 docs/adr/ADR-002（外键可能不生效）。

export function receive(db, { skuId, qty, at }) {
  return tx(db, () => {
    try {
      const r = db
        .prepare('INSERT INTO receipt (sku_id, qty, at) VALUES (?, ?, ?)')
        .run(skuId, qty, at);
      return Number(r.lastInsertRowid);
    } catch (err) {
      toViolation(err, UNSPECIFIED);
    }
  });
}

// ── 预占（AC 1.1–1.6）────────────────────────────────────────────────────────

export function reserve(db, { resId, requestId, skuId, qty, createdAt, expiresAt }) {
  return tx(db, () => {
    try {
      db.prepare(
        `INSERT INTO reservation (res_id, request_id, sku_id, qty, state, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'held', ?, ?)`,
      ).run(resId, requestId, skuId, qty, createdAt, expiresAt);
      return { reservation: reservation(db, resId), replayed: false };
    } catch (err) {
      // 唯一约束冲突 = 「这个请求来过了」（AC 1.4）。
      // 这里**不是**在判断一条业务规则，而是在识别一个**并发信号**：
      // 我们不问「能不能插入」，而是「插入失败了，那是为什么」。
      // 判断性检查（先 SELECT 再 INSERT）才会引入竞态，这里没有。
      if (!isReplay(err)) toViolation(err, UNSPECIFIED);

      const existing = db
        .prepare('SELECT * FROM reservation WHERE request_id = ?')
        .get(requestId);
      if (!existing) throw new SpecViolation(UNSPECIFIED, err.message);

      // 返回**首次的**结果（AC 1.4），不是本次请求参数推导出的结果。
      // ⚠️ 规格没有规定「同一 request_id 配不同参数」时该怎么办 ——
      //    当前的实现是照字面执行 1.4（返回首次结果，忽略本次参数）。
      //    这是一处**规格空白**，记录在 notes/L14 §6。
      return { reservation: existing, replayed: true };
    }
  });
}

// ── 兑现 / 释放（AC 2.1–2.6）─────────────────────────────────────────────────

function settle(db, resId, targetState, at) {
  return tx(db, () => {
    let changes;
    try {
      changes = db
        .prepare(
          `UPDATE reservation SET state = ?, settled_at = ?
            WHERE res_id = ? AND state = 'held'`,
        )
        .run(targetState, at, resId).changes;
    } catch (err) {
      toViolation(err, UNSPECIFIED);
    }

    const current = reservation(db, resId);
    if (!current) throw new SpecViolation(UNSPECIFIED, `预占不存在：${resId}`);

    if (Number(changes) === 1) return { reservation: current, replayed: false };

    // 没有行被改动 —— 分清两种含义（AC 2.2 幂等 vs 非法流转）。
    // 这一段读起来像业务判断，但它不是：它是在**解读一个并发结果**。
    // 真正的规则（「终结态不可复活」「过期不可兑现」）都在触发器里，
    // 这里只是把「已经发生的事」翻译成调用方能用的答案。
    if (current.state === targetState) return { reservation: current, replayed: true };

    throw new SpecViolation(
      current.state === 'held' ? Code.EXPIRED : Code.INVALID_STATE,
      `状态 ${current.state} 不允许转为 ${targetState}`,
    );
  });
}

export const commit = (db, resId, at) => settle(db, resId, 'committed', at);
export const release = (db, resId, at) => settle(db, resId, 'released', at);

// ── 收割（AC 3.3 / 3.4）──────────────────────────────────────────────────────
// 幂等是**白送的**：WHERE 里的 state='held' 让第二次运行匹配到 0 行。
// 不需要额外的判断，也不需要记住「收过了」。

export function reap(db, at) {
  return tx(db, () =>
    Number(
      db
        .prepare(
          `UPDATE reservation SET state = 'released', settled_at = ?
            WHERE state = 'held' AND expires_at <= ?`,
        )
        .run(at, at).changes,
    ),
  );
}

// ── 查询 ──────────────────────────────────────────────────────────────────────

export const available = (db, skuId) =>
  db.prepare('SELECT * FROM v_available WHERE sku_id = ?').get(skuId) ?? null;

export const allAvailable = (db) =>
  db.prepare('SELECT * FROM v_available ORDER BY sku_id').all();

export const reservation = (db, resId) =>
  db.prepare('SELECT * FROM reservation WHERE res_id = ?').get(resId) ?? null;

export const events = (db, resId) =>
  db.prepare('SELECT * FROM reservation_event WHERE res_id = ? ORDER BY event_id').all(resId);

/** AC 4.1：返回每条 SKU 的守恒差额。全部为 0 才算账平的。 */
export const conservation = (db) =>
  db.prepare('SELECT * FROM v_conservation ORDER BY sku_id').all();

/** AC 4.4 的验证工具：从入账与已兑现预占**重新推导**在手量。 */
export const deriveOnHand = (db) =>
  db
    .prepare(
      `SELECT s.sku_id,
              COALESCE((SELECT SUM(qty) FROM receipt WHERE sku_id = s.sku_id), 0)
            - COALESCE((SELECT SUM(qty) FROM reservation
                         WHERE sku_id = s.sku_id AND state = 'committed'), 0)
              AS derived,
              s.on_hand
         FROM sku s ORDER BY s.sku_id`,
    )
    .all();
