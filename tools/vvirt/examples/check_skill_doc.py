"""Check tools/vvirt/skills/vvirt: frontmatter, relative links, and that every runnable SKILL block in
references/layout-recipes.md really runs against the live vvirt server (through the real client).

    bash tools/vvirt/scripts/pyrun.sh tools/vvirt/examples/check_skill_doc.py
"""
import re
import sys
import time
from pathlib import Path

import yaml
from virtuoso_bridge import VirtuosoClient

SKILL_DIR = Path(__file__).resolve().parents[1] / "skills" / "vvirt"
fails: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        fails.append(name)


text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
fm = yaml.safe_load(re.match(r"---\n(.*?)\n---\n", text, re.S).group(1))
check("frontmatter has name/description/version", fm.get("name") == "vvirt" and len(fm.get("description", "")) > 80 and fm["metadata"].get("version"))
for md in [SKILL_DIR / "SKILL.md", *(SKILL_DIR / "references").glob("*.md")]:
    for link in re.findall(r"\]\((references/[^)#]+|[^)#:]+\.md)\)", md.read_text(encoding="utf-8")):
        base = md.parent if not link.startswith("references/") or md.parent.name == "references" else SKILL_DIR
        target = (SKILL_DIR / link) if link.startswith("references/") else (md.parent / link)
        check(f"link {md.name} -> {link}", target.exists(), str(target))

# every SKILL name the docs call must exist in the server (isCallable on the registered function table)
c = VirtuosoClient.from_env()
names = sorted(set(re.findall(r"\b((?:vv|db|dd|ge|le|tech)[A-Z]\w+)\(", " ".join(p.read_text(encoding="utf-8") for p in SKILL_DIR.rglob("*.md")))))
missing = [n for n in names if (c.execute_skill(f"isCallable('{n})").output or "").strip() != "t"]
check(f"all {len(names)} SKILL functions named in the skill exist", not missing, ", ".join(missing))

# run the recipe blocks
blocks = re.findall(r"```\n(.*?)```", (SKILL_DIR / "references" / "layout-recipes.md").read_text(encoding="utf-8"), re.S)
tag = str(int(time.time()))
c.execute_skill('unless(ddGetObj("designlib") ddCreateLib("designlib" "/mnt/d/MyWork/Veriolg_MA/tools/vvirt/workspace/libs/designlib"))')
c.execute_skill('let((o) o = ddGetObj("testlib" "chain") when(o ddDeleteObj(o)))')
c.execute_skill('cv = dbOpenCellViewByType("testlib" "chain" "layout" "maskLayout" "w")\n'
                'dbCreateParamInstByMasterName(cv "sky130_fd_sc_hd" "sky130_fd_sc_hd__inv_1" "layout" "U2" list(2.76 0.0) "R0")\n'
                'dbCreateParamInstByMasterName(cv "sky130_fd_sc_hd" "sky130_fd_sc_hd__inv_1" "layout" "U3" list(4.14 0.0) "R0")\n'
                'dbCreatePath(cv list("li1" "drawing") list(list(0.5 0.5) list(1.0 0.5)) 0.17)\ndbSave(cv)')
for i, b in enumerate(blocks, 1):
    code = b.replace('"testlib" "demo"', f'"testlib" "demo_{tag}"').replace('"inv_edit"', f'"inv_edit_{tag}"')
    if i == 3:
        code = code.replace('dbOpenCellViewByType("testlib" "chain"', 'dbOpenCellViewByType("testlib" "chain"')
    if i == 2:  # continues the cellview opened by block 1
        pass
    r = c.execute_skill(code)
    check(f"recipe block {i} runs", r.status.value == "success", "; ".join(r.errors)[:160])
c.execute_skill(f'let((o) o = ddGetObj("testlib" "demo_{tag}") when(o ddDeleteObj(o)))')
c.execute_skill(f'let((o) o = ddGetObj("designlib" "inv_edit_{tag}") when(o ddDeleteObj(o)))')
c.execute_skill('let((o) o = ddGetObj("testlib" "chain") when(o ddDeleteObj(o)))')
print("\nSKILL DOC OK" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
