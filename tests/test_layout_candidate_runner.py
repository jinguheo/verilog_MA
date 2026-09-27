import json
import tempfile
import unittest
from pathlib import Path

import layout_candidate_runner as runner


class LayoutCandidateRunnerTest(unittest.TestCase):
    def test_baseline_uses_actual_lef_dimensions(self):
        baseline = runner._baseline()
        self.assertEqual(baseline["design"], "ppa3_adc_capture_top")
        by_kind = {item["kind"]: item for item in baseline["macros"]}
        self.assertAlmostEqual(by_kind["analog"]["width"], 223.710)
        self.assertAlmostEqual(by_kind["memory"]["height"], 460.280)

    def test_actual_optimizer_returns_legal_candidate(self):
        result = runner.optimize_candidate({"mode": "hybrid"})
        baseline = runner._baseline()
        placements = runner._validate(result["placements"], baseline)
        self.assertEqual(len(placements), 2)
        self.assertGreater(result["metrics"]["candidates_evaluated"], 0)
        self.assertEqual(result["metrics"]["halo_um"], 40.0)
        self.assertEqual(len(result["candidate_pool"]), 10)
        self.assertGreater(result["metrics"]["replace_sa_candidates"], 0)
        self.assertEqual(len({runner._placement_signature(item["placements"]) for item in result["candidate_pool"]}), 10)

    def test_candidate_generation_modes_are_separate(self):
        constrained = runner.optimize_candidate({"mode": "constrained"})
        annealed = runner.optimize_candidate({"mode": "sa"})
        self.assertTrue(all(item["method"] == "constrained-grid" for item in constrained["candidate_pool"]))
        self.assertTrue(all(item["method"] == "macro-replace+sa" for item in annealed["candidate_pool"]))
        self.assertGreater(len(annealed["candidate_pool"]), 0)

    def test_overlap_is_rejected_before_openlane(self):
        baseline = runner._baseline()
        placements = [{**item, "x": 100, "y": 100} for item in baseline["macros"]]
        with self.assertRaisesRegex(ValueError, "overlaps"):
            runner._validate(placements, baseline)

    def test_fast_screen_metrics_penalize_timing_violations(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary) / "42-openroad-stamidpnr-3"
            state_dir.mkdir()
            (state_dir / "state_out.json").write_text(json.dumps({"metrics": {
                "route__wirelength__estimated": 50000.0,
                "timing__setup__wns": -0.25,
                "timing__setup__tns": -1.0,
                "design__instance__utilization": 0.65,
            }}), encoding="utf-8")
            metrics = runner._screen_metrics(Path(temporary))
        self.assertEqual(metrics["checkpoint"], runner.SCREEN_STEP)
        self.assertEqual(metrics["estimated_wirelength_um"], 50000.0)
        self.assertGreater(metrics["ranking_score"], metrics["estimated_wirelength_um"])


if __name__ == "__main__":
    unittest.main()
