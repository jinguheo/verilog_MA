"""Evidence records: classification, unknown-with-reason, freshness, comparison, and the OpenLane run builder."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import evidence as E  # noqa: E402
import ppa3_evidence  # noqa: E402


def make_run(root: Path, name: str, steps: dict[str, dict | None], cfg: dict | None = None, final: bool = False) -> Path:
    """steps: step folder -> metrics dict (finished) or None (folder exists, no state_out.json)."""
    run = root / "runs" / name
    run.mkdir(parents=True)
    (run / "resolved.json").write_text(json.dumps(cfg or {"CLOCK_PERIOD": 20, "MAGIC_DRC_USE_GDS": True, "PDK": "sky130A",
                                                           "PDK_ROOT": "/x/versions/" + "a" * 40 + "/sky130A"}), encoding="utf8")
    for step, metrics in steps.items():
        (run / step).mkdir()
        if metrics is not None:
            (run / step / "state_out.json").write_text(json.dumps({"metrics": metrics}), encoding="utf8")
    if final:
        (run / "final").mkdir()
        (run / "final" / "metrics.json").write_text("{}", encoding="utf8")
    return run


class EvidenceCoreTest(unittest.TestCase):
    def build(self, tmp: str) -> E.Evidence:
        root = Path(tmp)
        f = root / "m.json"
        f.write_text('{"a": 1}', encoding="utf8")
        ev = E.Evidence({"kind": "t", "id": "x"}, root, "test")
        fid = ev.add_input(f, "metrics")
        ev.observed("o1", "a", 1, fid, "a")
        ev.derived("d1", "a_positive", True, ["o1"], "a > 0")
        ev.unknown("u1", "b", "not measured")
        ev.inferred("i1", "state", "ok", "because", "medium", ["point in time"])
        return ev

    def test_valid_record_and_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.build(tmp).to_dict()
            self.assertEqual(E.validate(b), [])
            self.assertEqual(b["coverage"], {"observed": 1, "derived": 1, "inferred": 1, "unknown": 1})

    def test_derived_cannot_rest_on_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            ev = self.build(tmp)
            with self.assertRaises(ValueError):
                ev.derived("d2", "x", 1, ["nope"], "r")
            b = ev.to_dict()
            b["claims"].append({"id": "d3", "kind": "derived", "name": "bad", "value": 1, "from": ["u1"], "rule": "r"})
            b["coverage"]["derived"] += 1
            self.assertTrue(any("unknown claim u1" in e for e in E.validate(b)))

    def test_unknown_must_have_null_value_and_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.build(tmp).to_dict()
            u = next(c for c in b["claims"] if c["kind"] == "unknown")
            u["value"] = 0  # an unknown silently turned into zero is the failure this model exists to prevent
            self.assertTrue(any("must have value null" in e for e in E.validate(b)))

    def test_stale_input_detected_by_rehash(self):
        with tempfile.TemporaryDirectory() as tmp:
            b = self.build(tmp).to_dict()
            self.assertEqual(E.validate(b, Path(tmp)), [])
            (Path(tmp) / "m.json").write_text('{"a": 2}', encoding="utf8")
            self.assertTrue(any("stale" in e for e in E.validate(b, Path(tmp))))
            (Path(tmp) / "m.json").unlink()
            self.assertTrue(any("no longer exists" in e for e in E.validate(b, Path(tmp))))

    def test_compare_never_calls_unknown_equal(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.build(tmp).to_dict()
            b = copy.deepcopy(a)
            b["subject"]["id"] = "y"
            next(c for c in b["claims"] if c["name"] == "a")["value"] = 3
            b["context"] = {"CLOCK_PERIOD": 54}
            a["context"] = {"CLOCK_PERIOD": 52}
            r = E.compare(a, b)
            rows = {x["name"]: x for x in r["rows"]}
            self.assertEqual(rows["a"]["status"], "changed")  # 'a' declares no context dependency here
            self.assertEqual(rows["a"]["delta"], 2)
            self.assertEqual(rows["b"]["status"], "incomparable")  # unknown on both sides: not equal, not a delta
            self.assertFalse(r["like_for_like"])
            self.assertEqual(r["context_differs"][0]["key"], "CLOCK_PERIOD")

    def test_value_depending_on_a_differing_setting_is_not_like_for_like(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.build(tmp).to_dict()
            next(c for c in a["claims"] if c["name"] == "a")["depends_on_context"] = ["MAGIC_DRC_USE_GDS"]
            b = copy.deepcopy(a)
            next(c for c in b["claims"] if c["name"] == "a")["value"] = 0
            a["context"], b["context"] = {"MAGIC_DRC_USE_GDS": True}, {"MAGIC_DRC_USE_GDS": False}
            row = next(x for x in E.compare(a, b)["rows"] if x["name"] == "a")
            self.assertEqual(row["status"], "not_like_for_like")  # 1 -> 0 must not read as an improvement
            self.assertIn("MAGIC_DRC_USE_GDS", row["why"])
            b["context"] = dict(a["context"])
            self.assertEqual(next(x for x in E.compare(a, b)["rows"] if x["name"] == "a")["status"], "changed")

    def test_unknown_on_one_side_is_incomparable(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.build(tmp).to_dict()
            b = copy.deepcopy(a)
            c = next(c for c in b["claims"] if c["name"] == "a")
            c.update(kind="unknown", value=None, reason="gone")
            c.pop("source")
            row = next(x for x in E.compare(a, b)["rows"] if x["name"] == "a")
            self.assertEqual(row["status"], "incomparable")
            self.assertIn("right", row["why"])


class Ppa3BuilderTest(unittest.TestCase):
    M = {"timing__setup__ws": 9.0, "timing__hold__ws": 0.1, "route__drc_errors": 0}

    def test_unfinished_run_reports_unknowns_with_reasons_not_zeros(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = make_run(root, "r1", {"01-verilator-lint": dict(self.M), "02-yosys-synthesis": dict(self.M), "03-openroad-floorplan": None})
            b = ppa3_evidence.build(run, root, {"label": "t"}, set(), None)
            self.assertEqual(E.validate(b, root), [])
            by = {c["name"]: c for c in b["claims"]}
            self.assertEqual(by["setup_ws"]["kind"], "observed")
            self.assertEqual(by["setup_ws"]["source"]["step"], "02-yosys-synthesis")
            self.assertEqual(by["setup_ws"]["source"]["first_seen_step"], "01-verilator-lint")
            for m in ("lvs", "magic_drc", "klayout_drc", "xor"):
                self.assertEqual(by[m]["kind"], "unknown", m)
                self.assertIsNone(by[m]["value"])
                self.assertIn("last finished step: 02-yosys-synthesis", by[m]["reason"])
            self.assertEqual(by["state"]["value"], "stopped")
            self.assertEqual(by["state"]["kind"], "inferred")
            self.assertEqual(by["signoff_counts_present"]["value"], 1)  # only route_drc has a value

    def test_started_but_unfinished_step_is_named_in_the_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = make_run(root, "r2", {"01-verilator-lint": dict(self.M), "02-netgen-lvs": None})
            b = ppa3_evidence.build(run, root, {}, set(), None)
            lvs = next(c for c in b["claims"] if c["name"] == "lvs")
            self.assertIn("02-netgen-lvs started but has no state_out.json", lvs["reason"])

    def test_resumed_run_marks_inherited_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = make_run(root, "r3", {"01-klayout-drc": dict(self.M), "02-checker-magicdrc": dict(self.M)}, final=True)
            b = ppa3_evidence.build(run, root, {}, set(), None)
            self.assertTrue(b["context"]["resumed_from_earlier_state"])
            setup = next(c for c in b["claims"] if c["name"] == "setup_ws")
            self.assertIn("inherited", setup["note"])
            self.assertEqual(next(c for c in b["claims"] if c["name"] == "state")["value"], "finished")

    def test_state_running_and_unknown_process_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = make_run(root, "r4", {"01-verilator-lint": dict(self.M)})
            self.assertEqual(next(c for c in ppa3_evidence.build(run, root, {}, {"r4"}, None)["claims"] if c["name"] == "state")["value"], "running")
            unk = ppa3_evidence.build(run, root, {}, None, None)
            st = next(c for c in unk["claims"] if c["name"] == "state")
            self.assertEqual((st["value"], st["confidence"]), ("unknown", "low"))

    def test_def_mode_magic_drc_adds_a_limitation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = make_run(root, "r5", {"01-verilator-lint": dict(self.M)}, cfg={"MAGIC_DRC_USE_GDS": False, "ERROR_ON_MAGIC_DRC": False})
            b = ppa3_evidence.build(run, root, {}, set(), None)
            self.assertTrue(any("DEF" in lim and "not a pass" in lim for lim in b["limitations"]))
            self.assertTrue(any("non-fatal" in lim for lim in b["limitations"]))
            self.assertIn("NOT examined", next(c for c in b["claims"] if c["name"] == "magic_drc_mode")["value"])

    def test_empty_run_has_only_unknown_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = make_run(root, "r6", {})
            b = ppa3_evidence.build(run, root, {}, set(), None)
            self.assertEqual(E.validate(b, root), [])
            self.assertTrue(all(c["kind"] == "unknown" for c in b["claims"] if c["name"] in ppa3_evidence.METRICS))


if __name__ == "__main__":
    unittest.main()
