"""把散在仓库各处的文档拼进一个临时目录，供 Zensical 构建。

为什么需要这一步：Zensical 只能有一个 docs_dir，而本仓库的内容天然分居多处 ——
讲义在 `lessons/`、速查在 `reference/`、案例设计在 `projects/`、模板在 `templates/`、
完整产物在 `examples/`、门禁脚本的说明在 `scripts/`，还有两份根级文档。

两种做法里选了后者：

  ✗ 把内容复制进仓库（比如 `docs/`）再提交 —— 于是仓库里同时存在两份教材，
    改一处忘一处，迟早不一致。
  ✓ 构建时临时拼装（本脚本）—— 仓库里始终只有一份原文，站点是它的产物。

用法（三步，本脚本是第一步）：

    python tools/build_site.py                                     # 生成 site-src/
    uvx --with-requirements requirements-docs.txt zensical serve   # 本地预览，默认 8000 端口
    uvx --with-requirements requirements-docs.txt zensical build --strict --clean

CI 在推送到 main 时做同样的事并部署，见 .github/workflows/docs.yml。

────────────────────────────────────────────────────────────────────────────
拼装不只是复制文件。这里额外做三件「不做就会坏」的事：

① 改写相对链接。
   `lessons/09-converge-drift.md` 里的 `](../README.md)`，拼装后目标叫 `index.md`；
   MkDocs/Zensical 的 --strict 会把「指向不存在文档的相对链接」当**错误**，
   不是警告。所以每条相对链接都必须重新解析一遍。

② 把指向非文档文件的链接换成 GitHub 绝对地址。
   讲义里有 `examples/taskflow/src/domain/state-machine.ts` 这类引用。代码不进站点，
   但相对链接留在页面上会让 --strict 直接红。改为指向 GitHub 的 blob/tree 地址后，
   读者点开就能看到真实文件 —— 这比塞进导航更合适（代码在 GitHub 上才是活的）。

③ 把反引号里的仓库路径变成可点击链接。
   讲义用 `` `examples/focuslog/notes/L05-验收记录.md` `` 这种写法指明「完整参考产出」。
   在 GitHub 上它是纯文本，读者得自己拼路径；在站点上它可以直接跳过去。
   ⚠️ 只对**真实存在的文件**动手，且必须在代码围栏之外 —— 否则会把 shell 命令
   和示例代码里的假路径也一起链接化。

④ 转义裸的尖括号占位符。
   模板里的 `<功能名>`、`<一段话。>·` 会被 Python-Markdown 当成原生 HTML 标签原样
   透传，浏览器渲染成**不可见的空元素** —— 占位符会凭空消失，而构建一句警告都不报。
   实测踩过。代码片段内的尖括号已被 markdown 转义，不受影响。
"""

from __future__ import annotations

import os
import posixpath
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site-src"

# 指向 GitHub 的兜底地址：站点里放不下的东西（代码、脚本、CI 配置）用它。
REPO_SLUG = "whitsats/sdd-course"
BRANCH = "main"
BLOB = f"https://github.com/{REPO_SLUG}/blob/{BRANCH}"
TREE = f"https://github.com/{REPO_SLUG}/tree/{BRANCH}"

# 单独搬运的根级页面：(源文件, 站点路径)
ROOT_PAGES = [
    ("README.md", "index.md"),
    ("PLAN.md", "plan.md"),
]

# 整棵搬运的目录：其中所有 *.md 都成为站点页面，README.md 一律改名为 index.md
COPY_TREES = ["lessons", "reference", "projects", "templates", "examples", "scripts"]

# 拼装时跳过的目录（不是内容，是工具状态或构建产物）
SKIP_DIRS = {".git", "site-src", "site-out", ".freebuff", "node_modules", "__pycache__", ".venv", ".cache"}


