"""نگهبان مرزهای ماژول — Track C / ADR-0019.

این تست‌ها تصمیم «عدم تفکیک models.py» را قفل می‌کنند: تا وقتی این سه شرط
برقرارند، تفکیک models.py هیچ مسئله‌ای را حل نمی‌کند و انجام نمی‌شود.

1. گراف import در سطح فایلِ app/modules/* باید بدون چرخه بماند.
2. app/models/models.py فقط مجاز است از app.core.database (کلاس Base) —
   به‌علاوهٔ stdlib و third-party — وارد کند؛ هرگز از app.modules.
3. app/modules/content/legal.py باید برگ بماند (هیچ import از app.*) تا یال
   auth/service.py ← content/legal.py (فقط ثابت LEGAL_TEXT_VERSION) هرگز به
   چرخهٔ واقعی تبدیل نشود.
"""
from __future__ import annotations

import ast
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1] / "app"
MODULES_ROOT = APP_ROOT / "modules"


def _py_files(root: Path) -> list[Path]:
    return sorted(
        p for p in root.rglob("*.py")
        if "__pycache__" not in p.parts
    )


def _dotted(path: Path) -> str:
    """apps/api/app/modules/auth/service.py -> app.modules.auth.service"""
    rel = path.relative_to(APP_ROOT.parent)  # .../apps/api/app/...
    return ".".join(rel.with_suffix("").parts)


def _app_imports(path: Path) -> set[str]:
    """مجموعهٔ ماژول‌های app.* که این فایل مستقیم import می‌کند (absolute + relative)."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:
        return set()
    out: set[str] = set()
    own_pkg = _dotted(path).rpartition(".")[0]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == "app" or a.name.startswith("app."):
                    out.add(a.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                # relative: از پکیج فعلی بالا برو
                pkg = own_pkg
                for _ in range(node.level - 1):
                    pkg = pkg.rpartition(".")[0]
                base = f"{pkg}.{node.module}" if node.module else pkg
                if base == "app" or base.startswith("app."):
                    out.add(base)
            elif node.module and (node.module == "app" or node.module.startswith("app.")):
                out.add(node.module)
    return out


def _file_graph() -> dict[str, set[str]]:
    files = _py_files(MODULES_ROOT)
    dotted = {_dotted(p): p for p in files}
    graph: dict[str, set[str]] = {}
    for name, path in dotted.items():
        deps = set()
        for imp in _app_imports(path):
            # نزدیک‌ترین فایل/پکیجِ موجود به‌عنوان مقصد
            cand = imp
            while cand.startswith("app.modules."):
                if cand in dotted:
                    if cand != name:
                        deps.add(cand)
                    break
                # ممکن است attr یک ماژول باشد (from x.y import z) — پکیج والد را امتحان کن
                parent = cand.rpartition(".")[0]
                if parent == cand:
                    break
                cand = parent
        graph[name] = deps
    return graph


def _find_cycle(graph: dict[str, set[str]]) -> list[str] | None:
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}
    stack: list[str] = []

    def dfs(u: str) -> list[str] | None:
        color[u] = GRAY
        stack.append(u)
        for v in sorted(graph.get(u, ())):
            if v not in color:
                continue
            if color[v] == GRAY:
                return stack[stack.index(v):] + [v]
            if color[v] == WHITE:
                hit = dfs(v)
                if hit:
                    return hit
        color[u] = BLACK
        stack.pop()
        return None

    for n in sorted(graph):
        if color[n] == WHITE:
            hit = dfs(n)
            if hit:
                return hit
    return None


def test_modules_have_no_file_level_import_cycle():
    graph = _file_graph()
    assert graph, "no module files found"
    cycle = _find_cycle(graph)
    assert cycle is None, f"import cycle between module files: {' -> '.join(cycle)}"


def test_models_imports_only_base_from_app():
    imports = _app_imports(APP_ROOT / "models" / "models.py")
    bad = {i for i in imports if i != "app.core.database"}
    assert not bad, f"models.py must not import from app modules: {sorted(bad)}"


def test_content_legal_stays_a_leaf():
    imports = _app_imports(MODULES_ROOT / "content" / "legal.py")
    assert not imports, (
        "content/legal.py must stay import-leaf (auth/service.py depends on its "
        f"LEGAL_TEXT_VERSION constant); found app imports: {sorted(imports)}"
    )
