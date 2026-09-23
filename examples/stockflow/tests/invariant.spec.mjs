// ════════════════════════════════════════════════════════════════════════════
//  invariant.spec.mjs —— 不变量，而不是例子
//
//  前面几组测的是「给定输入，输出是 X」。这一组测的是：
//  **不管发生什么，某个等式恒成立。**
//
//  区别很要紧：举例测试只能覆盖你想到的路径；不变量测试覆盖你没想过的组合。
//  4.1 的措辞是「对任意操作序列成立」—— 那就不可能用例子测完，
//  只能随机走一遍，并且在**每一步之后**都检查等式。
// ════════════════════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, setNow, tx } from '../src/db.mjs';
import * as store from '../src/store.mjs';
import { tempDir } from './helpers.mjs';

/** 可复现的伪随机（固定种子 ⇒ 失败可重现，这是不变量测试的前提）。 */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function checkAll(db, label) {
  for (const row of store.conservation(db)) {
    assert.equal(row.delta, 0, `${label}：${row.sku_id} 的守恒等式被破坏`);
  }
  for (const row of store.allAvailable(db)) {
    assert.ok(row.available >= 0, `${label}：${row.sku_id} 的可用量成了 ${row.available}`);
    assert.ok(row.on_hand >= 0, `${label}：${row.sku_id} 的在手量成了 ${row.on_hand}`);
  }
  // AC 5.4：在手量必须能被「入账 − 已兑现」重新推导出来
  for (const row of store.deriveOnHand(db)) {
    assert.equal(row.on_hand, row.derived, `${label}：${row.sku_id} 的在手量推不出来`);
  }
}

test('AC 4.1 / 5.4 随机 400 步操作序列之后，守恒等式每一步都平', () => {
  const t = tempDir();
  const db = connect(t.path);
  const rand = prng(20260923);
  const skus = ['SKU-A', 'SKU-B'];
  let t0 = 1000;
  let n = 0;

  try {
    for (const s of skus) {
      store.createSku(db, s);
      store.receive(db, { skuId: s, qty: 8, at: t0 });
    }

    for (let step = 0; step < 400; step++) {
      const sku = skus[Math.floor(rand() * skus.length)];
      const pick = rand();
      t0 += 1 + Math.floor(rand() * 30);
      setNow(db, t0);

      try {
        if (pick < 0.45) {
          n += 1;
          store.reserve(db, {
            resId: `r-${step}`,
            requestId: `REQ-${step}`,
            skuId: sku,
            qty: 1 + Math.floor(rand() * 5),
            createdAt: t0,
            expiresAt: t0 + 1 + Math.floor(rand() * 200),
          });
        } else if (pick < 0.7) {
          const held = heldOf(db, sku);
          if (held.length) store.commit(db, held[Math.floor(rand() * held.length)].res_id, t0);
        } else if (pick < 0.85) {
          const held = heldOf(db, sku);
          if (held.length) store.release(db, held[Math.floor(rand() * held.length)].res_id, t0);
        } else if (pick < 0.95) {
          store.reap(db, t0);
        } else {
          store.receive(db, { skuId: sku, qty: 1 + Math.floor(rand() * 4), at: t0 });
        }
      } catch (err) {
        // 被拒绝是**正常**的（库存不够、已过期、状态不对……），
        // 但拒绝之后不变量仍必须成立 —— 这正是要在这里检查的东西。
        assert.ok(err.code, `第 ${step} 步抛出了非规格错误：${err.message}`);
      }

      checkAll(db, `第 ${step} 步（${pick < 0.45 ? 'reserve' : 'other'}）`);
    }

    assert.ok(n > 100, `随机序列只产生了 ${n} 次预占，覆盖太浅`);
    assert.equal(db.prepare('SELECT count(*) AS n FROM reservation').get().n > 30, true);
  } finally {
    db.close();
    t.cleanup();
  }
});

const heldOf = (db, skuId) =>
  db.prepare(`SELECT res_id FROM reservation WHERE sku_id=? AND state='held'`).all(skuId);

test('AC 4.4 事务失败时全部回滚：不留部分状态', () => {
  const t = tempDir();
  const db = connect(t.path);
  try {
    setNow(db, 1000);
    store.createSku(db, 'SKU-1');
    store.receive(db, { skuId: 'SKU-1', qty: 5, at: 1000 });

    const before = {
      res: db.prepare('SELECT count(*) AS n FROM reservation').get().n,
      evt: db.prepare('SELECT count(*) AS n FROM reservation_event').get().n,
      onHand: store.available(db, 'SKU-1').on_hand,
    };

    // 在一个事务里做「三件合法的事 + 一件非法的事」。
    // 前三件必须整体消失 —— 而不是留下两条预占和一条留痕。
    assert.throws(() =>
      tx(db, () => {
        for (const i of [1, 2, 3]) {
          store.reserve(db, {
            resId: `r-${i}`,
            requestId: `REQ-${i}`,
            skuId: 'SKU-1',
            qty: 1,
            createdAt: 1000,
            expiresAt: 9000,
          });
        }
        db.prepare(`UPDATE sku SET on_hand = -1 WHERE sku_id='SKU-1'`).run(); // 非法
      }),
    );

    assert.deepEqual(
      {
        res: db.prepare('SELECT count(*) AS n FROM reservation').get().n,
        evt: db.prepare('SELECT count(*) AS n FROM reservation_event').get().n,
        onHand: store.available(db, 'SKU-1').on_hand,
      },
      before,
      '回滚不完整 —— 有部分状态留了下来',
    );
    checkAll(db, '回滚之后');
  } finally {
    db.close();
    t.cleanup();
  }
});

test('AC 4.4 嵌套调用不会把外层事务提前提交', () => {
  // store 的每个函数都自带事务。如果它无条件 BEGIN/COMMIT，
  // 上面那个「三件合法 + 一件非法」的用例就会**提前提交**前两件 —— 回滚就失效了。
  // 这条测试钉住的是：内层失败必须让外层整体失败。
  const t = tempDir();
  const db = connect(t.path);
  try {
    setNow(db, 1000);
    store.createSku(db, 'SKU-1');
    store.receive(db, { skuId: 'SKU-1', qty: 5, at: 1000 });

    let innerError = null;
    assert.throws(() =>
      tx(db, () => {
        store.reserve(db, {
          resId: 'r-ok', requestId: 'Q-OK', skuId: 'SKU-1',
          qty: 1, createdAt: 1000, expiresAt: 9000,
        });
        try {
          store.reserve(db, {
            resId: 'r-bad', requestId: 'Q-BAD', skuId: 'SKU-1',
            qty: 999, createdAt: 1000, expiresAt: 9000,
          });
        } catch (e) {
          innerError = e.code;
        }
        throw new Error('外层决定放弃');
      }),
    );

    assert.equal(innerError, 'INSUFFICIENT_STOCK');
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM reservation').get().n,
      0,
      '内层事务被独立提交了 —— 外层回滚没能覆盖它',
    );
  } finally {
    db.close();
    t.cleanup();
  }
});
