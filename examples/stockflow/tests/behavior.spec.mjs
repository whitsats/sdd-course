// ════════════════════════════════════════════════════════════════════════════
//  behavior.spec.mjs —— 经过应用的行为
//
//  与 schema.spec.mjs 的分工：
//    schema.spec.mjs  证明「不经过应用也拦得住」（约束住在哪）
//    behavior.spec.mjs 证明「经过应用时的行为符合规格」（契约是什么）
//
//  两组都必须有。只有前者 → 不知道调用方拿到什么；只有后者 → 不知道
//  绕过应用时会发生什么（而绕过的路径是存在的）。
// ════════════════════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, setNow } from '../src/db.mjs';
import * as store from '../src/store.mjs';
import { tempDir } from './helpers.mjs';

function setup(onHand = 10, at = 1000) {
  const t = tempDir();
  const db = connect(t.path);
  setNow(db, at);
  store.createSku(db, 'SKU-1');
  store.receive(db, { skuId: 'SKU-1', qty: onHand, at });
  return { db, t, at };
}

let seq = 0;
const reserve = (db, over = {}) =>
  store.reserve(db, {
    resId: `r-${++seq}`,
    requestId: over.requestId ?? `REQ-${seq}`,
    skuId: 'SKU-1',
    qty: 1,
    createdAt: store.available(db, 'SKU-1') ? 1000 : 1000,
    expiresAt: 9000,
    ...over,
  });

// ── US1 预占 ────────────────────────────────────────────────────────────────

test('AC 1.1 预占成功后记录含全部可追溯字段', () => {
  const { db } = setup();
  const { reservation: r } = reserve(db, { qty: 3, requestId: 'R1' });
  assert.equal(r.state, 'held');
  assert.equal(r.qty, 3);
  assert.equal(r.request_id, 'R1');
  assert.equal(r.created_at, 1000);
  assert.equal(r.expires_at, 9000);
  assert.equal(r.settled_at, null);
});

test('AC 1.2 超过可用量的预占被拒绝', () => {
  const { db } = setup(3);
  reserve(db, { qty: 3 });
  assert.throws(() => reserve(db, { qty: 1 }), (e) => e.code === 'INSUFFICIENT_STOCK');
});

test('AC 1.3 被拒绝时不留任何痕迹', () => {
  const { db } = setup(3);
  reserve(db, { qty: 3, requestId: 'R-KEEP' });
  const before = {
    n: db.prepare('SELECT count(*) AS n FROM reservation').get().n,
    events: db.prepare('SELECT count(*) AS n FROM reservation_event').get().n,
    avail: store.available(db, 'SKU-1').available,
  };
  assert.throws(() => reserve(db, { qty: 5 }), (e) => e.code === 'INSUFFICIENT_STOCK');
  assert.deepEqual(
    {
      n: db.prepare('SELECT count(*) AS n FROM reservation').get().n,
      events: db.prepare('SELECT count(*) AS n FROM reservation_event').get().n,
      avail: store.available(db, 'SKU-1').available,
    },
    before,
    '被拒绝的请求留下了痕迹 —— 1.3 要求三者在拒绝前后完全相同',
  );
});

