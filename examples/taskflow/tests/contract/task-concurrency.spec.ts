/**
 * 并发冲突契约测试。这是全项目最重要的一组测试。
 *
 * 规格依据：spec 标准 3.5 / 3.6 / 3.7 / 5.4
 * 对应决策：ADR-002（乐观并发控制）
 *
 * 为什么最重要：这是唯一一个「失败会静默丢失用户输入」的场景。
 * 其他端点的 bug 只影响体验，这个 bug 影响正确性。
 *
 * 运行：node --test tests/contract/task-concurrency.spec.ts（零依赖，node:test + 原生类型擦除）
 *
 * ⚠️ 本文件不含「故意失败」的漂移演练 —— 那一条单独住在
 *    drift-drill.spec.ts，且**不在任何门禁里**（它必须永远红）。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, type Harness } from '../fixtures/harness.ts';

let h: Harness;

beforeEach(async () => {
  h = await makeHarness();
});

describe('标准 3.5 · version 不匹配返回 409 + current', () => {
  it('携带过期 version → 409 CONFLICT 且响应含服务端当前状态', async () => {
    // 先让 version 前进一次
    await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member',
      body: { status: 'doing', version: 1 },
    });

    // 再用过期的 version: 1 写入
    const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member',
      body: { status: 'in_review', version: 1 },
    });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'CONFLICT');

    // current 必须包含服务端当前完整状态 —— 这是 3.5 的核心要求，
    // 没有它，客户端收到 409 后无法自行恢复，只能重新拉取（多一次往返）
    const current = res.body.current as Record<string, unknown>;
    assert.strictEqual(current.id, h.taskId);
    assert.strictEqual(current.status, 'doing'); // 先到者写入的结果
    assert.strictEqual(current.version, 2);
    assert.ok(current.title !== undefined);
    assert.ok(current.updated_at !== undefined);
  });

  it('过期 version 的写入不改变任何数据', async () => {
    await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member',
      body: { status: 'doing', version: 1 },
    });
    const before = await h.getTask();

    await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member',
      body: { status: 'in_review', version: 1 },
    });

    const after = await h.getTask();
    assert.deepStrictEqual(after, before); // 完全未变
  });
});

describe('标准 3.6 · 并发写入：先到者胜', () => {
  it('两个相同 version 的并发写入，恰好一个成功、一个 409', async () => {
    const [a, b] = await Promise.all([
      h.request('PATCH', `/tasks/${h.taskId}`, {
        as: 'member',
        body: { status: 'doing', version: 1 },
      }),
      h.request('PATCH', `/tasks/${h.taskId}`, {
        as: 'member',
        body: { status: 'in_review', version: 1 },
      }),
    ]);

    const ok = [a, b].filter((r) => r.status === 200);
    const conflict = [a, b].filter((r) => r.status === 409);

    assert.strictEqual(ok.length, 1);
    assert.strictEqual(conflict.length, 1);

    // 失败的一方拿到的 current 必须等于成功一方写入的状态
    const okBody = ok[0].body as Record<string, unknown>;
    const conflictBody = conflict[0].body as Record<string, unknown>;
    const conflictCurrent = conflictBody.current as Record<string, unknown>;
    assert.strictEqual(conflictCurrent.status, okBody.status);
    assert.strictEqual(conflictCurrent.version, 2);

    // 最终数据只有一次写入生效（version 只前进了 1）
    const final = await h.getTask();
    assert.strictEqual(final.version, 2);
  });

  it('20 次并发写入同一 version：恰好 1 次成功，19 次 409', async () => {
    const attempts = 20;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        h.request('PATCH', `/tasks/${h.taskId}`, {
          as: 'member',
          body: { status: 'doing', version: 1 },
        }),
      ),
    );

    assert.strictEqual(results.filter((r) => r.status === 200).length, 1);
    assert.strictEqual(results.filter((r) => r.status === 409).length, attempts - 1);

    const final = await h.getTask();
    assert.strictEqual(final.version, 2); // 而不是 21
  });
});

describe('标准 3.7 · version 必填', () => {
  it('缺少 version → 400 VERSION_REQUIRED', async () => {
    const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member',
      body: { status: 'doing' },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'VERSION_REQUIRED');
  });
});

describe('标准 5.4 · 冲突被拒仍记审计', () => {
  it('409 的尝试会写入审计条目，result 为 conflict', async () => {
    await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member',
      body: { status: 'doing', version: 1 },
    });
    await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member',
      body: { status: 'in_review', version: 1 },
    });

    const entries = await h.getAuditEntries({ target: h.taskId });
    const conflicts = entries.filter((e) => e.result === 'conflict');
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].action, 'task.status_changed');
    assert.strictEqual(conflicts[0].target, h.taskId);
    assert.strictEqual(conflicts[0].result, 'conflict');
  });
});
