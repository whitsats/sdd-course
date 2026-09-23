// ════════════════════════════════════════════════════════════════════════════
//  concurrency.spec.mjs —— AC 4.2：并发下不超卖
//
//  为什么用 worker_threads 而不是 async/await：
//    `node:sqlite` 的 API 是**同步**的，同一个线程里的「并发」实际上是排队执行 ——
//    那样测出来的「不超卖」是**单线程串行**的必然结果，什么都没证明。
//    每个 worker 拥有**自己的连接**，才真的在数据层制造了争抢。
//
//  这也是本案例里唯一一个**必须**用多连接才能测的标准：
//    1.4 的幂等由 UNIQUE 保证（引擎内部，单连接也能测）
//    1.2 的不超卖由触发器保证（同上）
//    而 4.2 问的是「当有多个写入者同时在场时，这些保证还成立吗」——
//    这个问题**只能**在多写入者的前提下回答。
// ════════════════════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { connect, setNow } from '../src/db.mjs';
import * as store from '../src/store.mjs';
import { tempDir } from './helpers.mjs';

const WORKER = fileURLToPath(new URL('./concurrency.worker.mjs', import.meta.url));

async function race({ onHand, contenders }) {
  const t = tempDir();
  const at = 1000;

  // 主线程先把库和 schema 建好：让 worker 只做「争抢」这一件事，
  // 否则 40 条连接会同时跑迁移，测出来的是迁移的健壮性，不是预占的。
  const owner = connect(t.path);
  setNow(owner, at);
  store.createSku(owner, 'SKU-1');
  store.receive(owner, { skuId: 'SKU-1', qty: onHand, at });
  owner.close();

  const barrier = new SharedArrayBuffer(8);
  const gate = new Int32Array(barrier);

  const workers = Array.from({ length: contenders }, (_, i) =>
    new Worker(WORKER, {
      workerData: { dbPath: t.path, skuId: 'SKU-1', index: i, barrier, at },
    }),
  );

  const results = workers.map(
    (w) =>
      new Promise((resolve, reject) => {
        w.once('message', resolve);
        w.once('error', reject);
      }),
  );

  // 等所有 worker 都到达屏障再发令
  const deadline = Date.now() + 10_000;
  while (Atomics.load(gate, 0) < contenders) {
    if (Date.now() > deadline) throw new Error('worker 未能在 10 秒内全部就绪');
    await new Promise((r) => setTimeout(r, 5));
  }
  Atomics.store(gate, 1, 1);
  Atomics.notify(gate, 1, contenders);

  const settled = await Promise.all(results);
  await Promise.all(workers.map((w) => w.terminate()));

  const check = connect(t.path);
  const snapshot = {
    succeeded: settled.filter((r) => r.ok).length,
    onHand: store.available(check, 'SKU-1').on_hand,
    available: store.available(check, 'SKU-1').available,
    delta: check.prepare(`SELECT delta FROM v_conservation WHERE sku_id='SKU-1'`).get().delta,
    failures: settled.filter((r) => !r.ok).map((r) => r.code),
  };
  check.close();
  t.cleanup();
  return { snapshot, settled };
}

test('AC 4.2 40 个并发写入者争抢 10 件库存：恰好 10 个成功，绝不超卖', async () => {
  const { snapshot, settled } = await race({ onHand: 10, contenders: 40 });

  assert.equal(snapshot.succeeded, 10, `成功 ${snapshot.succeeded} 次，期望恰好 10 次`);
  assert.equal(snapshot.available, 0);
  assert.equal(snapshot.delta, 0, '守恒等式被并发破坏了');
  assert.equal(
    snapshot.onHand,
    10,
    '在手量在「只预占、未兑现」时不该变化',
  );
  // 失败原因必须是「库存不够」，不能是引擎层面的错误。
  // 出现 SQLITE_BUSY 之类会在这里暴露 —— 那意味着正确性靠的是运气而不是锁。
  assert.deepEqual(
    [...new Set(snapshot.failures)],
    ['INSUFFICIENT_STOCK'],
    `失败原因里混进了非预期的错误：${[...new Set(snapshot.failures)].join(', ')}`,
  );
  assert.equal(settled.length, 40);
});

test('AC 4.2 库存为 1 时，40 个并发者里只有 1 个能拿到', async () => {
  const { snapshot } = await race({ onHand: 1, contenders: 40 });
  assert.equal(snapshot.succeeded, 1);
  assert.equal(snapshot.available, 0);
});
