-- ════════════════════════════════════════════════════════════════════════════
--  巡检查询（patrol）
--
--  这些查询检查的是**schema 强制不了的那些规则** —— 见 docs/adr/ADR-004。
--
--  用法：
--    sqlite3 var/stockflow.db < queries/patrol.sql
--  或在 Node 里：node src/cli.mjs patrol
--
--  约定：**每一条查询都必须返回 0 行**。
--  任何一行输出都表示「有人在约束之外写了数据」——
--  这时不要去责怪写入方，先问「为什么这条规则没能变成约束」。
--
--  ⚠️ patrol 与触发器的根本区别：
--     触发器让违规**不可能发生**；patrol 让违规**可见**。
--     两者都需要，但不是同一种东西，不要在报告里把它们混成「都做了检查」。
-- ════════════════════════════════════════════════════════════════════════════

-- ① AC 4.1 库存守恒：在手量必须能被「入账 − 已兑现」重新推导出来。
--
--    这条**无法**做成约束：规则 5.4 要求「不得存在直接修改在手量的路径」，
--    而触发器无法分辨一个 UPDATE 是谁发起的（SQLite 没有 pg_trigger_depth() 这种机制）。
--    因此它只能是巡检。这是本案例最诚实的一条边界。
SELECT
  'CONSERVATION' AS rule,
  sku_id,
  on_hand,
  on_hand + COALESCE((SELECT SUM(qty) FROM reservation
                        WHERE sku_id = sku.sku_id AND state = 'committed'), 0)
          - COALESCE((SELECT SUM(qty) FROM receipt WHERE sku_id = sku.sku_id), 0) AS delta
FROM sku
WHERE on_hand + COALESCE((SELECT SUM(qty) FROM reservation
                           WHERE sku_id = sku.sku_id AND state = 'committed'), 0)
               - COALESCE((SELECT SUM(qty) FROM receipt WHERE sku_id = sku.sku_id), 0) <> 0

UNION ALL

-- ② AC 4.3⑥ 的巡检版本：生效中预占量不得超过在手量。
--    触发器已经拦住了**经由** reservation 表的写入；这条查的是
--    「on_hand 被外部改小之后」留下的存量不一致 —— 那是触发器管不到的时间点。
SELECT
  'OVERSELL' AS rule,
  s.sku_id,
  s.on_hand,
  s.on_hand - COALESCE((SELECT SUM(r.qty) FROM reservation r
                         WHERE r.sku_id = s.sku_id
                           AND r.state = 'held'
                           AND r.expires_at > (SELECT now FROM clock)), 0) AS delta
FROM sku s
WHERE s.on_hand - COALESCE((SELECT SUM(r.qty) FROM reservation r
                             WHERE r.sku_id = s.sku_id
                               AND r.state = 'held'
                               AND r.expires_at > (SELECT now FROM clock)), 0) < 0

UNION ALL

-- ③ AC 5.2 留痕完整性：每一条预占都应该至少有一条创建事件。
--    这条**理论上**可以由触发器保证（事实上也是），保留在 patrol 里是为了
--    在「有人用 sqlite3 CLI 加上 PRAGMA recursive_triggers 之类的方式动过库」时能发现。
SELECT
  'NO_EVENT' AS rule,
  r.res_id AS sku_id,
  r.qty AS on_hand,
  0 AS delta
FROM reservation r
WHERE NOT EXISTS (SELECT 1 FROM reservation_event e WHERE e.res_id = r.res_id)

UNION ALL

-- ④ AC 2.1 的顺带检查：状态与终结时刻必须一致。
--    schema 里已有 CHECK 保证，这里保留一条同义查询作为**对照** ——
--    如果它有一天真的返回了行，说明有人重建过表且漏掉了那个 CHECK。
SELECT
  'STATE_SETTLED' AS rule,
  res_id AS sku_id,
  qty AS on_hand,
  0 AS delta
FROM reservation
WHERE (state = 'held') <> (settled_at IS NULL);
