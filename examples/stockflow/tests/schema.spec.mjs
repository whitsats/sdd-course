// ════════════════════════════════════════════════════════════════════════════
//  schema.spec.mjs —— 本案例与前面四个案例最大的不同
//
//  这一组测试**不 import src/store.mjs、不 import src/db.mjs 的连接逻辑**。
//  它直接用裸 SQL 打这个库。
//
//  它证明的不是「我们的代码很小心」，而是：
//  **不经过我们的代码，也拦得住。**
//
//  同样的写法在普通项目里会被认为是坏味道（测试绕过了被测试的东西）。
//  这里反过来 —— 因为规格 4.3 要拦住的正是「不经过应用」的写入，
//  一组只走应用层的测试在**存在绕过路径**的前提下，提供的信心是假的。
// ════════════════════════════════════════════════════════════════════════════

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rawConnect, tempDir, seed, attempt, conservationOf } from './helpers.mjs';

const t = tempDir();
const db = rawConnect(t.path); // 注意：外键**未启用** —— 与多数客户端一致
after(() => {
  db.close();
  t.cleanup();
});
seed(db, 'SKU-1', 10);

// ── ① 级：列类型 / NOT NULL / STRICT ────────────────────────────────────────

test('STRICT 拦住非整数进入 INTEGER 列（AC 5.1）', () => {
  const err = attempt(
    db,
    `INSERT INTO reservation VALUES ('r-str','q-str','SKU-1','abc','held',1000,2000,NULL)`,
  );
  assert.ok(err, '类型被静默接受了 —— STRICT 没生效');
  assert.match(err, /cannot store TEXT value in INTEGER column/);
});

// ── ② 级：CHECK ─────────────────────────────────────────────────────────────

test('CHECK 拦住负在手量（AC 4.3①）', () => {
  const err = attempt(db, `UPDATE sku SET on_hand = -1 WHERE sku_id = 'SKU-1'`);
  assert.match(err, /CHECK constraint failed: on_hand >= 0/);
});

test('CHECK 拦住非正数量（AC 1.5 / 4.3②）', () => {
  for (const qty of [0, -3]) {
    const err = attempt(
      db,
      `INSERT INTO reservation VALUES ('r-q${qty}','qq${qty}','SKU-1',${qty},'held',1000,2000,NULL)`,
    );
    assert.match(err, /CHECK constraint failed: qty > 0/, `qty=${qty} 被接受了`);
  }
});

test('CHECK 拦住「过期时刻早于创建时刻」（AC 3.1）', () => {
  const err = attempt(
    db,
    `INSERT INTO reservation VALUES ('r-e','q-e','SKU-1',1,'held',2000,1000,NULL)`,
  );
  assert.match(err, /expires_at > created_at/);
});

test('CHECK 把「状态」与「终结时刻」绑成一致的一对（AC 2.2 / 5.1）', () => {
  // held 却带着终结时刻 → 拒绝（这是**两列之间**的关系，单列 CHECK 表达不了）
  assert.match(
    attempt(
      db,
      `INSERT INTO reservation VALUES ('r-h','q-h','SKU-1',1,'held',1000,2000,1500)`,
    ),
    /CHECK constraint failed/,
  );
  // committed 却没有终结时刻 → 拒绝
  assert.match(
    attempt(
      db,
      `INSERT INTO reservation VALUES ('r-c','q-c','SKU-1',1,'committed',1000,2000,NULL)`,
    ),
    /CHECK constraint failed/,
  );
});

// ── ③ 级：UNIQUE ────────────────────────────────────────────────────────────

test('UNIQUE 让同一请求标识无法被插入两次（AC 1.4 的载体）', () => {
  assert.equal(
    attempt(db, `INSERT INTO reservation VALUES ('r-a','REQ','SKU-1',1,'held',1000,2000,NULL)`),
    null,
  );
  const err = attempt(
    db,
    `INSERT INTO reservation VALUES ('r-b','REQ','SKU-1',1,'held',1000,2000,NULL)`,
  );
  assert.match(err, /UNIQUE constraint failed: reservation.request_id/);
});

// ── ⑤ 级：TRIGGER ───────────────────────────────────────────────────────────

test('触发器拦住超量预占（AC 1.2 / 4.3⑥）', () => {
  const err = attempt(
    db,
    `INSERT INTO reservation VALUES ('r-big','q-big','SKU-1',999,'held',1000,9000,NULL)`,
  );
  assert.equal(err, 'INSUFFICIENT_STOCK');
});

test('触发器拦住终结态复活（AC 2.2 / 4.3⑤）', () => {
  db.prepare(
    `INSERT INTO reservation VALUES ('r-s','q-s','SKU-1',1,'held',1000,9000,NULL)`,
  ).run();
  db.prepare(`UPDATE reservation SET state='released', settled_at=1500 WHERE res_id='r-s'`).run();
  const err = attempt(db, `UPDATE reservation SET state='held' WHERE res_id='r-s'`);
  assert.equal(err, 'INVALID_STATE');
});

test('触发器拦住改动已创建预占的身份字段（AC 5.1）', () => {
  db.prepare(
    `INSERT INTO reservation VALUES ('r-i','q-i','SKU-1',3,'held',1000,9000,NULL)`,
  ).run();
  // 注意每一条都写成**真的不一样**的值。
  // 第一版这里写的是 `sku_id = 'SKU-1'`（与旧值相同），于是 `NEW <> OLD` 为假，
  // 触发器**正确地**没有触发 —— 失败的是测试，不是代码。
  // 「用一个没有真正违反约束的用例去测约束」是很容易发生的一类假失败。
  db.prepare(`INSERT INTO sku (sku_id) VALUES ('SKU-OTHER')`).run();
  for (const set of ['qty = 1', "sku_id = 'SKU-OTHER'", 'expires_at = 99999', 'created_at = 1']) {
    assert.equal(
      attempt(db, `UPDATE reservation SET ${set} WHERE res_id='r-i'`),
      'IMMUTABLE_FIELD',
      `改 ${set} 没有被拦住`,
    );
  }
});

