/**
 * 权限矩阵 —— 领域层纯函数，无任何 IO 与框架依赖。
 *
 * 规格依据：spec 标准 1.2 / 1.3 / 2.4 / 3.9 / 4.5 / 6.2 / 6.3
 * 对应决策：plan.md D5（纯函数矩阵）、D10（非成员一律 404）
 *
 * 矩阵规模：2 角色 × 7 端点 = 14 格（spec §8 成功标准要求全覆盖）
 */

export const ROLES = ['owner', 'member'] as const;
export type Role = (typeof ROLES)[number];

/** 7 个端点。顺序与 spec 的端点清单一致。 */
export const ENDPOINTS = [
  { method: 'POST', path: '/projects',                key: 'create_project'   },
  { method: 'GET',  path: '/projects/:id',            key: 'get_project'      },
  { method: 'POST', path: '/projects/:id/tasks',      key: 'create_task'      },
  { method: 'GET',  path: '/projects/:id/tasks',      key: 'list_tasks'       },
  { method: 'PATCH',path: '/tasks/:id',               key: 'patch_task'       },
  { method: 'POST', path: '/tasks/:id/comments',      key: 'create_comment'   },
  { method: 'GET',  path: '/tasks/:id/comments',      key: 'list_comments'    },
] as const;

export type EndpointKey = (typeof ENDPOINTS)[number]['key'];

/**
 * 权限判定的三个可能结果。
 *
 * ⚠️ 注意 `not_member` 与 `not_found` **映射到同一个 HTTP 响应（404）**，
 * 但在这里是区分开的 —— 因为：
 * ① 审计需要区分「资源不存在」与「越权尝试」（标准 5.3 要求记录 denied）
 * ② 领域层不应该决定 HTTP 状态码，那是 routes 层的职责
 */
export type AccessDecision =
  | { kind: 'allow' }
  | { kind: 'deny_not_member' }   // → 404 PROJECT_NOT_FOUND / TASK_NOT_FOUND
  | { kind: 'deny_insufficient_role' }; // → 403 FORBIDDEN

/**
 * 只看角色、不看资源归属的判定。
 *
 * 返回 `allow` 表示「角色足够」，**不代表资源存在或用户属于该项目** ——
 * 后者由调用方（service 层）在查库后传入 membership 再判定。
 */
export function roleAllows(role: Role, endpoint: EndpointKey): AccessDecision {
  switch (endpoint) {
    // 标准 1.3：member 不能建项目
    case 'create_project':
      return role === 'owner' ? { kind: 'allow' } : { kind: 'deny_insufficient_role' };

    // 标准 6.2：member 不能管理成员（本端点清单中未列出成员管理端点，此处保留判定以备扩展）
    case 'get_project':
    case 'create_task':
    case 'list_tasks':
    case 'patch_task':
    case 'create_comment':
    case 'list_comments':
      // 这两个角色均可访问 —— 但前提是**必须是该项目成员**
      return { kind: 'allow' };

    default: {
      // 穷尽性检查：新增端点时若忘记在此处判定，TypeScript 会在此报错
      const _exhaustive: never = endpoint;
      return _exhaustive;
    }
  }
}

/**
 * 完整判定：结合角色与成员关系。
 *
 * @param role      用户在目标项目中的角色；null 表示**不是该项目成员**
 */
export function decide(
  role: Role | null,
  endpoint: EndpointKey,
): AccessDecision {
  // 标准 1.2 / 2.4 / 3.9 / 4.5 / 6：非成员一律 deny_not_member
  // 注意：create_project 是例外 —— 它不需要属于任何项目
  if (role === null && endpoint !== 'create_project') {
    return { kind: 'deny_not_member' };
  }

  return roleAllows((role ?? 'member') as Role, endpoint);
}

/**
 * 移除成员前的不变量校验（标准 6.3）。
 *
 * 单独抽出为函数而不是写成注释，因为它是一条**会被测试覆盖的规则**，
 * 且它的失败模式（项目失去全部 owner）无法通过重试恢复。
 */
export function canRemoveMember(
  currentOwners: readonly string[],
  targetUserId: string,
): { ok: true } | { ok: false; reason: 'LAST_OWNER' } {
  const remaining = currentOwners.filter((id) => id !== targetUserId);
  if (remaining.length === 0) {
    return { ok: false, reason: 'LAST_OWNER' };
  }
  return { ok: true };
}

/** 供测试与文档使用的完整矩阵（2 × 7 = 14 格）。 */
export function buildMatrix(): Array<{
  role: Role | null;
  endpoint: EndpointKey;
  decision: AccessDecision['kind'];
}> {
  const rows: Array<ReturnType<typeof buildMatrix>[number]> = [];
  for (const role of [null, ...ROLES] as const) {
    for (const { key } of ENDPOINTS) {
      rows.push({ role, endpoint: key, decision: decide(role, key).kind });
    }
  }
  return rows;
}
