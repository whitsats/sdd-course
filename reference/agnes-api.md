# Agnes API 速查（2026-09 实测）

> ⚠️ **本文件只记录已验证的事实。** 每条都注明「怎么验证的」。
> 未验证的东西一律不写 —— 尤其是猜出来的端点。

**实测日期**：2026-09-22
**实测环境**：Windows / Git Bash、`curl` 8.x、Python 3.10

---

## 1. Base URL ⚠️ 最容易搞错的一步

| 地址 | 结果 |
|------|------|
| **`https://api.agnes-ai.cn/v1`** | ✅ **正确**，`/models` 与 `/chat/completions` 均正常 |
| `https://apihub.agnes-ai.com/v1` | ❌ **陷阱**：`/models` 返回 200，但 `/chat/completions` 一律 401 |

### 为什么 `apihub` 那个是陷阱

```
GET  https://apihub.agnes-ai.com/v1/models   → 200（返回一份模型清单）
POST https://apihub.agnes-ai.com/v1/chat/completions → 401 Invalid token
```

**`/models` 返回 200 完全不能证明密钥有效。** 我在这上面浪费了一轮排查：
看到 200、又看到模型清单，就以为地址对了、只是密钥有问题，于是花时间去做
「密钥格式 / 认证头 / 模型权限」的排除性诊断 —— 而真正的问题在**地址**。

> 📌 **可迁移的教训**：`GET /models` 这类「无副作用端点」经常不校验认证，
> 所以**它永远不能用来验证凭证**。验证凭证必须打**真正需要鉴权的端点**。
>
> 这与本课程的方法论是同一件事：
> **要验证一个假设，必须打它最脆弱的那个点，而不是最方便的那个点。**

### 怎么一眼确认地址对不对

```bash
curl -s -m 30 https://api.agnes-ai.cn/v1/models \
  -H "Authorization: Bearer $AGNES_API_KEY" | head -c 200
```

- 返回 `{"data":[{"id":"agnes-...` → 地址与密钥都对
- 返回 `{"code":"000201","message":"Resource not found"}` → 地址错了
- 返回 `{"error":{"message":"无效的令牌"}}` → 地址对了，密钥错了
- 返回 `{"error":{"message":"未提供令牌"}}` → 没带上 `Authorization` 头

---

## 2. 认证

| 项 | 值 |
|----|-----|
| 协议 | OpenAI 兼容（`/v1/chat/completions`） |
| 认证头 | `Authorization: Bearer sk-...` |
| 密钥格式 | `sk-` + 48 字符 = 共 51 字符 |

**实测：只有 `Authorization` 头被识别。** 下列写法一律报 `未提供令牌`：

- `Authorization: sk-...`（缺 `Bearer `）
- `api-key: sk-...`
- `x-api-key: sk-...`
- `?api_key=sk-...`（查询参数）

---

## 3. 可用模型（`GET /v1/models` 实测清单）

### 文本对话

| 模型 | 实测结果 | 说明 |
|------|---------|------|
| `agnes-2.0-flash` | ✅ 正常返回 | 便宜/快 |
| `agnes-2.5-flash` | ✅ 正常返回 | **推荐默认**，本课程脚本用它 |
| `agnes-3.0-flash` | ✅ 正常返回 | 更强，仍属 flash 档 |
| `agnes-2.5-pro` | ⛔ 403 额度不足 | pro 档需要余额 |
| `agnes-2.5-pro-alpha` | ⛔ 403 额度不足 | 同上 |
| `agnes-2.5-pro-beta` | ⛔ 403 额度不足 | 同上 |

### 图像 / 视频

`agnes-image-2.0-flash` · `agnes-image-2.1-flash` · `agnes-image-2.5-flash`
`agnes-video-2.5` · `agnes-video-2.5-flash` · `agnes-video-v2.0`

> ⚠️ 图像/视频模型未经本文件实测（不在本课程的用途内）。列出来只为说明
> 「`/models` 的清单 ≠ 你能用的清单」—— **清单不校验权限，调用才校验。**

### 免费的边界

**flash 系列返回了真实内容，pro 系列报额度不足。**

> 📌 **这一点值得单独记住**：同一个密钥、同一个地址、同一时刻，
> **不同模型的可用性不同**。所以「密钥能不能用」不是一个是/否问题，
> 而是「密钥 × 模型 能不能用」的矩阵。
>
> 排查时如果只试一个模型就下结论，很容易得出错误答案（我第一轮就是这样）。

---

## 4. 错误码对照

| HTTP | 返回体 `error.message` | 含义 | 怎么修 |
|------|----------------------|------|--------|
| 200 | — | 成功 | — |
| 401 | `Invalid token` / `无效的令牌` | 密钥无效 | 检查是否复制完整；注意 **地址**是否也对 |
| 401 | `Token not provided` / `未提供令牌` | 没带上认证头 | 检查 `Authorization: Bearer ` 前缀和拼写 |
| 403 | `用户额度不足，剩余额度: ￥0.000000`<br>`code: insufficient_user_quota` | 余额不足 | **换 flash 档模型**，或充值 |
| 404 | `{"code":"000201","message":"Resource not found"}` | 地址错误 | 换回 `api.agnes-ai.cn` |

