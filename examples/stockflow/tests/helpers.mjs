// ════════════════════════════════════════════════════════════════════════════
//  测试辅助
//
//  这里最要紧的一件事：`rawConnect()` **不经过 src/db.mjs**。
//  它直接读 migrations/*.sql 建库，然后交出一个连接。
//
//  为什么必须这样：
//    schema.spec.mjs 要证明的是「**schema 自己能守住不变量**」。
//    如果那个测试先调用 `connect()`（它会 PRAGMA + 断言 + 迁移），
//    那么当它通过时，你无法区分到底是 schema 守住了，还是我们的连接代码守住了。
//    「因为我们的代码小心，所以测试通过了」是一种**无法被证伪**的结论 ——
//    而无法被证伪的结论不构成证据。
// ════════════════════════════════════════════════════════════════════════════

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from '../src/db.mjs';

export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'stockflow-test-'));
  return {
    dir,
    path: join(dir, 'test.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));
}

/**
 * 用 .sql 文件直接建库，不加载 src/ 的连接逻辑。
 * @param {string} path 库文件路径
 * @param {{foreignKeys?: boolean}} opts 是否启用引用完整性（默认**否**，与多数客户端一致）
 */
export function rawConnect(path, { foreignKeys = false } = {}) {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: foreignKeys });
  // 同一个库被多个连接复用是常态（这正是本案例要讨论的事）——
  // 已经有 schema 时不要再建一次。
  const fresh = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n === 0;
  if (fresh) for (const { sql } of migrationFiles()) db.exec(sql);
  return db;
}

/** 记录一次「应当被拒绝」的尝试，返回引擎给出的报错文本（未拒绝则返回 null）。 */
export function attempt(db, sql, ...params) {
  try {
    db.prepare(sql).run(...params);
    return null;
  } catch (err) {
    return err.message;
  }
}

/** 建一个 SKU 并给它入账，返回当前时刻。 */
export function seed(db, skuId, qty, at = 1000) {
  db.prepare('UPDATE clock SET now = ? WHERE id = 1').run(at);
  db.prepare('INSERT INTO sku (sku_id) VALUES (?)').run(skuId);
  db.prepare('INSERT INTO receipt (sku_id, qty, at) VALUES (?, ?, ?)').run(skuId, qty, at);
  return at;
}

export const conservationOf = (db, skuId) =>
  db.prepare('SELECT delta FROM v_conservation WHERE sku_id = ?').get(skuId)?.delta;
