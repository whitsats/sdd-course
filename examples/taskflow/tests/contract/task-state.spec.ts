/**
 * 状态机契约测试。
 *
 * 规格依据：spec §3（状态机）与标准 3.1 / 3.2 / 3.3 / 3.4
 * 对应决策：plan D4（显式流转表）
 *
 * 结构：合法流转「穷举表」+ 非法流转「穷举表」。两张表都必须与 spec §3 逐行对应。
 *
 * 运行：node --test tests/contract/task-state.spec.ts（零依赖，node:test + 原生类型擦除）
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, type Harness } from '../fixtures/harness.ts';
import {
  allowedTransitionsFrom,
  checkTransition,
  TASK_STATUSES,
} from '../../src/domain/state-machine.ts';

let h: Harness;

beforeEach(async () => {
  h = await makeHarness();
});

// ─────────────────────────────────────────────────────────────────────────────
// 合法流转（标准 3.1）—— 表必须与 spec §3「合法流转（穷举）」表逐行一致
// ─────────────────────────────────────────────────────────────────────────────
const VALID_TRANSITIONS = [
  { from: 'todo', to: 'doing', std: '3.1' },
  { from: 'doing', to: 'in_review', std: '3.1' },
  { from: 'in_review', to: 'doing', std: '3.1' }, // 驳回
  { from: 'in_review', to: 'done', std: '3.1' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 非法流转（标准 3.2）—— 包括「跳过中间状态」和所有回退
// ─────────────────────────────────────────────────────────────────────────────
const INVALID_TRANSITIONS = [
  { from: 'todo', to: 'in_review', std: '3.2' }, // 跳过 doing
  { from: 'todo', to: 'done', std: '3.2' }, // 跳过两步
  { from: 'doing', to: 'done', std: '3.2' }, // 跳过 in_review
  { from: 'doing', to: 'todo', std: '3.2' }, // 回退
  { from: 'in_review', to: 'todo', std: '3.2' }, // 回退
] as const;

// 标准 3.3：done 之后用户不可回退
const DONE_ROLLBACKS = [
  { from: 'done', to: 'todo', std: '3.3' },
  { from: 'done', to: 'doing', std: '3.3' },
  { from: 'done', to: 'in_review', std: '3.3' },
] as const;

describe('标准 3.1 · 合法流转', () => {
  for (const t of VALID_TRANSITIONS) {
    it(`[标准 ${t.std}] ${t.from} → ${t.to} 成功且 version 递增`, async () => {
      h.seedTask({ status: t.from, version: 1 });

      const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
        as: 'member',
        body: { status: t.to, version: 1 },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, t.to);
      assert.strictEqual(res.body.version, 2); // 标准 3.1：递增 1
    });
  }
});

describe('标准 3.2 · 非法流转返回 422 INVALID_TRANSITION', () => {
  for (const t of INVALID_TRANSITIONS) {
    it(`[标准 ${t.std}] ${t.from} → ${t.to} 被拒绝，响应含 from/to`, async () => {
      h.seedTask({ status: t.from, version: 1 });

      const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
        as: 'member',
        body: { status: t.to, version: 1 },
      });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.code, 'INVALID_TRANSITION');
      assert.strictEqual(res.body.from, t.from);
      assert.strictEqual(res.body.to, t.to);
    });
  }
});

describe('标准 3.3 · done 是用户操作的终态', () => {
  for (const t of DONE_ROLLBACKS) {
    it(`[标准 ${t.std}] done → ${t.to} 返回 422 TERMINAL_STATUS`, async () => {
      h.seedTask({ status: t.from, version: 5 });

      const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
        as: 'member',
        body: { status: t.to, version: 5 },
      });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.code, 'TERMINAL_STATUS');
    });
  }

  it('done 不能由用户直接改为 archived（归档是后台任务的行为）', async () => {
    h.seedTask({ status: 'done', version: 5 });
    const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member',
      body: { status: 'archived', version: 5 },
    });
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.code, 'INVALID_TRANSITION');
  });
});

describe('标准 3.4 · archived 是绝对终态', () => {
  for (const to of TASK_STATUSES.filter((s) => s !== 'archived')) {
    it(`archived → ${to} 返回 422 TERMINAL_STATUS`, async () => {
      h.seedTask({ status: 'archived', version: 9 });
      const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
        as: 'member',
        body: { status: to, version: 9 },
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.code, 'TERMINAL_STATUS');
    });
  }
});

describe('领域层：状态机表与 spec §3 的一致性', () => {
  it('合法流转表与 spec 完全一致（不多不少）', () => {
    const fromSpec = VALID_TRANSITIONS.map((t) => `${t.from}->${t.to}`).sort();
    const fromDomain = TASK_STATUSES.flatMap((from) =>
      allowedTransitionsFrom(from, 'user').map((to) => `${from}->${to}`),
    ).sort();
    assert.deepStrictEqual(fromDomain, fromSpec);
  });

  it('5 个状态与 spec §3 和 SQL CHECK 约束一致', () => {
    assert.deepStrictEqual(
      [...TASK_STATUSES].sort(),
      ['archived', 'doing', 'done', 'in_review', 'todo'].sort(),
    );
  });

  it('archived 没有任何合法出边（终态）', () => {
    assert.strictEqual(allowedTransitionsFrom('archived').length, 0);
  });

  it('checkTransition 对用户与系统的判定不同（archived 只可由系统写入）', () => {
    assert.strictEqual(checkTransition('done', 'archived', 'user').kind, 'invalid_transition');
    assert.strictEqual(checkTransition('done', 'archived', 'system').kind, 'ok');
    assert.strictEqual(checkTransition('archived', 'todo', 'system').kind, 'terminal_status');
  });
});
