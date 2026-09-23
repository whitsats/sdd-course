/**
 * 状态机契约测试。
 *
 * 规格依据：spec §3（状态机）与标准 3.1 / 3.2 / 3.3 / 3.4
 * 对应决策：plan D4（显式流转表）
 *
 * 结构：合法流转「穷举表」+ 非法流转「穷举表」。两张表都必须与 spec §3 逐行对应。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, type Harness } from '../fixtures/harness';
import { checkTransition, allowedTransitionsFrom, TASK_STATUSES } from '../../src/domain/state-machine';

let h: Harness;

beforeEach(async () => {
  h = await makeHarness();
});

// ─────────────────────────────────────────────────────────────────────────────
// 合法流转（标准 3.1）—— 表必须与 spec §3「合法流转（穷举）」表逐行一致
// ─────────────────────────────────────────────────────────────────────────────
const VALID_TRANSITIONS = [
  { from: 'todo',      to: 'doing',     std: '3.1' },
  { from: 'doing',     to: 'in_review', std: '3.1' },
  { from: 'in_review', to: 'doing',     std: '3.1' },   // 驳回
  { from: 'in_review', to: 'done',      std: '3.1' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 非法流转（标准 3.2）—— 包括「跳过中间状态」和所有终态后回退
// ─────────────────────────────────────────────────────────────────────────────
const INVALID_TRANSITIONS = [
  { from: 'todo',      to: 'in_review', std: '3.2' },   // 跳过 doing
  { from: 'todo',      to: 'done',      std: '3.2' },   // 跳过两步
  { from: 'doing',     to: 'done',      std: '3.2' },   // 跳过 in_review
  { from: 'doing',     to: 'todo',      std: '3.2' },   // 回退
  { from: 'in_review', to: 'todo',      std: '3.2' },   // 回退
] as const;

// 标准 3.3：done 之后不可回退
const DONE_ROLLBACKS = [
  { from: 'done', to: 'todo',      std: '3.3' },
  { from: 'done', to: 'doing',     std: '3.3' },
  { from: 'done', to: 'in_review', std: '3.3' },
] as const;

describe('标准 3.1 · 合法流转', () => {
  it.each(VALID_TRANSITIONS)(
    '[标准 $std] $from → $to 成功且 version 递增',
    async ({ from, to }) => {
      await h.seedTask({ status: from, version: 1 });

      const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
        as: 'member', body: { status: to, version: 1 },
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(to);
      expect(res.body.version).toBe(2);   // 标准 3.1：递增 1
    },
  );
});

describe('标准 3.2 · 非法流转返回 422 INVALID_TRANSITION', () => {
  it.each(INVALID_TRANSITIONS)(
    '[标准 $std] $from → $to 被拒绝，响应含 from/to',
    async ({ from, to }) => {
      await h.seedTask({ status: from, version: 1 });

      const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
        as: 'member', body: { status: to, version: 1 },
      });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      expect(res.body.from).toBe(from);
      expect(res.body.to).toBe(to);
    },
  );
});

describe('标准 3.3 · done 是用户操作的终态', () => {
  it.each(DONE_ROLLBACKS)(
    '[标准 $std] done → $to 返回 422 TERMINAL_STATUS',
    async ({ from, to }) => {
      await h.seedTask({ status: from, version: 5 });

      const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
        as: 'member', body: { status: to, version: 5 },
      });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('TERMINAL_STATUS');
    },
  );

  it('done 不能由用户直接改为 archived（归档是后台任务的行为）', async () => {
    await h.seedTask({ status: 'done', version: 5 });
    const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
      as: 'member', body: { status: 'archived', version: 5 },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });
});

describe('标准 3.4 · archived 是绝对终态', () => {
  it.each(TASK_STATUSES.filter((s) => s !== 'archived'))(
    'archived → %s 返回 422 TERMINAL_STATUS',
    async (to) => {
      await h.seedTask({ status: 'archived', version: 9 });
      const res = await h.request('PATCH', `/tasks/${h.taskId}`, {
        as: 'member', body: { status: to, version: 9 },
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('TERMINAL_STATUS');
    },
  );
});

describe('领域层：状态机表与 spec §3 的一致性', () => {
  it('合法流转表与 spec 完全一致（不多不少）', () => {
    const fromSpec = VALID_TRANSITIONS.map((t) => `${t.from}->${t.to}`).sort();
    const fromDomain = TASK_STATUSES.flatMap((from) =>
      allowedTransitionsFrom(from, 'user').map((to) => `${from}->${to}`),
    ).sort();
    expect(fromDomain).toEqual(fromSpec);
  });

  it('5 个状态与 spec §3 和 SQL CHECK 约束一致', () => {
    expect([...TASK_STATUSES].sort()).toEqual(
      ['archived', 'doing', 'done', 'in_review', 'todo'].sort(),
    );
  });

  it('archived 没有任何合法出边（终态）', () => {
    expect(allowedTransitionsFrom('archived')).toHaveLength(0);
  });

  it('checkTransition 对用户与系统的判定不同（archived 只可由系统写入）', () => {
    expect(checkTransition('done', 'archived', 'user').kind).toBe('invalid_transition');
    expect(checkTransition('done', 'archived', 'system').kind).toBe('ok');
    expect(checkTransition('archived', 'todo', 'system').kind).toBe('terminal_status');
  });
});
