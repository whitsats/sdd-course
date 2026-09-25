/**
 * 契约测试的最小内存实现（harness）。
 *
 * 它是什么：一个**没有 HTTP 服务器、没有数据库**的 taskflow 应用 ——
 * 请求分发、成员资格、乐观并发、审计全部在内存里完成。
 * 但每一条规则判定都走 `src/domain/` 的领域函数，
 * 保证「规则只有一个真相源」：harness 自己不实现任何业务规则。
 *
 * 它不是什么：不是完整实现。routes / repositories / Postgres 不存在，
 * 映射表里指向完整实现的那些测试文件仍然没有对象 —— 见 README「边界」一节。
 *
 * ⚠️ 并发语义（task-concurrency.spec.ts 依赖这个约定）：
 * dispatch 前先让出一个微任务（模拟异步分发，让 Promise.all 真正交错），
 * 但「读 version → 校验 → 写入」是一段**同步临界区** ——
 * 对应真实实现里数据库行锁内的原子操作。没有这个约定，
 * 20 路并发会全部成功，乐观并发测试就失去了意义。
 *
 * ⚠️ 时钟是固定基准：updated_at 由 version 推导而不是取当前时间。
 * 同一操作在任何机器、任何时刻跑，观测到的字段字节级相同 ——
 * 这也是宪法「时间可注入」条款在测试侧的体现。
 */

import { checkTransition, isTaskStatus, type TaskStatus } from '../../src/domain/state-machine.ts';
import { canRemoveMember, decide, type Role } from '../../src/domain/permissions.ts';

/** null = 已认证但不是该项目成员；'anonymous' = 没有 Authorization 头（标准 1.6） */
export type Actor = Role | null | 'anonymous';

export type HarnessResponse = {
  status: number;
  body: Record<string, unknown>;
};

export type Task = {
  id: string;
  project_id: string;
  title: string;
  status: TaskStatus;
  version: number;
  created_at: string;
  updated_at: string;
};

export type AuditEntry = {
  action: string;
  actor: string;
  target: string;
  result: 'ok' | 'conflict' | 'denied';
  at: string;
};

export type Harness = {
  projectId: string;
  taskId: string;
  /** 把任务重置到指定状态（等价于重新建库；审计与评论一并清空） */
  seedTask(input: { status: TaskStatus; version: number }): void;
  request(
    method: 'POST' | 'GET' | 'PATCH',
    path: string,
    opts?: { as?: Actor; body?: Record<string, unknown> },
  ): Promise<HarnessResponse>;
  getTask(): Promise<Task>;
  getAuditEntries(query: { target: string }): Promise<AuditEntry[]>;
};

const CLOCK_BASE = Date.parse('2026-09-01T10:00:00.000Z');

