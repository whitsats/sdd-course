/**
 * 游标分页 —— 领域层纯函数，无任何 IO 与框架依赖。
 *
 * 规格依据：spec 标准 2.6 / 2.7 / 2.8 / 2.9 / 4.4
 * 对应决策：plan.md D8（cursor 而非 offset）、D9（超限截断）、§4.3（游标编码格式）
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const PAGINATION_ERRORS = {
  INVALID_PAGINATION: 'INVALID_PAGINATION',
} as const;

export type PageParams =
  | { kind: 'ok'; size: number; truncated: boolean; cursor: Cursor | null }
  | { kind: 'invalid'; code: 'INVALID_PAGINATION'; detail: string };

/**
 * 游标内容。
 *
 * ⚠️ 标准 2.9 要求「created_at 降序，created_at 相同时 id 降序」。
 * 游标必须**同时携带两个排序键**，否则在 created_at 并列时翻页会漏数据或重复。
 * 这就是为什么游标不是「一个自增序号」—— 那种设计在并列值上必然出错。
 */
export type Cursor = {
  createdAt: string; // ISO 8601
  id: string;
};

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const sep = decoded.lastIndexOf('|');
    if (sep <= 0) return null;
    const createdAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!createdAt || !id) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * 解析并规范化分页参数。
 *
 * 三条规格要求的落地：
 * - 标准 2.6：未指定时默认 20
 * - 标准 2.7：> 100 时**截断为 100（不报错）**，并以 `truncated` 标记
 * - 标准 2.8：≤ 0 或非整数时返回 400 INVALID_PAGINATION
 */
export function resolvePageParams(input: {
  size?: unknown;
  cursor?: unknown;
}): PageParams {
  let size = DEFAULT_PAGE_SIZE;
  let truncated = false;

  if (input.size !== undefined && input.size !== null && input.size !== '') {
    const raw = typeof input.size === 'string' ? input.size.trim() : input.size;
    const parsed = typeof raw === 'number' ? raw : Number(raw);

    // 标准 2.8：非整数或非数字
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      return { kind: 'invalid', code: 'INVALID_PAGINATION', detail: 'size 必须是整数' };
    }
    // 标准 2.8：≤ 0
    if (parsed <= 0) {
      return { kind: 'invalid', code: 'INVALID_PAGINATION', detail: 'size 必须大于 0' };
    }
    // 标准 2.7：> 100 → 截断，不报错
    if (parsed > MAX_PAGE_SIZE) {
      size = MAX_PAGE_SIZE;
      truncated = true;
    } else {
      size = parsed;
    }
  }

  let cursor: Cursor | null = null;
  if (input.cursor !== undefined && input.cursor !== null && input.cursor !== '') {
    cursor = decodeCursor(String(input.cursor));
    if (cursor === null) {
      return { kind: 'invalid', code: 'INVALID_PAGINATION', detail: 'cursor 格式非法' };
    }
  }

  return { kind: 'ok', size, truncated, cursor };
}

/**
 * 从一页结果推导下一页游标。
 *
 * @param rows 已按「created_at DESC, id DESC」排序的当前页（最多取 `size` 条）
 * @param size 本页请求的有效条数
 */
export function nextCursorFrom<T extends { createdAt: string; id: string }>(
  rows: readonly T[],
  size: number,
): string | null {
  // 标准 2.6：无更多数据时 next_cursor 为 null
  if (rows.length < size) return null;
  const last = rows[rows.length - 1];
  if (!last) return null;
  return encodeCursor({ createdAt: last.createdAt, id: last.id });
}
