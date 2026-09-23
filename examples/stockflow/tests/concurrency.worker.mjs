// 并发争抢用的 worker。
// 每个 worker 一条**独立连接** —— 这是必要的：如果用同一条连接，
// 争抢就被 database/sql 那层排队消化掉了，测不到数据层的行为。
import { parentPort, workerData } from 'node:worker_threads';
import { connect } from '../src/db.mjs';
import * as store from '../src/store.mjs';

const { dbPath, skuId, index, barrier, at } = workerData;
const gate = new Int32Array(barrier);

const db = connect(dbPath); // 已存在的库 → 迁移是空操作，只有读

// 用屏障把 N 个 worker 对齐到同一瞬间，尽量制造真实的争抢。
// 少了这一步，第一个 worker 可能在最后一个启动前就跑完了，测试会「安静地通过」。
Atomics.add(gate, 0, 1);
Atomics.wait(gate, 1, 0); // 等主线程发令（gate[1] 从 0 变成 1）

let result;
try {
  const r = store.reserve(db, {
    resId: `r-w${index}`,
    requestId: `REQ-W${index}`,
    skuId,
    qty: 1,
    createdAt: at,
    expiresAt: at + 100000,
  });
  result = { ok: true, resId: r.reservation.res_id };
} catch (err) {
  result = { ok: false, code: err.code ?? 'ENGINE_ERROR', message: err.message };
}

parentPort.postMessage(result);
db.close();
