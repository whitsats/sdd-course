-- ════════════════════════════════════════════════════════════════════════════
--  stockflow · 001_init
--  对应规格：specs/001-stockflow-mvp/spec.md（26 条验收标准）
--
--  这个文件是**实现的主体**，不是「数据访问层的一部分」。
--  规格里那些「不能发生的事」，绝大多数不住在 src/ 里 —— 住在这里。
--
--  阅读顺序建议：先看每个 CHECK 后面的 AC 编号，再看 §2 的触发器。
--  如果你发现某条规格在这里找不到落点，去 docs/adr/ADR-004 看它为什么不在这里。
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- §0  关于本文件里「看不到」的两件事
--
--  ① 这里没有 `PRAGMA foreign_keys = ON`。
--     写了也没用 —— 该 PRAGMA 是**每连接**的，不随 schema 持久化。
--     它由 src/db.mjs 在建立连接时设置，并**读回来断言**。
--     详见 docs/adr/ADR-002。
--
--  ② 这里没有「禁止直接修改 sku.on_hand」的约束。
--     触发器无法分辨「这个 UPDATE 是谁发起的」，所以这条规则**在 SQLite 里
--     无法用 schema 表达**。它被降级为一条巡检规则：queries/patrol.sql。
--     详见 docs/adr/ADR-004。
-- ────────────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────────────
-- §1  表
--
--  全部使用 STRICT。理由（AC 5.1）：SQLite 默认是**动态类型**——
--  一个声明为 INTEGER 的列会欣然接受字符串 'abc'。
--  没有 STRICT 的话，「数量是整数」这条标准其实**没有被任何东西保证**。
-- ────────────────────────────────────────────────────────────────────────────

-- 库存单位。注意 on_hand 是**派生值**（AC 5.4）：它的每一次变化都源于
-- 一条入账流水（+）或一次兑现（−），两者都由触发器写入，不由调用方写入。
CREATE TABLE sku (
  sku_id   TEXT    PRIMARY KEY,
  on_hand  INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0)   -- AC 4.3①
) STRICT;

