#!/usr/bin/env python
"""generate-evals —— 把 spec.md 的验收标准变成评测卡（L15）。

用途：映射表回答「每条标准由哪个测试守」；评测卡回答另一个问题——
      **把行为喂回来，逐条判定它符不符合标准**。判定者可以是评审模型，
      也可以是人（卡片本身就是验收记录的骨架）。

与 agnes-review.py 的分工：
      agnes-review 是**整体找茬**（读完整个 spec 找矛盾与缺口，L06）；
      本脚本是**逐条判定**（每条标准一张卡，L15）。一个横向，一个纵向。

用法：
    python scripts/generate-evals.py examples/focuslog                 # 输出到 stdout
    python scripts/generate-evals.py examples/focuslog --out evals.jsonl
    python scripts/generate-evals.py examples/focuslog/specs/001-focuslog-mvp/spec.md

输出：JSONL，每行一张评测卡：
    {"id": "3.1", "ac": "<标准原文>", "test": "<映射表里的测试，可能为 null>",
     "type": "<映射表里的类型，可能为 null>", "card": "<可直接粘给评审模型的判定卡>"}

⚠️ 边界（L15 §5）：评测**不是门禁**。评审模型的判定有方差，
   不能进 CI —— 确定性的检查才能当门禁（AP-18 的另一半）。

⛔ 本脚本只做文本提取与拼装：不联网、不依赖任何第三方包、不改仓库文件（除非 --out）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROW = re.compile(r"^\|\s*(\d+\.\d+)\s*\|")
# spec 行：| 1.1 | <标准原文…可含竖线…> |
SPEC_ROW = re.compile(r"^\|\s*(\d+\.\d+)\s*\|(.*)\|\s*$")

CARD_TEMPLATE = """【判定卡 · 验收标准 {id}】
{ac}

【待判定行为】
<在此粘贴：命令与实际输出 / agent 产出 / 截图转写。留空 = 无法判定。>

【判定要求】
1. 只依据上面的标准原文判定，不引入标准之外的假设。
2. 结论三选一：PASS / FAIL / 无法判定。
3. FAIL 或无法判定时，引用标准原文中缺失或矛盾的部分作为证据；禁止编造行为细节。
4. 若这条标准本身不可验收（无触发、无条件、无可见结果），输出「无法判定」，
   并在证据里把它改写成一条可验收的标准 —— 这是评测回馈规格的入口。"""


def read_rows(path: Path) -> list[str]:
    """按行读 md，跳过代码围栏 —— 围栏里的示例表格不是验收标准。"""
    lines: list[str] = []
    fence = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("```"):
            fence = not fence
            continue
        if not fence:
            lines.append(line)
    return lines


def parse_spec(path: Path) -> dict[str, str]:
    """返回 {标准编号: 标准原文}。取首尾竖线之间的全部内容，标准里可以含竖线。"""
    out: dict[str, str] = {}
    for line in read_rows(path):
        m = SPEC_ROW.match(line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def parse_map(path: Path) -> dict[str, tuple[str | None, str | None]]:
    """返回 {标准编号: (测试引用, 类型)}。列结构与 check-spec-coverage.sh 的判据一致。"""
    out: dict[str, tuple[str | None, str | None]] = {}
    for line in read_rows(path):
        m = ROW.match(line.strip())
        if not m:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        test = cells[2] if len(cells) > 2 else None
        typ = cells[3] if len(cells) > 3 else None
        out[m.group(1)] = (test or None, typ or None)
    return out


def locate(project: Path) -> tuple[Path, Path | None]:
    """与 check-spec-coverage.sh 相同的解析顺序：活跃 feature → 编号最小的 feature。"""
    if project.is_file() and project.name == "spec.md":
        spec = project
        feature = spec.parent
        proj = feature.parent.parent
        m1 = feature / "docs" / "验收标准-测试映射.md"
        m2 = proj / "docs" / "验收标准-测试映射.md"
        return spec, (m1 if m1.exists() else (m2 if m2.exists() else None))

    specs_dir = project / "specs"
    if not specs_dir.is_dir():
        raise SystemExit(f"::error::{project} 下没有 specs/ 目录（退出码 2，配置问题）")
    features = sorted(d for d in specs_dir.iterdir() if d.is_dir())
    if not features:
        raise SystemExit(f"::error::{specs_dir} 下没有任何 feature 目录")
    feature = features[0]
    spec = feature / "spec.md"
    if not spec.exists():
        raise SystemExit(f"::error::{feature} 下找不到 spec.md")
    m1 = feature / "docs" / "验收标准-测试映射.md"
    m2 = project / "docs" / "验收标准-测试映射.md"
    return spec, (m1 if m1.exists() else (m2 if m2.exists() else None))


def main() -> int:
    ap = argparse.ArgumentParser(description="把 spec 的验收标准变成评测卡（JSONL）")
    ap.add_argument("project", help="项目目录（含 specs/）或 spec.md 路径")
    ap.add_argument("--out", help="写入该文件（JSONL）；缺省输出到 stdout")
    args = ap.parse_args()

    # Windows 控制台默认 GBK，直接 print 中文会乱码（与 agnes-review.py 同一个坑）
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    root = Path(args.project)
    spec_path, map_path = locate(root)
    standards = parse_spec(spec_path)
    if not standards:
        raise SystemExit(
            f"::error::{spec_path} 里没有解析到任何验收标准行（形如 | 1.1 | … |）。"
            "若表格在代码围栏里或列格式不同，请先修格式（退出码 2）"
        )
    mapping = parse_map(map_path) if map_path and map_path.exists() else {}

    lines = []
    for sid in sorted(standards, key=lambda k: [int(p) for p in k.split(".")]):
        test, typ = mapping.get(sid, (None, None))
        card = CARD_TEMPLATE.format(id=sid, ac=standards[sid])
        lines.append(
            json.dumps(
                {"id": sid, "ac": standards[sid], "test": test, "type": typ, "card": card},
                ensure_ascii=False,
            )
        )

    payload = "\n".join(lines) + "\n"
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload, encoding="utf-8")
        print(f"✅ {len(lines)} 张评测卡 → {out}（来源：{spec_path}）", file=sys.stderr)
    else:
        sys.stdout.write(payload)

    missing = sorted(set(mapping) - set(standards))
    if missing:
        print(
            f"::warning::映射表有 {len(missing)} 条编号在 spec 里找不到：{', '.join(missing[:5])}…",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
