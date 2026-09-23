// ════════════════════════════════════════════════════════════════════════════
//  连接与迁移
//
//  这个文件只做一件事，但那件事是 ADR-002 的全部结论：
//  **建立连接之后，把「schema 看起来有约束」变成「这次连接确实会执行约束」。**
//
//  它存在的理由可以一句话说清：
//    schema 里写了 REFERENCES，不等于这次连接会检查它 ——
//    实测同一个库、同一条语句：Node 默认拒绝，Python 与命令行客户端默认放行。
// ════════════════════════════════════════════════════════════════════════════

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..');
export const MIGRATIONS_DIR = join(PROJECT_ROOT, 'migrations');

export class PragmaNotInEffect extends Error {}

/**
 * 断言引用完整性确实处于开启状态（AC 4.5）。
 *
 * 为什么是「设置 + 读回来」而不是「设置完就相信」——两个独立的理由：
 *  ① 写入 PRAGMA 本身可能失败，而不是没有生效。实测：
 *       db.exec('BEGIN');
 *       db.exec('PRAGMA foreign_keys = ON');   // 不抛错
 *       读回 → 0                                 // 但没生效
 *     **「写了但没生效」这个失败模式，与它要防的东西是同一个形态。**
 *  ② 未来某次重构可能把连接的创建挪进了事务里（例如为了让
 *     「迁移 + 首个业务语句」原子化）。那时这个断言会立刻炸，
 *     而不是让整库的外键**静默**消失。
 */
export function assertForeignKeys(db) {
  const row = db.prepare('PRAGMA foreign_keys').get();
  const on = row ? Object.values(row)[0] : undefined;
  if (Number(on) !== 1) {
    throw new PragmaNotInEffect(
      `引用完整性未启用（PRAGMA foreign_keys = ${on}）。` +
        '本次连接的所有 FOREIGN KEY 约束都不会生效 —— 这包括 AC 1.6、4.3③。' +
        '注意：在事务内设置该 PRAGMA 会被静默忽略，见 docs/adr/ADR-002。',
    );
  }
  return true;
}

/**
 * 打开一个连接：设置每连接的前提 → 应用迁移 → 返回。
 * @param {string} target 文件路径，或 ':memory:'
 */
export function connect(target = ':memory:') {
  if (target !== ':memory:') mkdirSync(dirname(target), { recursive: true });

  const db = new DatabaseSync(target);
  db.exec('PRAGMA busy_timeout = 5000');

  // ① 每连接的前提。必须在任何事务开始之前，且必须读回来验证。
  db.exec('PRAGMA foreign_keys = ON');
  assertForeignKeys(db);

  // ② 持久化级别的设置（与上一条不同，journal_mode 会写进库文件头）。
  //    这个对比值得记一笔：**同样是 PRAGMA，有的随库持久化，有的随连接生灭。**
  //    判断依据只能是查文档 / 实测一次，不能靠直觉。
  if (target !== ':memory:') db.exec('PRAGMA journal_mode = WAL');

  migrate(db);
  return db;
}

/**
 * 应用 migrations/*.sql（按文件名排序）。
 *
 * 用 `db.exec()` 而不是「按分号切分再逐条执行」：后者会在
 * `CREATE TRIGGER ... BEGIN ... END;` 上碎掉 —— 触发器体里本来就有分号。
 * 这是本仓库里第五个「看起来在工作、实际在碎」的地方（见 notes/L14 §5）。
 */
export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    version    TEXT    PRIMARY KEY,
    applied_at INTEGER NOT NULL
  ) STRICT`);

  const done = new Set(
    db.prepare('SELECT version FROM schema_migration').all().map((r) => r.version),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)')
        .run(file, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`迁移 ${file} 失败：${err.message}`);
    }
    applied.push(file);
  }
  return applied;
}

/** 当前每个连接的事务嵌套深度。用 WeakMap 而不是字段，避免污染连接对象。 */
const depth = new WeakMap();

/**
 * 所有事务的唯一入口 —— 保证「中途失败 ⇒ 全部回滚」（AC 4.4）。
 *
 * 可重入。这一点是**被迫**的，不是设计偏好：
 * store 的每个公开函数都自带事务（这样单独调用它们就已经满足 4.4），
 * 而一个真实的业务动作往往要组合几个这样的函数。
 * 如果本函数一进去就 `BEGIN`，那么第二次调用会直接报
 * `cannot start a transaction within a transaction` —— 于是所有人都会
 * 开始在 store 里加「我现在是不是已经在事务里了」的判断。
 * 那种判断会很快长成一张谁也不敢改的网。
 *
 * 用 SAVEPOINT 做嵌套：内层失败只回退到自己的保存点，
 * 内层失败但被调用方接住时，**外层可以继续**；外层失败则整体回滚。
 *
 * IMMEDIATE：在事务开始时立刻取写锁，而不是等第一次写入。
 * 在多写入者竞争下，这能把「写时才发现锁冲突」提前到「开事务时」，
 * 于是 busy_timeout 从那一刻开始计时，行为可预期。
 */
export function tx(db, fn) {
  const level = (depth.get(db) ?? 0) + 1;
  depth.set(db, level);
  const savepoint = `sp_${level}`;

  if (level === 1) db.exec('BEGIN IMMEDIATE');
  else db.exec(`SAVEPOINT ${savepoint}`);

  try {
    const result = fn();
    if (level === 1) db.exec('COMMIT');
    else db.exec(`RELEASE ${savepoint}`);
    return result;
  } catch (err) {
    try {
      if (level === 1) db.exec('ROLLBACK');
      else db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    } catch {
      // 回滚本身失败（例如连接已断）不应掩盖原始错误。
    }
    throw err;
  } finally {
    depth.set(db, level - 1);
  }
}

// ── 时刻（AC 3.5）────────────────────────────────────────────────────────────
// 系统时钟只在**边界**被读一次，写进 clock 表；之后全库读那一行。

export const readNow = (db) => db.prepare('SELECT now FROM clock WHERE id = 1').get().now;

export function setNow(db, t) {
  if (!Number.isInteger(t)) throw new TypeError(`时刻必须是整数（秒），收到 ${t}`);
  db.prepare('UPDATE clock SET now = ? WHERE id = 1').run(t);
  return t;
}
