"""vvGdsSummary / vvGdsCompare: known GDS files built with write_gds, expected numbers worked out by hand.
Run in WSL (needs the PDK like test_api):  cd tools/vvirt && python3 tests/test_gds_report.py
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt import gds_report, records, skill_funcs  # noqa: E402
from vvirt.gdsio import write_gds  # noqa: E402
from vvirt.odb import Database  # noqa: E402
from vvirt.skill_lang import Interp, SkillError  # noqa: E402
from vvirt.stdcell import StdCellLib  # noqa: E402

TMP = tempfile.TemporaryDirectory(dir="/tmp")
DB = Database(os.path.join(TMP.name, "libs"), StdCellLib())
IT = Interp()
skill_funcs.install(IT, DB, os.path.join(TMP.name, "out"))

SQ = [(0, 0), (1000, 0), (1000, 1000), (0, 1000)]  # 1 um square at dbu 1 nm


def gds(name, structures):
    p = os.path.join(TMP.name, name)
    write_gds(p, "t", structures)
    return p


def base():
    return {"leaf": {"polys": [(68, 20, SQ)], "paths": [], "texts": [(68, 5, (10, 10), "A")], "srefs": []},
            "top": {"polys": [(69, 20, [(0, 0), (2000, 0), (2000, 500), (0, 500)])],
                    "paths": [(68, 20, 200, [(0, 0), (3000, 0)], 0)], "texts": [],
                    "srefs": [("leaf", (500, 500), False, 0.0, 1.0)]}}


class GdsReportTest(unittest.TestCase):
    def test_summary_numbers(self):
        s = gds_report.summary(gds("a.gds", base()))
        self.assertEqual(records.get(s, "tops"), ["top"])
        self.assertEqual(records.get(s, "structures"), 2)
        top = [c for c in records.get(s, "cells") if records.get(c, "name") == "top"][0]
        self.assertEqual(records.get(top, "shapes"), 2)
        self.assertEqual(records.get(top, "references"), 1)
        layers = {records.get(l, "layer"): records.get(l, "areaUm2") for l in records.get(top, "layers")}
        self.assertAlmostEqual(layers[69], 1.0)   # 2 um x 0.5 um
        self.assertAlmostEqual(layers[68], 0.6)   # path 3 um long x 0.2 um wide
        self.assertEqual(records.get(top, "bboxUm"), [[0.0, -0.1], [3.0, 0.5]])

    def test_identical_even_if_vertex_loop_is_rotated_and_reversed(self):
        b = base()
        b["leaf"]["polys"] = [(68, 20, list(reversed(SQ[2:] + SQ[:2])))]
        r = gds_report.compare(gds("a1.gds", base()), gds("b1.gds", b))
        self.assertTrue(records.get(r, "identical"))
        self.assertEqual(records.get(r, "elementsAdded"), 0)

    def test_added_shape_is_reported_with_layer_and_box(self):
        b = base()
        b["top"]["polys"].append((70, 20, [(100, 100), (300, 100), (300, 400), (100, 400)]))
        r = gds_report.compare(gds("a2.gds", base()), gds("b2.gds", b))
        self.assertFalse(records.get(r, "identical"))
        self.assertEqual((records.get(r, "changedStructures"), records.get(r, "elementsAdded"), records.get(r, "elementsRemoved")), (1, 1, 0))
        ch = records.get(r, "changes")[0]
        self.assertEqual(records.get(ch, "name"), "top")
        ex = records.get(ch, "examples")[0]
        self.assertEqual((records.get(ex, "change"), records.get(ex, "layer")), ("added", 70))
        self.assertEqual(records.get(ex, "bboxUm"), [[0.1, 0.1], [0.3, 0.4]])

    def test_moved_reference_and_text_change(self):
        b = base()
        b["top"]["srefs"] = [("leaf", (800, 500), False, 0.0, 1.0)]
        b["leaf"]["texts"] = [(68, 5, (10, 10), "B")]
        r = gds_report.compare(gds("a3.gds", base()), gds("b3.gds", b))
        names = {records.get(c, "name"): c for c in records.get(r, "changes")}
        self.assertEqual(records.get(names["top"], "movedOrChangedReferences"), ["leaf"])
        self.assertEqual(records.get(names["leaf"], "textAdded"), ["B"])
        self.assertEqual(records.get(names["leaf"], "textRemoved"), ["A"])

    def test_structure_only_in_one_file_and_top_filter(self):
        b = base()
        b["extra"] = {"polys": [(68, 20, SQ)], "paths": [], "texts": [], "srefs": []}
        pa, pb = gds("a4.gds", base()), gds("b4.gds", b)
        r = gds_report.compare(pa, pb)
        self.assertEqual(records.get(r, "structuresOnlyInB"), ["extra"])
        self.assertFalse(records.get(r, "identical"))
        self.assertEqual(records.get(gds_report.compare(pa, pb, top="top"), "changedStructures"), 0)

    def test_through_skill_and_path_restriction(self):
        pa, pb = gds("a5.gds", base()), gds("b5.gds", base())
        self.assertTrue(IT.eval_text(f'vvGet(vvGdsCompare("{pa}" "{pb}") "identical")'))
        self.assertEqual(IT.eval_text(f'vvGet(vvGdsSummary("{pa}") "structures")'), 2)
        with self.assertRaises(SkillError):
            IT.eval_text('vvGdsSummary("/etc/passwd")')
        with self.assertRaises(SkillError):
            IT.eval_text(f'vvGdsSummary("{pa}" "nope")')


if __name__ == "__main__":
    unittest.main(verbosity=1)