export async function makeHarness(): Promise<Harness> {
  const projectId = 'proj-1';
  const taskId = 'task-1';
  const ownerId = 'user-owner-1';
  const memberId = 'user-member-1';
  const project = { id: projectId, name: '示例项目', owner_id: ownerId, members: [memberId] };

  const tasks: Task[] = [];
  const comments: Array<{ id: string; task_id: string; author: string; body: string }> = [];
  const audit: AuditEntry[] = [];
  let taskSeq = 0;
  let commentSeq = 0;

  const actorName = (as: Actor): string => {
    if (as === 'anonymous') return 'anonymous';
    if (as === null) return 'user-outsider-1';
    return as === 'owner' ? ownerId : memberId;
  };

  const entry = (as: Actor, target: string, result: AuditEntry['result']): AuditEntry => ({
    action: 'task.status_changed',
    actor: actorName(as),
    target,
    result,
    at: new Date(CLOCK_BASE).toISOString(),
  });

  const respond = (status: number, body: Record<string, unknown>): HarnessResponse => ({
    status,
    body,
  });

  function seedTask(input: { status: TaskStatus; version: number }): void {
    const fresh: Task = {
      id: taskId,
      project_id: projectId,
      title: '示例任务',
      status: input.status,
      version: input.version,
      created_at: new Date(CLOCK_BASE).toISOString(),
      updated_at: new Date(CLOCK_BASE + input.version * 1000).toISOString(),
    };
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx >= 0) tasks[idx] = fresh;
    else tasks.push(fresh);
    comments.length = 0;
    audit.length = 0;
  }

  // 初始状态：todo / version 1 —— 并发测试不 seedTask，直接依赖这个起点
  seedTask({ status: 'todo', version: 1 });

  // ⛔ 同步临界区从这里开始：读 version → 校验 → 写入之间不得插入 await。
  // 这段代码对应真实实现里「数据库行锁内的事务」，它的原子性是 3.6 的前提。
  function handle(
    method: 'POST' | 'GET' | 'PATCH',
    rawPath: string,
    as: Actor,
    body: Record<string, unknown> | undefined,
  ): HarnessResponse {
    // 标准 1.6：未认证一律 401，先于路由与成员资格判定
    if (as === 'anonymous') {
      return respond(401, { code: 'UNAUTHENTICATED' });
    }
    const role: Role | null = as;
    const segments = rawPath.split('?')[0].split('/').filter(Boolean);

    // POST /projects —— 标准 1.1 / 1.3
    if (method === 'POST' && rawPath === '/projects') {
      const d = decide(role, 'create_project');
      if (d.kind !== 'allow') return respond(403, { code: 'FORBIDDEN' });
      return respond(201, { id: projectId, name: '新项目', owner_id: actorName(as) });
    }

    // GET /projects/:pid —— 标准 1.2（非成员 → 404，不区分不存在与无权限）
    if (method === 'GET' && segments[0] === 'projects' && segments.length === 2) {
      if (role === null || segments[1] !== projectId) {
        return respond(404, { code: 'PROJECT_NOT_FOUND' });
      }
      return respond(200, { ...project });
    }

    // POST /projects/:pid/tasks —— 标准 2.1 / 2.4
    if (method === 'POST' && segments[0] === 'projects' && segments[2] === 'tasks' && segments.length === 3) {
      if (role === null || segments[1] !== projectId) {
        return respond(404, { code: 'PROJECT_NOT_FOUND' });
      }
      taskSeq += 1;
      const t: Task = {
        id: `task-${taskSeq}`,
        project_id: segments[1],
        title: typeof body?.title === 'string' ? body.title : '新任务',
        status: 'todo', // 标准 2.1：初始状态恒为 todo（2.2：请求体里的 status 被忽略）
        version: 1,
        created_at: new Date(CLOCK_BASE).toISOString(),
        updated_at: new Date(CLOCK_BASE).toISOString(),
      };
      tasks.push(t);
      return respond(201, { ...t });
    }

    // GET /projects/:pid/tasks —— 标准 2.6
    if (method === 'GET' && segments[0] === 'projects' && segments[2] === 'tasks' && segments.length === 3) {
      if (role === null || segments[1] !== projectId) {
        return respond(404, { code: 'PROJECT_NOT_FOUND' });
      }
      return respond(200, { items: tasks.filter((t) => t.project_id === segments[1]) });
    }

    // PATCH /tasks/:tid —— 标准 3.x 全族 + 3.9（非成员 404）
    if (method === 'PATCH' && segments[0] === 'tasks' && segments.length === 2) {
      const t = tasks.find((x) => x.id === segments[1]);
      if (role === null || !t) {
        audit.push(entry(as, segments[1], 'denied'));
        return respond(404, { code: 'TASK_NOT_FOUND' });
      }
      // 标准 3.7：version 必填
      const version = body?.version;
      if (typeof version !== 'number') {
        return respond(400, { code: 'VERSION_REQUIRED' });
      }
      // 标准 3.5：version 不匹配 → 409，current 带服务端完整当前状态
      if (version !== t.version) {
        audit.push(entry(as, t.id, 'conflict'));
        return respond(409, { code: 'CONFLICT', current: { ...t } });
      }
      const to = body?.status;
      if (to !== undefined) {
        if (typeof to !== 'string' || !isTaskStatus(to)) {
          return respond(422, { code: 'INVALID_TRANSITION', from: t.status, to });
        }
        const d = checkTransition(t.status, to, 'user');
        if (d.kind === 'invalid_transition') {
          audit.push(entry(as, t.id, 'denied'));
          return respond(422, { code: 'INVALID_TRANSITION', from: d.from, to: d.to });
        }
        if (d.kind === 'terminal_status') {
          audit.push(entry(as, t.id, 'denied'));
          return respond(422, { code: 'TERMINAL_STATUS' });
        }
        t.status = to;
      }
      t.version += 1;
      t.updated_at = new Date(CLOCK_BASE + t.version * 1000).toISOString();
      audit.push(entry(as, t.id, 'ok'));
      return respond(200, { ...t });
    }

    // POST /tasks/:tid/comments —— 标准 4.1 / 4.5
    if (method === 'POST' && segments[0] === 'tasks' && segments[2] === 'comments' && segments.length === 3) {
      if (role === null || !tasks.some((t) => t.id === segments[1])) {
        return respond(404, { code: 'TASK_NOT_FOUND' });
      }
      commentSeq += 1;
      const c = {
        id: `comment-${commentSeq}`,
        task_id: segments[1],
        author: actorName(as),
        body: typeof body?.body === 'string' ? body.body : '示例评论',
      };
      comments.push(c);
      return respond(201, { ...c });
    }

    // GET /tasks/:tid/comments —— 标准 4.4 / 4.5
    if (method === 'GET' && segments[0] === 'tasks' && segments[2] === 'comments' && segments.length === 3) {
      if (role === null || !tasks.some((t) => t.id === segments[1])) {
        return respond(404, { code: 'TASK_NOT_FOUND' });
      }
      return respond(200, { items: comments.filter((c) => c.task_id === segments[1]) });
    }

    // POST /projects/:pid/members —— 标准 6.2 / 6.3
    if (method === 'POST' && segments[0] === 'projects' && segments[2] === 'members' && segments.length === 3) {
      if (role === null || segments[1] !== projectId) {
        return respond(404, { code: 'PROJECT_NOT_FOUND' });
      }
      if (role !== 'owner') {
        return respond(403, { code: 'FORBIDDEN' }); // 标准 6.2：member 不能管理成员
      }
      const r = canRemoveMember([ownerId], String(body?.user_id ?? ''));
      if (!r.ok) return respond(422, { code: r.reason }); // 标准 6.3：最后一个 owner 不可移除
      return respond(200, { id: projectId, members: [memberId] });
    }

    // ⛔ 未定义路由不在规格内：不携带任何错误码。
    // 错误码必须能指回 spec §6（scripts/check-error-codes.py 会强制这一条）——
    // 实现不得发明 spec 里没有的错误码。这里曾有自造的 NOT_FOUND，被该门禁抓出后改正。
    return respond(404, {});
  }

  async function request(
    method: 'POST' | 'GET' | 'PATCH',
    path: string,
    opts: { as?: Actor; body?: Record<string, unknown> } = {},
  ): Promise<HarnessResponse> {
    // 让出微任务：Promise.all 的并发请求在这里真正交错。
    // 之后 handle() 一口气同步跑完 —— 并发的胜负由临界区的原子性决定。
    await Promise.resolve();
    const as = opts.as === undefined ? 'anonymous' : opts.as;
    return handle(method, path, as, opts.body);
  }

  return {
    projectId,
    taskId,
    seedTask,
    request,
    getTask: async (): Promise<Task> => {
      const t = tasks.find((x) => x.id === taskId);
      if (!t) throw new Error(`task ${taskId} 未初始化`);
      return { ...t };
    },
    getAuditEntries: async (query: { target: string }): Promise<AuditEntry[]> =>
      audit.filter((e) => e.target === query.target),
  };
}