test('触发器让兑现自动扣减在手量（AC 2.1 / 2.5）', () => {
  const before = db.prepare(`SELECT on_hand FROM sku WHERE sku_id='SKU-1'`).get().on_hand;
  db.prepare(
    `INSERT INTO reservation VALUES ('r-k','q-k','SKU-1',4,'held',1000,9000,NULL)`,
  ).run();
  // 只改状态，**完全不碰 sku 表** —— 出库必须由引擎完成
  db.prepare(`UPDATE reservation SET state='committed', settled_at=1200 WHERE res_id='r-k'`).run();
  const after = db.prepare(`SELECT on_hand FROM sku WHERE sku_id='SKU-1'`).get().on_hand;
  assert.equal(before - after, 4, '状态改了但库存没扣 —— 2.1 的两步没有同生共死');
});

test('触发器让入账自动落进在手量（AC 5.4）', () => {
  const before = db.prepare(`SELECT on_hand FROM sku WHERE sku_id='SKU-1'`).get().on_hand;
  db.prepare(`INSERT INTO receipt (sku_id, qty, at) VALUES ('SKU-1', 7, 1000)`).run();
  const after = db.prepare(`SELECT on_hand FROM sku WHERE sku_id='SKU-1'`).get().on_hand;
  assert.equal(after - before, 7);
});

test('触发器替调用方写留痕（AC 5.2）', () => {
  db.prepare(
    `INSERT INTO reservation VALUES ('r-evt','q-evt','SKU-1',1,'held',1000,9000,NULL)`,
  ).run();
  db.prepare(`UPDATE reservation SET state='released', settled_at=1600 WHERE res_id='r-evt'`).run();
  const rows = db
    .prepare(`SELECT from_state, to_state FROM reservation_event WHERE res_id='r-evt' ORDER BY event_id`)
    .all()
    // node:sqlite 返回的行对象**原型是 null**，而 assert.deepStrictEqual 会比较原型：
    // 两个字段完全相同、但一个是 null 原型的对象，会给出一个
    // 「看起来一模一样却报 deepStrictEqual 失败」的报错。摊平成普通对象。
    .map((r) => ({ from_state: r.from_state, to_state: r.to_state }));
  assert.deepEqual(rows, [
    { from_state: null, to_state: 'held' },
    { from_state: 'held', to_state: 'released' },
  ]);
});

// ── ④ 级：FOREIGN KEY，以及它为什么单独占一节 ───────────────────────────────

test('外键**在未启用时**拦不住幽灵 SKU —— 这不是期望行为，是被记录的代价（AC 4.3③）', () => {
  // 本文件顶部的连接是 foreignKeys: false，与 sqlite3 CLI / Python sqlite3 的默认值一致。
  // 这条测试存在的意义：把「schema 写了 REFERENCES 但没人执行它」变成**可见的事实**，
  // 而不是一个只写在文档里的提醒。详见 docs/adr/ADR-002。
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 0);

  const err = attempt(
    db,
    `INSERT INTO reservation VALUES ('r-ghost','q-ghost','GHOST',1,'held',1000,9000,NULL)`,
  );
  assert.equal(
    err,
    null,
    '幽灵行被拒绝了 —— 说明该连接启用了外键，本测试的前提不成立',
  );

  // 幽灵行真的在库里 —— 这正是「强制力取决于客户端」这句话的实证
  assert.equal(
    db.prepare(`SELECT count(*) AS n FROM reservation WHERE sku_id='GHOST'`).get().n,
    1,
  );
});

test('同一个库、同一条语句：启用外键的连接会拒绝它（AC 1.6 / 4.3③）', () => {
  const on = rawConnect(t.path, { foreignKeys: true });
  try {
    const err = attempt(
      on,
      `INSERT INTO reservation VALUES ('r-ghost2','q-ghost2','GHOST',1,'held',1000,9000,NULL)`,
    );
    assert.match(err, /FOREIGN KEY constraint failed/);
  } finally {
    // Windows 上未关闭的连接会让临时目录删不掉（EPERM），
    // 而那个报错会盖掉真正的断言失败 —— 所以用 finally。
    on.close();
  }
});

// ── 视图：把规格里的等式变成可以直接 SELECT 的事实 ─────────────────────────

test('守恒视图把「账是平的」变成可查询的事实（AC 4.1）', () => {
  assert.equal(conservationOf(db, 'SKU-1'), 0);
});

test('可用量视图排除了已过期但未收割的 held（AC 3.2）', () => {
  db.prepare(`UPDATE clock SET now = 1000 WHERE id = 1`).run();
  db.prepare(`INSERT INTO sku (sku_id) VALUES ('SKU-2')`).run();
  db.prepare(`INSERT INTO receipt (sku_id, qty, at) VALUES ('SKU-2', 5, 1000)`).run();
  db.prepare(
    `INSERT INTO reservation VALUES ('r-x','q-x','SKU-2',5,'held',1000,2000,NULL)`,
  ).run();

  const before = db.prepare(`SELECT available FROM v_available WHERE sku_id='SKU-2'`).get();
  assert.equal(before.available, 0, '预占生效期内，可用量应为 0');

  db.prepare(`UPDATE clock SET now = 2500 WHERE id = 1`).run();
  const after = db.prepare(`SELECT available FROM v_available WHERE sku_id='SKU-2'`).get();
  assert.equal(after.available, 5, '过期后可用量应恢复，即使还没收割');
});
