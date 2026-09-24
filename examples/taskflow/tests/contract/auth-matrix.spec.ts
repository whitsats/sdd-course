/**
 * 权限矩阵契约测试 —— 2 角色 × 7 端点 = 14 格，全覆盖。
 *
 * 规格依据：spec 标准 1.2 / 1.3 / 2.4 / 3.9 / 4.5 / 6.2
 * 映射表：docs/验收标准-测试映射.md
 *
 * ⚠️ 为什么用表格驱动而不是手写 14 个 it：
 *    手写时漏掉一格**看不出来**；表格里少一行**一眼就能看出来**。
 *    这是「契约测试只测 happy path」最可靠的防线。
 *
 * 运行：node --test tests/contract/auth-matrix.spec.ts（零依赖，node:test + 原生类型擦除）
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatrix, decide } from '../../src/domain/permissions.ts';
import { makeHarness, type Actor, type Harness } from '../fixtures/harness.ts';

let h: Harness;

beforeEach(async () => {
  // 每一格都在干净状态上判定 —— 权限格之间不得有顺序依赖，
  // 否则矩阵测的不是「角色 × 端点」，而是「角色 × 端点 × 执行顺序」。
  h = await makeHarness();
});

type Case = {
  /** null 表示「不是该项目成员」 */
  role: Actor;
  method: 'POST' | 'GET' | 'PATCH';
  path: string;
  /** 期望的 HTTP 状态码 */
  status: number;
  /** 期望的错误码；成功时为 undefined */
  code?: string;
  /** PATCH 的请求体（矩阵只关心权限判定，body 取一条合法流转） */
  body?: Record<string, unknown>;
  /** 对应 spec 标准编号 */
  std: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// 14 格 + 4 格「非成员」 = 18 行；另有「未认证」单列一节（标准 1.6）。
// 每一行都必须能指回 spec 的一条标准。指不回去的，就是多余测试。
// ─────────────────────────────────────────────────────────────────────────────
const MATRIX: Case[] = [
  // ── owner 的 7 格 ──────────────────────────────────────────────
  { role: 'owner', method: 'POST', path: '/projects', status: 201, std: '1.1' },
  { role: 'owner', method: 'GET', path: '/projects/:pid', status: 200, std: '1.2' },
  { role: 'owner', method: 'POST', path: '/projects/:pid/tasks', status: 201, std: '2.1' },
  { role: 'owner', method: 'GET', path: '/projects/:pid/tasks', status: 200, std: '2.6' },
  { role: 'owner', method: 'PATCH', path: '/tasks/:tid', status: 200, body: { status: 'doing', version: 1 }, std: '3.1' },
  { role: 'owner', method: 'POST', path: '/tasks/:tid/comments', status: 201, std: '4.1' },
  { role: 'owner', method: 'GET', path: '/tasks/:tid/comments', status: 200, std: '4.4' },

  // ── member 的 7 格 ────────────────────────────────────────────
  // 唯一的差异格：member 不能建项目（标准 1.3）
  { role: 'member', method: 'POST', path: '/projects', status: 403, code: 'FORBIDDEN', std: '1.3' },
  { role: 'member', method: 'GET', path: '/projects/:pid', status: 200, std: '1.2' },
  { role: 'member', method: 'POST', path: '/projects/:pid/tasks', status: 201, std: '2.1' },
  { role: 'member', method: 'GET', path: '/projects/:pid/tasks', status: 200, std: '2.6' },
  { role: 'member', method: 'PATCH', path: '/tasks/:tid', status: 200, body: { status: 'doing', version: 1 }, std: '3.1' },
  { role: 'member', method: 'POST', path: '/tasks/:tid/comments', status: 201, std: '4.1' },
  { role: 'member', method: 'GET', path: '/tasks/:tid/comments', status: 200, std: '4.4' },

  // ── 非成员：除 create_project 外一律 404（标准 1.2 / 2.4 / 3.9 / 4.5）──
  { role: null, method: 'GET', path: '/projects/:pid', status: 404, code: 'PROJECT_NOT_FOUND', std: '1.2' },
  { role: null, method: 'POST', path: '/projects/:pid/tasks', status: 404, code: 'PROJECT_NOT_FOUND', std: '2.4' },
  { role: null, method: 'PATCH', path: '/tasks/:tid', status: 404, code: 'TASK_NOT_FOUND', std: '3.9' },
  { role: null, method: 'GET', path: '/tasks/:tid/comments', status: 404, code: 'TASK_NOT_FOUND', std: '4.5' },
];

function resolve(path: string, h: Harness): string {
  return path.replace(':pid', h.projectId).replace(':tid', h.taskId);
}

describe('权限矩阵（2 角色 × 7 端点 = 14 格 + 非成员 4 格）', () => {
  for (const c of MATRIX) {
    it(`[标准 ${c.std}] ${c.role ?? '非成员'} ${c.method} ${c.path} → ${c.status}`, async () => {
      const res = await h.request(c.method, resolve(c.path, h), { as: c.role, body: c.body });
      assert.strictEqual(res.status, c.status);
      if (c.code !== undefined) {
        assert.strictEqual(res.body.code, c.code);
      }
    });
  }

  it('覆盖了全部 14 格角色×端点组合', () => {
    // 元验证：矩阵测试本身是否完整。
    // ⚠️ 键必须含 method：POST /projects/:pid/tasks 与 GET /projects/:pid/tasks
    //    是两格，path 相同。只按 path 去重会得出 10（实测踩过 —— 这条元验证
    //    在测试跑不起来的年代从没被执行过，一可执行就抓住了它自己）。
    const covered = new Set(
      MATRIX.filter((c) => c.role !== null).map((c) => `${c.role}:${c.method} ${c.path}`),
    );
    // 7 个端点，每个有 owner/member 两格
    assert.strictEqual(covered.size, 14);
  });

  it('领域层矩阵与 spec 的角色能力一致', () => {
    // 领域层的判定应与 HTTP 层行为一致 —— 两处不一致就是双真相源
    assert.strictEqual(decide('owner', 'create_project').kind, 'allow');
    assert.strictEqual(decide('member', 'create_project').kind, 'deny_insufficient_role');
    assert.strictEqual(buildMatrix().length, 21); // 3（含 null）× 7
  });
});

describe('标准 1.6 · 未认证', () => {
  it('无 Authorization 头 → 401 UNAUTHENTICATED（非 403）', async () => {
    const res = await h.request('GET', `/projects/${h.projectId}`, { as: 'anonymous' });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'UNAUTHENTICATED');
  });
});

describe('标准 6.3 · 最后一个 owner 不可移除', () => {
  it('移除唯一的 owner → 422 LAST_OWNER', async () => {
    const res = await h.request('POST', `/projects/${h.projectId}/members`, {
      as: 'owner',
      body: { action: 'remove', user_id: 'user-owner-1' },
    });
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.code, 'LAST_OWNER');
  });
});