-- 入库入账流水（AC 5.4）：只增不改，是不可篡改的账本。
-- 「设置初始库存」也走这里 —— 没有任何路径可以绕过账本直接设定在手量。
CREATE TABLE receipt (
  receipt_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id      TEXT    NOT NULL REFERENCES sku(sku_id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  at          INTEGER NOT NULL
) STRICT;

-- 预占（AC 1.1 / 1.4 / 1.5 / 1.6 / 3.1）
CREATE TABLE reservation (
  res_id      TEXT    PRIMARY KEY,
  request_id  TEXT    NOT NULL,
  sku_id      TEXT    NOT NULL REFERENCES sku(sku_id),        -- AC 1.6 ⚠ 依赖 FK 已启用
  qty         INTEGER NOT NULL CHECK (qty > 0),               -- AC 1.5
  state       TEXT    NOT NULL CHECK (state IN ('held','committed','released')),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL CHECK (expires_at > created_at), -- AC 3.1
  settled_at  INTEGER,

  -- AC 2.2 / 5.1：held 必须没有终结时刻；终结态必须有。
  -- 这条把「状态」与「终结时刻」两列绑成一致的一对 —— 单靠两列各自的
  -- CHECK 做不到，因为要表达的是**它们之间的关系**。
  CHECK ((state = 'held') = (settled_at IS NULL)),

  -- AC 1.4 幂等的**载体**。见 docs/adr/ADR-001 规则 2：
  -- 之所以必须是 UNIQUE 而不是触发器里的「先 SELECT 再判断」，
  -- 是因为后者存在竞态窗口，而唯一约束由引擎原子保证。
  UNIQUE (request_id)
) STRICT;

-- 只增不改的状态流转留痕（AC 5.2）
CREATE TABLE reservation_event (
  event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  res_id      TEXT    NOT NULL REFERENCES reservation(res_id),
  from_state  TEXT,                        -- NULL = 创建
  to_state    TEXT    NOT NULL CHECK (to_state IN ('held','committed','released')),
  at          INTEGER NOT NULL
) STRICT;

-- 全库唯一的时刻来源（AC 3.5）。单行表，见 docs/adr/ADR-003。
CREATE TABLE clock (
  id   INTEGER PRIMARY KEY CHECK (id = 1),   -- 只允许一行
  now  INTEGER NOT NULL
) STRICT;

INSERT INTO clock (id, now) VALUES (1, 0);


-- ────────────────────────────────────────────────────────────────────────────
-- §2  索引
-- ────────────────────────────────────────────────────────────────────────────

-- 可用量的聚合查询（以及触发器里的同一段条件）都走这个索引
CREATE INDEX idx_reservation_active ON reservation (sku_id, state, expires_at);
CREATE INDEX idx_reservation_request ON reservation (request_id);
CREATE INDEX idx_receipt_sku ON receipt (sku_id);


-- ────────────────────────────────────────────────────────────────────────────
-- §3  触发器 —— 只在 CHECK 表达不了的时候使用
--
--  判据（docs/adr/ADR-001 规则 1）：能用 CHECK 表达的绝不用触发器，
--  因为 CHECK 的报错指向**列**（可直接对应规格编号），
--  触发器的报错只指向**触发器名**。
--  下面的触发器存在的唯一理由是：条件里含**聚合**，而 CHECK 禁止子查询。
-- ────────────────────────────────────────────────────────────────────────────

-- AC 1.2 / 4.3⑥：不允许超卖。
--   可用的判定是聚合：on_hand − Σ(生效中 held) − 本次要占的 qty ≥ 0
--   「生效中」= state='held' 且未过期（AC 3.2）。时刻取自 clock 表，
--   保证同一条语句内只读一次「现在」（docs/adr/ADR-003）。
CREATE TRIGGER trg_reservation_no_oversell
BEFORE INSERT ON reservation
WHEN NEW.state = 'held' AND (
  SELECT s.on_hand
       - COALESCE((SELECT SUM(r.qty) FROM reservation r
                    WHERE r.sku_id = NEW.sku_id
                      AND r.state = 'held'
                      AND r.expires_at > (SELECT now FROM clock)), 0)
       - NEW.qty
    FROM sku s
   WHERE s.sku_id = NEW.sku_id
) < 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;

-- AC 2.2 / 4.3⑤：终结态不得复活；流转只允许 held → committed / released。
--   把这条放在 BEGIN 里而不是代码里，意味着**任何** UPDATE 都受它约束。
CREATE TRIGGER trg_reservation_transition_guard
BEFORE UPDATE OF state ON reservation
WHEN NOT (OLD.state = 'held' AND NEW.state IN ('committed','released'))
BEGIN
  SELECT RAISE(ABORT, 'INVALID_STATE');
END;

-- AC 2.1：兑现即出库。两件事必须同生共死 —— 由调用方的事务包起来，
--   而出库这一半由触发器完成，因此**不存在**「把状态改成 committed 但没扣库存」的路径。
--   扣成负数会被 sku.on_hand 的 CHECK 拦住（AC 4.3①）。
CREATE TRIGGER trg_commit_takes_stock
AFTER UPDATE OF state ON reservation
WHEN NEW.state = 'committed'
BEGIN
  UPDATE sku SET on_hand = on_hand - NEW.qty WHERE sku_id = NEW.sku_id;
END;

-- AC 2.6：已过期的 held 不得被兑现。
--   这条标准来自规格 §6 的待澄清第 2 条 —— 「过期算不算可兑现」在原文里是个空白，
--   这里选择了「拒绝」并写进了规格（AC 2.6），理由是：
--   3.2 已经把过期的 held 排除在可用量之外，若还允许它兑现，
--   同一批库存就会被**卖出两次**（一次被新预占占用，一次被这条过期预占兑现）。
--   允许兑现的代价是把不一致推给 on_hand 的非负 CHECK 去兜底，
--   错误码也会从 INVALID 退化成一句「CHECK constraint failed」。
CREATE TRIGGER trg_commit_requires_not_expired
BEFORE UPDATE OF state ON reservation
WHEN OLD.state = 'held'
 AND NEW.state = 'committed'
 AND OLD.expires_at <= (SELECT now FROM clock)
BEGIN
  SELECT RAISE(ABORT, 'EXPIRED');
END;

-- AC 5.4：入账即增加在手量。同样不存在「记了账但没加库存」的路径。
CREATE TRIGGER trg_receipt_applies_to_stock
AFTER INSERT ON receipt
BEGIN
  UPDATE sku SET on_hand = on_hand + NEW.qty WHERE sku_id = NEW.sku_id;
END;

-- AC 5.1：预占的身份字段一经创建不可更改。
--   没有这条的话，一条已兑现的预占可以被改成 qty=0 来「抹掉」守恒等式里的差额。
CREATE TRIGGER trg_reservation_identity_immutable
BEFORE UPDATE ON reservation
WHEN NEW.res_id    <> OLD.res_id
  OR NEW.sku_id    <> OLD.sku_id
  OR NEW.request_id <> OLD.request_id
  OR NEW.qty       <> OLD.qty
  OR NEW.created_at <> OLD.created_at
  OR NEW.expires_at <> OLD.expires_at
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_FIELD');
END;

-- AC 5.2：留痕由引擎写，不由调用方写。
--   调用方「有义务记得写日志」这种设计，会在第一个忘记的分支上失效。
CREATE TRIGGER trg_event_on_create
AFTER INSERT ON reservation
BEGIN
  INSERT INTO reservation_event (res_id, from_state, to_state, at)
  VALUES (NEW.res_id, NULL, NEW.state, NEW.created_at);
END;

CREATE TRIGGER trg_event_on_transition
AFTER UPDATE OF state ON reservation
BEGIN
  INSERT INTO reservation_event (res_id, from_state, to_state, at)
  VALUES (NEW.res_id, OLD.state, NEW.state,
          COALESCE(NEW.settled_at, (SELECT now FROM clock)));
END;


-- ────────────────────────────────────────────────────────────────────────────
-- §4  查询视图 —— 把「规格里的等式」变成可以直接 SELECT 的事实
-- ────────────────────────────────────────────────────────────────────────────

-- AC 1.2 / 3.2：可用量。**这是唯一的判定口径**，
-- 触发器里的条件与对外的查询读的是同一段逻辑。
-- 注意这里的 (SELECT now FROM clock)：与触发器里的那一处取的是同一个时刻。
CREATE VIEW v_available AS
SELECT
  s.sku_id,
  s.on_hand,
  COALESCE((SELECT SUM(r.qty) FROM reservation r
             WHERE r.sku_id = s.sku_id
               AND r.state = 'held'
               AND r.expires_at > (SELECT now FROM clock)), 0) AS held_active,
  s.on_hand
  - COALESCE((SELECT SUM(r.qty) FROM reservation r
               WHERE r.sku_id = s.sku_id
                 AND r.state = 'held'
                 AND r.expires_at > (SELECT now FROM clock)), 0) AS available
FROM sku s;

-- AC 4.1：库存守恒。**这一行必须恒等于 0**，对任意操作序列成立。
-- 它把「相信代码是对的」换成了一条可以直接查询的等式。
CREATE VIEW v_conservation AS
SELECT
  s.sku_id,
  s.on_hand
  + COALESCE((SELECT SUM(r.qty) FROM reservation r
               WHERE r.sku_id = s.sku_id AND r.state = 'committed'), 0)
  - COALESCE((SELECT SUM(c.qty) FROM receipt c WHERE c.sku_id = s.sku_id), 0)
    AS delta
FROM sku s;