test('AC 1.4 同一请求标识重复提交返回首次结果，且不二次占用', () => {
  const { db } = setup(10);
  const first = reserve(db, { qty: 4, requestId: 'R-DUP' });
  const again = reserve(db, { qty: 4, requestId: 'R-DUP' });

  assert.equal(again.replayed, true);
  assert.equal(again.reservation.res_id, first.reservation.res_id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM reservation').get().n, 1);
  assert.equal(store.available(db, 'SKU-1').available, 6, '被占用了两次');
});

test('AC 1.5 非正数量被拒绝', () => {
  const { db } = setup();
  for (const qty of [0, -1, 1.5]) {
    assert.throws(() => reserve(db, { qty }), (e) => e.code === 'INVALID_QTY', `qty=${qty}`);
  }
});

test('AC 1.6 未知 SKU 被拒绝', () => {
  const { db } = setup();
  assert.throws(
    () => reserve(db, { skuId: 'GHOST' }),
    (e) => e.code === 'UNKNOWN_SKU',
  );
});

// ── US2 兑现与释放 ──────────────────────────────────────────────────────────

test('AC 2.1 兑现同时完成状态流转与出库', () => {
  const { db } = setup(10);
  const { reservation: r } = reserve(db, { qty: 4 });
  store.commit(db, r.res_id, 1100);

  assert.equal(store.reservation(db, r.res_id).state, 'committed');
  assert.equal(store.available(db, 'SKU-1').on_hand, 6, '在手量没有减少');
  assert.equal(
    db.prepare(`SELECT delta FROM v_conservation WHERE sku_id='SKU-1'`).get().delta,
    0,
  );
});

test('AC 2.2 已释放的预占不能再兑现（终结态不复活）', () => {
  const { db } = setup(10);
  const { reservation: r } = reserve(db, { qty: 2 });
  store.release(db, r.res_id, 1100);
  assert.throws(() => store.commit(db, r.res_id, 1200), (e) => e.code === 'INVALID_STATE');
});

test('AC 2.3 重复兑现是幂等成功，且不二次扣减', () => {
  const { db } = setup(10);
  const { reservation: r } = reserve(db, { qty: 4 });
  store.commit(db, r.res_id, 1100);
  const onHandAfterFirst = store.available(db, 'SKU-1').on_hand;

  const second = store.commit(db, r.res_id, 1200);
  assert.equal(second.replayed, true);
  assert.equal(store.available(db, 'SKU-1').on_hand, onHandAfterFirst, '被扣了两次');
});

test('AC 2.4 释放不改变在手量，可用量恢复', () => {
  const { db } = setup(10);
  const { reservation: r } = reserve(db, { qty: 6 });
  assert.equal(store.available(db, 'SKU-1').available, 4);

  store.release(db, r.res_id, 1100);
  assert.equal(store.available(db, 'SKU-1').on_hand, 10, '释放改动了在手量');
  assert.equal(store.available(db, 'SKU-1').available, 10);
});

test('AC 2.6 兑现一条已过期的预占被拒绝，且不动在手量', () => {
  const { db } = setup(10);
  const { reservation: r } = reserve(db, { qty: 4, expiresAt: 1500 });
  setNow(db, 2000); // 已过期

  assert.throws(() => store.commit(db, r.res_id, 2000), (e) => e.code === 'EXPIRED');
  assert.equal(store.available(db, 'SKU-1').on_hand, 10);
  assert.equal(store.reservation(db, r.res_id).state, 'held', '状态被改动了');
});

// ── US3 过期 ────────────────────────────────────────────────────────────────

test('AC 3.1 过期时刻不晚于创建时刻被拒绝', () => {
  const { db } = setup();
  assert.throws(
    () => reserve(db, { createdAt: 2000, expiresAt: 2000 }),
    (e) => e.code === 'INVALID_EXPIRY',
  );
});

test('AC 3.2 过期后可用量恢复，无需先收割', () => {
  const { db } = setup(10);
  reserve(db, { qty: 7, expiresAt: 1500 });
  assert.equal(store.available(db, 'SKU-1').available, 3);
  setNow(db, 2000);
  assert.equal(store.available(db, 'SKU-1').available, 10, '过期了但还占着库存');
});

test('AC 3.3 / 3.4 收割与它的幂等性', () => {
  const { db } = setup(10);
  const a = reserve(db, { qty: 2, expiresAt: 1200 });
  const b = reserve(db, { qty: 3, expiresAt: 9000 });

  setNow(db, 2000);
  assert.equal(store.reap(db, 2000), 1, '应恰好收割 1 条');
  assert.equal(store.reap(db, 2000), 0, '重复收割产生了额外变更');
  assert.equal(store.reap(db, 99999), 1, '更晚的时刻应收割掉剩下的那条');

  assert.equal(store.reservation(db, a.reservation.res_id).state, 'released');
  assert.equal(store.reservation(db, b.reservation.res_id).state, 'released');
  assert.equal(store.conservation(db).every((r) => r.delta === 0), true);
});

test('AC 3.5 业务路径不读系统时钟', () => {
  const { db } = setup(10);
  const realNow = Date.now;
  // 把墙钟变成会爆炸的东西：任何读到它的业务路径都会立刻失败。
  // 这比「断言结果稳定」更强 —— 它证明的是**不存在这条依赖**。
  Date.now = () => {
    throw new Error('业务路径读到了系统时钟（AC 3.5）');
  };
  try {
    const { reservation: r } = reserve(db, { qty: 2, expiresAt: 5000 });
    setNow(db, 6000);
    assert.equal(store.available(db, 'SKU-1').available, 10);
    assert.equal(store.reap(db, 6000), 1);
    assert.equal(store.reservation(db, r.res_id).state, 'released');
  } finally {
    Date.now = realNow;
  }
  // 说明：建库时的迁移记账确实会调用一次 Date.now（那是**边界**，不是业务路径）。
  // 本测试先建库再上锁，就是为了把那条边界排除在外 —— 而不是为了让测试变绿。
});

// ── US5 可追溯 ──────────────────────────────────────────────────────────────

test('AC 5.2 留痕由引擎写，顺序可复现', () => {
  const { db } = setup(10);
  const { reservation: r } = reserve(db, { qty: 2 });
  store.commit(db, r.res_id, 1100);
  const ev = store.events(db, r.res_id).map((e) => `${e.from_state ?? '∅'}→${e.to_state}@${e.at}`);
  assert.deepEqual(ev, ['∅→held@1000', 'held→committed@1100']);
});

test('AC 5.3 每一种拒绝都有稳定错误码，调用方不需要解析文本', () => {
  const { db } = setup(1);
  const codes = new Set();
  const capture = (fn) => {
    try {
      fn();
    } catch (e) {
      codes.add(e.code);
    }
  };
  capture(() => reserve(db, { qty: 5 }));
  capture(() => reserve(db, { qty: 0 }));
  capture(() => reserve(db, { skuId: 'GHOST' }));
  capture(() => reserve(db, { createdAt: 1, expiresAt: 1 }));
  assert.deepEqual([...codes].sort(), [
    'INSUFFICIENT_STOCK',
    'INVALID_EXPIRY',
    'INVALID_QTY',
    'UNKNOWN_SKU',
  ]);
});
