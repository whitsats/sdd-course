#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  人工演示入口
//
//  它存在的两个理由：
//   ① 让你能**用命令行看**规格是怎么被执行的 ——
//      尤其是「同一件事，经由应用 vs 不经过应用」的对照（见 notes/L14 §3）。
//   ② 让「时刻」这件事在交互里可见：`--at=100` 可以把整库的时间钉在 100，
//      于是过期、收割、可兑现性都变成可以复现的实验，而不是需要等待的现象。
// ════════════════════════════════════════════════════════════════════════════

import { connect, setNow, readNow, PROJECT_ROOT } from './db.mjs';
import * as store from './store.mjs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const args = argv.filter((a) => !a.startsWith('--'));
const [cmd, ...rest] = args;

const dbPath = flags.db === true || flags.db === undefined
  ? join(PROJECT_ROOT, 'var', 'stockflow.db')
  : flags.db;

const db = connect(dbPath);

// ── 时刻（AC 3.5）：系统时钟只在这里读一次，之后全库读 clock 表 ──────────────
const wall = Math.floor(Date.now() / 1000);
if (flags.at !== undefined) {
  setNow(db, Number(flags.at));
} else if (cmd !== 'now' && cmd !== 'bump') {
  setNow(db, wall);
}

const out = (label, value) =>
  console.log(`${label.padEnd(14, ' ')} ${typeof value === 'string' ? value : JSON.stringify(value)}`);

const run = {
  'add-sku': () => out('sku', store.createSku(db, rest[0])),

  receive: () => out('receipt#', store.receive(db, { skuId: rest[0], qty: Number(rest[1]), at: readNow(db) })),

  reserve: () => {
    const t = readNow(db);
    const ttl = Number(flags.ttl ?? 3600);
    // --res= 让调用方指定标识。门禁与测试需要它：
    // 随机标识会让「按 id 直写一条脏数据」的负向用例在 id 写错时
    // 静默变成「匹配 0 行」，从而把「什么都没发生」误判成「写入成功」。
    const r = store.reserve(db, {
      resId: flags.res ?? `r-${Math.random().toString(36).slice(2, 10)}`,
      requestId: flags.req ?? `req-${Math.random().toString(36).slice(2, 10)}`,
      skuId: rest[0],
      qty: Number(rest[1]),
      createdAt: t,
      expiresAt: t + ttl,
    });
    out(r.replayed ? '重放（1.4）' : '已预占', { res_id: r.reservation.res_id, state: r.reservation.state, qty: r.reservation.qty });
  },

  commit: () => {
    const r = store.commit(db, rest[0], readNow(db));
    out(r.replayed ? '重放（2.3）' : '已兑现', { state: r.reservation.state, settled_at: r.reservation.settled_at });
  },

  release: () => {
    const r = store.release(db, rest[0], readNow(db));
    out(r.replayed ? '重放' : '已释放', r.reservation.state);
  },

  reap: () => out('收割条数', store.reap(db, readNow(db))),

  events: () => console.table(store.events(db, rest[0])),

  // 给脚本用的机器可读输出（门禁与测试都读它，避免去解析表格）
  available: () => {
    const a = store.available(db, rest[0]);
    console.log(a ? a.available : '');
  },

  state: () => console.log(store.reservation(db, rest[0])?.state ?? ''),

  res: () => console.log(store.reservation(db, rest[0])?.res_id ?? ''),

  show: () => {
    console.table(store.allAvailable(db));
    const rows = store.conservation(db);
    const bad = rows.filter((r) => r.delta !== 0);
    out('守恒（4.1）', bad.length === 0 ? `✅ ${rows.length} 个 SKU 全部平账` : `❌ ${bad.length} 个 SKU 不平`);
    out('时刻（3.5）', readNow(db));
  },

  now: () => {
    if (rest[0] !== undefined) setNow(db, Number(rest[0]));
    out('时刻', readNow(db));
  },

  bump: () => {
    setNow(db, readNow(db) + Number(rest[0] ?? 0));
    out('时刻', readNow(db));
  },

  patrol: () => {
    const sql = 'SELECT * FROM (' + patrolUnion() + ')';
    const rows = db.prepare(sql).all();
    if (rows.length === 0) {
      out('巡检', '✅ 0 行 —— 没有发现约束之外的写入');
    } else {
      console.table(rows);
      out('巡检', `❌ ${rows.length} 行违规`);
      process.exitCode = 1;
    }
  },
};

function patrolUnion() {
  return [
    // 外面套一层：SQLite 不允许在 WHERE 里引用同一层的列别名。
    `SELECT * FROM (SELECT 'CONSERVATION' AS rule, sku_id, on_hand, on_hand + COALESCE((SELECT SUM(qty) FROM reservation WHERE sku_id = sku.sku_id AND state='committed'),0) - COALESCE((SELECT SUM(qty) FROM receipt WHERE sku_id = sku.sku_id),0) AS delta FROM sku) WHERE delta <> 0`,
    `SELECT 'OVERSELL', s.sku_id, s.on_hand, 0 FROM sku s WHERE s.on_hand - COALESCE((SELECT SUM(r.qty) FROM reservation r WHERE r.sku_id=s.sku_id AND r.state='held' AND r.expires_at > (SELECT now FROM clock)),0) < 0`,
    `SELECT 'NO_EVENT', r.res_id, r.qty, 0 FROM reservation r WHERE NOT EXISTS (SELECT 1 FROM reservation_event e WHERE e.res_id = r.res_id)`,
    `SELECT 'STATE_SETTLED', res_id, qty, 0 FROM reservation WHERE (state='held') <> (settled_at IS NULL)`,
  ].join(' UNION ALL ');
}

if (!cmd || !run[cmd]) {
  console.error(`用法：node src/cli.mjs <命令> [参数] [--db=路径] [--at=时刻]

  add-sku <skuId>              建一个 SKU
  receive <skuId> <qty>        入账（AC 5.4）
  reserve <skuId> <qty>        预占   [--ttl=秒] [--req=请求标识] [--res=预占标识]
  commit  <resId>              兑现（AC 2.1）
  release <resId>              释放（AC 2.4）
  reap                         收割已过期预占（AC 3.3）
  events  <resId>              流转留痕（AC 5.2）
  available <skuId>            只输出可用量数字（给脚本用）
  state   <resId>              只输出状态（给脚本用）
  show                         可用量 + 守恒总览
  patrol                       巡检（schema 强制不了的规则）
  now [t] / bump <dt>          读写 / 推进时刻（AC 3.5）

当前库：${dbPath}`);
  process.exitCode = cmd ? 1 : 0;
} else {
  try {
    run[cmd]();
  } catch (err) {
    // 规格违规以稳定错误码的形式出现在 stderr（AC 5.3）
    console.error(`${err.code ?? 'ERROR'}${err.raw ? `\n  ${err.raw}` : ''}`);
    process.exitCode = 1;
  }
}