### 请求 id

每个错误都带 `request id`（例：`20260922155201992833284qiOwhEUG`）。
**提工单时带上它** —— 这是平台侧唯一能定位到你那次请求的凭据。

---

## 5. 成功响应形状（实测）

```json
{
  "id": "6463134c81994478b6a9476da821ef1f",
  "created": 1790092334,
  "model": "agnes-2.5-flash",
  "object": "chat.completion",
  "choices": [
    {
      "finish_reason": "length",
      "index": 0,
      "message": { "content": "Hi! How can I", "role": "assistant" },
      "provider_specific_fields": {}
    }
  ]
}
```

标准 OpenAI 形状。`choices[0].message.content` 取文本即可。

---

## 6. 最小可用调用（curl）

```bash
export AGNES_API_KEY='sk-...'          # ⛔ 绝不写进仓库

curl -s -m 60 https://api.agnes-ai.cn/v1/chat/completions \
  -H "Authorization: Bearer $AGNES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-2.5-flash",
    "messages": [
      {"role": "system", "content": "你是规格审阅者。"},
      {"role": "user",   "content": "找出这份规格的矛盾。"}
    ],
    "temperature": 0.2,
    "max_tokens": 2000
  }'
```

---

## 7. 在 SDD 流程里怎么用

本仓库提供了一个可直接用的脚本：**`scripts/agnes-review.py`** ——
把一份 `spec.md` 送去**对抗式审阅**。

```bash
export AGNES_API_KEY='sk-...'
python scripts/agnes-review.py examples/focuslog/specs/001-focuslog-mvp/spec.md
```

它按五类检查挑刺，每条要求给出「位置 / 问题 / 后果 / 建议」四个要素：

| 类别 | 检查什么 |
|------|---------|
| ① 歧义 | 「友好」「合理」「尽快」这类无法判定的词；一个行为两种合理解读 |
| ② 矛盾 | 两条验收标准在某种输入下要求不同行为 |
| ③ 缺口 | 六类歧义区里留空的地方 |
| ④ 不可测 | 写不出确定性断言的标准 |
| ⑤ 实现泄漏 | 规格里出现了类名、库名、文件路径 |

### 它和 `/speckit-analyze` 的关系

| | `/speckit-analyze` | `agnes-review.py` |
|---|---|---|
| 检查什么 | **规格内部一致性**（标准互斥、孤儿标准、需求↔任务覆盖） | **话没说全的地方**（歧义、缺口） |
| 确定性 | 高（可复现） | 低（每次可能不同） |
| 成本 | 免费 | 需要额度 |
| 该信谁 | 当作**门禁**（可以阻断 CI） | 当作**外脑**（必须人工过一遍） |

> 📌 **不要把模型审阅接进 CI 当门禁。**
> 它是非确定性的：同一份规格两次可能给出不同意见。
> 非确定性的门禁 = 会误报的门禁 = 团队会学会无视它（AP-18）。
>
> **正确用法：人来读它的输出，然后决定改不改规格。**

### 实测效果（2026-09-22）

用 `agnes-2.5-flash` 审 `focuslog` 的规格，它找出了三条我确实没写的东西：

1. **一个真实的矛盾**：`US2.5` 规定跨天会话时长全计入**开始日**，
   而 `US3.6` 规定周报**不含**活跃会话 →
   周一 23:50 开始、周二 00:10 结束的会话，在周二的周报里**凭空消失**。
   规格没有定义这种情况的预期行为。
2. **输出格式未定义**：只说了「输出确认信息（含标签与开始时间）」，
   没给格式 → 测试只能断言「输出非空」。
3. **两个错误码的边界模糊**：`TAG_REQUIRED` 与 `TAG_INVALID` 是否允许合并，规格没说。

**这三条都不是「写错了」，而是「没写到」。** 而这正是模型比工具强的地方 ——
工具只能检查你说过的话是否自洽，模型能看出**你漏了哪句话**。

---

## 8. 安全约定（本仓库遵守）

| 约定 | 做法 |
|------|------|
| 密钥不进仓库 | 只从环境变量 `AGNES_API_KEY` 读，代码里没有任何默认值 |
| 密钥不进对话记录 | 测试时直接用环境变量赋值，不落到文件 |
| 规格外发要知情 | `agnes-review.py` 会把规格全文发到 Agnes；**敏感项目先脱敏** |
| 密钥泄漏要轮换 | 官方文档：密钥泄漏后应立即删除或重置 |

> ⛔ **`scripts/` 与 `examples/` 下任何文件都不得包含 `sk-` 开头的字符串。**
> 可以用下面的命令自查（应当无输出）：
>
> ```bash
> grep -rn "sk-[A-Za-z0-9]\{20,\}" --include='*' . | grep -v '\.git/'
> ```
