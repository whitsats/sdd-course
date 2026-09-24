/**
 * ⛔ 漂移演练（drift drill）—— 这条测试**故意写错**，它必须失败。
 *
 * 规格依据：L07 验收 ②「存在至少一条故意写成会失败的测试，用来证明测试真的能抓到偏离」。
 *
 * 它回答的问题只有一个：**这套契约测试的绿，是真的绿吗？**
 * 如果把「断言 409」错写成「断言 200」测试依然全绿，说明测试机制本身失效了 ——
 * 一个不会红的门禁不是门禁，是仪式。
 *
 * 怎么用（预期输出：1 fail）：
 *
 *     node --test tests/contract/drift-drill.spec.ts
 *
 * ⚠️ 因此它**不进任何门禁**：run-all-gates.sh 的 ⑤ 只点名跑 auth-matrix /
 *    task-state / task-concurrency 三个文件。一条永远红的 CI 门禁会被团队关掉，
 *    然后连真正的违规一起失去（AP-18 的完整死法，见 L09 §3）。
 *    真正的门禁式元验证是「注入违规 → 看门禁变红 → 撤销」，见各案例 notes。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness } from './fixtures/harness.ts';

describe('元验证 · 确认测试确实会抓到偏离', () => {
  it('[故意失败] 断言冲突会返回 200 —— 此测试必须 FAILED', async () => {
    const h = await makeHarness();
    await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member',
      body: { status: 'doing', version: 1 },
    });
    const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member',
      body: { status: 'in_review', version: 1 },
    });
    // ↓ 故意写错：实际是 409。若这里是绿的，说明测试机制失效了
    assert.strictEqual(res.status, 200);
  });
});
