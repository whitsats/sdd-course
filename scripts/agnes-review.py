#!/usr/bin/env python
"""agnes-review —— 用 Agnes API 对规格做一次对抗式审阅。

用途：这是 /speckit-analyze 的「人工替代版」。
      analyze 检查**规格内部一致性**（标准之间有没有矛盾、有没有孤儿标准）；
      本脚本让一个模型从**外部视角**挑刺 —— 两者互补：
      工具擅长确定性检查，模型擅长发现「话没说全」的地方。

用法：
    export AGNES_API_KEY='sk-...'          # 只从环境变量读，绝不写进文件
    python scripts/agnes-review.py examples/taskflow/specs/001-taskflow-mvp/spec.md

可选：
    --model agnes-2.5-flash                 # 默认；见 reference/agnes-api.md 的模型说明
    --focus "并发与权限"                     # 让审阅聚焦某个方面
    --diff                                  # 只输出审阅意见，不输出元信息

⛔ 本脚本**不**包含密钥，也**不**会把规格内容发送到 Agnes 以外的任何地方。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

# ── Windows 控制台默认是 GBK，直接 print 中文会变成乱码。
#    显式把标准输出切成 UTF-8 —— 这是 Windows 上写 CLI 的必备一步。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

DEFAULT_BASE = "https://api.agnes-ai.cn/v1"
DEFAULT_MODEL = "agnes-2.5-flash"
MAX_SPEC_CHARS = 60_000

# ── 审阅提示词 ────────────────────────────────────────────────────────────
# 设计原则：**要求它给出「哪一行」和「为什么」**，否则模型会输出一堆泛泛的建议。
# 泛泛的建议无法被采纳，等于没有。
SYSTEM_PROMPT = """你是一个严格的规格审阅者。你的任务是找出规格中的**缺陷**，不是夸它。

只报告你能指出具体位置的问题。每条意见必须包含：
1. **位置**：引用规格里的原句（或指出「缺失」）
2. **问题**：它为什么是缺陷
3. **后果**：不修会导致什么具体的返工或事故
4. **建议**：怎么改（给出一句可直接替换的写法）

按以下五类检查，**没有发现问题的类别就明确写「无」**，不要编凑：

① **歧义**：出现「友好」「合理」「尽快」「适当」「可能」这类无法判定的词；
   或一个行为有两种合理解读。
② **矛盾**：两条验收标准在某种输入下要求不同的行为。
③ **缺口**：六类歧义区里留空的地方 —— 边界与极值、错误与失败、权限与可见性、
   并发与顺序、时间与时效、状态转换。
④ **不可测**：无法写出确定性断言的标准。
⑤ **实现泄漏**：规格里出现了类名、库名、文件路径等实现细节（规格不该有这些）。

最后给一个「最该先修的 3 条」，按严重程度排序。"""


def call_agnes(base: str, model: str, api_key: str, user_content: str) -> str:
    """调用 OpenAI 兼容的 /chat/completions，返回助手回复文本。"""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.2,
        "max_tokens": 4000,
    }
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"]


def main() -> int:
    ap = argparse.ArgumentParser(description="用 Agnes API 对规格做对抗式审阅")
    ap.add_argument("spec", help="规格文件路径（.md）")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--base", default=os.environ.get("AGNES_BASE", DEFAULT_BASE))
    ap.add_argument("--focus", default=None, help="让审阅聚焦某个方面")
    args = ap.parse_args()

    api_key = os.environ.get("AGNES_API_KEY", "").strip()
    if not api_key:
        print("⛔ 缺少 AGNES_API_KEY 环境变量。", file=sys.stderr)
        print("   export AGNES_API_KEY='sk-...'", file=sys.stderr)
        print("   （密钥只从环境变量读，不会写入任何文件。）", file=sys.stderr)
        return 2

    try:
        with open(args.spec, encoding="utf-8") as f:
            spec_text = f.read()
    except OSError as e:
        print(f"⛔ 读不到规格文件：{e}", file=sys.stderr)
        return 2

    if len(spec_text) > MAX_SPEC_CHARS:
        print(f"⛔ 规格过长（{len(spec_text)} 字符 > {MAX_SPEC_CHARS}）。", file=sys.stderr)
        print("   请先拆分为单个 feature 的规格再送审。", file=sys.stderr)
        return 2

    header = f"请审阅以下规格文件：{args.spec}\n"
    if args.focus:
        header += f"\n**本次审阅请特别聚焦**：{args.focus}\n"
    user_content = f"{header}\n---\n\n{spec_text}"

    print(f"→ 模型 {args.model} @ {args.base}")
    print(f"→ 规格 {args.spec}（{len(spec_text)} 字符）")
    if args.focus:
        print(f"→ 聚焦 {args.focus}")
    print("─" * 68)

    try:
        print(call_agnes(args.base, args.model, api_key, user_content))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        print(f"\n⛔ HTTP {e.code}：{detail}", file=sys.stderr)
        if "insufficient_user_quota" in detail:
            print("   原因：账户额度不足。pro 系列需要余额；flash 系列通常免费。", file=sys.stderr)
            print("   试试：--model agnes-2.5-flash", file=sys.stderr)
        elif "无效的令牌" in detail or "invalid" in detail.lower():
            print("   原因：令牌无效。检查 AGNES_API_KEY 是否复制完整。", file=sys.stderr)
        return 1
    except urllib.error.URLError as e:
        print(f"\n⛔ 网络错误：{e.reason}", file=sys.stderr)
        print("   检查 base url 是否正确、是否需要代理。", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
