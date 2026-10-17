import json
import unittest
from pathlib import Path

import failure_knowledge as fk

DAQ = Path(__file__).resolve().parents[1] / "samples" / "sample_test_4" / "asic" / "daq_subsystem"


def placements(name):
    config = json.loads((DAQ / name).read_text(encoding="utf-8"))
    out = []
    for definition in config["MACROS"].values():
        for instance, p in definition["instances"].items():
            out.append({"instance": instance, "x": float(p["location"][0]), "y": float(p["location"][1]), "orientation": p.get("orientation", "N")})
    return out


class FailureKnowledgeTest(unittest.TestCase):
    def test_grid_baseline_passes_every_rule(self):
        r = fk.check_placements("daq_subsystem", placements("config_hierarchical.json"))
        self.assertEqual(r["features"]["row_channel_um"], 300.0)
        self.assertEqual(r["features"]["topology"], "grid")
        self.assertEqual(r["hits"], [])
        self.assertFalse(r["rejected"])

    def test_narrow_channel_candidate_is_rejected_like_the_real_failure(self):
        r = fk.check_placements("daq_subsystem", placements("config_hierarchical_macrotetris.json"))
        self.assertEqual(r["features"]["row_channel_um"], 100.0)
        self.assertEqual([h["id"] for h in fk.rejecting(r["hits"])], ["daq-row-channel-min-300"])

    def test_scattered_candidate_is_only_warned_about(self):
        r = fk.check_placements("daq_subsystem", placements("config_hierarchical_macrotetris_v2.json"))
        self.assertEqual(r["features"]["topology"], "scattered")
        self.assertIsNone(r["features"]["row_channel_um"])  # one band on y, so no row channel (same as the TypeScript gate)
        self.assertEqual([h["id"] for h in r["hits"]], ["daq-scattered-global-route-congestion"])
        self.assertFalse(r["rejected"])

    def test_same_row_packing_gaps_are_not_channels(self):
        # 4 columns x 2 rows: x-axis has 4 bands with 100 um gaps, but the y-axis has fewer bands, so only the row channel counts
        macros = fk.macros_from_placements(placements("config_hierarchical.json"))
        gaps, axis = fk.internal_projection_gaps(macros)
        self.assertEqual((gaps, axis), ([300.0], "y"))

    def test_ppa3_adc_left_fragment_pattern(self):
        def p(x):
            return [{"instance": "u_adc", "x": x, "y": 150.0, "orientation": "N"}]
        self.assertTrue(fk.check_placements("ppa3_adc_capture_top", p(40.0))["rejected"])  # 9.76 um fragment, observed failure
        self.assertFalse(fk.check_placements("ppa3_adc_capture_top", p(30.24))["rejected"])
        self.assertFalse(fk.check_placements("ppa3_adc_capture_top", p(50.0))["rejected"])

    def test_reject_rules_need_a_bracketing_pass_and_fail(self):
        db = fk.load_db()
        for rule in db["nogoods"]:
            if rule["enforce"] == "reject":
                self.assertTrue(rule["evidence"]["pass"] and rule["evidence"]["fail"], rule["id"])
            else:
                self.assertEqual(rule["enforce"], "record_only")

    def test_only_completed_or_failed_runs_are_usable_labels(self):
        db = fk.load_db()
        for r in db["records"]:
            self.assertEqual(r["usable_as_label"], r["status"] in {"completed_flow", "failed"}, r["id"])
        # interrupted reruns (host sleep) are not evidence about the geometry
        interrupted = [r for r in db["records"] if r["status"] == "incomplete_no_error"]
        self.assertTrue(interrupted and not any(r["usable_as_label"] for r in interrupted))


if __name__ == "__main__":
    unittest.main()
