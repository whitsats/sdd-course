/**
 * 权限矩阵契约测试 —— 2 角色 × 7 端点 = 14 格，全覆盖。
 *
 * 规格依据：spec 标准 1.2 / 1.3 / 2.4 / 3.9 / 4.5 / 6.2
 * 映射表：docs/验收标准-测试映射.md
 *
 * ⚠️ 为什么用表格驱动而不是手写 14 个 it：
 *    手写时漏掉一格**看不出来**；表格里少一行**一眼就能看出来**。
 *    这是「契约测试只测 happy path」最可靠的防线。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildMatrix, decide, type EndpointKey, type Role } from '../../src/domain/permissions';
import { makeHarness, type Harness } from '../fixtures/harness';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
});

type Case = {
  /** null 表示「不是该项目成员」 */
  role: Role | null;
  method: 'POST' | 'GET' | 'PATCH';
  path: string;
  /** 期望的 HTTP 状态码 */
  status: number;
  /** 期望的错误码；成功时为 undefined */
  code?: string;
  /** 对应 spec 标准编号 */
  std: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// 14 格 + 1 格「非成员」 + 1 格「未认证」 = 16 条
// 每一行都必须能指回 spec 的一条标准。指不回去的，就是多余测试。
// ─────────────────────────────────────────────────────────────────────────────
const MATRIX: Case[] = [
  // ── owner 的 7 格 ──────────────────────────────────────────────
  { role: 'owner',  method: 'POST',  path: '/projects',                        status: 201, std: '1.1' },
  { role: 'owner',  method: 'GET',   path: '/projects/:pid',                   status: 200, std: '1.2' },
  { role: 'owner',  method: 'POST',  path: '/projects/:pid/tasks',             status: 201, std: '2.1' },
  { role: 'owner',  method: 'GET',   path: '/projects/:pid/tasks',             status: 200, std: '2.6' },
  { role: 'owner',  method: 'PATCH', path: '/tasks/:tid',                      status: 200, std: '3.1' },
  { role: 'owner',  method: 'POST',  path: '/tasks/:tid/comments',             status: 201, std: '4.1' },
  { role: 'owner',  method: 'GET',   path: '/tasks/:tid/comments',             status: 200, std: '4.4' },

  // ── member 的 7 格 ────────────────────────────────────────────
  // 唯一的差异格：member 不能建项目（标准 1.3）
  { role: 'member', method: 'POST',  path: '/projects',                        status: 403, code: 'FORBIDDEN', std: '1.3' },
  { role: 'member', method: 'GET',   path: '/projects/:pid',                   status: 200, std: '1.2' },
  { role: 'member', method: 'POST',  path: '/projects/:pid/tasks',             status: 201, std: '2.1' },
  { role: 'member', method: 'GET',   path: '/projects/:pid/tasks',             status: 200, std: '2.6' },
  { role: 'member', method: 'PATCH', path: '/tasks/:tid',                      status: 200, std: '3.1' },
  { role: 'member', method: 'POST',  path: '/tasks/:tid/comments',             status: 201, std: '4.1' },
  { role: 'member', method: 'GET',   path: '/tasks/:tid/comments',             status: 200, std: '4.4' },

  // ── 非成员：除 create_project 外一律 404（标准 1.2 / 2.4 / 3.9 / 4.5）──
  { role: null,     method: 'GET',   path: '/projects/:pid',                   status: 404, code: 'PROJECT_NOT_FOUND', std: '1.2' },
  { role: null,     method: 'POST',  path: '/projects/:pid/tasks',             status: 404, code: 'PROJECT_NOT_FOUND', std: '2.4' },
  { role: null,     method: 'PATCH', path: '/tasks/:tid',                      status: 404, code: 'TASK_NOT_FOUND',    std: '3.9' },
  { role: null,     method: 'GET',   path: '/tasks/:tid/comments',             status: 404, code: 'TASK_NOT_FOUND',    std: '4.5' },
];

function resolve(path: string, h: Harness): string {
  return path.replace(':pid', h.projectId).replace(':tid', h.taskId);
}

describe('权限矩阵（2 角色 × 7 端点 = 14 格 + 非成员 4 格）', () => {
  it.each(MATRIX)(
    '[标准 $std] $role $method $path → $status',
    async ({ role, method, path, status, code }) => {
      const res = await h.request(method, resolve(path, h), { as: role, std: 1 });
      expect(res.status).toBe(status);
      if (code !== undefined) {
        expect(res.body.code).toBe(code);
      }
    },
  );

  it('覆盖了全部 14 格角色×端点组合', () => {
    // 元验证：矩阵测试本身是否完整
    const covered = new Set(
      MATRIX.filter((c) => c.role !== null).map((c) => `${c.role}:${c.path}`),
    );
    // 7 个端点，每个有 owner/member 两格
    expect(covered.size).toBe(14);
  });

  it('领域层矩阵与 spec 的角色能力一致', () => {
    // 领域层的判定应与 HTTP 层行为一致 —— 两处不一致就是双真相源
    const ownerCreate = decide('owner', 'create_project');
    const memberCreate = decide('member', 'create_project');
    expect(ownerCreate.kind).toBe('allow');
    expect(memberCreate.kind).toBe('deny_insufficient_role');
    expect(buildMatrix()).toHaveLength(21); // 3（含 null）× 7
  });
});

describe('标准 1.6 · 未认证', () => {
  it('无 Authorization 头 → 401 UNAUTHENTICATED（非 403）', async () => {
    const res = await h.request('GET', `/projects/${h.projectId}`, { as: 'anonymous' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('标准 6.3 · 最后一个 owner 不可移除', () => {
  it('移除唯一的 owner → 422 LAST_OWNER', async () => {
    const res = await h.request('POST', `/projects/${h.projectId}/members`, {
      as: 'owner',
      body: { action: 'remove', user_id: 'user-owner-1' },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('LAST_OWNER');
  });
});
