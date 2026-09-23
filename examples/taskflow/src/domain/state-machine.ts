/**
 * 任务状态机 —— 领域层纯函数，无任何 IO 与框架依赖。
 *
 * 规格依据：specs/001-taskflow-mvp/spec.md §3（状态机）与标准 3.2 / 3.3 / 3.4
 * 对应决策：plan.md D4（用显式流转表而非 if-else）
 *
 * ⚠️ 本文件不得 import fastify / pg / repositories / services。
 *    该约束由 CI 的分层边界检查强制（见 .github/workflows/sdd-gate.yml）。
 */

/** 全部合法状态。与 spec §3 和 migrations/001_init.sql 的 CHECK 约束三处一致。 */
export const TASK_STATUSES = ['todo', 'doing', 'in_review', 'done', 'archived'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ERROR_CODES = {
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  TERMINAL_STATUS: 'TERMINAL_STATUS',
} as const;

export type TransitionResult =
  | { kind: 'ok' }
  | { kind: 'invalid_transition'; from: TaskStatus; to: TaskStatus }
  | { kind: 'terminal_status'; from: TaskStatus; to: TaskStatus };

/**
 * 合法流转表 —— 穷举。
 *
 * 用显式表而非 if-else 的理由（plan D4）：
 * ① 标准 3.2 要求「合法转移穷举」，表本身就是那份穷举清单，可以直接与 spec §3 逐行对照
 * ② 新增状态时，TypeScript 的 Record<TaskStatus, ...> 会强制你补全所有键，漏一个就编译不过
 * ③ if-else 的隐式分支无法被机械检查「是否覆盖了全部组合」
 */
const ALLOWED: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['doing'],
  doing: ['in_review'],
  in_review: ['doing', 'done'], // doing = 驳回
  done: ['archived'],           // 不可回退；archived 由后台任务写入
  archived: [],                 // 终态
};

/** 终态集合。`done` 允许被后台任务推进到 archived，但不允许用户操作回退。 */
const TERMINAL_FOR_USER: readonly TaskStatus[] = ['done', 'archived'];

/** 仅后台任务可执行的目标状态。用户请求不得直接写入。 */
export const SYSTEM_ONLY_TARGETS: readonly TaskStatus[] = ['archived'];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * 判断一次状态转移是否合法。
 *
 * @param from 当前状态
 * @param to   目标状态
 * @param actor 'user' = 用户请求；'system' = 后台任务（归档）
 */
export function checkTransition(
  from: TaskStatus,
  to: TaskStatus,
  actor: 'user' | 'system' = 'user',
): TransitionResult {
  // 标准 3.4：archived 是终态，任何修改（含系统）都拒绝
  if (from === 'archived') {
    return { kind: 'terminal_status', from, to };
  }

  // 用户请求不得直接写入系统专用状态（archived）
  if (actor === 'user' && SYSTEM_ONLY_TARGETS.includes(to)) {
    return { kind: 'invalid_transition', from, to };
  }

  // 标准 3.3：done 之后用户不可回退
  if (actor === 'user' && TERMINAL_FOR_USER.includes(from)) {
    return { kind: 'terminal_status', from, to };
  }

  if (!ALLOWED[from].includes(to)) {
    return { kind: 'invalid_transition', from, to };
  }

  return { kind: 'ok' };
}

/**
 * 计算「用户在当前状态下可以推进到哪些状态」。
 *
 * 用途：供 API 在 GET /projects/:id/tasks 的响应中返回 `allowed_transitions`，
 * 让客户端不必重复实现状态机（避免两处真相源）。
 */
export function allowedTransitionsFrom(
  from: TaskStatus,
  actor: 'user' | 'system' = 'user',
): readonly TaskStatus[] {
  return ALLOWED[from].filter(
    (to) => checkTransition(from, to, actor).kind === 'ok',
  );
}
