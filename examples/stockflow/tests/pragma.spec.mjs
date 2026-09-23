// ════════════════════════════════════════════════════════════════════════════
//  pragma.spec.mjs —— AC 4.5：连接前提
//
//  这一组测试守护的是 ADR-002 的结论：
//  外键的强制力**不在 schema 里**，它在每一次连接的前提里。
//  前提错了不会报错，它只会安静地不生效 —— 所以这里逐条把它钉住。
// ════════════════════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { connect, assertForeignKeys, PragmaNotInEffect } from '../src/db.mjs';
import * as store from '../src/store.mjs';
import { tempDir, rawConnect, attempt } from './helpers.mjs';

test('AC 4.5 经由 db.connect() 建立的连接一定启用了引用完整性', () => {
  const t = tempDir();
  const db = connect(t.path);
  try {
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    db.close();
    t.cleanup();
  }
});

test('AC 4.5 未启用时断言会抛错 —— 而不是安静地继续', () => {
  const t = tempDir();
  const db = new DatabaseSync(t.path, { enableForeignKeyConstraints: false });
  try {
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 0);
    assert.throws(() => assertForeignKeys(db), PragmaNotInEffect);
  } finally {
    db.close();
    t.cleanup();
  }
});

test('探针：在事务内设置 `PRAGMA foreign_keys` 会被**静默忽略**', () => {
  // 这条不是「期望行为」，是把一个**真实且反直觉的引擎行为**固定成测试。
  // 我们依赖了这个行为（所以把设置写在了任何事务开始之前），
  // 于是它必须有一条测试来守护 —— 否则将来 SQLite 改了它，
  // 我们会以「某个谁也想不到的原因」的方式发现。
  //
  // 这也是本课程里反复出现的同一个形态的第四次：
  // **代码在，但什么都没发生，而且不报错。**
  const t = tempDir();
  const db = new DatabaseSync(t.path, { enableForeignKeyConstraints: false });
  try {
    db.exec('BEGIN');
    db.exec('PRAGMA foreign_keys = ON');
    assert.equal(
      db.prepare('PRAGMA foreign_keys').get().foreign_keys,
      0,
      '在事务内生效了 —— 说明引擎行为变了，db.mjs 里的顺序假设需要重新审视',
    );
    db.exec('COMMIT');
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 0, '提交后也不该生效');

    db.exec('PRAGMA foreign_keys = ON'); // 事务外
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    db.close();
    t.cleanup();
  }
});

test('该 PRAGMA 是**每连接**的：一个连接关掉它，不影响另一个连接', () => {
  const t = tempDir();
  const off = rawConnect(t.path, { foreignKeys: false });
  const on = rawConnect(t.path, { foreignKeys: true });
  try {
    assert.equal(off.prepare('PRAGMA foreign_keys').get().foreign_keys, 0);
    assert.equal(on.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);

    const sql = `INSERT INTO reservation VALUES (?,?,?,1,'held',1000,9000,NULL)`;
    assert.equal(
      attempt(off, sql, 'r-off', 'q-off', 'GHOST'),
      null,
      '外键关掉的连接应当能写进去',
    );
    assert.match(
      attempt(on, sql, 'r-on', 'q-on', 'GHOST'),
      /FOREIGN KEY constraint failed/,
      '外键开着的连接应当拒绝',
    );
  } finally {
    off.close();
    on.close();
    t.cleanup();
  }
});

test('AC 4.5 断言的时机无关：在事务里调用断言仍能正确报告状态', () => {
  // 读 PRAGMA 与写 PRAGMA 不同：读**不受事务影响**。
  // 这条测试的意义是固定住「断言可以放在任何地方」这个性质，
  // 这样将来有人把它挪进一个事务里时，它依然是有意义的检查。
  const t = tempDir();
  const db = connect(t.path);
  try {
    db.exec('BEGIN');
    assert.equal(assertForeignKeys(db), true);
    db.exec('ROLLBACK');
  } finally {
    db.close();
    t.cleanup();
  }
});

test('AC 4.5 的实践后果：换一个默认关闭外键的客户端，同一份 schema 会放行脏数据', () => {
  // 这条测试与 schema.spec.mjs 里那条同源，放在这里是为了把它和
  // 「我们的连接永远启用」这一保证摆在一起看 —— 两者的对比才是完整的结论。
  const t = tempDir();
  const app = connect(t.path);
  try {
    store.createSku(app, 'SKU-1');
    assert.throws(
      () => store.reserve(app, {
        resId: 'r1', requestId: 'q1', skuId: 'GHOST',
        qty: 1, createdAt: 1000, expiresAt: 9000,
      }),
      (e) => e.code === 'UNKNOWN_SKU',
    );
  } finally {
    app.close();
    t.cleanup();
  }
});
