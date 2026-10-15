"""vv* API contract: every function is described in the registry, results are named-field records, vvHelp/vvGet work.
Runs the interpreter in-process (no server); needs the sky130A PDK, so run it in WSL:

    cd tools/vvirt && python3 tests/test_api.py
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from vvirt import api_registry, records, skill_funcs  # noqa: E402
from vvirt.odb import Database  # noqa: E402
from vvirt.skill_lang import Interp, SkillError, skill_repr  # noqa: E402
from vvirt.stdcell import StdCellLib  # noqa: E402

TMP = tempfile.TemporaryDirectory()
STD = StdCellLib()
DB = Database(os.path.join(TMP.name, "libs"), STD)
DB.create_lib("tlib")
IT = Interp()
skill_funcs.install(IT, DB, os.path.join(TMP.name, "out"))


def run(src):
    return IT.eval_text(src)


class RegistryTest(unittest.TestCase):
    def test_every_vv_function_is_described_and_nothing_stale(self):
        registered = {k for k in IT.funcs if k.startswith("vv")}
        described = set(api_registry.names())
        self.assertEqual(sorted(registered - described), [], "vv* functions without a registry entry (add one in api_registry.py)")
        self.assertEqual(sorted(described - registered), [], "registry entries for functions that no longer exist")

    def test_entries_are_complete(self):
        for n, e in api_registry.API.items():
            for key in ("group", "summary", "args", "returns", "example"):
                self.assertIn(key, e, n)
            self.assertTrue(e["summary"].strip() and e["example"].strip(), n)

    def test_examples_name_their_own_function(self):
        for n, e in api_registry.API.items():
            self.assertIn(n + "(", e["example"], n)

    def test_vvapi_and_vvhelp(self):
        rows = run("vvApi()")
        self.assertEqual({r[1] for r in rows}, set(api_registry.names()))
        h = run('vvHelp("vvRoute")')
        self.assertEqual(records.get(h, "name"), "vvRoute")
        self.assertIn("limitations", records.get(h, "returns"))
        with self.assertRaises(SkillError) as cm:
            run('vvHelp("vvRout")')
        self.assertIn("vvRoute", cm.exception.message)  # near-miss names are suggested


class NamedResultsTest(unittest.TestCase):
    def test_cellinfo_is_a_record_and_positional_still_works(self):
        info = run('vvCellInfo("sky130_fd_sc_hd__inv_1")')
        self.assertEqual(records.keys(info), ["name", "library", "width", "height", "pins"])
        self.assertEqual(run('vvGet(vvCellInfo("sky130_fd_sc_hd__inv_1") "width")'), 1.38)
        pin = run('vvPin("sky130_fd_sc_hd__inv_1" "Y")')
        self.assertEqual(records.keys(pin), ["name", "direction", "use", "layer", "bbox", "center"])
        bb = records.get(pin, "bbox")
        self.assertAlmostEqual(records.get(pin, "center")[0], (bb[0][0] + bb[1][0]) / 2, places=3)
        legacy = run('vvCellInfo("sky130_fd_sc_hd__inv_1" ?positional t)')
        self.assertEqual(legacy[0], "sky130_fd_sc_hd__inv_1")
        self.assertEqual(legacy[1], 1.38)

    def test_vvget_paths_and_missing_keys(self):
        self.assertIsNone(run('vvGet(vvCellInfo("sky130_fd_sc_hd__inv_1") "nosuchfield")'))
        self.assertIsNone(run('vvGet(nil "a" "b")'))
        self.assertEqual(run('vvGet(vvCellInfo("sky130_fd_sc_hd__inv_1") "pins" 0 "name")') in ("A", "Y", "VGND", "VNB", "VPB", "VPWR"), True)

    def test_vvpin_unknown_pin_lists_the_real_ones(self):
        with self.assertRaises(SkillError) as cm:
            run('vvPin("sky130_fd_sc_hd__inv_1" "Q")')
        self.assertIn("Pins:", cm.exception.message)
        self.assertIn("Y", cm.exception.message)

    def test_layers_and_viadefs_are_records_and_work(self):
        lay = run("vvLayers()")
        self.assertEqual(records.keys(lay[0]), ["layer", "purposes"])
        via = run("vvViaDefs()")  # this raised a TypeError before the rewrite (ViaDef was indexed like a dict)
        self.assertEqual(records.keys(via[0]), ["name", "bottom", "cut", "top", "cutSize"])
        self.assertTrue(any(records.get(v, "name") == "M1M2_PR" for v in via))
        self.assertIsInstance(run("vvViaDefs(?positional t)")[0][0], str)

    def test_route_and_placerow_records(self):
        run('cvt = dbOpenCellViewByType("tlib" "t1" "layout" "maskLayout" "w")')
        row = run('vvPlaceRow(cvt "A" list("inv_1" "nand2_1") list(0.0 0.0) 0)')
        self.assertEqual(records.keys(row[0]), ["name", "cell", "x", "orient"])
        self.assertEqual([records.get(r, "cell") for r in row], ["inv_1", "nand2_1"])
        self.assertEqual(run('vvPlaceRow(cvt "B" list("inv_1") list(0.0 2.72) 1 ?positional t)')[0][1], "inv_1")
        run('dbCreateRect(cvt list("met2" "drawing") list(list(-0.15 -0.15) list(0.15 0.15)))')
        r = run('vvRoute(cvt "met2" list(0 0) list(3 0))')
        self.assertEqual(records.keys(r), ["how", "width", "space", "points", "limitations"])
        self.assertTrue(records.get(r, "limitations"))
        self.assertEqual(skill_repr(run('vvRoute(cvt "met2" list(0 3) list(3 3) ?positional t)'))[0], "(")

    def test_check_report_violations_are_records(self):
        run('cvr = dbOpenCellViewByType("tlib" "t2" "layout" "maskLayout" "w")')
        run('dbCreateRect(cvr list("met2" "drawing") list(list(0 0) list(1 0.3)))')
        run('dbCreateRect(cvr list("met2" "drawing") list(list(0 0.4) list(1 0.7)))')  # gap 0.1 < 0.14
        rep = run('vvCheckReport(cvr list("met2"))')
        self.assertEqual(records.get(rep, "status"), "violations")
        v = records.get(rep, "violations")[0]
        self.assertEqual(records.keys(v), ["layer", "rule", "required", "bbox"])
        self.assertEqual(records.get(rep, "checkedLayers")[0], [["layer", "met2"], ["rules", ["minWidth", "minSpace", "minArea"]]])


class RecordsTest(unittest.TestCase):
    def test_get_and_keys(self):
        r = records.rec(("a", 1), ("b", [records.rec(("c", 2))]))
        self.assertEqual(records.get(r, "b", 0, "c"), 2)
        self.assertIsNone(records.get(r, "b", 5, "c"))
        self.assertEqual(records.keys(r), ["a", "b"])
        self.assertIsNone(records.keys("not a record"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