def _setup_console() -> None:
    """把控制台输出切到 UTF-8（Windows 上这一步是必须的）。

    实测：Windows 默认代码页 GBK，下面带 ✓ 的汇总会直接把这个脚本弄死：
        UnicodeEncodeError: 'gbk' codec can't encode character '\u2713'
    报错位置跟真正的工作毫无关系，很容易误判成「复制文件失败」。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass


# ── 页面对照表 ────────────────────────────────────────────────────────────────

def _site_path(src_rel: str) -> str:
    """仓库里的路径 → 站点里的路径。唯一的规则是 README.md 变成 index.md。"""
    head, _, name = src_rel.rpartition("/")
    if name == "README.md":
        return f"{head}/index.md" if head else "index.md"
    return src_rel


def _collect_pages() -> dict[str, str]:
    """{仓库相对路径 → 站点路径}。这张表是后面所有链接改写的地基。"""
    pages: dict[str, str] = {}
    for src_rel, site_rel in ROOT_PAGES:
        if not (ROOT / src_rel).is_file():
            raise SystemExit(f"✗ 缺少源文件：{src_rel}")
        pages[src_rel] = site_rel
    for tree in COPY_TREES:
        base = ROOT / tree
        if not base.is_dir():
            continue
        for src in sorted(base.rglob("*.md")):
            src_rel = src.relative_to(ROOT).as_posix()
            pages[src_rel] = _site_path(src_rel)
    return pages


def _repo_index() -> tuple[set[str], set[str]]:
    """仓库里真实存在的文件与目录（大小写敏感）。

    为什么不用 Path.exists()：Windows 文件系统大小写不敏感，`plan.md` 会被判定存在
    并解析到 `PLAN.md`，而 Linux 上的 CI 不会 —— 同一个脚本在本地和 CI 上跑出两种
    结果，是最难查的那类 bug。这里自己走一遍目录，两边行为一致。
    """
    files: set[str] = set()
    dirs: set[str] = set()
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        rel_dir = Path(dirpath).relative_to(ROOT).as_posix()
        if rel_dir != ".":
            dirs.add(rel_dir)
        for name in filenames:
            files.add(name if rel_dir == "." else f"{rel_dir}/{name}")
    return files, dirs


# ── 改写规则 ──────────────────────────────────────────────────────────────────

_CODE_SPAN = re.compile(r"`([^`\n]+)`")
_LINK = re.compile(r"\]\((?P<target>[^)\s]+)(?:\s+[\"'][^\"']*[\"'])?\)")
_ANGLE = re.compile(r"<([^<>\n]*)>")

# 保留为原生 HTML 的标签名。本仓库目前一个也没用，留着是为了不误伤以后加进来的。
_HTML_TAGS = {
    "a", "abbr", "audio", "b", "bdi", "bdo", "blockquote", "br", "cite", "code", "dd",
    "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "h1",
    "h2", "h3", "h4", "h5", "h6", "hr", "i", "iframe", "img", "input", "ins", "kbd",
    "label", "li", "link", "mark", "meta", "ol", "p", "picture", "pre", "q", "s",
    "samp", "script", "section", "small", "source", "span", "strong", "style", "sub",
    "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr",
    "u", "ul", "var", "video",
}

# 反引号里形如仓库路径的才考虑链接化。前缀白名单 + 文件真实存在，双保险。
_LINKABLE_PREFIXES = (
    "examples/", "scripts/", "templates/", "lessons/", "reference/", "projects/",
    "specs/", "docs/", "notes/", "memory/",
)


class Stats:
    def __init__(self) -> None:
        self.pages = 0
        self.site_links = 0
        self.github_links = 0
        self.linkified = 0
        self.escaped = 0
        self.unresolved: list[tuple[str, str]] = []
        self.github_samples: list[tuple[str, str, str]] = []
        self.escape_samples: list[tuple[str, str]] = []


def _rewrite_target(target: str, src_rel: str, site_rel: str,
                    pages: dict[str, str], files: set[str], dirs: set[str],
                    stats: Stats) -> str | None:
    """把一条相对链接改写掉；返回 None 表示不归我们管（外部地址、锚点）。"""
    if not target or target.startswith(("http://", "https://", "mailto:", "tel:", "#")):
        return None

    path, sep, anchor = target.partition("#")
    if not path:
        return None
    suffix = f"#{anchor}" if sep else ""

    key = posixpath.normpath(posixpath.join(posixpath.dirname(src_rel), path))

    # 作者也可以按「站点里的名字」写链接（…/index.md）：README.md 是仓库里的名字，
    # index.md 是站点上的名字，两种都认能省掉一类「本地能跳、站点跳不动」的困惑。
    if key not in pages and key.endswith("index.md"):
        alt = key[: -len("index.md")] + "README.md"
        if alt in pages:
            key = alt

    if key in pages:  # ① 站点里有这一页 → 改成站点内的相对路径
        new = posixpath.relpath(pages[key], start=posixpath.dirname(site_rel) or ".")
        stats.site_links += 1
        return new + suffix

    if key in files:  # ② 是仓库里的真实文件，但不进站点 → 指向 GitHub
        stats.github_links += 1
        url = f"{BLOB}/{quote(key, safe='/')}{suffix}"
        if len(stats.github_samples) < 5:
            stats.github_samples.append((src_rel, target, url))
        return url

    if key in dirs:  # ③ 目录 → GitHub 的目录页
        stats.github_links += 1
        return f"{TREE}/{quote(key, safe='/')}{suffix}"

    stats.unresolved.append((src_rel, target))
    return None


def _do_text(seg: str, src_rel: str, site_rel: str, pages: dict[str, str],
             files: set[str], dirs: set[str], stats: Stats) -> str:
    """处理非代码片段：改写链接 + 转义裸占位符。"""

    def _link(m: re.Match[str]) -> str:
        new = _rewrite_target(m.group("target"), src_rel, site_rel, pages, files, dirs, stats)
        return f"]({new})" if new else m.group(0)

    seg = _LINK.sub(_link, seg)
    seg = _ANGLE.sub(lambda m: _escape_angle(m, stats), seg)
    return seg


def _escape_angle(m: re.Match[str], stats: Stats) -> str:
    inner = m.group(1).strip()
    if not inner:
        return m.group(0)
    if inner.startswith("!--"):  # HTML 注释
        return m.group(0)
    # ⚠️ 必须先 lstrip("/")：闭合标签 </summary> 去掉首尾尖括号后是 "/summary"，
    #    直接 split("/")[0] 会得到空串，于是**闭合标签被当成占位符转义、而开标签没有** ——
    #    结果是 <details> 开着、</details> 变成可见文本，全部折叠块渲染错乱。实测踩过。
    head = inner.split()[0].lstrip("/").split("/")[0].rstrip("/").lower()
    if head in _HTML_TAGS:
        return m.group(0)
    if inner.startswith(("http://", "https://")) or "@" in inner:
        return m.group(0)  # 自动链接 / 邮箱
    stats.escaped += 1
    if len(stats.escape_samples) < 5:
        stats.escape_samples.append((m.group(0), f"&lt;{inner}&gt;"))
    return f"&lt;{inner}&gt;"


def _linkify_code(content: str, src_rel: str, site_rel: str,
                  pages: dict[str, str], files: set[str], stats: Stats) -> str | None:
    """反引号里的仓库路径 → 可点击链接。只认真实存在的文件。"""
    text = content.strip()
    if not text or len(text) > 200:
        return None
    if any(ch in text for ch in " *${}|\"'`\\<>()"):
        return None  # 含通配符/空格/花括号的写法（如 src/{a,b,c}.ts）一律不碰
    if not re.fullmatch(r"[A-Za-z0-9_./一-鿿-]+", text):
        return None

    # 先按仓库根解析（讲义里就是这么写的），再退回按页面所在目录解析
    for base in ("", posixpath.dirname(src_rel)):
        key = posixpath.normpath(posixpath.join(base, text)) if base else posixpath.normpath(text)
        if key.startswith("..") or key in (".", ""):
            continue
        if key not in files:
            continue
        looks_like_path = text.startswith(_LINKABLE_PREFIXES) or "." in text
        if not looks_like_path:
            continue
        if key in pages:
            url = posixpath.relpath(pages[key], start=posixpath.dirname(site_rel) or ".")
        else:
            url = f"{BLOB}/{quote(key, safe='/')}"
        return url, key
    return None


def _transform(text: str, src_rel: str, site_rel: str, pages: dict[str, str],
               files: set[str], dirs: set[str], stats: Stats) -> str:
    """逐行处理，代码围栏内一律不动。"""
    out: list[str] = []
    fence: str | None = None
    for line in text.split("\n"):
        stripped = line.lstrip()
        marker = stripped[:3] if stripped[:3] in ("```", "~~~") else None
        if marker:
            if fence is None:
                fence = marker
            elif marker == fence:
                fence = None
            out.append(line)
            continue
        if fence is not None:
            out.append(line)
            continue

        parts: list[str] = []
        pos = 0
        for m in _CODE_SPAN.finditer(line):
            if m.start() > pos:
                parts.append(_do_text(line[pos:m.start()], src_rel, site_rel, pages, files, dirs, stats))
            hit = _linkify_code(m.group(1), src_rel, site_rel, pages, files, stats)
            # 前一个字符是 `[` 说明它是链接的文字部分，再套一层链接会坏掉
            already_link_text = m.start() > 0 and line[m.start() - 1] == "["
            if hit and not already_link_text:
                url, key = hit
                parts.append(f"[`{m.group(1)}`]({url})")
                stats.linkified += 1
            else:
                parts.append(m.group(0))
            pos = m.end()
        if pos < len(line):
            parts.append(_do_text(line[pos:], src_rel, site_rel, pages, files, dirs, stats))
        out.append("".join(parts))
    return "\n".join(out)


# ── 主流程 ────────────────────────────────────────────────────────────────────

def main() -> int:
    _setup_console()

    pages = _collect_pages()
    files, dirs = _repo_index()

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    stats = Stats()
    stats.pages = len(pages)

    for src_rel, site_rel in sorted(pages.items(), key=lambda kv: kv[1]):
        src = ROOT / src_rel
        dst = OUT / site_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        text = src.read_text(encoding="utf-8")
        dst.write_text(_transform(text, src_rel, site_rel, pages, files, dirs, stats), encoding="utf-8")

    print(f"✓ 已生成 {OUT.relative_to(ROOT)}/：{stats.pages} 页")
    print(f"  站点内链接改写 {stats.site_links} 条 · 转为 GitHub 地址 {stats.github_links} 条 · "
          f"反引号路径可点击化 {stats.linkified} 处 · 占位符转义 {stats.escaped} 处")

    if stats.github_samples:
        print("\n  GitHub 地址改写示例：")
        for src_rel, old, new in stats.github_samples:
            print(f"    {src_rel}: {old}\n      → {new}")
    if stats.escape_samples:
        print("\n  占位符转义示例：")
        for old, new in stats.escape_samples:
            print(f"    {old} → {new}")

    if stats.unresolved:
        print(f"\n✗ 有 {len(stats.unresolved)} 条相对链接解析不了（--strict 下会直接失败）：", file=sys.stderr)
        for src_rel, target in stats.unresolved:
            print(f"    {src_rel} → {target}", file=sys.stderr)
        return 1

    print("\n  本地预览：uvx --with-requirements requirements-docs.txt zensical serve")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
