#!/usr/bin/env python
"""check-error-codes —— 错误码投影门禁（L07 §7 · 机器可读规格层）。

spec 的「边界条件汇总」表是人读的；实现里散落的 'CONFLICT' 字符串是机器写的。
两个表示会漂移：实现顺手发明一个 spec 里没有的错误码，没有任何门禁会拦 —— 直到本脚本。

规则（刻意单向）：**实现引用的每个错误码，都必须能在 spec 里指回一条标准。**
反向不查：spec 声明了完整 API 的码，实现可能尚未提交（taskflow 的已知边界，
见 examples/taskflow/README.md「边界」一节）——查了就会红在本该绿的地方。

用法：
    python scripts/check-error-codes.py examples/taskflow
    python scripts/check-error-codes.py examples/taskflow --impl src/domain --impl tests
    python scripts/check-error-codes.py examples/taskflow --json   # 输出机器可读投影

--json 输出 spec 错误码的投影：{code → 引用它的标准编号列表}。
这是 spec 的机器可读表示 —— 给监控、文档、告警探针（L16）当数据源。

⛔ 纯标准库，不联网；默认只读，不写任何文件。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# spec 与实现两侧都用同一套「像错误码」的判据：全大写 + 下划线，≥3 字符。
CODE_LIKE = re.compile(r"\b[A-Z][A-Z0-9_]{2,}\b")
# HTTP 动词在 spec 的 AC 里也以反引号出现（`POST /projects`），不是错误码。
HTTP_VERBS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
# AC 行：| 3.2 | WHEN …（`INVALID_TRANSITION`）… |
AC_ROW = re.compile(r"^\|\s*(\d+\.\d+)\s*\|")


def read_md_lines(path: Path) -> list[str]:
    """跳过代码围栏 —— 围栏里的示例不是规格声明。"""
    lines: list[str] = []
    fence = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("```"):
            fence = not fence
            continue
        if not fence:
            lines.append(line)
    return lines


def strip_code_comments(line: str) -> bool:
    """返回 True 表示该行是注释（// 或 /* 或 * 开头），不应参与错误码统计。"""
    return re.match(r"^\s*(//|/\*|\*)", line) is not None


def spec_codes(spec: Path) -> dict[str, list[str]]:
    """从 spec 提取错误码 → 引用它的标准编号列表（投影）。"""
    codes: dict[str, list[str]] = {}
    for line in read_md_lines(spec):
        m = AC_ROW.match(line.strip())
        current = m.group(1) if m else None
        for token in CODE_LIKE.findall(line):
            if token in HTTP_VERBS:
                continue
            # 反引号里的全大写词才算候选 —— 粗判据：该词在原文中以 ` 包裹。
            if f"`{token}`" not in line:
                continue
            entry = codes.setdefault(token, [])
            if current and current not in entry:
                entry.append(current)
    return codes


def impl_codes(roots: list[Path]) -> dict[str, list[str]]:
    """从实现源码提取字符串字面量形式的错误码 → 出现位置。"""
    found: dict[str, list[str]] = {}
    for root in roots:
        if root.is_file():
            files = [root]
        else:
            files = sorted(p for p in root.rglob("*") if p.suffix in {".ts", ".js", ".py", ".java", ".mjs"})
        for f in files:
            try:
                lines = f.read_text(encoding="utf-8").splitlines()
            except (UnicodeDecodeError, OSError):
                continue
            for i, line in enumerate(lines, 1):
                if strip_code_comments(line):
                    continue
                for token in re.findall(r"""['"]([A-Z][A-Z0-9_]{2,})['"]""", line):
                    if token in HTTP_VERBS:
                        continue
                    found.setdefault(token, []).append(f"{f.as_posix()}:{i}")
    return found


def locate(project: Path) -> Path:
    """与 check-spec-coverage.sh 同源：活跃 feature → 编号最小的 feature。"""
    if project.is_file() and project.name == "spec.md":
        return project
    specs_dir = project / "specs"
    features = sorted(d for d in specs_dir.iterdir() if d.is_dir()) if specs_dir.is_dir() else []
    if not features:
        raise SystemExit(f"::error::{project} 下没有 specs/ 目录（退出码 2）")
    spec = features[0] / "spec.md"
    if not spec.exists():
        raise SystemExit(f"::error::{features[0]} 下找不到 spec.md")
    return spec


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(description="错误码投影门禁：实现引用的每个错误码都能指回 spec")
    ap.add_argument("project", help="项目目录（含 specs/）或 spec.md 路径")
    ap.add_argument("--impl", action="append", default=[],
                    help="实现扫描目录（可重复）；缺省为项目下 src/ 与 tests/")
    ap.add_argument("--json", action="store_true", help="输出机器可读投影（JSON）并退出")
    args = ap.parse_args()

    root = Path(args.project)
    spec = locate(root)

    if args.json:
        projection = {
            code: {"standards": refs or None}
            for code, refs in sorted(spec_codes(spec).items())
        }
        print(json.dumps(projection, ensure_ascii=False, indent=2))
        return 0

    refs = spec_codes(spec)
    impl_roots = [Path(p) for p in args.impl] or [root / "src", root / "tests"]
    impl_roots = [p for p in impl_roots if p.exists()]
    impl = impl_codes(impl_roots)

    invented = {code: locs for code, locs in impl.items() if code not in refs}
    print(f"spec 错误码：{len(refs)} 个    实现引用：{len(impl)} 个    扫描：{len(impl_roots)} 个目录")

    if invented:
        print(f"❌ {len(invented)} 个实现自造、spec 里不存在的错误码：")
        for code in sorted(invented):
            print(f"  - {code}  ←  {invented[code][0]}（共 {len(invented[code])} 处）")
        print("  修法：先改 spec（走 change-request），再改实现 —— 顺序不能反（L09）。")
        return 1

    print("✅ 实现引用的每个错误码都能在 spec 里指回标准")
    return 0


if __name__ == "__main__":
    sys.exit(main())
